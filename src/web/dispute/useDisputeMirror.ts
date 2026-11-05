// 冲突裁决页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。
// 内核账本是真相；?backend= 显式关闭时跳过上抛，后端不可达时失败由 mirrorClient 记录、
// 经全局提示条与运行日志可见（不再静默），页面数据与交互不受影响。
import { mirrorReport } from '../mirrorClient.ts';
import type { ConflictRecord } from './types.ts';

export interface DisputeMirror {
  /** 18.4 约束5 成对审计（old_id/new_id 必须成对出现）：真发 /api/mirror/audit */
  audit: (action: string, rec: ConflictRecord, verdict: string | null) => void;
}

export function useDisputeMirror(): DisputeMirror {
  return {
    audit: (action, rec, verdict) => {
      mirrorReport('dispute', action, undefined, {
        conflict_id: rec.id, old_id: rec.old_id, new_id: rec.new_id, verdict,
      });
    },
  };
}
