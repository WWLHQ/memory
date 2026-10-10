// 冲突裁决页后端镜像（T5）：沿用 useBackendMirror 的 ?backend= 覆盖模式。
// ⚠ 本地内存态为真相；home server 暂无 dispute 端点，故 mirror 为 safe-noop（fire-and-forget，失败静默）。
import { useEffect, useRef } from 'react';
import { mirrorReport } from '../mirrorClient.ts';
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
    audit: (action, rec, verdict) => {
      // G6 上抛：18.4 约束5 成对审计（old_id/new_id 必须成对出现）
      mirrorReport('dispute', action, undefined, {
        conflict_id: rec.id, old_id: rec.old_id, new_id: rec.new_id, verdict,
      });
    },
  };
}
