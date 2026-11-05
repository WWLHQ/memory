// 自有 Agent 会话自动采集器（§5.1 双链路补偿 · P0 自有形态，可调周期对账，预设 5min）
//
// 设计原则（诚实、不造假）：
//   · 只读"确实存在"的会话日志（目录/文件缺失 → 诚实 skip + 原因，绝不造假数据）
//   · 角色白名单（批次35）：源缺省**只采 user**——助手消息是「我先看一下…/让我检查…」这类过程旁白
//     的主体（本机账本 1642 行实测：入库噪声全部来自助手消息）。只有 Agent 工作日志的源
//     （workbuddy `##` 分块）显式写 roles:['assistant'] 保留采集，旁白交给 L0→L1 质量门拦。
//   · 增量：per-file 游标 {offset, contentSha}，只读 offset 之后的新内容；文件被截断/重写 → 重置全量
//   · 幂等：每条消息 SHA-256(content + source + seq) 去重（§5.4），跨周期不重复入库
//   · 入库：新消息 → 调用方注入的 write（coreWrite，L0 AES-256-GCM → L1–L6 阶梯）
//   · 周期：createReconciler(intervalMs) 驱动；预设 5min（300000ms，§5.1 短周期对账）
//   · 游标持久化：saveCursor/loadCursor（主进程落 userData），重启断点续采
//
// 内置两种解析器（pluggable，按 source.parser 路由）：
//   · claude    ：~/.claude/projects/*/*.jsonl（message.content 为字符串或 [{type:text|tool_result}]）
//   · workbuddy ：~/workbuddy/*/.workbuddy/memory/*.md（UTF-8 Markdown，## 分块 + 列表项）
// 其它 Agent 可实现 parseLine/parseMarkdown 注入。
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { isL0LockedError } from './errors.ts';

/** 让出事件循环（避免大文件批量处理时阻塞 Electron 主进程 → 窗口"未响应"） */
const yieldToEventLoop = (): Promise<void> => new Promise((res) => setImmediate(res));

// ─── 解析器抽象 ────────────────────────────────────────────────────────────────

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  session_id?: string;
  /** 源内唯一序（用于幂等键；缺省用全局 seq） */
  seq?: number;
}

export type LineParser = (line: string) => ParsedMessage[] | ParsedMessage | null;

/** 整块（Markdown）解析器（workbuddy 等）：全文 → 消息列表 */
export type BlockParser = (text: string, sourceName: string) => ParsedMessage[];

// ─── Claude Code JSONL 解析器 ─────────────────────────────────────────────────

/**
 * Claude Code 会话日志（JSONL）：
 *   · type:"user" 且 message.content 为字符串 → 用户输入
 *   · type:"assistant" 且 message.content 含 {type:"text"} 块 → 助手正文
 *   · tool_result / thinking / queue-operation / attachment → 不采（非对话正文）
 *   · isMeta:true（斜杠命令回显、系统注入的提醒）→ 不采（批次35：那不是用户说的话）
 * 容错：坏行/半行跳过；content 数组里只取 text 块并拼接。
 * 注：本解析器两种角色都解析出来，角色白名单在 scanSessionLogs 按 source.roles 过滤（采集口收口）。
 */
export function parseClaudeJsonl(line: string): ParsedMessage[] | null {
  const t = line.trim();
  if (!t) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(t); } catch { return null; }
  if (o.type !== 'user' && o.type !== 'assistant') return null;
  if (o.isMeta === true) return null;
  const msg = o.message as { role?: string; content?: unknown } | undefined;
  if (!msg) return null;
  const sid = typeof o.sessionId === 'string' ? o.sessionId : undefined;
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || undefined : undefined;
  const apiBlockIndex: unknown = o.apiBlockIndex;
  const seq = typeof apiBlockIndex === 'number' ? apiBlockIndex : undefined;

  let text: string;
  const c = msg.content;
  if (typeof c === 'string') {
    text = c;
  } else if (Array.isArray(c)) {
    // 只取 type:"text" 块的 text；tool_result/thinking 不采
    const parts = c
      .map((b) => (b && typeof b === 'object' && (b as { type?: string; text?: unknown }).type === 'text'
        ? String((b as { text?: unknown }).text ?? '')
        : ''))
      .filter(Boolean);
    text = parts.join('\n');
  } else {
    return null;
  }
  if (text.trim() === '') return null;
  const role: 'user' | 'assistant' = o.type === 'user' ? 'user' : 'assistant';
  return [{ role, content: text, ts, session_id: sid, seq }];
}

// ─── workbuddy Markdown 解析器 ────────────────────────────────────────────────

/**
 * workbuddy 日志（UTF-8 Markdown）：按 `##` 二级标题分块，每块是一个"事件"。
 *   · 块标题行 → 该事件的描述前缀
 *   · `-` 列表项 / 普通段落行 → 事件正文
 * role 统一标 'assistant'（这是 Agent 自己写的工作日志/记忆），category 由上层按内容归。
 */
