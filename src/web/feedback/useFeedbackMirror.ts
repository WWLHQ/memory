// 用户反馈页后端镜像（阶段5-C 口径统一）：真接 home server POST /api/mirror/audit。
// 内核账本是真相；?backend= 显式关闭时跳过上抛，后端不可达时失败由 mirrorClient 记录、
// 经全局提示条与运行日志可见（不再静默），页面数据与交互不受影响。
import { mirrorReport } from '../mirrorClient.ts';
import type { FeedbackRecord } from './types.ts';

export interface FeedbackMirror {
  /** 13.7 反馈 + 17.4 trust_delta（request_id 继承召回链路）：真发 /api/mirror/audit */
  audit: (action: string, rec: FeedbackRecord, requestId: string) => void;
}

export function useFeedbackMirror(): FeedbackMirror {
  return {
    audit: (action, rec, requestId) => {
      mirrorReport('feedback', action, requestId, {
        memory_id: rec.memory_id, fb_action: rec.action, rating: rec.rating, trust_delta: rec.trust_delta,
      });
    },
  };
}
