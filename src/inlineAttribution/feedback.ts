// REQ-004 T7 用户干预反馈闭环（端口式，预留 REQ-007 内核接入）
// 来源：需求规格书_Agent界面内联记忆标识.md §3（13.7 → 7.2 自生长）、§2.4（9.10 stale）
import type { FeedbackAction, TrustDelta, FeedbackPort } from '../types/inlineAttribution.ts';

/** 动作 → 信任增量（13.7 / 9.10） */
export function applyFeedback(action: FeedbackAction): TrustDelta {
  switch (action) {
    case 'confirm':
      return { action, delta: 0.1, toConflictQueue: false }; // 提升优先级
    case 'reject':
      return { action, delta: -0.05, toConflictQueue: false }; // 降权不删除 → stale
    case 'disputed':
      return { action, delta: 0, toConflictQueue: true }; // 进冲突裁决队列 P7
  }
}

/** 本地 mock 端口：写审计 + 回调（真实内核端口留待 REQ-007） */
export class LocalMockFeedbackPort implements FeedbackPort {
  public audits: Array<{ req: string; delta: TrustDelta }> = [];
  constructor(private readonly onWrite?: (req: string, delta: TrustDelta) => void) {}
  writeAudit(req: string, delta: TrustDelta): void {
    this.audits.push({ req, delta });
    this.onWrite?.(req, delta);
  }
}
