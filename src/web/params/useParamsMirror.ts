// 全局参数页后端镜像（T4）：沿用 ?backend= 覆盖 + safe-noop 模式。
import { useEffect, useRef } from 'react';
import { mirrorReport } from '../mirrorClient.ts';
import type { DevParams, KbPolicyRow, NormalConfig } from './types.ts';

export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface ParamsMirror {
  save: (cfg: NormalConfig, kbs: KbPolicyRow[], dev: DevParams, requestId: string) => void;
}

export function useParamsMirror(): ParamsMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：home server 提供 /api/params 时拉取回填（失败静默）。
  }, []);

  return {
    save: (cfg, kbs, dev, requestId) => {
      // G6 上抛：params_save（配置快照随 payload 持久到 home server 账本）
      mirrorReport('params', 'params_save', requestId, { cfg, kbs, dev });
    },
  };
}