export function parseWorkbuddyMd(text: string, _sourceName?: string): ParsedMessage[] {
  const out: ParsedMessage[] = [];
  const lines = text.split('\n');
  let current: { title: string; body: string[] } | null = null;
  let seq = 0;
  const flush = () => {
    if (current && (current.title || current.body.length)) {
      const content = [current.title ? `## ${current.title}` : null, ...current.body]
        .filter((x) => x && x.trim() !== '')
        .join('\n');
      if (content.trim() !== '') {
        out.push({ role: 'assistant', content, seq: seq++ });
      }
    }
    current = null;
  };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    if (/^##\s/.test(l)) {
      flush();
      current = { title: l.replace(/^##\s*/, '').trim(), body: [] };
    } else if (current) {
      // 跳过文件主标题（# 一级）与空行，其余归入当前块
      if (/^#\s/.test(l)) continue;
      current.body.push(l);
    }
  }
  flush();
  return out;
}

// ─── DSH session_projcache 解析器（完整会话记录：turnOutline 的 prompt/response 全文） ───

/**
 * DSH（DeepSeek Harness）会话完整记录（~/.dsh/storages/session_projcache/sessions/*.json）：
 *   · 结构 { version, record: { identity: {cwd, createdAt, ...}, rows: { turnOutline: {val: {turns: [{turn, seq, prompt, response}]}} } } }
 *   · turns[].prompt = 用户消息全文；turns[].response = 助手回复全文（一字不漏，markdown 原始文本）
 *   · 按 turn 采 2 条（user + assistant）；response 为空（纯工具轮）→ 只采 user
 *   · 文件被 DSH 追加写（turns 数组变长/内容更新）→ 全文指纹变了就重新采全量 + seenHashes 幂等兜底
 * 这是 DSH 唯一的「逐条完整会话正文」落盘位置（session.v4.jsonl.zstd 只有 1 行会话壳元数据，不含对话正文）。
 */
export function parseDshProjcache(text: string, _sourceName?: string): ParsedMessage[] {
  let o: { record?: { identity?: { cwd?: string; createdAt?: number }; rows?: Record<string, { val?: unknown }> } };
  try { o = JSON.parse(text); } catch { return []; }
  const rec = o.record;
  if (!rec || typeof rec !== 'object') return [];
  const outlineRow = rec.rows?.turnOutline;
  const turns = (outlineRow?.val as { turns?: Array<{ turn?: number; seq?: number; prompt?: string; response?: string }> } | undefined)?.turns;
  if (!Array.isArray(turns)) return [];
  const out: ParsedMessage[] = [];
  for (const t of turns) {
    if (!t || typeof t !== 'object') continue;
    const ts = typeof rec.identity?.createdAt === 'number' ? rec.identity.createdAt : undefined;
    const prompt = typeof t.prompt === 'string' ? t.prompt : '';
    const response = typeof t.response === 'string' ? t.response : '';
    if (prompt.trim() !== '') {
      out.push({ role: 'user', content: prompt, ts, seq: t.seq, session_id: `dsht${t.turn ?? t.seq}` });
    }
    if (response.trim() !== '') {
      out.push({ role: 'assistant', content: response, ts, seq: (t.seq ?? 0) + 1, session_id: `dsht${t.turn ?? t.seq}` });
    }
  }
  return out;
}

// ─── 采集源配置 ───────────────────────────────────────────────────────────────

export interface SessionLogSource {
  /** 来源标识（source_agent，写进审计 + 记忆 created_by_agent） */
  name: string;
  /** 解析器类型 */
  parser: 'claude-jsonl' | 'workbuddy-md' | 'jsonl' | 'markdown' | 'dsh-zstd-jsonl' | 'dsh-projcache';
  /** 会话日志目录（缺失 → 诚实 skip） */
  dir: string;
  /** 文件名过滤（缺省按 parser 选：jsonl 类 *.jsonl，markdown 类 *.md，dsh-zstd-jsonl 类 *.jsonl.zstd） */
  filePattern?: RegExp;
  /** 递归子目录（Claude projects 下的 jsonl 用） */
  recursive?: boolean;
  /** 最大递归深度（缺省 4，防 node_modules 等深坑） */
  maxDepth?: number;
  /** 自定义行解析器（parser='jsonl' 时可覆盖 claude-jsonl） */
  parseLine?: LineParser;
  /** 自定义块解析器（parser='markdown'/'dsh-projcache' 时可覆盖 workbuddy-md / parseDshProjcache） */
  parseBlock?: BlockParser;
  /** 单文件单次最多采多少条（防巨量灌入，缺省 500） */
  maxMessagesPerFile?: number;
  /** 记忆类别缺省（assistant 日志 → 多为 fact/pitfall） */
  category?: string;
  /**
   * 采集角色白名单（批次35）。**缺省只采 `user`**——助手侧消息是过程旁白/进度自述的主体
   * （本机账本 1642 行实测：噪声全部来自助手消息），质量门拦不住的那部分应该根本不进采集口。
   * 例外：只存在 Agent 自己工作日志的源（workbuddy `##` 分块记忆）， parser 没有角色可分，
   * 显式写 `roles: ['assistant']` 保留采集，旁白交给 L0→L1 质量门拦。
   */
  roles?: Array<ParsedMessage['role']>;
}

/** 批次35 缺省采集角色：只采用户消息 */
const DEFAULT_COLLECT_ROLES: Array<ParsedMessage['role']> = ['user'];

// ─── zstd 增量解压（DSH session.v4.jsonl.zstd 专用） ─────────────────────────

/** zstd frame magic（小端 readUInt32LE 值 = 0xfd2fb528）。
 *  为支持 offset 增量：按 8-byte magic 定位下一个 frame 起点，跳过 offset 之前的所有 frame。
 *  当前 frame 内若被截断（写一半）→ zstdDecompressSync 报错 → 跳过到下一 frame 或文件尾。 */
const ZSTD_FRAME_MAGIC = 0xfd2fb528;

/** 找到 offset 之后第一个 zstd frame 的字节偏移（逐字节扫 magic） */
function nextFrameAt(buf: Buffer, from: number): number {
  for (let i = from; i + 4 <= buf.byteLength; i++) {
    if (buf.readUInt32LE(i) === ZSTD_FRAME_MAGIC) return i;
  }
  return -1;
}

/** 解一个 zstd frame（从 frameStart 到下一个 frame 起点或文件尾）→ 文本。
 *  注意：Node 的 zstdDecompressSync 对截断 frame 不抛错而是返回空串（静默丢数据），
 *  故先做结构完整性检查（zstdFrameComplete），不完整一律返回 null。 */
function decompressFrame(buf: Buffer, frameStart: number): string | null {
  const next = nextFrameAt(buf, frameStart + 4); // 跳过当前 magic，找下一个 frame
  const end = next >= 0 ? next : buf.byteLength;
  if (!zstdFrameComplete(buf, frameStart, end)) return null;
  const slice = buf.subarray(frameStart, end);
  try {
    return zstdDecompressSync(slice).toString('utf8');
  } catch {
    return null;
  }
}

/** frame header 结束位置（跳过 FHD/Window_Descriptor/DictID/FCS）；头部不全 → -1 */
function zstdHeaderEnd(buf: Buffer, start: number): number {
  if (start + 5 > buf.byteLength) return -1;
  const fhd = buf[start + 4];
  const single = (fhd >> 5) & 1;
  const dictFlag = fhd & 3;
  const fcsFlag = (fhd >> 6) & 3;
  let p = start + 5;
  if (!single) p += 1;
  p += [0, 1, 2, 4][dictFlag];
  p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
  return p <= buf.byteLength ? p : -1;
}

/** 结构完整性：按 block header 走到 last_block 且落在切片内 = 完整；否则视为截断/损坏。
 *  覆盖"写入一半"场景（zstdDecompressSync 对截断帧返回空串，不能用解压结果判断）。 */
function zstdFrameComplete(buf: Buffer, start: number, end: number): boolean {
  let p = zstdHeaderEnd(buf, start);
  if (p < 0) return false;
  while (p + 3 <= end) {
    const v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    const last = v & 1;
    const type = (v >> 1) & 3;
    const size = v >>> 3;
    if (type === 3) return false; // reserved block type
    p += type === 1 ? 1 : size; // RLE 块数据仅 1 字节
    if (p > end) return false;
    if (last) return true;
  }
  return false;
}

// ─── 增量游标（可持久化） ─────────────────────────────────────────────────────

export interface FileCursor {
  /** 游标版本：2 = 字节偏移（D4）；旧版字符游标无 v → 一律重置，避免中文等多字节内容错位 */
  v?: number;
  offset: number;      // 已消费字节偏移（JSONL 行首 / zstd frame 起点 / Markdown 文件长度）
  contentSha: string;  // 已消费前缀（buf[0, offset)）的 SHA-256；不一致 = 截断/重写 → 重置
  lastRun: number;
  /** Markdown/整块解析：限流中断时的下一条消息下标（仅 contentSha 未变时有效） */
  msgIndex?: number;
}

/** 当前游标版本（字节语义） */
const CURSOR_V = 2;

export interface CollectorCursor {
  [key: string]: FileCursor;
}

export interface CollectedItem {
  key: string;          // `${source.name}:${file}`
  agent: string;        // source.name
  role: string;
  content: string;
  hash: string;         // 幂等键 SHA-256
  seq: number;
  category?: string;
}

// ─── 目录枚举（递归，带深度上限；异步，避免阻塞事件循环） ──────────────────────

async function listFiles(dir: string, pattern: RegExp, recursive: boolean, maxDepth: number): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.git' || e === '.playwright' || e === '.chrome') continue; // 避开深坑
      const full = join(d, e);
      let isDir: boolean;
      try {
        isDir = (await stat(full)).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (recursive && depth < maxDepth) await walk(full, depth + 1);
      } else if (pattern.test(e)) {
        found.push(full);
      }
    }
  };
  await walk(dir, 0);
  return found;
}

