// 记忆管理页后端镜像（T5）：沿用 useBackendMirror 的 ?backend= 覆盖模式。
// ⚠ 本地内存态为真相；home server 暂无 memory 端点，故 mirror 为 safe-noop（fire-and-forget，失败静默）。
import { useEffect, useRef } from 'react';
import type { MemoryOp, MemoryRecord } from './types.ts';

/** 默认本地后端；?backend= 可覆盖（与原型语义优先一致） */
export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface MemoryMirror {
  /** G6 审计上抛：当前为 safe-noop（无端点时静默） */
  audit: (action: string, rec: MemoryRecord, op: MemoryOp) => void;
}

export function useMemoryMirror(): MemoryMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：未来 home server 提供 /api/memories 时在此拉取回填（失败静默）。
  }, []);

  return {
    audit: (_action, _rec, _op) => {
      // safe-noop：保持原型同步交互，不阻塞 UI。
    },
  };
}
