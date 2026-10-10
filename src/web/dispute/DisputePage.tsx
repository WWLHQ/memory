// 冲突裁决页 T5：完整编排 + mirror
import { useState, useRef } from 'react';
import { SEED_CONFLICTS } from './seed.ts';
import { queueSort, auditPair } from './logic.ts';
import { useDisputeMirror } from './useDisputeMirror.ts';
import { DisputeQueue } from './DisputeQueue.tsx';
import { DisputeVerdict } from './DisputeVerdict.tsx';
import { useToast } from './useToast.tsx';
import type { ConflictRecord, Verdict } from './types.ts';

/** 本地审计事件（18.4 约束5：old_id/new_id 成对） */
interface AuditEvt {
  action: string;
  old_id: string;
  new_id: string;
  verdict: Verdict;
  request_id: string;
  note?: string;
}

export function DisputePage() {
  const [list] = useState<ConflictRecord[]>(SEED_CONFLICTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEvt[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useDisputeMirror();
  const requestSeq = useRef(0);

  const now = Date.now();
  const filtered = queueSort(list, now);
  const selected = list.find((r) => r.id === selectedId) ?? null;

  const handleVerdict = (v: Verdict, _result: unknown, reqId: string) => {
    if (!selected) return;
    const evt = auditPair(selected, v, reqId);
    setAuditLog((prev) => [evt, ...prev]);
    // G6 上抛：safe-noop（mirror 为 safe-noop）
    mirror.audit('dispute', selected as any, null as any);
    show(`${evt.note}（${reqId}）`);
  };

  return (
    <div className="wrap" data-testid="dispute-page">
      <h1>⚖️ 冲突裁决页 <span className="badge p2">REQ-006 · P7</span></h1>
      <div className="sub">人工审核队列（12.1）+ 9.7 三模式裁决 · 数据本地种子为真相</div>
      <div className="card">
        <div className="row-head">
          <b>待裁决队列（{filtered.length}）</b>
          <span className="dim">仅 dispute_flag=true；超期 &gt;7d 高亮</span>
        </div>
        <DisputeQueue list={filtered} now={now} onSelect={setSelectedId} selectedId={selectedId ?? undefined} />
      </div>
      {selected && (
        <div className="card">
          <b>裁决面板 — {selected.id}</b>
          <div className="compare">
            <div className="side old" data-testid="panel-old">
              <span className="meta">{selected.old_id} · {selected.old_confidence}</span>
              {selected.old_content}
            </div>
            <div className="side new" data-testid="panel-new">
              <span className="meta">{selected.new_id} · {selected.new_confidence}</span>
              {selected.new_content}
            </div>
          </div>
          <DisputeVerdict
            record={selected}
            requestSeq={requestSeq.current + 1}
            onVerdict={handleVerdict}
          />
        </div>
      )}
      {auditLog.length > 0 && (
        <div className="card">
          <b>裁决历史（18.4）</b>
          <ul data-testid="audit-log">
            {auditLog.map((e, i) => (
              <li key={i} data-testid={`audit-row-${i}`}>
                <span className="mid">{e.request_id}</span> · {e.action} · {e.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast}
    </div>
  );
}
