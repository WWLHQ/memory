// 无状态 ID 对账：会话 ID 是唯一主键，文件名即 ID，文件系统即账本。
// 方案见 specs/reports/WEBCHAT-ID-RECONCILE-PLAN.md。
// 这里只放纯函数（零 IO 副作用除 listCollectedIds 的只读目录扫描），便于单测与变异验证。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 采集驱动交上来的会话——只需要 id + title 就能做对账，其他字段原样透传。 */
export interface DriverChat {
  id: string;
  title: string;
  [k: string]: unknown;
}

const ID_PATTERNS: RegExp[] = [
  /\/a\/chat\/s\/([0-9a-fA-F-]{8,})/,   // deepseek / 通用
  /\/chat\/([0-9]{8,})/,                // 豆包：/chat/<数字会话ID>
  /\/search\/([0-9]{8,})/,              // 文心一言：/search/<数字会话ID>
  /[?&]chat[id]?=([0-9a-zA-Z_-]{8,})/,  // 部分站点的 query 参数
];

/**
 * 从会话 URL 提取稳定 ID。拿不到返回 null，由调用方退化处理（不要瞎编 ID）。
 * 只认 URL 里现成的 ID，不解析正文、不依赖排序。
 */
export function conversationIdFromUrl(url: string): string | null {
  if (typeof url !== 'string' || !url) return null;
  for (const re of ID_PATTERNS) {
    const m = re.exec(url);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * 净化成安全文件名主干：只保留 [A-Za-z0-9_.-]，其余一律下划线；空串视为无 ID；上限 80。
 * Windows 文件名非法字符（\/:*?"<>|）全部消失，天然无路径穿越。
 */
export function sanitizeConversationId(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

/**
 * 会话对应的文件名。有 ID → <sanitized-id>.md（幂等，任何时间都是同一个名字）；
 * 无 ID → 时间戳文件名（兼容旧插件 / 其他站点，幂等性较弱是已知边界 N3）。
 */
export function webchatExportFileName(at: number, conversationId?: string): string {
  const id = sanitizeConversationId(conversationId ?? '');
  if (id) return `${id}.md`;
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}.md`;
}

/** 无 ID 会话的退化去重键（只用于内存集合比较，不落盘） */
function fallbackFileName(chat: DriverChat): string {
  return `title:${chat.title}.md`;
}

/** 一次会话在"已采集合"里的键。有 ID 走 ID，无 ID 退化标题。 */
export function chatCollectedKey(chat: DriverChat): string {
  const id = sanitizeConversationId(chat.id ?? '');
  return id ? `${id}.md` : fallbackFileName(chat);
}

/**
 * 从"当前存在的 ID 集合"里过滤出待采会话。
 * existing 是 <exportDir>/<site>/ 下已有的 .md 文件名集合（文件系统即账本）。
 * 同一批内重复 ID 只采一次；改正文不影响 ID → 不会重复采（T1）；
 * 删掉文件后 key 消失 → 重新待采（T3）。
 */
export function pickNewChatsById<T extends DriverChat>(chats: T[], existing: Set<string>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const c of chats) {
    const key = chatCollectedKey(c);
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * 扫导出目录，得到"已采的 ID 集合"——只读 .md 文件名，忽略诊断/备份/子目录。
 *
 * `requireUserMessage` 用于修「导出文件没有用户对话」：历史上 2026-11-19 19:53–19:58
 * 导出的 8 份文件只有 `## 助手`，旧代码已修但坏文件仍被当"已采"永久跳过。
 * 打开该开关后，没有 `## 用户` 的文件不算已采，下一轮会自动按同一会话 ID 覆盖重采。
 */
export function listCollectedIds(dir: string, opts?: { requireUserMessage?: boolean }): Set<string> {
  const out = new Set<string>();
  const requireUser = opts?.requireUserMessage === true;
  try {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isFile()) continue;
      if (!name.name.toLowerCase().endsWith('.md')) continue;
      if (requireUser) {
        try {
          const text = readFileSync(join(dir, name.name), 'utf8');
          // 必须是独立的 `## 用户` 标题；正文里出现"用户"两个字不算。
          if (!/^##\s*用户\s*$/m.test(text)) continue;
        } catch {
          // 读不出来就不算已采：宁可重采，也不能让坏文件永久占位
          continue;
        }
      }
      out.add(name.name);
    }
  } catch {
    // 目录不存在 / 读不到 → 当作空账本（宁可重采，不可静默漏采）
  }
  return out;
}
