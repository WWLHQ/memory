// 冲突裁决页 T5：完整编排 + mirror · 真实数据接真版
// 队列 = 真实账本冲突（记忆表 conflict_id 标记 + conflict_resolve 审计「转人工」事件，
// 桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级内存态，无冲突诚实空态）。
// 裁决走 ma._memoryOp / ma.write（真实写账本 + 审计：auto_override/merge 落定出队，
// user_confirm/hold 写审计保持 pending）。
// 与记忆库管理页一致：禁止注入演示/种子冲突 —— 队列只反映真实账本 pending 冲突；
// 无真实冲突 → 诚实空态并引导去写入页产生真实记忆。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示内核原因 + 重试，绝不渲染成「无待裁决冲突」。
import { useEffect, useState } from 'react';
import { queueSort, auditPair } from './logic.ts';
import { useDisputeMirror } from './useDisputeMirror.ts';
import { coreConflicts, coreVerdict } from './coreDispute.ts';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
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

const NO_CONFLICTS: ConflictRecord[] = [];

export function DisputePage({ load = coreConflicts }: { load?: () => Promise<ConflictRecord[]> } = {}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEvt[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useDisputeMirror();

  // 挂载：从真实账本读 pending 冲突队列（无种子兜底；读不到 = 错误态，不冒充无冲突）
  const ledger = useKernelLoad<ConflictRecord[]>('dispute', load);
  const { phase, data, error: loadError, retry } = ledger;
  const conflicts = data ?? NO_CONFLICTS;

  const now = Date.now();
  const filtered = queueSort(conflicts, now);
  const selected = conflicts.find((r) => r.id === selectedId) ?? null;

  // 首次读到队列 → 默认选中第一条；裁决后出队 → 顺延选中
  useEffect(() => {
    if (phase !== 'ok') return;
    setSelectedId((cur) => (conflicts.some((r) => r.id === cur) ? cur : conflicts[0]?.id ?? null));
  }, [phase, conflicts]);

  const handleVerdict = async (v: Verdict, _result: unknown) => {
    if (!selected) return;
    try {
      const out = await coreVerdict(selected, v);
      // 批次48 A19：request_id 只能来自内核裁决返回值；内核没给就不显示假 id
      const reqId = out.kernel_request_ids[0] ?? '';
      const evt = auditPair(selected, v, reqId);
      setAuditLog((prev) => [{ ...evt, note: out.merged_mem_id ? `${evt.note}（合并记忆 ${out.merged_mem_id}）` : evt.note }, ...prev]);
      // G6 上抛：真发 /api/mirror/audit（失败由 mirrorClient 记录并可见），携带真实 verdict 与 request_id
      mirror.audit('dispute', selected, v, reqId);
      show(reqId ? `${evt.note}（${reqId}）` : `${evt.note}（内核未返回 request_id）`);
      // 内核裁决后刷新队列：resolved 出队；user_confirm/hold 保持 pending（真实语义）
      ledger.replace(await coreConflicts());
    } catch (e) {
      show(`裁决失败：${kernelErrorText(e)}`);
    }
  };

  if (phase === 'loading') {
    return (
      <div className="wrap" data-testid="dispute-page">
        <h1>⚖️ 冲突裁决页 <span className="badge p2">REQ-006 · P7</span></h1>
        <div className="note">加载真实账本中…</div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="wrap" data-testid="dispute-page">
        <h1>⚖️ 冲突裁决页 <span className="badge p2">REQ-006 · P7</span></h1>
        <KernelLoadError what="读取待裁决冲突队列" error={loadError} onRetry={retry} />
        {toast}
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div className="wrap" data-testid="dispute-page">
        <h1>⚖️ 冲突裁决页 <span className="badge p2">REQ-006 · P7</span></h1>
        <div className="card" data-testid="dispute-empty">
          <b>当前账本无待裁决冲突。</b>
          <div className="note">
            队列只反映真实账本中 pending 的冲突（记忆表 conflict_id 标记 + conflict_resolve
            「转人工」审计）。请先在「写入页」产生记忆，当不同端对同一记忆产生并发版本时，
            内核会真实产出冲突进入本队列。空账本不伪造数据。
          </div>
        </div>
        {toast}
      </div>
    );
  }

  return (
    <div className="wrap" data-testid="dispute-page">
      <h1>⚖️ 冲突裁决页 <span className="badge p2">REQ-006 · P7</span></h1>
      <div className="sub">人工审核队列（12.1）+ 9.7 三模式裁决 · 数据真相 = 内核账本（{conflicts.length} 条真实待裁决）</div>
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
                <span className="mid">{e.request_id || '账本无 request_id'}</span> · {e.action} · {e.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast}
    </div>
  );
}
