// 全局参数页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。
// 内核账本是真相；?backend= 显式关闭时跳过上抛，后端不可达时失败由 mirrorClient 记录、
// 经全局提示条与运行日志可见（不再静默），页面数据与交互不受影响。
import { mirrorReport } from '../mirrorClient.ts';
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';

export interface ParamsMirror {
  /** params_save（配置快照随 payload 持久到 home server 账本）：真发 /api/mirror/audit */
  save: (cfg: NormalConfig, kbs: KbPolicyRow[], dev: DevParams, requestId: string) => void;
}

export function useParamsMirror(): ParamsMirror {
  return {
    save: (cfg, kbs, dev, requestId) => {
      mirrorReport('params', 'params_save', requestId, { cfg, kbs, dev });
    },
  };
}
