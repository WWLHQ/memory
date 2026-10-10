// 写入页（REQ-006 / P2）· 完整编排（T5）
// 表单(T3) + 查重卡(T4) + 写入回执（memory_id + L1–L6 折叠，L1 仅审计展开）+ toast + 后端 mirror。
// 数据本地内存态为真相；操作经校验后生成回执并触发审计上抛（G6）。
import { useState } from 'react';
import { WriteForm } from './WriteForm.tsx';
import { DedupCard } from './DedupCard.tsx';
import { useToast } from './useToast.tsx';
import { useWriteMirror } from './useWriteMirror.ts';
import { composeReceipt, scoreDedup, validateDraft } from './logic.ts';
import { SEED_EXISTING } from './seed.ts';
import type { LayerName, MemoryDraft, WriteReceipt } from './types.ts';

// 全局注入（演示值；真实环境由租户上下文注入，禁手填，R2）
const INJECTED = { session_id: 's1', project_id: 'p1' };

export function WritePage() {
  const [draft, setDraft] = useState<MemoryDraft>({
    content: '', category: 'fact', tags: [], source: 'conversation',
    session_id: INJECTED.session_id, project_id: INJECTED.project_id,
  });
  const [dedupAction, setDedupAction] = useState<WriteReceipt['dedup_action']>('keep');
  const [receipt, setReceipt] = useState<WriteReceipt | null>(null);
  const toast = useToast();
  const mirror = useWriteMirror();

  // 查重随内容实时计算（纯函数）
  const result = scoreDedup(draft.content, SEED_EXISTING, 'L3');

  function handleSubmit() {
    const v = validateDraft(draft);
    if (!v.ok) {
      toast.show(v.errors.join('；'));
      return;
    }
    const r = composeReceipt(draft.content, result.is_duplicate ? dedupAction : 'create');
    setReceipt(r);
    mirror.audit(`memory_${r.dedup_action}`);
    toast.show('已写入记忆。');
  }

  return (
    <div className="wrap" data-testid="write-page">
      <h1>✍️ 写入页 <span className="badge p2">REQ-006 · P2</span></h1>
      <div className="sub">写入 + 六维查重（6.1）+ L1–L6 回执（13.6 / 2.2）· 数据本地内存态为真相</div>

      <WriteForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />

      {draft.content.trim().length > 0 && (
        <DedupCard result={result} onAction={setDedupAction} />
      )}

      {receipt && (
        <div className="card receipt" data-testid="receipt">
          <b>写入回执</b>
          <div>memory_id：<span className="mid" data-testid="receipt-id">{receipt.memory_id}</span> · 动作 {receipt.dedup_action}</div>
          <div className="note">L1–L6 逐层（L1 原文仅审计展开，15.3）：</div>
          {(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as LayerName[]).map((ln) => (
            <details className="layer" key={ln} data-testid={`layer-${ln}`}>
              <summary>{ln} · {receipt.layers[ln].summary}</summary>
              {receipt.layers[ln].auditOnly && (
                <div className="audit">⚠ 仅审计可展开原文（15.3）</div>
              )}
            </details>
          ))}
        </div>
      )}

      <div className="note">
        红线：project_id 全局注入禁手填（R2）；L1 原文仅审计展开（15.3）；查重三模式写审计（G6）。
        后端镜像当前为 safe-noop（home server 暂无 write/memory 端点）。
      </div>

      {toast.node}
    </div>
  );
}
