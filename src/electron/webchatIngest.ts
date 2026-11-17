// 插件导出的本机接收端：让浏览器插件不再依赖「浏览器下载目录」。
//
// 真实事故（2026-11-16）：插件用 chrome.downloads 把 Markdown 写到
// `<下载目录>/chat-exports/<站点>/<时间戳>.md`，但 QQ 浏览器把它丢进了
// `%TEMP%\20261116-222305.md`（子目录被整个剥掉，QQ 浏览器自己的下载记录
// qb_file_dl_record_v1.db 第 45 条可查）；而应用扫的是
// `C:\Users\LHQ\Downloads\chat-exports` → 永远「采到 0 条」。
// 结论：只要还依赖浏览器下载目录，就永远在给各家浏览器的下载策略打补丁。
//
// 因此改为：插件 POST 到本机 127.0.0.1 → 由应用自己写进「导出和同步目录」
// → 采集器必然扫到。下载目录只作为「本机服务不可用」时的兜底。
//
// 安全口径：
//   · 只监听 127.0.0.1（不对外）
//   · Bearer token 鉴权（token 由应用生成，与端口一起写进插件目录的 runtime.json）
//   · 文件名由服务端生成，绝不采信客户端文件名 → 不可能路径穿越
//   · 站点段必须匹配 ^[a-z0-9_-]{1,40}$，与采集侧 siteExportStats 同一判据
//   · 请求体上限默认 8MB

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { basename, join, resolve as resolvePath, sep } from 'node:path';

/** 站点目录名的唯一判据（与 chatExportsLocations.siteExportStats 保持一致） */
export const WEBCHAT_SITE_RE = /^[a-z0-9_-]{1,40}$/;

const DEFAULT_MAX_BODY = 8 * 1024 * 1024;
/** 诊断线索上限：只放 class/data-* 与截断文本，正常几百字节，给足余量但不许被塞成大文件 */
const MAX_DIAG_BYTES = 256 * 1024;
/**
 * 审计快照上限：原对话全文 + 导出文档全文成对存，会比诊断大一个量级。
 * 8MB 够放下超长对话，又不至于让内存爆掉。
 */
const MAX_AUDIT_BYTES = 8 * 1024 * 1024;

export interface WebchatIngestPayload {
  site?: unknown;
  title?: unknown;
  url?: unknown;
  exportedAt?: unknown;
  markdown?: unknown;
  /** 页面结构诊断（仅当插件没认出用户提问时才有） */
  diag?: unknown;
  /**
   * 原对话快照（插件从页面 DOM 抽到的消息序列）。
   * 有了它才能逐条回答「导出文档与原对话有无差异、有没有遗漏、正确率多少」——
   * 原对话不在本机磁盘上（DeepSeek 的 IndexedDB 只存会话元数据，实测确认），
   * 所以只能「抽取时顺手带上来」。
   */
  auditSource?: unknown;
}

export interface WebchatIngestOptions {
  /** 必须与插件持有的一致 */
  token: string;
  /** 当前导出目录：每次请求现取，用户在界面上改目录后立即生效 */
  resolveExportDir: () => string;
  /**
   * 诊断线索目录（可选）。刻意与导出目录分开：采集器只扫导出目录，
   * 放 .json 进去既不会被误当对话入库，也不会让用户在多出来的文件前发懵。
   */
  resolveDiagDir?: () => string;
  /**
   * 审计快照目录（可选）：原对话 + 导出文档成对落盘，供「导出完整性审计」逐条比对。
   * 同样与导出目录分开——审计数据不是对话，采集器不该碰它。
   */
  resolveAuditDir?: () => string;
  /**
   * 每次成功落盘的记账回调（0.3.0 新增，供壳层「网页导出状态」UI 显示）。
   * 失败/拒绝不会触发；写在 server 层，纯函数 handleExportRequest 保持无副作用。
   */
  onSaved?: (info: { site: string; path: string; bytes: number; at: number }) => void;
  maxBodyBytes?: number;
  now?: () => number;
  mkdirp?: (dir: string) => void;
  writeFile?: (path: string, data: string) => void;
}

