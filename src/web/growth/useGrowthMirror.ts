// 自我净化与生长页后端镜像：growth_op 动作审计上抛（G6 fire-and-forget）。
import { useCallback } from 'react';
import { mirrorReport } from '../mirrorClient.ts';
import type { GrowthAuditEntry } from './types.ts';

export function useGrowthMirror() {
  return useCallback((event: string, requestId: string, entry: GrowthAuditEntry) => {
    mirrorReport('growth', event, requestId, { entry });
  }, []);
}