// ─── 扫描 + 增量 + 幂等（纯 fs，不写库；写库由 applyScanToStore 负责） ────────

export interface ScanResult {
  collected: number;
  deduped: number;
  /** 批次35：被角色白名单（缺省只采 user）挡下的消息数——不是幂等命中，是采集口径 */
  roleSkipped: number;
  skipped: string[];
  items: CollectedItem[];
  cursors: CollectorCursor;
  ts: number;
}

export interface ScanOptions {
  sources: SessionLogSource[];
  /** 已持久化游标（增量起点）；缺省空（首次全量） */
  cursor?: CollectorCursor;
  /** 幂等 hash 集合（跨周期去重；缺省空） */
  seenHashes?: Set<string>;
  /** 本轮最多产出多少条（限流，防大批量灌入卡死事件循环；缺省不限） */
  maxItemsPerRun?: number;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function sha256Buf(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

/**
 * 扫所有会话源，增量采新消息（返回条目 + 新游标，不写库）。
 * 异步（fs/promises + setImmediate 让出事件循环，避免 Electron 主进程"未响应"）。
 * 可单测（await 即可）。
 */
export async function scanSessionLogs(opts: ScanOptions): Promise<ScanResult> {
  const { sources, cursor: prevCursor = {}, seenHashes = new Set(), maxItemsPerRun } = opts;
  const cursors: CollectorCursor = { ...prevCursor };
  const items: CollectedItem[] = [];
  const skipped: string[] = [];
  let collected = 0;
  let deduped = 0;
  /** 批次35：因角色不在源白名单（缺省只采 user）而被采集口挡下的消息数 */
  let roleSkipped = 0;
  /** 本轮已新采消息数（去重命中不占限流名额），限流以此为准 */
  let processedThisRun = 0;
  /** 限流：本轮新采消息达到上限后停止继续采（游标保留，下周期接着采） */
  const shouldStop = (): boolean => maxItemsPerRun !== undefined && processedThisRun >= maxItemsPerRun;
  const markProcessed = (): void => { processedThisRun++; };

  for (const src of sources) {
    const roles = src.roles ?? DEFAULT_COLLECT_ROLES; // 批次35：缺省只采用户消息
    if (!existsSync(src.dir)) {
      skipped.push(`${src.name}: 目录不存在（${src.dir}）`);
      continue;
    }
    const pattern = src.filePattern ?? (
      src.parser === 'workbuddy-md' || src.parser === 'markdown' ? /\.md$/
      : src.parser === 'dsh-zstd-jsonl' ? /\.jsonl\.zstd$/
      : src.parser === 'dsh-projcache' ? /\.json$/
      : /\.jsonl$/
    );
    let files: string[];
    try {
      files = await listFiles(src.dir, pattern, src.recursive ?? (src.parser === 'claude-jsonl'), src.maxDepth ?? 4);
    } catch (e) {
      skipped.push(`${src.name}: 目录枚举失败 ${String((e as Error)?.message ?? e)}`);
      continue;
    }
    if (files.length === 0) {
      skipped.push(`${src.name}: 无匹配会话文件（${src.dir}）`);
      continue;
    }

    for (const full of files) {
      // 限流：本轮已处理消息达到上限后停止继续读文件（游标保留，下周期接着采）
      if (shouldStop()) {
        skipped.push(`${src.name}: 本轮已达限流上限 ${maxItemsPerRun}，剩余文件下周期续采`);
        break;
      }
      const rel = full.slice(src.dir.length + 1).replace(/\\/g, '/');
      const key = `${src.name}:${rel}`;
      const maxPerFile = src.maxMessagesPerFile ?? 500;
      let buf: Buffer;
      try {
        buf = await readFile(full); // 统一按字节读：游标/截断/多字节内容全部 byte 口径（D4）
      } catch (e) {
        skipped.push(`${key}: 读取失败 ${String((e as Error)?.message ?? e)}`);
        continue;
      }

      const prev = cursors[key];
      /** 前缀指纹校验：offset 在文件内且已消费前缀未被改写 → 游标有效；否则重置全量 */
      const prefixValid = (offset: number): boolean => {
        if (offset <= 0) return true;
        if (!prev || prev.v !== CURSOR_V || offset > buf.byteLength || !prev.contentSha) return false;
        return sha256Buf(buf.subarray(0, offset)) === prev.contentSha;
      };
      const resetReason = (offset: number): string | null => {
        if (offset <= 0 || !prev) return null;
        if (prev.v !== CURSOR_V) return '游标为旧版字符偏移';
        if (offset > buf.byteLength) return '文件被截断';
        return '文件被重写（前缀指纹不一致）';
      };

      if (src.parser === 'claude-jsonl' || src.parser === 'jsonl') {
        // JSONL 增量（字节游标）：只处理完整 \n 结尾的行；未写完的尾行留到下周期
        const startOffset = prefixValid(prev?.offset ?? 0) ? (prev?.offset ?? 0) : 0;
        const why = startOffset === 0 ? resetReason(prev?.offset ?? 0) : null;
        if (why) skipped.push(`${key}: ${why}，重置全量采集`);
        const parse = src.parseLine ?? parseClaudeJsonl;
        let lineStart = startOffset;
        let fileNew = 0;
        for (let i = startOffset; i < buf.byteLength; i++) {
          if (buf[i] !== 0x0a) continue; // '\n'
          const lineEnd = i + 1;
          const line = buf.toString('utf8', lineStart, i);
          if (line.trim() === '') { lineStart = lineEnd; continue; }
          if (shouldStop()) {
            skipped.push(`${key}: 本轮已达限流上限 ${maxItemsPerRun}，剩余下周期`);
            break; // 游标停在行首 → 下周期从此行续采
          }
          if (fileNew >= maxPerFile) {
            skipped.push(`${key}: 超过单文件上限 ${maxPerFile}，剩余下周期`);
            break; // 单文件限额只统计本次新采；游标停在行首
          }
          const msgs = parse(line);
          const list = Array.isArray(msgs) ? msgs : msgs ? [msgs] : [];
          for (const m of list) {
            if (!roles.includes(m.role)) { roleSkipped++; continue; } // 角色不在源白名单 → 采集口挡下
            const hash = sha256(`${m.content}|${m.session_id ?? ''}|${key}`);
            if (seenHashes.has(hash)) {
              deduped++; // 幂等命中不占限流/单文件名额
              continue;
            }
            seenHashes.add(hash);
            collected++;
            fileNew++;
            items.push({
              key, agent: src.name, role: m.role, content: m.content,
              hash, seq: m.seq ?? items.length, category: src.category,
            });
            markProcessed(); // 只有新采消息占限流名额
          }
          lineStart = lineEnd; // 该行完整消费后才推进游标
        }
        cursors[key] = {
          v: CURSOR_V, offset: lineStart,
          contentSha: sha256Buf(buf.subarray(0, lineStart)), lastRun: Date.now(),
        };
      } else if (src.parser === 'dsh-zstd-jsonl') {
        // DSH 会话日志（zstd）：按 frame 边界增量；尾部不完整 frame 不推进，下周期重试
        const startOffset = prefixValid(prev?.offset ?? 0) ? (prev?.offset ?? 0) : 0;
        const why = startOffset === 0 ? resetReason(prev?.offset ?? 0) : null;
        if (why) skipped.push(`${key}: ${why}，重置全量采集`);
        const parse = src.parseLine ?? parseClaudeJsonl;
        let consumed = startOffset;
        let fileNew = 0;
        let fs = nextFrameAt(buf, startOffset);
        if (fs < 0 && buf.byteLength > startOffset) {
          skipped.push(`${key}: 无完整 zstd frame（等待写入完成）`);
        }
        while (fs >= 0 && fs < buf.byteLength) {
          const next = nextFrameAt(buf, fs + 4);
          const tail = next >= 0 ? next : buf.byteLength;
          const text = decompressFrame(buf, fs);
          if (text === null) {
            if (next < 0) {
              // 末尾 frame 尚未写完 → 游标停在 frame 起点，下周期重试（不丢数据）
              skipped.push(`${key}: 尾部 zstd frame 不完整，下周期重试`);
              break;
            }
            skipped.push(`${key}: zstd frame 解压失败，跳过损坏帧`);
            consumed = tail;
            fs = next;
            continue;
          }
          let stop = false;
          for (const line of text.split('\n')) {
            if (line.trim() === '') continue;
            if (shouldStop()) {
              skipped.push(`${key}: 本轮已达限流上限 ${maxItemsPerRun}，剩余下周期`);
              stop = true;
              break;
            }
            if (fileNew >= maxPerFile) {
              skipped.push(`${key}: 超过单文件上限 ${maxPerFile}，剩余下周期`);
              stop = true;
              break;
            }
            const msgs = parse(line);
            const list = Array.isArray(msgs) ? msgs : msgs ? [msgs] : [];
            for (const m of list) {
              if (!roles.includes(m.role)) { roleSkipped++; continue; } // 角色不在源白名单 → 采集口挡下
              const hash = sha256(`${m.content}|${m.session_id ?? ''}|${key}`);
              if (seenHashes.has(hash)) {
                deduped++;
                continue;
              }
              seenHashes.add(hash);
              collected++;
              fileNew++;
              items.push({
                key, agent: src.name, role: m.role, content: m.content,
                hash, seq: m.seq ?? items.length, category: src.category,
              });
              markProcessed();
            }
          }
          if (stop) break; // 游标停在当前 frame 起点（frame 内已采消息靠 seenHashes 去重）
          consumed = tail;
          fs = next >= 0 ? next : -1;
        }
        cursors[key] = {
          v: CURSOR_V, offset: consumed,
          contentSha: sha256Buf(buf.subarray(0, consumed)), lastRun: Date.now(),
        };
      } else {
        // Markdown / 整块 JSON（workbuddy / dsh-projcache）：全文指纹不变且无续采位 → 跳过；
        // 限流/单文件上限中断时记 msgIndex（同一全文的下一条消息下标），下周期从该处续采
        const rawText = buf.toString('utf8');
        const wholeSha = sha256Buf(buf);
        const parse = src.parser === 'dsh-projcache' ? (src.parseBlock ?? parseDshProjcache) : (src.parseBlock ?? parseWorkbuddyMd);
        // 批次35：整块解析先过角色白名单再算下标——游标 msgIndex 记的是「过滤后」的位置，续采口径才稳定
        const allMsgs = parse(rawText, src.name);
        const msgs = allMsgs.filter((m) => roles.includes(m.role));
        roleSkipped += allMsgs.length - msgs.length;
        const unchanged = prev?.v === CURSOR_V && prev.contentSha === wholeSha;
        // 无续采位 = 上次已整文件采完（msgIndex 缺省视为文件尾）
        const startIdx = unchanged ? (prev?.msgIndex ?? msgs.length) : 0;
        if (unchanged && startIdx >= msgs.length) {
          // 文件无变化 → 不重复采；如实统计幂等命中数（观测口径，游标保持）
          for (const m of msgs) {
            const h = src.parser === 'dsh-projcache'
              ? sha256(`${m.content}|${src.name}|${rel}|${m.role}`)
              : sha256(`${m.content}|${src.name}|${rel}`);
            if (seenHashes.has(h)) deduped++;
          }
          continue;
        }
        let idx = startIdx;
        let fileNew = 0;
        let stoppedByCap = false;
        for (; idx < msgs.length; idx++) {
          const m = msgs[idx];
          if (shouldStop()) {
            stoppedByCap = true;
            skipped.push(`${key}: 本轮已达限流上限 ${maxItemsPerRun}，剩余下周期`);
            break;
          }
          if (fileNew >= maxPerFile) {
            stoppedByCap = true; // 记 msgIndex，下周期从该块续采
            skipped.push(`${key}: 超过单文件上限 ${maxPerFile}，剩余下周期`);
            break;
          }
          // dsh-projcache：hash 含 role（user/assistant 同 turn 不同 hash）；workbuddy：按块
          const hash = src.parser === 'dsh-projcache'
            ? sha256(`${m.content}|${src.name}|${rel}|${m.role}`)
            : sha256(`${m.content}|${src.name}|${rel}`);
          if (seenHashes.has(hash)) {
            deduped++; // 幂等命中不占限流/单文件名额
            continue;
          }
          seenHashes.add(hash);
          collected++;
          fileNew++;
          items.push({
            key, agent: src.name, role: m.role, content: m.content,
            hash, seq: m.seq ?? idx, category: src.category,
          });
          markProcessed();
        }
        cursors[key] = stoppedByCap
          ? { v: CURSOR_V, offset: buf.byteLength, contentSha: wholeSha, lastRun: Date.now(), msgIndex: idx }
          : { v: CURSOR_V, offset: buf.byteLength, contentSha: wholeSha, lastRun: Date.now() };
      }
      // 每处理完一个文件让出一次事件循环（防大文件批量处理卡死主进程）
      await yieldToEventLoop();
    }
  }

  return { collected, deduped, roleSkipped, skipped, items, cursors, ts: Date.now() };
}

// ─── 周期对账器（§5.1 双链路补偿，可配周期，预设 5min） ───────────────────────

export interface ReconcileOptions {
  /** 周期 ms，缺省 300000（5min，§5.1 短周期对账） */
  intervalMs?: number;
  /** 每次周期调用的采集源（对象或函数：函数在每次对账前求值，支持动态扩展 agent 白名单） */
  source: ScanOptions | (() => ScanOptions);
  /** 采集完成回调（落库 + 更新游标）。抛错 = 本轮没推进，触发退避（批次41-D）。 */
  onScan: (scan: ScanResult) => Promise<void> | void;
  /** 启动即跑一次（缺省 true，首扫全量） */
  runOnStart?: boolean;
  /** 注入定时器（测试用 fake timer；缺省 globalThis.setInterval） */
  timer?: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (h: unknown) => void };
  /** 采集器来源标记（写审计 source） */
  sourceLabel?: string;
  /**
   * 批次41-D（P1-12）：连续失败后的指数退避倍率（`intervalMs·factor^fails`）。缺省 2。
   * 只在「本轮没推进」（onScan 抛错）时抬下次间隔，成功即回落到 `intervalMs`。
   */
  backoffFactor?: number;
  /** 批次41-D：退避间隔的上限 ms（指数增长封顶，避免无限拉长）。缺省 2h。 */
  backoffCapMs?: number;
  /**
   * 批次41-D：连续失败达到该轮数后**停自动重试**（保留手动重跑，成功即重启）。缺省 6。
   * 语义：5→10→20→40→80→120(cap) 六次递增后不再空转，避免 L0 写密钥锁定等长障时日志/错误长期刷屏。
   */
  maxConsecutiveFails?: number;
  /** 批次41-D：注入时钟（测试用 fake clock；缺省 Date.now） */
  now?: () => number;
  /** 批次41-D：本轮判为失败（onScan 抛错）后的回调（带轮数/退避间隔/原因码，绝不带正文；供主进程落 collector:backoff 动作日志） */
  onRoundFail?: (info: { fails: number; delayMs: number; reason: string }) => void;
  /** 批次41-D：连续失败达上限、停自动重试时的回调（同样只带原因码） */
  onAutoRetryStopped?: (info: { fails: number; reason: string }) => void;
  /** 批次41-D：失败后成功恢复（退避归零）时的回调 */
  onRecover?: (info: { prevFails: number }) => void;
}

export interface Reconciler {
  stop(): void;
  /** 手动触发一次对账（不等周期）；返回本次扫描结果 */
  runOnce(): Promise<ScanResult>;
  readonly intervalMs: number;
  /** 是否已停止（stop() 后为 true；供 UI 展示采集器状态） */
  readonly stopped: boolean;
  /** 最近一次扫描结果（供 UI 展示对账状态） */
  last?: ScanResult;
  /** 批次41-D：当前连续失败轮数（成功即清零） */
  readonly consecutiveFails: number;
  /** 批次41-D：是否已因连续失败达上限而停自动重试（手动重跑成功后自动重启） */
  readonly autoRetryStopped: boolean;
}

export function createReconciler(opts: ReconcileOptions): Reconciler {
  const intervalMs = opts.intervalMs ?? 300_000; // §5.1 预设 5min
  const timer = opts.timer ?? {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h: unknown) => globalThis.clearInterval(h as number),
  };
  // source 支持动态：每次对账前求值（函数形式），让 detector 更新白名单后周期采集自动扩展
  const resolveSource = (): ScanOptions => (typeof opts.source === 'function' ? opts.source() : opts.source);
  // 批次41-D（P1-12）：失败退避常量。指数 `intervalMs·factor^fails`，封顶 capMs；连续失败达上限即停自动重试。
  const backoffFactor = opts.backoffFactor ?? 2;
  const backoffCapMs = opts.backoffCapMs ?? 7_200_000; // 缺省 2h（任务口径「钳到上限如 2h」）
  const maxConsecutiveFails = opts.maxConsecutiveFails ?? 6;
  const now = opts.now ?? Date.now;
  let stopped = false;
  let last: ScanResult | undefined;
  let inflight: Promise<ScanResult> | null = null;
  // 批次41-D：退避状态。consecutiveFails 成功即清零；nextEligibleAt 门控心跳 tick；autoStopped 达上限停心跳
  let consecutiveFails = 0;
  let nextEligibleAt = 0;
  let autoStopped = false;
  let handle: unknown;

