// 账号与安全页后端镜像（T4）：safe-noop 模式。
import { useEffect, useRef } from 'react';

export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface SecurityMirror {
  audit: (action: string, requestId: string) => void;
}

export function useSecurityMirror(): SecurityMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：home server 提供 /api/security 时上抛（失败静默）。
  }, []);

  return {
    audit: (_action, _requestId) => {
      // safe-noop
    },
  };
}
