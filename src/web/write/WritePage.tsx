// 写入页（REQ-006 / P2）· 定稿三标签：写入表单 / 最近回执 / 查重与 L0 规则
// 批次58：写入表单 tab 改定稿版式（masthead + 左栏 表单/回执 + 右栏 查重/L0 解锁 + 底部 最近写入）；
// 修复轮3：masthead 上移到 tab 栏上方常驻、写密钥状态并入 masthead 右侧，卡片英文缀标全部取消。
// 最近回执 / 查重与 L0 规则两 tab 保持 p0 版式不动。
// 表单 → Jaccard 查重预判 → 内核 ma.write → L1–L6 回执。
// 回执必须是内核真实返回：被拒时只显示原因与内核 request_id（未签发就写未签发），不做乐观成功。
// ⚠ 禁止注入演示/种子数据：查重候选与最近回执全部读真实账本（空库即无候选 / 无回执）。
import { useEffect, useRef, useState } from 'react';
import { WriteForm } from './WriteForm.tsx';
import { DedupCard } from './DedupCard.tsx';
import { WriteReceiptCard, WriteReceiptTable, WriteRecentWritesCard, WriteRefusalCard } from './WriteReceiptCard.tsx';
import { WriteL0UnlockCard, type L0UnlockStatus } from './WriteL0UnlockCard.tsx';
import { useToast } from './useToast.tsx';
import { useWriteMirror } from './useWriteMirror.ts';
import { composeReceipt, scoreDedup, validateDraft, L1_CHAR_LIMIT } from './logic.ts';
import { coreWrite, coreListExisting, coreWriteStatus, coreWriteReceipts, requestIdOfError } from './coreWrite.ts';
import { kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { L0WriteUnlock } from '../shared/L0WriteUnlock.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { useSessionContext } from '../shared/session.ts';
import { isL0LockedError } from '../../core/memagent/errors.ts';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';
import { newRequestId } from '../kernel.ts';
import { LAYER_SPECS } from '../../core/memagent/layerRules.ts';
import type {
  ExistingMemory, MemoryDraft, WriteReceipt, WriteReceiptHistoryRow, WriteRefusal,
} from './types.ts';

type WriteTab = 'form' | 'receipts' | 'rules';
const TABS: { id: WriteTab; label: string }[] = [
  { id: 'form', label: '写入表单' },
  { id: 'receipts', label: '最近回执' },
  { id: 'rules', label: '查重与 L0 规则' },
];

const RECEIPT_RULES = [
  { k: 'create', label: 'create · 新建', body: 'L1 与账本最相近记忆的词面分低于 L1 阈值（0.70）→ 新建条目并签发 L1–L6。' },
  { k: 'graft', label: 'graft · 分支嫁接', body: '与既有记忆达 L1 阈值 → 内核新建并嫁接到最近分支；回执给新条目的真实 memory_id。' },
  { k: 'keep', label: 'keep · 保留原记忆', body: '内核返回 duplicated 时不新建层，保留原记忆；当前写路径只在重复判定命中该分支时产出。' },
  { k: 'filtered', label: 'filtered · 质量门拦截', body: 'L0→L1 质量门判定无信息量 / 过短 / 无用内容 → 不入库，回执如实写 filtered。' },
];

export function WritePage({ load = coreListExisting }: { load?: () => Promise<ExistingMemory[]> } = {}) {
  useHostTheme();
  const [tab, setTab] = useState<WriteTab>('form');
  // session_id 由页面生成真实唯一值；真实环境可由租户上下文覆盖（R2）
  const [sessionId] = useState(() => newRequestId('sess'));
  const [draft, setDraft] = useState<MemoryDraft>({
    content: '', category: 'fact', tags: [], source: 'conversation',
    session_id: sessionId, project_id: DEFAULT_PROJECT_ID,
  });
  const [receipt, setReceipt] = useState<WriteReceipt | null>(null);
  const [refusal, setRefusal] = useState<WriteRefusal | null>(null);
  // L0 写密钥锁定挡下的提交：原地给解锁入口，解锁后自动重放（不把用户赶去别的页面）
  const [l0Locked, setL0Locked] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [l0Status, setL0Status] = useState<L0UnlockStatus>({ phase: 'loading' });
  const [history, setHistory] = useState<{ phase: 'loading' | 'ready' | 'error'; rows: WriteReceiptHistoryRow[]; error?: string }>({
    phase: 'ready', rows: [],
  });
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

  // 写密钥真实状态（内核 getWriteStatus；pending 条数不展示，定稿明确队列页不存在）
  const loadL0Status = () => {
    coreWriteStatus()
      .then((s) => setL0Status({ phase: 'ready', unlocked: s.l0_unlocked }))
      .catch((e: unknown) => setL0Status({ phase: 'error', error: kernelErrorText(e) }));
  };
  useEffect(loadL0Status, [receipt, refusal]);

  const loadHistory = () => {
    setHistory((h) => ({ ...h, phase: 'loading' }));
    coreWriteReceipts(10)
      .then((rows) => setHistory({ phase: 'ready', rows }))
      .catch((e: unknown) => setHistory({ phase: 'error', rows: [], error: kernelErrorText(e) }));
  };

  // 批次58：最近写入通栏挂载即载；写入成功后也总是刷新（form tab 直接可见）
  useEffect(loadHistory, []);

  // 登录态实时跟随：壳层登录/登出写 localStorage（另一文档）→ 本 iframe 收到 storage 事件
  // → useSessionContext 的 sid 变化 → 查重候选 / 写密钥状态 / 最近写入三个数据源整体重载，
  // 不再要求「登录后刷新页面才生效」。
  const { sid } = useSessionContext();
  const prevSidRef = useRef(sid);
  useEffect(() => {
    if (prevSidRef.current === sid) return;
    prevSidRef.current = sid;
    retryDedup();
    loadL0Status();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  useEffect(() => {
    if (tab === 'receipts') loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 词面预览随内容实时计算（纯函数，候选来自真实账本；未接大模型时内核只查 L1）
  const result = scoreDedup(draft.content, existing);

  function handleSubmit() {
    const v = validateDraft(draft);
    if (!v.ok) {
      toast.show(v.errors.join('；'));
      return;
    }
    void doWrite();
  }

  /** 真正提交一条写入；解锁成功后直接重放（不必让用户再点一次「写入」） */
  function doWrite() {
    return (async () => {
      try {
        const cw = await coreWrite({
          content: draft.content, category: draft.category,
          project_id: draft.project_id, session_id: draft.session_id, source: draft.source,
        });
        const createdAt = new Date().toISOString();
        setL0Locked(false);
        setShowUnlock(false);
        setRefusal(null);
        // 四类回执全部照内核真实返回展示（filtered 也出回执，但明确未入库）
        setReceipt(composeReceipt(draft.content, cw.dedup_action, {
          requestId: cw.request_id,
          memoryId: cw.mem_id,
          createdAt,
          layers: cw.layers,
          refinedBy: cw.refined_by,
        }));
        // 账本已变 → 刷新查重候选（保留旧列表直到新列表返回，避免闪烁）
        void load().then((list) => replace(list)).catch(() => {});
        loadHistory();
        mirror.audit(`memory_${cw.dedup_action}`);
        toast.show(
          // 内核写路径真实产出：create / graft / keep / filtered（keep 仅在 duplicated 时出现）
          cw.dedup_action === 'create'
            ? '已写入记忆。'
            : cw.dedup_action === 'graft'
              ? `与既有记忆相似（sim=${cw.sim.toFixed(2)}），已新建并分支嫁接。`
              : cw.dedup_action === 'keep'
                ? `与既有记忆完全重复（sim=${cw.sim.toFixed(2)}），保留原记忆。`
                : '内容被 L0→L1 质量门拦截（无信息量/过短/无用内容），未写入记忆库。',
        );
      } catch (e) {
        // 拒绝也必须出「拒绝回执」：原因 + 内核请求号，不做乐观成功
        const now = new Date().toISOString();
        const locked = isL0LockedError(e);
        setReceipt(null);
        setRefusal({
          reason: kernelErrorText(e),
          request_id: requestIdOfError(e),
          created_at: now,
          l0_locked: locked,
        });
        setL0Locked(locked);
        if (locked) {
          toast.show('未写入：L0 写密钥未解锁（原文没法封成密文）。解锁写密钥后会自动重放这条写入。');
          return;
        }
        toast.show(`写入失败：${kernelErrorText(e)}`);
      }
    })();
  }

  // 解锁成功：刷新写密钥状态；确实有被挡条目才自动重放（没挡过就不替用户提交）
  const handleUnlocked = () => {
    loadL0Status();
    if (l0Locked) void doWrite();
  };

  const statusText = l0Status.phase === 'loading'
    ? '写密钥：读取中'
    : l0Status.phase === 'error'
      ? `写密钥：状态不可读（${l0Status.error}）`
      : l0Status.unlocked ? '写密钥：已解锁' : '写密钥：未解锁';

  return (
    <div className="p0-page" data-testid="write-page">
      {/* 修复轮3：写入记忆行上移到 tab 栏上方常驻；非 form tab 的「写入记忆 · ma.write」头部行取消，
          写密钥状态与解锁入口并入 masthead 右侧（各 tab 都可见）。 */}
      <div className="wf-masthead">
        <h2 className="wf-mast-title">写入记忆</h2>
        <span className="wf-mast-meta">写入只落 L0 密文 + 脱敏 L1 · 深层交后台补炼</span>
        <span className="wf-mast-right">
          <span className={`p0-tag ${l0Status.unlocked ? 'ok' : l0Status.phase === 'error' ? 'err' : 'warn'}`} data-testid="write-key-status">
            {statusText}
          </span>
          {!l0Status.unlocked && (
            <button type="button" className="p0-btn" data-testid="unlock-btn" onClick={() => setShowUnlock((v) => !v)}>
              解锁写密钥
            </button>
          )}
        </span>
      </div>

      <div className="p0-tabs" role="tablist" aria-label="写入页标签">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`p0-tab${tab === t.id ? ' active' : ''}`}
            data-testid={`write-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'receipts' && history.rows.length > 0 ? <span className="p0-tabnum">{history.rows.length}</span> : null}
          </button>
        ))}
      </div>

      {showUnlock && (
        <L0WriteUnlock scene="写入页" onUnlocked={() => { setShowUnlock(false); void doWrite(); }} />
      )}

      {tab === 'form' && (
        <div className="wf-page">
          <div className="wf-cols">
            <div className="wf-col">
              <WriteForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />

              {receipt && <WriteReceiptCard receipt={receipt} />}
              {refusal && <WriteRefusalCard refusal={refusal} source={draft.source} />}
              {!receipt && !refusal && (
                <div className="wf-card" data-testid="receipt-placeholder">
                  <div className="wf-hd">
                    <span className="wf-zh">写入回执</span>
                    <span className="wf-meta">等待真实提交</span>
                  </div>
                  <div className="wf-bd">
                    <div className="wf-empty dashed">
                      <b>等待真实提交</b>
                      <div>提交后这里展示内核返回的 request_id / memory_id 与四类结果；被拒则展示拒绝原因，不会先显示成功。</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="wf-col wf-side">
              {/* 查重卡常驻；候选读取失败时仍在 DEDUP 卡框架内如实报错（不冒充「无候选」，不画预览分） */}
              {phase === 'error' ? (
                <div className="wf-card wf-dedup" data-testid="dedup-card-error">
                  <div className="wf-hd">
                    <span className="wf-zh">查重预览</span>
                    <span className="wf-meta">候选读取失败</span>
                  </div>
                  <div className="wf-bd">
                    <div className="wf-status bad" data-testid="kernel-error">
                      <b data-testid="kernel-error-title">读取查重候选失败：内核数据没读到</b>
                      <div data-testid="kernel-error-reason">原因：{dedupError ?? '未知错误'}</div>
                      <div className="wf-note">
                        这不是「账本为空」——真的没有候选时会明确写「空」。请确认桌面端正在运行
                        （或主进程未繁忙/库未被锁），然后重试。
                      </div>
                      <button type="button" className="btn" data-testid="kernel-retry" onClick={retryDedup}>重试</button>
                    </div>
                  </div>
                </div>
              ) : (
                <DedupCard result={result} hasContent={draft.content.trim().length > 0} />
              )}
              <WriteL0UnlockCard status={l0Status} triggered={l0Locked} onUnlocked={handleUnlocked} />
            </div>
          </div>

          <WriteRecentWritesCard
            // 修复轮4 口径：最近写入只统计真实落库行（create/graft/keep）；
            // 质量门拦截（filter_code 在）不是写入——mem_id 未写入、层未产生，不计入
            rows={history.rows.filter((r) => r.filter_code === null).slice(0, 3)}
            phase={history.phase}
            error={history.error}
          />
        </div>
      )}

      {tab === 'receipts' && (
        <WriteReceiptTable
          rows={history.rows}
          phase={history.phase}
          error={history.error}
          onRetry={loadHistory}
        />
      )}

      {tab === 'rules' && (
        <div className="wf-grid3">
          <div className="wf-card">
            <div className="wf-hd"><span className="wf-zh">四类回执</span><span className="wf-meta">结果由内核写路径自动裁决</span></div>
            <div className="wf-bd">
              {RECEIPT_RULES.map((r) => (
                <div className="wf-kv" key={r.k}>
                  <span className="wf-k mono">{r.label}</span>
                  <span className="wf-v">{r.body}</span>
                </div>
              ))}
            </div>
            <div className="wf-note">不提供用户可选的「合并/覆盖/保留」按钮：结果由内核写路径自动裁决。</div>
          </div>

          <div className="wf-card">
            <div className="wf-hd"><span className="wf-zh">L1–L6 上限（内核 LAYER_SPECS）</span></div>
            <table className="wf-rt">
              <thead><tr><th>层</th><th>名称</th><th>上限</th><th>下限</th></tr></thead>
              <tbody>
                {LAYER_SPECS.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.id}</td>
                    <td>{s.name}</td>
                    <td className="num">{s.maxChars === null ? '不限' : `${s.maxChars} 字`}</td>
                    <td className="num">{s.minChars === null ? '未取数' : `${s.minChars} 字`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="wf-note">正文计数按定稿 300 字提示；内核 L1 当前不限长，L2 摘要按 300 字生成。</div>
          </div>

          <div className="wf-card">
            <div className="wf-hd"><span className="wf-zh">失败与诚实态</span></div>
            <ul className="wf-bullets">
              <li>写密钥未解锁：原文无法封成密文 → 内核拒绝，界面显示拒绝原因与 request_id（未签发则如实写「未签发」），并把本条放入 pendingWrites 待重放。</li>
              <li>L0→L1 质量门拦截：不伪造 success，回执明确 filtered 且 memory_id 为空。</li>
              <li>内核不可达：查重候选读取失败如实报错，不冒充「无候选」，不画预览分。</li>
              <li>回执只读：不可编辑、不提供重放按钮；最近回执取账本 action=write 审计行。</li>
            </ul>
            <div className="wf-note">正文上限提示 = {L1_CHAR_LIMIT} 字；超出不拦截，以内核真实写入为准。</div>
          </div>
        </div>
      )}

      {toast.node}
    </div>
  );
}