  /** 本轮失败原因码（绝不带正文）：取 last 里的合成占位首句，没有就 unknown */
  const roundFailReason = (): string => last?.skipped?.[0] ?? 'unknown';

  function doRunOnce(): Promise<ScanResult> {
    const p = (async () => {
      let failed = false;
      try {
        const scan = await scanSessionLogs(resolveSource());
        last = scan;
        await opts.onScan(scan);
        return scan;
      } catch (e) {
        // 本轮没推进（扫描抛错或 onScan 抛错，如 L0 写密钥锁定导致 apply 失败）
        failed = true;
        last = { collected: 0, deduped: 0, roleSkipped: 0, skipped: [`采集异常: ${String((e as Error)?.message ?? e)}`], items: [], cursors: {}, ts: now() };
        return last;
      } finally {
        inflight = null;
        noteRound(failed); // 批次41-D：无论成功失败都记账退避（手动与周期同口径）
      }
    })();
    inflight = p;
    return p;
  }

  /** 批次41-D：一轮跑完后的退避记账。失败→抬下次间隔+必要时停自动重试；成功→归零+重启心跳 */
  function noteRound(failed: boolean): void {
    if (failed) {
      consecutiveFails++;
      // 指数退避，封顶 capMs：第 N 次失败后等 min(cap, intervalMs·factor^N)
      const delayMs = Math.min(backoffCapMs, intervalMs * Math.pow(backoffFactor, consecutiveFails));
      nextEligibleAt = now() + delayMs;
      opts.onRoundFail?.({ fails: consecutiveFails, delayMs, reason: roundFailReason() });
      if (!stopped && consecutiveFails >= maxConsecutiveFails && !autoStopped) {
        // 连续失败达上限：停自动重试（清心跳），只保留手动重跑入口；成功即重启
        autoStopped = true;
        timer.clearInterval(handle);
        opts.onAutoRetryStopped?.({ fails: consecutiveFails, reason: roundFailReason() });
      }
    } else {
      if (consecutiveFails > 0) opts.onRecover?.({ prevFails: consecutiveFails });
      consecutiveFails = 0;
      nextEligibleAt = 0;
      // 之前因连续失败停过、现在成功了 → 重新拉起心跳
      if (autoStopped && !stopped) {
        autoStopped = false;
        arm();
      }
    }
  }

