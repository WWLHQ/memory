// 冲突裁决页 T5：完整编排 + mirror · 真实数据接真版
// 队列 = 真实账本冲突（记忆表 conflict_id 标记 + conflict_resolve 审计「转人工」事件，
// 桌面 Electron 下 = 主进程 FileStorage 持久库；浏览器降级内存态，无冲突诚实空态）。
// 裁决走 ma._memoryOp / ma.write（真实写账本 + 审计：auto_override/merge 落定出队，
// user_confirm/hold 写审计保持 pending）。
// 与记忆库管理页一致：禁止注入演示/种子冲突 —— 队列只反映真实账本 pending 冲突；
// 无真实冲突 → 诚实空态并引导去写入页产生真实记忆。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示内核原因 + 重试，绝不渲染成「无待裁决冲突」。
// 批次53-R：版式按用户截图 1:1 重做为密集表格流（窄行高、小字号、chip 体系、四等宽裁决按钮），
// 数据逻辑与全部 testid 零改动。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { queueSort, auditPair, initialConflictId, overdueDays } from './logic.ts';
import { publishSelection } from '../shared/selectionChannel.ts';
import { useDisputeMirror } from './useDisputeMirror.ts';
import { coreConflictHistory, coreConflicts, coreVerdict, type ConflictHistoryRow } from './coreDispute.ts';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { DisputeQueue } from './DisputeQueue.tsx';
import { DisputeVerdict, VERDICTS } from './DisputeVerdict.tsx';
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

const verdictLabel = (v: Verdict): string => VERDICTS.find((x) => x.key === v)?.label ?? v;

