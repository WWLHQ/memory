// 写入页后端镜像（T5）：沿用 ?backend= 覆盖模式。
// ⚠ 本地内存态为真相；home server 暂无 write/memory 端点，故 mirror 为 safe-noop（fire-and-forget，失败静默）。
import { useEffect, useRef } from 'react';

export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface WriteMirror {
  /** 写入/覆盖/合并审计上抛：当前 safe-noop */
  audit: (action: string) => void;
}

export function useWriteMirror(): WriteMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：未来 home server 提供 /api/memories 写入时在此回填（失败静默）。
  }, []);

  return {
    audit: () => {
      // safe-noop：保持原型同步交互，不阻塞 UI。
    },
  };
}