  async function runOnce(): Promise<ScanResult> {
    if (stopped) {
      return last ?? { collected: 0, deduped: 0, roleSkipped: 0, skipped: [], items: [], cursors: {}, ts: now() };
    }
    // 已有在途对账 → 等它完成返回同一结果（不并发重入；定时器 tick 与手动 runOnce 互斥）
    if (inflight) return inflight;
    return doRunOnce();
  }

  /** 批次41-D：心跳 tick——退避窗口内直接跳过；达上限停自动重试后也跳过（只有手动重跑能再拉起来） */
  function tick(): void {
    if (stopped || autoStopped) return;
    if (now() < nextEligibleAt) return; // 处于退避窗口 → 本轮不跑
    void runOnce();
  }

  function arm(): void {
    // 心跳固定在 base intervalMs 上 tick，实际是否起跑由退避门控决定（避免改动注入定时器接口）
    handle = timer.setInterval(tick, intervalMs);
  }

  arm();

  if (opts.runOnStart !== false) {
    void runOnce(); // 启动即对账（首扫全量）
  }

  return {
    stop() {
      stopped = true;
      timer.clearInterval(handle);
    },
    runOnce,
    intervalMs,
    get stopped() {
      return stopped;
    },
    get last() {
      return last;
    },
    get consecutiveFails() {
      return consecutiveFails;
    },
    get autoRetryStopped() {
      return autoStopped;
    },
  };
}

