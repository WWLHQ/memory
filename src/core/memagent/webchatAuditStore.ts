// 网页对话导出的完整性审计：把「原对话」与「导出文档」放在一起比，回答
// 「导全了没有、有没有遗漏、正确率多少」。
//
// 为什么必须同一次抽取内比（2026-11-17 实测确认）：
//   DeepSeek 的 IndexedDB（https_chat.deepseek.com_0.indexeddb.leveldb）里
//   **只有会话元数据**（id/title/updated_at/is_empty），没有对话正文——
//   实测在全部 .ldb/.log 里搜「个人开发的记忆系统」「变现路径」均 0 命中。
//   豆包同理：原对话只在页面 DOM 与站点接口里，不在本机磁盘。
//   所以「导出后拿磁盘文件跟原对话比」这条路根本不存在——原对话拿不到。
//   唯一可行：**插件抽取时把原对话一起带上来**，落盘成对，才能逐条比对。
//
// 落盘布局（与导出目录分开，避免被采集器当对话扫进去）：
//   <导出目录>/../webchat-audit/<站点>/<时间戳>.json
//   内容：{ source: [{role,text}], exported: [{role,text}], ... }
//
// 采集器只扫导出目录（chat-exports），审计目录是同级另一目录，不会污染记忆库。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditExport, summarizeAudit, type AuditMessage, type AuditOneResult } from './webchatAudit.ts';

/** 单条会话的审计快照（插件随导出一起送上来） */
export interface WebchatAuditSnapshot {
  site: string;
  title: string;
  url: string;
  exportedAt: number;
  /** 原对话（插件从 DOM 抽到的消息序列） */
  source: AuditMessage[];
  /** 导出文档（应用落盘的那份 Markdown 原文） */
  exportedMarkdown: string;
}

export interface WebchatAuditFile extends WebchatAuditSnapshot {
  file: string;
}

const AUDIT_DIR_NAME = 'webchat-audit';

/**
 * 审计目录：固定放在**应用数据根**下（<数据根>/webchat-audit），不跟导出目录走。
 *
 * 为什么不放导出目录旁边：导出目录可能是 `C:\Users\xxx\Downloads\chat-exports`
 * （用户自己选的），把审计文件扔进去等于污染用户的下载目录，而且和「诊断线索」
 * （webchat-verify）已经采取的做法不一致 —— 那类非对话数据统一待在数据根。
 *
 * 采集器只扫导出目录（chat-exports），审计目录在数据根另一个位置，不会被当对话入库。
 */
export function resolveAuditDir(rootDir: string): string {
  return join(rootDir, AUDIT_DIR_NAME);
}

function safeSegment(value: string, max: number): string {
  let out = '';
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const code = text.charCodeAt(i);
    out += (code < 32 || '<>:"/\\|?*'.indexOf(ch) >= 0) ? '_' : ch;
  }
  return out.replace(/\s+/g, '_').slice(0, max || 60);
}

