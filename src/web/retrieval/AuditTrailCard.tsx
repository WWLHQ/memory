// 检索页「审计链路上下文」卡（阶段5-A / A15 接线）。
// 真查内核审计账本，按 ?request_id= 过滤：无参数不渲染、查无记录如实显示空、读取失败显式报错。
// 红线：本卡只回放已发生的审计行，不模拟召回结果、不注入任何演示数据。
import { useEffect, useState } from 'react';
import type { AuditEntry } from '../audit/types.ts';
import { coreLoadAudit } from '../audit/coreAudit.ts';
import { actionLabel } from '../audit/logic.ts';
import { readTrailRequestId, trailEntries } from '../audit/auditLink.ts';

export function AuditTrailCard({ search }: { search: string }) {
  const requestId = readTrailRequestId(search);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    setState('loading');
    void coreLoadAudit()
      .then((all) => {
        if (!alive) return;
        setRows(trailEntries(all, requestId));
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => { alive = false; };
  }, [requestId]);

  if (!requestId) return null;

  return (
    <div className="card" data-testid="audit-trail-card">
      <div className="row-head"><b>审计链路上下文</b> <span className="dim">request_id={requestId}</span></div>
      {state === 'loading' && <div className="note" data-testid="trail-loading">读取内核审计账本…</div>}
      {state === 'error' && <div className="note" data-testid="trail-error">读取审计账本失败：未展示任何上下文（不生成模拟结果）。</div>}
      {state === 'ready' && rows.length === 0 && (
        <div className="note" data-testid="trail-empty">账本中无该 request_id 的审计记录；此处不生成任何检索结果。</div>
      )}
      {state === 'ready' && rows.length > 0 && (
        <div data-testid="trail-rows">
          {rows.map((e, i) => (
            <div className="note" key={`${e.request_id}-${i}`} data-testid={`trail-row-${i}`}>
              {new Date(e.created_at).toLocaleString('zh-CN')} · {actionLabel(e.action)} · {e.resource_type}/{e.resource_id} · payload {e.payload_tokens}（预算单位）
            </div>
          ))}
        </div>
      )}
      <div className="note">数据来源：内核审计账本（append-only）。本卡只展示已发生的审计行，不模拟召回。</div>
    </div>
  );
}
