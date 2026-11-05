// 审计行 → 检索页「链路上下文」的真实跳转契约（阶段5-A / A15）。
// 旧实现是指向通览页的空跳转：目标页不消费任何参数，点击后无任何上下文。
// 现在 href 带真实 request_id，检索页按该 id 真查内核审计账本；查不到如实显示空，绝不生成模拟结果。
import { chainByRequest } from './logic.ts';
import type { AuditEntry } from './types.ts';

/** 检索页入口（全小写；Windows 大小写不敏感会掩盖 Linux 上的 404） */
export const RETRIEVAL_CONTEXT_PAGE = '/retrieval.html';
export const RETRIEVAL_CONTEXT_PARAM = 'request_id';

/** 生成真实链路跳转 URL；request_id 必须编码，避免 & / 空格切断参数 */
export function retrievalContextHref(requestId: string): string {
  return `${RETRIEVAL_CONTEXT_PAGE}?${RETRIEVAL_CONTEXT_PARAM}=${encodeURIComponent(requestId)}`;
}

/** 从 URL search 读取 request_id；缺失/空白返回 null（不回落伪造的默认链路） */
export function readTrailRequestId(search: string): string | null {
  const raw = new URLSearchParams(search).get(RETRIEVAL_CONTEXT_PARAM);
  return raw && raw.trim() ? raw : null;
}

/** 只保留该 request_id 的真实审计行（时间升序）；无参数或账本查无此 id → 空数组 */
export function trailEntries(entries: AuditEntry[], requestId: string | null): AuditEntry[] {
  return requestId ? chainByRequest(entries, requestId) : [];
}
