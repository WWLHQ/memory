// 冲突裁决页 T5：完整编排 + mirror
// 初始渲染用种子；队列 = 内核 SyncHub 真实冲突（并发版本 push 产出），
// 裁决走 hub.resolve + ma._memoryOp（auto_override/merge 落定出队，user_confirm/hold 保持 pending）。
import { useEffect, useState, useRef } from 'react';
import { SEED_CONFLICTS } from './seed.ts';
import { queueSort, auditPair } from './logic.ts';
import { useDisputeMirror } from './useDisputeMirror.ts';
import { coreConflicts, coreVerdict } from './coreDispute.ts';
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
  const [list, setList] = useState<ConflictRecord[]>(SEED_CONFLICTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEvt[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useDisputeMirror();
  const requestSeq = useRef(0);

  const now = Date.now();
  const filtered = queueSort(list, now);
  const selected = list.find((r) => r.id === selectedId) ?? null;

  // 挂载同步：队列以内核 SyncHub pending 冲突为准（初始种子渲染，内容一致无跳变）
  useEffect(() => {
    let alive = true;
    coreConflicts().then((live) => { if (alive && live.length > 0) setList(live); });
    return () => { alive = false; };
  }, []);

  const handleVerdict = async (v: Verdict, _result: unknown, reqId: string) => {
    if (!selected) return;
    const out = await coreVerdict(selected, v);
    const evt = auditPair(selected, v, reqId);
    setAuditLog((prev) => [{ ...evt, note: out.merged_mem_id ? `${evt.note}（合并记忆 ${out.merged_mem_id}）` : evt.note }, ...prev]);
    // G6 上抛：safe-noop（mirror 为 safe-noop）
    mirror.audit('dispute', selected as any, null as any);
    show(`${evt.note}（${reqId}）`);
    // 内核裁决后刷新队列：resolved 出队；user_confirm/hold 保持 pending（真实语义）
    const live = await coreConflicts();
    setList(live);
    // 已选冲突若已出队，清空选中
    setSelectedId((cur) => (live.some((r) => r.id === cur) ? cur : null));
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
