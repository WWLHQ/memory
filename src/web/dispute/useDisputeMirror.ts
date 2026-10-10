// 冲突裁决页后端镜像（T5）：沿用 useBackendMirror 的 ?backend= 覆盖模式。
// ⚠ 本地内存态为真相；home server 暂无 dispute 端点，故 mirror 为 safe-noop（fire-and-forget，失败静默）。
import { useEffect, useRef } from 'react';
import type { ConflictRecord } from './types.ts';

export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface DisputeMirror {
  audit: (action: string, rec: ConflictRecord, verdict: string | null) => void;
}

export function useDisputeMirror(): DisputeMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：未来 home server 提供 /api/conflicts 时在此拉取回填（失败静默）。
  }, []);

  return {
    audit: (_action, _rec, _verdict) => {
      // safe-noop
    },
  };
}
