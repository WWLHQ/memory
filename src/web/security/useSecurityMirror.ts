// 账号与安全页后端镜像（T4）：safe-noop 模式。
import { useEffect, useRef } from 'react';
import { mirrorReport } from '../mirrorClient.ts';

import { homeBaseUrl } from '../backend.ts';

export function resolveBackendUrl(): string {
  return homeBaseUrl();
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
    audit: (action, requestId) => {
      // G6 上抛：安全配置变更（后端不在时静默）
      mirrorReport('security', action, requestId);
    },
  };
}
