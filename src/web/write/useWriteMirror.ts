// 写入页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。
// 内核账本是真相；?backend= 显式关闭时跳过上抛，后端不可达时失败由 mirrorClient 记录、
// 经全局提示条与运行日志可见（不再静默），页面数据与交互不受影响。
import { mirrorReport } from '../mirrorClient.ts';

export interface WriteMirror {
  /** 写入/覆盖/合并审计上抛：真发 /api/mirror/audit；失败可见但不中断交互 */
  audit: (action: string) => void;
}

export function useWriteMirror(): WriteMirror {
  return {
    audit: (action) => mirrorReport('write', action),
  };
}
