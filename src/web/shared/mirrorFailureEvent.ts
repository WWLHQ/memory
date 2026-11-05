// 阶段5-C：mirror 上抛失败事件与载荷（零依赖共享，避免 mirrorClient ↔ actionLog 循环 import）。
export const MIRROR_FAILURE_EVENT = 'mam:mirror-failure';

export interface MirrorFailure {
  source: string;
  action: string;
  reason: string;
  at: number;
}
