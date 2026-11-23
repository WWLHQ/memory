// 写入页（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write，批次47 重建）：
// af-head（写入记忆 + sub）→ af-cols(1fr 320px)：左=写入表单面板 + L0 锁定 warn alert + 就地解锁卡（warn 边框）
// + 回执面板；右=查重预览面板；底部=最近写入通栏表。设计稿无 tab、无页头右侧按钮区，v5/p0 版式清零。
// 数据全部真实：表单 → Jaccard 查重预判 → 内核 ma.write → 四类回执（create/graft/keep/filtered）。
// 回执必须是内核真实返回：被拒时只显示原因与内核 request_id（未签发就写未签发），不做乐观成功。
// ⚠ 禁止注入演示/种子数据：查重候选与最近写入全部读真实账本（空库即无候选 / 空表）。
import { useEffect, useRef, useState } from 'react';
import { WriteForm } from './WriteForm.tsx';
import { DedupCard } from './DedupCard.tsx';
import { WriteReceiptCard, WriteRecentWritesCard, WriteRefusalCard } from './WriteReceiptCard.tsx';
import { WriteL0UnlockCard, type L0UnlockStatus } from './WriteL0UnlockCard.tsx';
import { useToast } from './useToast.tsx';
import { useWriteMirror } from './useWriteMirror.ts';
import { composeReceipt, scoreDedup, validateDraft } from './logic.ts';
import { coreWrite, coreListExisting, coreWriteStatus, coreWriteReceipts, requestIdOfError } from './coreWrite.ts';
import { kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { useSessionContext } from '../shared/session.ts';
import { onL0WriteLockChanged } from '../shared/l0WriteLockSignal.ts';
import { isL0LockedError } from '../../core/memagent/errors.ts';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';
import { newRequestId } from '../kernel.ts';
import { QUALITY_GATE_VERSION } from '../../core/memagent/qualityGate.ts';
import type {
  ExistingMemory, MemoryDraft, WriteReceipt, WriteReceiptHistoryRow, WriteRefusal,
} from './types.ts';

export function WritePage({ load = coreListExisting }: { load?: () => Promise<ExistingMemory[]> } = {}) {
  useHostTheme();
  // session_id 由页面生成真实唯一值；真实环境可由租户上下文覆盖（R2）
  const [sessionId] = useState(() => newRequestId('sess'));
  const [draft, setDraft] = useState<MemoryDraft>({
    content: '', category: 'fact', tags: [], source: 'conversation',
    session_id: sessionId, project_id: DEFAULT_PROJECT_ID,
  });
  const [receipt, setReceipt] = useState<WriteReceipt | null>(null);
  const [refusal, setRefusal] = useState<WriteRefusal | null>(null);
  // L0 写密钥锁定挡下的提交：就地给解锁入口（warn alert + 解锁卡），解锁后自动重放（不把用户赶去别的页面）
  const [l0Locked, setL0Locked] = useState(false);
  // 解锁成功即时收起解锁卡（不等异步状态刷新，设计稿：已解锁不渲染解锁卡）
  const [unlockedLocal, setUnlockedLocal] = useState(false);
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

  // 最近写入通栏挂载即载；写入成功后也总是刷新（设计稿单页无 tab，通栏直接可见）
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

  // 写密钥在**别的页面/卡片**里被解锁或锁定（安全页「本账号写密钥」卡、壳层状态栏）时，
  // 主进程 IPC 改了锁状态但不写 localStorage → 本页解锁卡会停在旧值。
  // 信号只提示「该重读了」，真值仍由 coreWriteStatus() 从内核重取。
  useEffect(() => onL0WriteLockChanged(() => loadL0Status()), []);

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
          // 内核写路径真实产出：create / graft / keep / filtered（keep 仅在重复判定命中该分支时出现）
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

  // 解锁成功：即时收起解锁卡 + 刷新写密钥状态；确实有被挡条目才自动重放（没挡过就不替用户提交）
  const handleUnlocked = () => {
    setUnlockedLocal(true);
    loadL0Status();
    if (l0Locked) void doWrite();
  };

  const showUnlockCard = !unlockedLocal
    && (l0Status.phase === 'error' || (l0Status.phase === 'ready' && !l0Status.unlocked));

  return (
    <div className="wr-page" data-testid="write-page">
      <div className="wr-scroll">
        <div className="wr-main af-stack">
          {/* 页头：设计稿 pg-write 无右侧按钮区，写密钥状态由锁定 alert / 解锁卡如实承载 */}
          <div className="af-head" data-testid="write-head">
            <h1>写入记忆</h1>
            <span className="sub">只落 L0 密文 + 脱敏 L1 · 深层交后台补炼 · L0→L1 质量门 v{QUALITY_GATE_VERSION} 无旁路</span>
          </div>

          {l0Status.phase === 'error' && (
            <div className="af-alert bad" data-testid="l0-status-error">
              <span className="tag">L0</span>
              写密钥状态不可读（{l0Status.error}）—— 不猜已解锁，解锁入口不可用。
            </div>
          )}

          {/* E_L0_LOCKED warn alert：只有真被挡过一条写入才出现（设计稿口径），解锁后自动重放 */}
          {l0Locked && (
            <div className="af-alert warn" data-testid="l0-unlock-alert">
              <span className="tag">L0</span>
              写密钥未解锁，本次写入被挡（E_L0_LOCKED）——解锁后自动重放这条，不必再点写入。
            </div>
          )}

          <div className="af-cols wr-cols">
            <div className="af-stack">
              <WriteForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />

              {/* 就地解锁卡：写密钥锁定或状态不可读时出现（已解锁按设计稿不渲染） */}
              {showUnlockCard && (
                <WriteL0UnlockCard status={l0Status} triggered={l0Locked} onUnlocked={handleUnlocked} />
              )}

              {receipt && <WriteReceiptCard receipt={receipt} />}
              {refusal && <WriteRefusalCard refusal={refusal} source={draft.source} />}
              {!receipt && !refusal && (
                <section className="af-panel" data-testid="receipt-placeholder">
                  <div className="af-ph">
                    <h3>回执 · 待生成</h3>
                    <span className="hint">本次写入未入库，不出成功回执</span>
                  </div>
                  <div className="af-pb">
                    <div className="af-empty">
                      等待真实提交 · 提交后这里出示内核返回的 request_id / memory_id 与四类结果（create / graft / keep / filtered）；
                      被拒则展示拒绝原因，不会先显示成功。
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div className="af-stack">
              {/* 查重卡常驻右栏；候选读取失败时如实报错（不冒充「无候选」，不画预览分） */}
              {phase === 'error' ? (
                <section className="af-panel" data-testid="dedup-card-error">
                  <div className="af-ph">
                    <h3>查重预览</h3>
                    <span className="hint">候选读取失败</span>
                  </div>
                  <div className="af-pb">
                    <div data-testid="kernel-error">
                      <b data-testid="kernel-error-title">读取查重候选失败：内核数据没读到</b>
                      <div data-testid="kernel-error-reason">原因：{dedupError ?? '未知错误'}</div>
                      <p className="af-note">
                        这不是「账本为空」——真的没有候选时会明确写「空」。请确认桌面端正在运行
                        （或主进程未繁忙/库未被锁），然后重试。
                      </p>
                      <button type="button" className="af-btn sm" data-testid="kernel-retry" onClick={retryDedup}>重试</button>
                    </div>
                  </div>
                </section>
              ) : (
                <DedupCard result={result} hasContent={draft.content.trim().length > 0} />
              )}
            </div>
          </div>

          <WriteRecentWritesCard
            // 修复轮4 口径：最近写入只统计真实落库行（create/graft/keep）；
            // 质量门拦截（filter_code 在）不是写入——mem_id 未写入、层未产生，不计入
            rows={history.rows.filter((r) => r.filter_code === null)}
            phase={history.phase}
            error={history.error}
          />
        </div>
      </div>
      {toast.node}
    </div>
  );
}
