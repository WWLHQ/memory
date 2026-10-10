// 用户反馈页后端镜像（T4）：safe-noop 模式。
import { useEffect, useRef } from 'react';
import { mirrorReport } from '../mirrorClient.ts';
import type { FeedbackRecord } from './types.ts';

export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface FeedbackMirror {
  audit: (action: string, rec: FeedbackRecord, requestId: string) => void;
}

export function useFeedbackMirror(): FeedbackMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：home server 提供 /api/feedback 时上抛（失败静默）。
  }, []);

  return {
    audit: (action, rec, requestId) => {
      // G6 上抛：13.7 反馈 + 17.4 trust_delta（request_id 继承召回链路）
      mirrorReport('feedback', action, requestId, {
        memory_id: rec.memory_id, fb_action: rec.action, rating: rec.rating, trust_delta: rec.trust_delta,
      });
    },
  };
}