// ─── 内置源目录探测（自动读各 Agent 真实日志位置，不依赖用户配置路径） ─────────

export interface DefaultSourcesOpts {
  /** 用户主目录（缺省 process.env.USERPROFILE / HOME） */
  home?: string;
  /** workbuddy 根目录（缺省 ~/workbuddy） */
  workbuddyRoot?: string;
  /** 需要采集的 agent 名（白名单，缺省全部默认 agent；已检测到的已安装 agent 列表传入后扩展源） */
  agents?: string[];
}

/**
 * 自动探测本机各 Agent 的真实会话日志位置（不造假：只返回确实存在的目录）。
 *  - Claude Code：home 下 .claude/projects（递归 *.jsonl）
 *  - workbuddy：workbuddy 根下各项目 .workbuddy/memory（*.md）
 *  - 扩展 agent（Qoder CN / Trae Code CN / Zcode / Cursor / Gemini / Qwen 等）：
 *    按 agent 名映射到常见会话/记忆目录（*.jsonl 或 *.md），目录不存在则 skip。
 * 不存在的目录不会进列表（由 scanSessionLogs 诚实 skip 兜底）。
 */
export function defaultAgentSources(o: DefaultSourcesOpts = {}): SessionLogSource[] {
  const home = o.home ?? process.env.USERPROFILE ?? process.env.HOME ?? '';
  const out: SessionLogSource[] = [];
  if (!home) return out;
  // Claude Code
  out.push({
    name: 'claude-code',
    parser: 'claude-jsonl',
    dir: join(home, '.claude', 'projects'),
    recursive: true,
    maxDepth: 4,
    category: 'context',
  });
  // workbuddy（自有 P0）
  // 批次35 角色例外：它是 Agent 自己写的工作日志（`##` 分块），源里根本没有用户消息流——
  // 按缺省口径（只采 user）会把这个源整体清零。保留采集，旁白交给 L0→L1 质量门拦。
  const wbRoot = o.workbuddyRoot ?? join(home, 'workbuddy');
  out.push({
    name: 'workbuddy',
    parser: 'workbuddy-md',
    dir: wbRoot,
    recursive: true,
    maxDepth: 4,
    category: 'fact',
    filePattern: /\.md$/,
    roles: ['assistant'],
  });
  // DSH（自有 P0，DeepSeek Harness）：完整会话正文落盘在 session_projcache（turnOutline 逐 turn 的 prompt/response 全文）
  // 注：~/.dsh/sessions/**/session.v4.jsonl.zstd 只有 1 行会话壳元数据（无对话正文），不作为采集源
  out.push({
    name: 'deepseek-harness',
    parser: 'dsh-projcache',
    dir: join(home, '.dsh', 'storages', 'session_projcache', 'sessions'),
    recursive: false,
    maxDepth: 1,
    category: 'context',
    filePattern: /^session-.*\.json$/,
  });
  // 扩展 agent 会话/记忆目录映射（按 agent 名 → 常见路径；目录不存在由 scan 诚实 skip）
  const agentSourceMap: Record<string, { parser: SessionLogSource['parser']; dir: string; category: string; filePattern?: RegExp }> = {
    'Qoder CN': { parser: 'claude-jsonl', dir: join(home, '.qoder', 'sessions'), category: 'context', filePattern: /\.jsonl$/ },
    'Trae Code CN': { parser: 'claude-jsonl', dir: join(home, '.trae', 'sessions'), category: 'context', filePattern: /\.jsonl$/ },
    'Zcode': { parser: 'claude-jsonl', dir: join(home, '.zcode', 'sessions'), category: 'context', filePattern: /\.jsonl$/ },
    'Cursor': { parser: 'claude-jsonl', dir: join(home, '.cursor', 'sessions'), category: 'context', filePattern: /\.jsonl$/ },
    'Gemini CLI': { parser: 'claude-jsonl', dir: join(home, '.gemini', 'sessions'), category: 'context', filePattern: /\.jsonl$/ },
    'Qwen Code': { parser: 'claude-jsonl', dir: join(home, '.qwen', 'sessions'), category: 'context', filePattern: /\.jsonl$/ },
  };
  // 按白名单扩展（缺省：全部映射都进；传入 agents 白名单则只进白名单 + 默认 claude/workbuddy）
  const wantAll = !o.agents || o.agents.length === 0;
  for (const [name, spec] of Object.entries(agentSourceMap)) {
    if (!wantAll && !o.agents!.includes(name)) continue;
    out.push({
      name: name.toLowerCase().replace(/\s+/g, '-'),
      parser: spec.parser,
      dir: spec.dir,
      recursive: true,
      maxDepth: 4,
      category: spec.category,
      ...(spec.filePattern ? { filePattern: spec.filePattern } : {}),
    });
  }
  return out;
}

