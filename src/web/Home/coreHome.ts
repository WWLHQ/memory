// 首页（REQ-005）溯源接真：.rid 点击后真查 home server mirror 账本（/api/mirror/audit），
// modal 内展示命中条目；四卡数据为原型 §0.2 快照（UI 硬约束，E2E 锁定文案）。
import { mirrorFetch } from '../mirrorClient.ts';

export interface TraceHit {
  source: string;
  action: string;
  request_id: string;
  seq?: number;
}

/** 按 request_id 在 home 账本中溯源（后端不在/未收录 → 空数组，safe-noop 语义） */
export async function coreTraceLookup(requestId: string, limit = 200): Promise<TraceHit[]> {
  const { items } = await mirrorFetch(undefined, limit);
  return items
    .map((raw) => raw as { source?: unknown; action?: unknown; request_id?: unknown; seq?: unknown })
    .filter((i) => i.request_id === requestId)
    .map((i) => ({
      source: String(i.source ?? 'unknown'),
      action: String(i.action ?? 'unknown'),
      request_id: String(i.request_id),
      seq: typeof i.seq === 'number' ? i.seq : undefined,
    }));
}