function stampOf(at: number): string {
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 写一份审计快照（同名的重复导出会被内容哈希区分开，便于事后看出「重复导出」） */
export function writeAuditSnapshot(dir: string, snap: WebchatAuditSnapshot): string {
  const site = safeSegment(snap.site, 40) || 'webchat';
  const siteDir = join(dir, site);
  mkdirSync(siteDir, { recursive: true });
  const sha = createHash('sha256').update(snap.exportedMarkdown).digest('hex').slice(0, 8);
  const file = join(siteDir, `${stampOf(snap.exportedAt)}-${sha}.json`);
  writeFileSync(file, JSON.stringify(snap, null, 2), 'utf8');
  return file;
}

/**
 * 读回全部审计快照。
 *
 * 两种布局都要认（2026-11-17 实测事故）：
 *   ① `<dir>/<站点>/<时间戳>.json` —— 设计时的布局；
 *   ② `<dir>/<时间戳>.json`        —— 接收端实际写出来的布局
 *      （webchatIngest 直接 `join(auditDir, basename.md → .json)`，没有站点子目录）。
 * 只认 ① 会让 191 份真实快照被读成 0 份，UI 于是报「还没有可比对的原对话快照」，
 * 而磁盘上明明有 —— 用户没法自证，只能怀疑功能没上线。
 */
export function readAuditSnapshots(dir: string): WebchatAuditFile[] {
  if (!existsSync(dir)) return [];
  const out: WebchatAuditFile[] = [];
  const push = (file: string): void => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as WebchatAuditSnapshot;
      if (!raw || !Array.isArray(raw.source)) return;
      out.push({ ...raw, file });
    } catch {
      // 坏文件跳过，不让一次坏快照毁掉整份审计
    }
  };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name.toLowerCase().endsWith('.json')) push(join(dir, entry.name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const siteDir = join(dir, entry.name);
    for (const f of readdirSync(siteDir)) {
      if (f.toLowerCase().endsWith('.json')) push(join(siteDir, f));
    }
  }
  return out;
}

/** 跑一次完整审计 → 逐会话明细 + 总账 */
export function runAudit(dir: string): {
  results: { snapshot: WebchatAuditFile; result: AuditOneResult }[];
  summary: ReturnType<typeof summarizeAudit>;
} {
  const snaps = readAuditSnapshots(dir);
  const results = snaps.map((snapshot) => ({ snapshot, result: auditExport(snapshot.source ?? null, snapshot.exportedMarkdown ?? '') }));
  return { results, summary: summarizeAudit(results.map((r) => r.result)) };
}

/** 人话版的审计报告（给用户看，不给 JSON） */
export function formatAuditReport(
  out: { results: { snapshot: WebchatAuditFile; result: AuditOneResult }[]; summary: ReturnType<typeof summarizeAudit> },
): string {
  const lines: string[] = [];
  const s = out.summary;
  lines.push('# 网页对话导出完整性审计');
  lines.push('');
  lines.push(`- 审计会话数：${s.sessions}（其中 ${s.sessionsWithSnapshot} 个带原对话快照，可逐条比对）`);
  lines.push(`- 原对话消息总数：${s.sourceMessages} 条；导出文档消息总数：${s.exportedMessages} 条`);
  if (s.accuracy !== null) {
    lines.push(`- 综合正确率（逐字一致 / 原对话条数）：${(s.accuracy * 100).toFixed(1)}%`);
  }
  lines.push(`- 逐字一致：${s.textExact} 条；角色判错：${s.roleMismatch} 条；遗漏：${s.missing} 条；多余：${s.extra} 条`);
  lines.push(`- 被截断：${s.truncated} 条；内容被改写：${s.rewritten} 条`);
  lines.push('');
  const bad = out.results.filter((r) => {
    const rr = r.result;
    return rr.missing > 0 || rr.extra > 0 || rr.truncated > 0 || rr.rewritten > 0 || rr.roleMismatch > 0;
  });
  if (bad.length === 0) {
    lines.push('逐条比对结果：全部会话完全一致，无遗漏、无截断、无改写。');
    return lines.join('\n');
  }
  lines.push(`## 有差异的会话（${bad.length} 个）`);
  lines.push('');
  for (const b of bad.slice(0, 50)) {
    const r = b.result;
    lines.push(`### ${b.snapshot.title || '(无标题)'} — ${b.snapshot.url}`);
    lines.push(`原对话 ${r.sourceCount ?? '?'} 条 / 导出 ${r.exportedCount} 条；逐字一致 ${r.textExact} 条；遗漏 ${r.missing}、多余 ${r.extra}、截断 ${r.truncated}、改写 ${r.rewritten}、角色错 ${r.roleMismatch}`);
    for (const issue of r.issues) lines.push(`- ${issue}`);
    lines.push('');
  }
  return lines.join('\n');
}
