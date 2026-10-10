// 审计日志页后端镜像（T5）：沿用 ?backend= 覆盖模式。
// ⚠ 本地种子为真相；home server 暂无 audit 端点，故 mirror 为 safe-noop（fire-and-forget，失败静默）。
import { useEffect, useRef } from 'react';

export function resolveBackendUrl(): string {
  if (typeof location === 'undefined') return '';
  const q = new URLSearchParams(location.search).get('backend');
  if (q !== null) return q.trim();
  return 'http://localhost:8200';
}

export interface AuditMirror {
  /** 审计查询/导出上抛：当前 safe-noop */
  audit: (action: string) => void;
}

export function useAuditMirror(): AuditMirror {
  const urlRef = useRef<string | null>(null);
  if (urlRef.current === null) urlRef.current = resolveBackendUrl();

  useEffect(() => {
    // 预留：未来 home server 提供 /api/audit 时在此回填（失败静默）。
  }, []);

  return {
    audit: () => {
      // safe-noop：保持原型同步交互，不阻塞 UI。
    },
  };
}
