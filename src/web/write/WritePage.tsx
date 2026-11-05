// 写入页（REQ-006 / P2）· 完整编排（T5）
// 表单(T3) + 查重卡(T4) + 写入回执（memory_id + L1–L6 折叠，L1 仅审计展开）+ toast + 后端 mirror。
// T7 接真内核：提交走 memagent-core ma.write（查重 new/merged/duplicated 真实判定）。
// ⚠ 禁止注入演示/种子数据：查重候选来自真实账本（空库即无候选）；写入只产生真实记忆。
import { useState, useEffect } from 'react';
import { WriteForm } from './WriteForm.tsx';
import { DedupCard } from './DedupCard.tsx';
import { useToast } from './useToast.tsx';
import { useWriteMirror } from './useWriteMirror.ts';
import { composeReceipt, scoreDedup, validateDraft } from './logic.ts';
import { coreWrite, coreListExisting } from './coreWrite.ts';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { L0WriteUnlock } from '../shared/L0WriteUnlock.tsx';
import { isL0LockedError } from '../../core/memagent/errors.ts';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';
import { newRequestId } from '../kernel.ts';
import type { ExistingMemory, LayerName, MemoryDraft, WriteReceipt } from './types.ts';

// 项目 ID 从账本真实派生（listProjectIds）；账本为空时回落 DEFAULT_PROJECT_ID 占位（A10，非空账本务必用真实项目）

export function WritePage({ load = coreListExisting }: { load?: () => Promise<ExistingMemory[]> } = {}) {
  // session_id 由页面生成真实唯一值（不再用演示值 's1'）；真实环境可由租户上下文覆盖（R2）
  const [sessionId] = useState(() => newRequestId('sess'));
  const [draft, setDraft] = useState<MemoryDraft>({
    content: '', category: 'fact', tags: [], source: 'conversation',
    session_id: sessionId, project_id: DEFAULT_PROJECT_ID,
  });
  const [receipt, setReceipt] = useState<WriteReceipt | null>(null);
  // 批次41-W：本次提交是不是「L0 写密钥锁着」挡下的——是就在原地给解锁入口，不要把用户赶去别的页面
  const [l0Locked, setL0Locked] = useState(false);
  const toast = useToast();
  const mirror = useWriteMirror();

  // 查重候选 = 真实账本既有记忆（无种子兜底）；内核读不到时如实报错，绝不冒充「无候选」
  const dedupLedger = useKernelLoad<ExistingMemory[]>('write-dedup', load);
  const { phase, data: existingData, error: dedupError, retry: retryDedup, replace } = dedupLedger;
  const existing = existingData ?? [];

  // 批次27 P2-7：账本已有真实项目时，默认写入跟随账本（不再钉死占位项目）
  useEffect(() => {
    void listProjectIds().then((projects) => {
      if (projects.length > 0) {
        setDraft((d) => (projects.includes(d.project_id) ? d : { ...d, project_id: projects[0]! }));
      }
    });
  }, [existingData]);

  // 词面预览随内容实时计算（纯函数，候选来自真实账本；对照层 L1 = 未接大模型时内核唯一查重层）
  const result = scoreDedup(draft.content, existing);

  function handleSubmit() {
    const v = validateDraft(draft);
    if (!v.ok) {
      toast.show(v.errors.join('；'));
      return;
    }
    void doWrite();
  }

  /** 真正提交一条写入；解锁成功后可以直接重放（批次41-W），不必让用户再点一次「写入」 */
  function doWrite() {
    return (async () => {
      try {
        const cw = await coreWrite({
          content: draft.content, category: draft.category,
          project_id: draft.project_id, session_id: draft.session_id, source: draft.source,
        });
        setL0Locked(false);
        if (cw.dedup_action === 'filtered') {
          setReceipt(null);
        } else {
          setReceipt(composeReceipt(draft.content, cw.dedup_action, {
            memoryId: cw.mem_id,
            layers: cw.layers,
            refinedBy: cw.refined_by,
          }));
        }
        // 账本已变 → 刷新查重候选（保留旧列表直到新列表返回，避免闪烁）
        void load().then((list) => replace(list)).catch(() => {});
        mirror.audit(`memory_${cw.dedup_action}`);
        toast.show(
          // 阶段5-E / B10：内核只有 create / graft / keep / filtered 四种结果，
          // 删掉永不命中的 merge 分支（旧「用户三模式」残留），filtered 落到质量门拦截说明。
          cw.dedup_action === 'create'
            ? '已写入记忆。'
            : cw.dedup_action === 'graft'
              ? `与既有记忆相似（sim=${cw.sim.toFixed(2)}），已新建并分支嫁接。`
              : cw.dedup_action === 'keep'
                ? `与既有记忆完全重复（sim=${cw.sim.toFixed(2)}），保留原记忆。`
                : '内容被 L0→L1 质量门拦截（无信息量/过短/无用内容），未写入记忆库。',
        );
      } catch (e) {
        if (isL0LockedError(e)) {
          // 批次41-W：这类失败不是内容问题，是写密钥锁着——给就地解锁入口，而不是只甩一句错误码
          setL0Locked(true);
          toast.show('未写入：L0 写密钥未解锁（原文没法封成密文）。解锁写密钥后会自动重放这条写入。');
          return;
        }
        toast.show(`写入失败：${kernelErrorText(e)}`);
      }
    })();
  }

  return (
    <div className="wrap" data-testid="write-page">
      <h1>✍️ 写入页 <span className="badge p2">REQ-006 · P2</span></h1>
      <div className="sub">写入 + 本地词面查重预览（判重在内核）+ L1–L6 回执（13.6 / 2.2）· 数据本地内存态为真相</div>

      <WriteForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />

      {draft.content.trim().length > 0 && phase === 'error' && (
        <KernelLoadError what="读取查重候选（真实账本）" error={dedupError} onRetry={retryDedup} />
      )}
      {draft.content.trim().length > 0 && phase !== 'error' && <DedupCard result={result} />}

      {l0Locked && <L0WriteUnlock scene="这条手动写入" onUnlocked={doWrite} />}

      {receipt && (
        <div className="card receipt" data-testid="receipt">
          <b>写入回执</b>
          <div>
            memory_id：<span className="mid" data-testid="receipt-id">{receipt.memory_id}</span> · 动作 {receipt.dedup_action}
            {' '}· 精炼 {receipt.refined_by === 'stub' ? '未精炼（未接入 LLM）' : 'LLM'}
          </div>
          <div className="note">L1–L6 逐层（只展示真实产出；L1 原文仅审计展开，15.3）：</div>
          {(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as LayerName[]).map((ln) => (
            <details className="layer" key={ln} data-testid={`layer-${ln}`}>
              <summary>{ln} · {receipt.layers[ln].summary}</summary>
              {receipt.layers[ln].auditOnly && (
                <div className="audit">⚠ 仅审计可展开原文（15.3）</div>
              )}
              {receipt.layers[ln].text && (
                <div className="layer-body" data-testid={`layer-body-${ln}`}>{receipt.layers[ln].text}</div>
              )}
            </details>
          ))}
        </div>
      )}

      <div className="note">
        红线：project_id 全局注入禁手填（R2）；L1 原文仅审计展开（15.3）；查重判定与动作由内核写路径执行并写审计（G6）。
        审计上抛真接 home server 的 POST /api/mirror/audit（?backend= 可指定后端）；后端不可达时失败会显示提示，本地数据不受影响。
      </div>

      {toast.node}
    </div>
  );
}