// ─── 与 coreWrite 的桥接（P0 主源：入库走 L0→L6 阶梯） ────────────────────────

export interface CollectorBridgeOpts {
  /** 写入器（注入 coreWrite 封装；避免循环依赖） */
  write: (input: {
    content: string;
    category: string;
    project_id: string;
    source_agent?: string;
    session_id?: string;
  }) => Promise<{ mem_id: string; dedup: { action: string } }>;
  /** 审计写口（§4.3 全链路可追溯） */
  audit?: (rec: {
    request_id: string; action: string; ts: number; project_id?: string;
    detail?: Record<string, unknown>;
  }) => Promise<void>;
  project_id?: string;
}

export interface ApplyScanResult {
  /** 真正 new 的条数（dedup 后） */
  written: number;
  /** 批次35：被 L0→L1 质量门拦下的条数（有 filtered 审计留痕，不是丢失） */
  filtered: number;
  /** 写入失败条数：调用方必须据此保留旧游标，下一轮重采（去重兜底） */
  failed: number;
  /**
   * 批次41-W：failed 里有多少是「L0 写密钥未解锁」。这类失败**不是 bug**，用户输入管理密码
   * 解锁写密钥就能解决；不拆开就只会看到 failed=N，不知道下一步该做什么（端壳据此把失败原因
   * 判成 l0_locked 并提示解锁）。恒 ≤ failed。
   */
  failed_l0_locked: number;
}

