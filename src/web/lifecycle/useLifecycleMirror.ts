// 生命周期页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。
// 内核审计账本是真相；?backend= 显式关闭时跳过上抛，后端不可达时失败由 mirrorClient 记录、
// 经全局提示条与运行日志可见（不再静默），页面数据与交互不受影响。
import { mirrorReport } from '../mirrorClient.ts';

export interface LifecycleMirror {
  /** 生命周期动作审计上抛：真发 /api/mirror/audit；失败可见但不中断交互 */
  audit: (action: string, requestId: string) => void;
}

export function useLifecycleMirror(): LifecycleMirror {
  return { audit: (action, requestId) => mirrorReport('lifecycle', action, requestId) };
}