export function DisputePage({ load = coreConflicts, loadHistory = coreConflictHistory }: {
  load?: () => Promise<ConflictRecord[]>;
  loadHistory?: () => Promise<ConflictHistoryRow[]>;
} = {}) {
  // 批次53：跟随壳层主题（浅/深），与监控/首页同口径；主题令牌内嵌 .dsp-page
  useHostTheme();
  // D4：壳层深链 ?id= 预设选中；队列里没有该 id 时由下方 effect 回落第一条
  const [selectedId, setSelectedId] = useState<string | null>(() => initialConflictId(location.search));
  const [auditLog, setAuditLog] = useState<AuditEvt[]>([]);
  /** 账本真实裁决历史（conflict_resolve 成对审计）；与审计失败分开存，失败如实显示 */
  const [history, setHistory] = useState<ConflictHistoryRow[]>([]);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  /** 超期筛选：参考稿筛选行的真实可操作项（类型因内核未采样不可筛选） */
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { node: toast, show } = useToast();
  const mirror = useDisputeMirror();

  const reloadHistory = useCallback(async () => {
    try {
      setHistory(await loadHistory());
      setHistoryErr(null);
    } catch (e) {
      setHistoryErr(kernelErrorText(e));
    }
  }, [loadHistory]);

  // 挂载：从真实账本读 pending 冲突队列（无种子兜底；读不到 = 错误态，不冒充无冲突）
  const ledger = useKernelLoad<ConflictRecord[]>('dispute', load);
  const { phase, data, error: loadError, retry } = ledger;
  const conflicts = data ?? NO_CONFLICTS;

  const now = Date.now();
  const filteredAll = queueSort(conflicts, now);
  const overdueCount = filteredAll.filter((r) => r.overdue_days > 7).length;
  const filtered = overdueOnly ? filteredAll.filter((r) => r.overdue_days > 7) : filteredAll;
  const selected = conflicts.find((r) => r.id === selectedId) ?? null;

  // 历史：账本真实审计为主；本页刚裁决但账本尚未回读到的即时事件按 request_id 去重后置顶
  const historyRows = useMemo(() => {
    const live = auditLog.filter((e) => !e.request_id || !history.some((h) => h.request_id === e.request_id));
    return [
      ...live.map((e) => ({ request_id: e.request_id, verdict: e.verdict, note: `${e.note}（本页即时）` })),
      ...history.map((h) => ({
        request_id: h.request_id,
        verdict: h.verdict,
        note: `${h.note} · ${h.old_id} → ${h.new_id}`,
      })),
    ];
  }, [auditLog, history]);

  // 队列读到之后拉一次真实历史（失败不阻断页面，只在历史面板内如实提示）
  useEffect(() => {
    if (phase !== 'ok') return;
    void reloadHistory();
  }, [phase, reloadHistory]);

  // S4：把真实待裁决冲突回传给壳层属性检查器（无选中回传 null）
  useEffect(() => {
    if (!selected) {
      publishSelection(null);
      return;
    }
    const days = overdueDays(selected.created_at, Date.now());
    publishSelection({
      v: 1,
      page: 'dispute.html',
      title: `冲突 ${selected.id}`,
      subtitle: '真实账本 pending 冲突 · 内核检测结果原样回传',
      fields: [
        { k: 'ID', v: selected.id, mono: true },
        { k: '旧记忆', v: selected.old_id, mono: true },
        { k: '新记忆', v: selected.new_id, mono: true },
        { k: '旧置信度', v: String(selected.old_confidence) },
        { k: '新置信度', v: String(selected.new_confidence) },
        { k: '待裁决标记', v: selected.dispute_flag ? 'dispute_flag=true' : 'dispute_flag=false' },
        { k: '创建时间', v: selected.created_at },
        { k: '超期天数', v: `${days} 天（>7 天高亮）` },
      ],
    });
  }, [selected]);

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
      // 历史同步回读账本（内核写的是成对审计，页面不自行编造历史行）
      void reloadHistory();
    } catch (e) {
      show(`裁决失败：${kernelErrorText(e)}`);
    }
  };

  // 批次53-R：页头单行（标题 + 规格注 + 右侧计数徽标）+ 密集表格流；testid 全保留。
  // 批次54：页头下补第二行小灰 chip（对齐截图）；空态改「表头骨架 + 诚实空行」。
  // 批次63：按设计稿 pg-dispute 校准——sub 补「§」前缀、计数徽标回 warn 色。
  const head = (
    <div className="af-head" data-testid="dispute-head">
      <h1>冲突裁决</h1>
      <span className="sub">§9.7 裁决队列 · write/sync 冲突 · 超期 7 天升级告警</span>
      {phase === 'ok' && <span className="af-badge warn" data-testid="dispute-count">待裁决 {filtered.length}</span>}
    </div>
  );
  const policyRow = (
    <div className="af-chiprow" aria-hidden="true">
      <span className="af-badge">9.7 裁决队列</span>
      <span className="af-badge">不自动覆盖 · 保存原文</span>
    </div>
  );
  // 参考稿筛选行：①待裁决队列 / ②超期 >7 天 是真筛选；③类型筛选因内核未采样如实禁用
  const filterRow = (
    <div className="af-chiprow" data-testid="dispute-filter">
      <button
        type="button" className="af-badge" data-testid="dispute-filter-all"
        aria-pressed={!overdueOnly} onClick={() => setOverdueOnly(false)}
      >
        待裁决队列（{filteredAll.length}）
      </button>
      <button
        type="button" className="af-badge" data-testid="dispute-filter-overdue"
        aria-pressed={overdueOnly} onClick={() => setOverdueOnly(true)}
      >
        超期 &gt;7 天（{overdueCount}）
      </button>
      <button
        type="button" className="af-badge" data-testid="dispute-filter-type" disabled
        title="内核无 detect_conflicts 检测引擎：冲突类型未采样（null），无法按 write / sync 筛选"
      >
        类型：write / sync（不可用）
      </button>
      <span className="af-badge">不自动覆盖 · 保存原文</span>
    </div>
  );
  const historyPanel = (historyRows.length > 0 || historyErr) && (
    <section className="af-panel" data-testid="dispute-history">
      <div className="af-ph">
        <h3>裁决历史</h3>
        <span className="hint">conflict_resolve 成对审计 · 含 pending / resolved · 全部来自账本</span>
      </div>
      <div className="af-pb af-flush">
        {historyErr ? (
          <div className="af-note" data-testid="dispute-history-error">
            读取裁决历史失败：{historyErr}（队列不受影响）
          </div>
        ) : (
          <ul className="audit-list" data-testid="audit-log">
            <li className="q-head" aria-hidden="true">
              <span>request_id</span>
              <span>动作</span>
              <span>note</span>
            </li>
            {historyRows.map((e, i) => (
              <li className="a-row" key={`${e.request_id || 'live'}-${i}`} data-testid={`audit-row-${i}`}>
                <span className="mid">{e.request_id || '账本无 request_id'}</span>
                <span><i className={`chip ${e.verdict}`}>{verdictLabel(e.verdict)}</i></span>
                <span className="note-cell">{e.note}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
  const shell = (inner: ReactNode) => (
    <div className="dsp-page" data-testid="dispute-page">
      <div className="dsp-scroll"><div className="dsp-main"><div className="af-stack">
        {head}{conflicts.length > 0 ? filterRow : policyRow}{inner}
      </div></div></div>
    </div>
  );

  if (phase === 'loading') {
    return shell(
      <>
        <div className="af-panel"><div className="af-pb"><div className="af-note">加载真实账本中…</div></div></div>
        {toast}
      </>,
    );
  }

  if (phase === 'error') {
    return shell(
      <>
        <KernelLoadError what="读取待裁决冲突队列" error={loadError} onRetry={retry} />
        {toast}
      </>,
    );
  }

  if (conflicts.length === 0) {
    // 批次54：空态不再是居中说明卡，而是与截图同构的「队列面板 + 表头骨架 + 诚实空行」；
    // 不渲染 data-testid="queue"（空态测试断言它不存在），表头骨架仅 aria 装饰。
    return shell(
      <>
        <div className="af-panel" data-testid="dispute-empty">
          <div className="af-ph">
            <h3>冲突队列（0）</h3>
            <span className="hint">仅 dispute_flag=true · 超期 &gt;7d 告警 · 类型未采样 = 内核无检测引擎</span>
          </div>
          <div className="af-pb af-flush">
            <ul className="queue">
              <li className="q-head" aria-hidden="true">
                <span>conflict_id</span>
                <span>类型</span>
                <span>mem_id</span>
                <span className="num">old 置信度</span>
                <span className="num">new 置信度</span>
                <span>等待</span>
                <span>操作</span>
              </li>
              <li className="empty-row">
                <b>当前账本无待裁决冲突。</b>
                队列只反映真实账本中 pending 的冲突（记忆表 conflict_id 标记 + conflict_resolve
                「转人工」审计）。请先在「写入页」产生记忆，当不同端对同一记忆产生并发版本时，
                内核会真实产出冲突进入本队列。空账本不伪造数据。
              </li>
            </ul>
          </div>
        </div>
        {historyPanel}
      </>,
    );
  }

  return shell(
    <>
      <section className="af-panel">
        <div className="af-ph">
          <h3>冲突队列（{filtered.length}）</h3>
          <span className="hint">仅 dispute_flag=true · 超期 &gt;7d 告警 · 类型未采样 = 内核无检测引擎</span>
        </div>
        <div className="af-pb af-flush">
          {filtered.length === 0 ? (
            <div className="queue empty" data-testid="queue-filter-empty">
              当前筛选（超期 &gt;7 天）没有匹配的待裁决冲突；账本共 {filteredAll.length} 条，切回「待裁决队列」可见。
            </div>
          ) : (
            <DisputeQueue list={filtered} now={now} onSelect={setSelectedId} selectedId={selectedId ?? undefined} />
          )}
        </div>
      </section>
      {selected && (
        <section className="af-panel">
          <div className="af-ph">
            {/* 批次63：对齐设计稿——标题「双栏对比 · <conflict_id>」，hint「<mem_id> → <mem_id> 候选」
                （内核冲突记录无版本号字段，不编造 v3→v4；用真实记忆 id 对）。 */}
            <h3 className="mono-title">双栏对比 · {selected.id}</h3>
            <span className="hint">{selected.old_id} → {selected.new_id} 候选</span>
          </div>
          <div className="af-pb">
            <div className="compare">
              <div className="side old" data-testid="panel-old">
                <div className="side-hd"><span className="tag">旧值</span><span className="meta">{selected.old_id} · conf {selected.old_confidence}</span></div>
                <div className="side-bd"><del>{selected.old_content}</del></div>
              </div>
              <div className="side new" data-testid="panel-new">
                <div className="side-hd"><span className="tag">新值</span><span className="meta">{selected.new_id} · conf {selected.new_confidence}</span></div>
                <div className="side-bd"><ins>{selected.new_content}</ins></div>
              </div>
            </div>
            {/* 参考稿「裁决方式切换」：人工可用；AI 裁决内核未接，如实禁用并写原因 */}
            <div className="verdict-mode" data-testid="dispute-verdict-mode">
              <span className="vm-label">裁决方式</span>
              <button type="button" className="af-badge" data-testid="dispute-mode-human" aria-pressed="true">人工裁决</button>
              <button
                type="button" className="af-badge" data-testid="dispute-mode-ai" disabled
                title="内核未提供 AI 裁决通道（无建议生成 / 无自动落定），当前只能用下方四项人工裁决"
              >
                AI 裁决（不可用）
              </button>
              <span className="vm-hint">AI 裁决需内核提供建议通道，当前未接入；下方四项动作即人工裁决</span>
            </div>
            <DisputeVerdict
              record={selected}
              onVerdict={handleVerdict}
            />
          </div>
        </section>
      )}
      {historyPanel}
      {toast}
    </>,
  );
}