/**
 * 把采集结果写入记忆库 + 审计（source='collector'）。
 * 单条失败不阻塞整批，但必须通过返回值上报 → 调用方不得推进游标。
 */
export async function applyScanToStore(scan: ScanResult, opts: CollectorBridgeOpts): Promise<ApplyScanResult> {
  let written = 0;
  let filtered = 0;
  let failed = 0;
  let failedL0Locked = 0;
  const now = Date.now();
  for (let i = 0; i < scan.items.length; i++) {
    const item = scan.items[i];
    const category = item.category ?? 'context';
    try {
      const r = await opts.write({
        content: item.content,
        category,
        project_id: opts.project_id ?? 'P1',
        source_agent: `collector:${item.agent}`,
        session_id: item.key,
      });
      if (r.dedup.action === 'new') written++;
      else if (r.dedup.action === 'filtered') filtered++; // 质量门拦下：已有 filtered 审计，不是丢失
      await opts.audit?.({
        request_id: `req_col_${now}_${item.seq}`,
        action: 'write',
        ts: now,
        project_id: opts.project_id ?? 'P1',
        detail: { source: 'collector', agent: item.agent, dedup: r.dedup.action, mem_id: r.mem_id, hash: item.hash },
      });
      // 每 5 条让出一次事件循环（防逐条 coreWrite 的 await 链 + 内存计算长时间占死主进程）
      if ((i + 1) % 5 === 0) await yieldToEventLoop();
    } catch (e) {
      // 单条失败不阻塞整批（诚实：error 审计留痕 + 失败计数）
      failed++;
      // 批次41-W：锁定失败单独计数——原因不同，用户要做的事完全不同（解锁写密钥 vs 排查写入）
      const l0Locked = isL0LockedError(e);
      if (l0Locked) failedL0Locked++;
      await opts.audit?.({
        request_id: `req_col_${now}_${item.seq}_err`,
        action: 'write',
        ts: now,
        project_id: opts.project_id ?? 'P1',
        detail: {
          source: 'collector', agent: item.agent,
          error: String((e as Error)?.message ?? e),
          ...(l0Locked ? { l0_locked: true } : {}),
        },
      });
      if ((i + 1) % 5 === 0) await yieldToEventLoop();
    }
  }
  return { written, filtered, failed, failed_l0_locked: failedL0Locked };
}