function cors(res: ServerResponse): void {
  // 本地端口 + Bearer 鉴权：Origin 允许任意（扩展的 origin 各家不同，且 Electron 扩展页也可能是 chrome-extension://）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  cors(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** 常量时间比较，避免按字节回显 token 前缀 */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      // 超限后不再缓存，但继续把流读干净——否则 req.destroy() 会让客户端只看到连接重置，
      // 而不是我们准备好的 413 文案。
      if (tooLarge) return;
      size += chunk.length;
      if (size > max) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) fail(new Error('E_BODY_TOO_LARGE'));
      else ok(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      if (!tooLarge) fail(e);
    });
  });
}

/** 文件名由服务端生成：<YYYYMMDD-HHmmss>.md（与插件侧 core.fileNameFor 同格式，便于识别） */
export function webchatExportFileName(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}.md`;
}

/** 在导出目录里选一个不与现有文件冲突的名字（秒级时间戳可能撞，撞了加 -1/-2） */
function pickPath(exportDir: string, site: string, base: string, exists: (p: string) => boolean): string {
  const root = resolvePath(exportDir);
  const dir = resolvePath(join(root, site));
  // 严格边界：root 本身或 root + 分隔符开头，避免 `chat-evil` 这类前缀误判为同一目录
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (dir !== root && !dir.startsWith(prefix)) throw new Error('E_PATH_ESCAPE');
  const stem = base.replace(/\.md$/, '');
  for (let i = 0; i < 100; i += 1) {
    const name = i === 0 ? base : `${stem}-${i}.md`;
    const full = join(dir, name);
    if (!exists(full)) return full;
  }
  return join(dir, `${stem}-${Date.now()}.md`);
}

export interface WebchatIngestResult {
  ok: boolean;
  path?: string;
  site?: string;
  bytes?: number;
  /** 诊断线索落盘路径（只有带了 diag 且写成功才有） */
  diagPath?: string;
  /** 诊断没写成的原因（不影响对话文件本身） */
  diagSkipped?: string;
  /** 审计快照落盘路径（只有带了 auditSource 且写成功才有） */
  auditPath?: string;
  /** 审计快照没写成的原因（不影响对话文件本身） */
  auditSkipped?: string;
  error?: string;
}

/**
 * 处理一次导出请求（导出成纯函数便于单测直接驱动，不必起端口）。
 * 判据顺序：token → 方法 → 站点 → 正文 → 落盘。
 */
export function handleExportRequest(
  opts: WebchatIngestOptions & { exists?: (p: string) => boolean },
  headers: { authorization?: string | string[] },
  payload: WebchatIngestPayload,
): { code: number; body: WebchatIngestResult } {
  const given = typeof headers.authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(headers.authorization.trim())?.[1] : undefined;
  if (!given || !tokenMatches(given, opts.token)) {
    return { code: 401, body: { ok: false, error: '令牌无效：请在应用「Agent 接入」页重新复制插件目录并重新加载扩展' } };
  }
  const site = typeof payload.site === 'string' ? payload.site.trim() : '';
  if (!WEBCHAT_SITE_RE.test(site)) {
    return { code: 400, body: { ok: false, error: `站点名不合法：${site || '(空)'}` } };
  }
  const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
  if (!markdown) {
    return { code: 400, body: { ok: false, error: '正文为空：没有可写入的对话内容' } };
  }
  const at = Number(payload.exportedAt);
  const stampMs = Number.isFinite(at) && at > 0 ? at : (opts.now ?? Date.now)();
  let exportDir: string;
  try {
    exportDir = opts.resolveExportDir();
  } catch (e) {
    return { code: 500, body: { ok: false, error: `读取导出目录失败：${String((e as Error)?.message ?? e)}` } };
  }
  // 默认按真实文件系统判重名（纯函数调用时也能正确避让，不必调用方注入）
  const exists = opts.exists ?? ((p: string) => existsSync(p));
  const mkdirp = opts.mkdirp ?? ((d: string) => mkdirSync(d, { recursive: true }));
  const write = opts.writeFile ?? ((p: string, d: string) => writeFileSync(p, d, 'utf8'));
  try {
    const target = pickPath(exportDir, site, webchatExportFileName(stampMs), exists);
    mkdirp(join(exportDir, site));
    write(target, markdown);
    const body: WebchatIngestResult = { ok: true, path: target, site, bytes: Buffer.byteLength(markdown) };
    // 诊断只在插件「没认出用户提问」时附带。主文件已经落盘，诊断写失败也不能把它算成失败。
    if (payload.diag !== undefined && payload.diag !== null && opts.resolveDiagDir) {
      try {
        const text = JSON.stringify(payload.diag, null, 2);
        if (Buffer.byteLength(text) > MAX_DIAG_BYTES) {
          body.diagSkipped = `诊断内容超过上限（${Math.round(MAX_DIAG_BYTES / 1024)}KB）`;
        } else {
          const diagDir = opts.resolveDiagDir();
          mkdirp(diagDir);
          const diagFile = join(diagDir, basename(target).replace(/\.md$/i, '.json'));
          write(diagFile, text);
          body.diagPath = diagFile;
        }
      } catch (e) {
        body.diagSkipped = `写诊断失败：${String((e as Error)?.message ?? e)}`;
      }
    }
    // 审计快照：原对话 + 导出文档成对落盘，供「导出完整性审计」逐条比对。
    // 与诊断一样：写失败不影响对话文件本身（内容已经落盘了）。
    if (Array.isArray(payload.auditSource) && payload.auditSource.length > 0 && opts.resolveAuditDir) {
      try {
        const source = payload.auditSource as { role?: unknown; text?: unknown }[];
        const clean = source
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
          .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text as string }));
        const text = JSON.stringify({
          site,
          title: typeof payload.title === 'string' ? payload.title : '',
          url: typeof payload.url === 'string' ? payload.url : '',
          exportedAt: stampMs,
          source: clean,
          exportedMarkdown: markdown,
        }, null, 2);
        if (Buffer.byteLength(text) > MAX_AUDIT_BYTES) {
          body.auditSkipped = `审计快照超过上限（${Math.round(MAX_AUDIT_BYTES / 1024)}KB）`;
        } else {
          const auditDir = opts.resolveAuditDir();
          mkdirp(auditDir);
          const auditFile = join(auditDir, basename(target).replace(/\.md$/i, '.json'));
          write(auditFile, text);
          body.auditPath = auditFile;
        }
      } catch (e) {
        body.auditSkipped = `写审计快照失败：${String((e as Error)?.message ?? e)}`;
      }
    }
    return { code: 200, body };
  } catch (e) {
    return { code: 500, body: { ok: false, error: `写入失败：${String((e as Error)?.message ?? e)}` } };
  }
}

// ─── 清空旧导出（0.5.3） ──────────────────────────────────────────────────────
//
// 为什么需要「应用侧清空」（2026-11-17）：抽取层补上结构后，同一段对话抽出来的文本
// 变了 → 内容指纹（sig）也变了 → 插件的去重账全部对不上 → 重导会在
// `chat-exports/<站点>/` 下再落一份同名不同时间戳的文件。只清插件去重账不清文件，
// 结果就是「重复文件」；只清文件不清去重账，结果是「文件没了但插件认为导过」。
// 所以清空必须一次做完：删旧 md（应用侧）+ 重置去重账（插件侧）。
//
// 安全口径：只删「导出目录下、站点子目录里、直接位于该层的 .md」，不递归、
// 不碰诊断目录、不碰记忆库；站点段仍走同一个 WEBCHAT_SITE_RE 判据。

export interface WebchatClearOptions {
  token: string;
  resolveExportDir: () => string;
  /** 审计快照目录（只有显式要求 audit=true 才会动它） */
  resolveAuditDir?: () => string;
  /** 目录列举（注入点：单测不碰真实磁盘） */
  listDir?: (dir: string) => { name: string; dir: boolean }[];
  /** 删单个文件（注入点；默认 unlinkSync） */
  unlinkFile?: (path: string) => void;
}

export interface WebchatClearResult {
  ok: boolean;
  /** 删掉的导出 Markdown 份数 */
  deleted: number;
  /** 删掉的审计快照份数（没要求清审计时恒为 0） */
  deletedAudit: number;
  /** 处理过的站点目录名 */
  sites: string[];
  error?: string;
}

function defaultListDir(dir: string): { name: string; dir: boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() }));
  } catch {
    // 目录不存在 = 本来就没有旧导出，不是错误
    return [];
  }
}

/** 目录边界：只允许 root 本身或 root 的直接子目录（防 ../，也防 chat-evil 这类前缀误判） */
function insideRoot(root: string, target: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(prefix);
}

/**
 * 处理一次「清空旧导出」请求（纯函数，便于单测直接驱动）。
 * 判据顺序：token → 站点名 → 目录 → 逐个删（只删 .md）。
 */
export function handleClearRequest(
  opts: WebchatClearOptions,
  headers: { authorization?: string | string[] },
  payload: { site?: unknown; audit?: unknown } = {},
): { code: number; body: WebchatClearResult } {
  const empty: WebchatClearResult = { ok: false, deleted: 0, deletedAudit: 0, sites: [] };
  const given = typeof headers.authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(headers.authorization.trim())?.[1] : undefined;
  if (!given || !tokenMatches(given, opts.token)) {
    return { code: 401, body: { ...empty, error: '令牌无效：请在应用「Agent 接入」页重新复制插件目录并重新加载扩展' } };
  }
  const wantSite = typeof payload.site === 'string' ? payload.site.trim() : '';
  if (wantSite && !WEBCHAT_SITE_RE.test(wantSite)) {
    return { code: 400, body: { ...empty, error: `站点名不合法：${wantSite}` } };
  }
  let root: string;
  try {
    root = resolvePath(opts.resolveExportDir());
  } catch (e) {
    return { code: 500, body: { ...empty, error: `读取导出目录失败：${String((e as Error)?.message ?? e)}` } };
  }
  const listDir = opts.listDir ?? defaultListDir;
  const unlink = opts.unlinkFile ?? ((p: string) => unlinkSync(p));
  const sites = wantSite ? [wantSite] : listDir(root).filter((d) => d.dir && WEBCHAT_SITE_RE.test(d.name)).map((d) => d.name);
  const failures: string[] = [];
  const doneSites: string[] = [];
  let deleted = 0;
  for (const site of sites) {
    const dir = resolvePath(join(root, site));
    if (!insideRoot(root, dir)) {
      failures.push(`${site}：路径越界，已拒绝`);
      continue;
    }
    doneSites.push(site);
    for (const item of listDir(dir)) {
      if (item.dir || !/\.md$/i.test(item.name)) continue;
      try {
        unlink(join(dir, item.name));
        deleted += 1;
      } catch (e) {
        failures.push(`${site}/${item.name}：${String((e as Error)?.message ?? e)}`);
      }
    }
  }
  let deletedAudit = 0;
  if (payload.audit === true && opts.resolveAuditDir) {
    try {
      const auditDir = resolvePath(opts.resolveAuditDir());
      // 审计快照只有两种摆法（见 webchatAuditStore.readAuditSnapshots）：平铺或按站点分子目录
      for (const item of listDir(auditDir)) {
        const target = join(auditDir, item.name);
        if (!item.dir) {
          if (!/\.json$/i.test(item.name)) continue;
          try {
            unlink(target);
            deletedAudit += 1;
          } catch (e) {
            failures.push(`${item.name}：${String((e as Error)?.message ?? e)}`);
          }
          continue;
        }
        for (const sub of listDir(target)) {
          if (sub.dir || !/\.json$/i.test(sub.name)) continue;
          try {
            unlink(join(target, sub.name));
            deletedAudit += 1;
          } catch (e) {
            failures.push(`${item.name}/${sub.name}：${String((e as Error)?.message ?? e)}`);
          }
        }
      }
    } catch (e) {
      failures.push(`审计快照目录不可用：${String((e as Error)?.message ?? e)}`);
    }
  }
  if (failures.length > 0) {
    // 部分失败必须如实报失败：调用方据此**不重置**去重账，避免「文件删了一半、账已清」的错位
    return {
      code: 500,
      body: { ok: false, deleted, deletedAudit, sites: doneSites, error: `有 ${failures.length} 项没删掉：${failures.slice(0, 3).join('；')}` },
    };
  }
  return { code: 200, body: { ok: true, deleted, deletedAudit, sites: doneSites } };
}

/** 建 HTTP 服务（不 listen，交给调用方决定端口与生命周期） */
export function createWebchatIngestServer(opts: WebchatIngestOptions & { onCleared?: (info: WebchatClearResult) => void }): Server {
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const exists = (p: string): boolean => existsSync(p);
  return createHttpServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && (path === '/ping' || path === '/')) {
      sendJson(res, 200, { ok: true, app: 'MultiAgent Memory', service: 'webchat-ingest' });
      return;
    }
    if (path === '/clear') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, deleted: 0, deletedAudit: 0, sites: [], error: '只接受 POST' });
        return;
      }
      void (async () => {
        let text = '';
        try {
          text = await readBody(req, maxBody);
        } catch (e) {
          const tooLarge = String((e as Error)?.message ?? e) === 'E_BODY_TOO_LARGE';
          sendJson(res, tooLarge ? 413 : 400, {
            ok: false, deleted: 0, deletedAudit: 0, sites: [],
            error: tooLarge ? '请求体过大' : '读取请求体失败',
          });
          return;
        }
        let payload: { site?: unknown; audit?: unknown } = {};
        if (text.trim()) {
          try {
            payload = JSON.parse(text) as { site?: unknown; audit?: unknown };
          } catch {
            sendJson(res, 400, { ok: false, deleted: 0, deletedAudit: 0, sites: [], error: '请求体不是合法 JSON' });
            return;
          }
        }
        const out = handleClearRequest(
          { token: opts.token, resolveExportDir: opts.resolveExportDir, resolveAuditDir: opts.resolveAuditDir },
          req.headers,
          payload,
        );
        if (out.code === 200 && opts.onCleared) {
          try {
            opts.onCleared(out.body);
          } catch {
            // 记账失败不影响清空结果本身
          }
        }
        sendJson(res, out.code, out.body);
      })();
      return;
    }
    if (path !== '/export') {
      sendJson(res, 404, { ok: false, error: `未知路径：${path}` });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '只接受 POST' });
      return;
    }
    void (async () => {
      let text: string;
      try {
        text = await readBody(req, maxBody);
      } catch (e) {
        const tooLarge = String((e as Error)?.message ?? e) === 'E_BODY_TOO_LARGE';
        sendJson(res, tooLarge ? 413 : 400, {
          ok: false,
          error: tooLarge ? `内容超过上限（${Math.round(maxBody / 1024 / 1024)}MB）` : '读取请求体失败',
        });
        return;
      }
      let payload: WebchatIngestPayload;
      try {
        payload = JSON.parse(text) as WebchatIngestPayload;
      } catch {
        sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
        return;
      }
      const out = handleExportRequest({ ...opts, exists }, req.headers, payload);
      // 成功落盘 → 记账给壳层状态 UI（失败/拒绝不算导出，不记账）
      if (out.code === 200 && out.body.ok && out.body.site && out.body.path && opts.onSaved) {
        try {
          opts.onSaved({
            site: out.body.site,
            path: out.body.path,
            bytes: out.body.bytes ?? 0,
            at: Date.now(),
          });
        } catch {
          // 记账失败不影响导出本身：状态 UI 少一条，文件已在盘上
        }
      }
      sendJson(res, out.code, out.body);
    })();
  });
}

/**
 * 把「端口 + 令牌」写进插件目录的 runtime.json，供扩展 fetch(chrome.runtime.getURL) 读取。
 * 写成 0600：同机其它用户读不到（Windows 上 mode 被忽略，但语义保留）。
 */
export function writeWebchatRuntime(opts: {
  extDir: string;
  port: number;
  token: string;
  writeFile?: (path: string, data: string, mode?: number) => void;
}): string {
  const file = join(opts.extDir, 'runtime.json');
  const body = JSON.stringify({ port: opts.port, token: opts.token, updatedAt: Date.now() }, null, 2);
  const write = opts.writeFile ?? ((p: string, d: string, mode?: number) => writeFileSync(p, d, { encoding: 'utf8', mode }));
  write(file, body, 0o600);
  return file;
}

/** 生成新令牌（幂等场景由调用方决定是否复用旧值） */
export function newWebchatIngestToken(): string {
  return randomBytes(24).toString('hex');
}
