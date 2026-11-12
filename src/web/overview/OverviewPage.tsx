// 首页总览工作台（批次57-C · 版式对齐定稿图 stratum-l1l3-preview pg-home）：
// 头部 → L0 提示 → 效果四卡 → 双栏（左：图谱/异常/最近审计；右：TOKEN 节省率/补炼/MCP/引擎/今日概览）→ 页脚端口行。
// 所有读数来自 loadOverview 单次真实取数：内核账本 / 审计 / 主进程 IPC（refine:state · mcp:clients · llm:config · dataRoot:get）/ /api/health。
// 读不到就显示「读不到 / 未取数 / —」并给原因，绝不用演示数或 0 冒充成功读数。
// 问账本问答框已独立为整页（assistant.html · src/web/assistant/AssistantPage.tsx），本页不再渲染底部输入框。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadOverview,
  type OverviewSnapshot,
  type OverviewRefinePanel,
  type OverviewMcpPanel,
  type OverviewEnginePanel,
  type OverviewTokenPanel,
  type OverviewTodayPanel,
} from '../shell/overview.ts';
import { HOME_BASE, ONBOARD_BASE } from '../backend.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { requestShellView } from '../shared/shellNavigate.ts';
import { rebuildKernelForDataPlane } from '../kernel.ts';
import { Icon } from '../shell/Icons.tsx';
import { refineStopRows } from '../params/refineQueue.ts';
import type { Gain } from '../../types/agentOnboard.ts';
import type { LayerGraph } from '../Home/layerGraph.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import './overviewPage.css';

type RawAnomaly = NonNullable<RawHomeFeed['anomalies']>[number];

const LAYER_COLOR: Record<string, string> = {
  L0: 'var(--c-l0)', L1: 'var(--c-l1)', L2: 'var(--c-l2)', L3: 'var(--c-l3)',
  L4: 'var(--c-l4)', L5: 'var(--c-l5)', L6: 'var(--c-l6)',
};
const LAYER_SHORT: Record<string, string> = {
  L0: '原文', L1: '脱敏', L2: '摘要', L3: '得失', L4: '模式', L5: '洞察', L6: '索引',
};
/** 六层枢纽在图谱里的固定坐标（viewBox 760×352，账本核居中 380,176） */
const HUB_POS: Record<string, { x: number; y: number }> = {
  L1: { x: 126, y: 110 }, L2: { x: 380, y: 48 }, L3: { x: 634, y: 110 },
  L4: { x: 634, y: 242 }, L5: { x: 380, y: 304 }, L6: { x: 126, y: 242 },
};

type Focus = 'all' | 'L2' | 'L3' | 'L4+';

/** 页脚端口标签：home/onboard 从 backend.ts 单一真源派生（A4 门禁禁硬编码字面量） */
const HOME_PORT = `:${new URL(HOME_BASE).port}`;
const ONBOARD_PORT = `:${new URL(ONBOARD_BASE).port}`;

function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** UTC+08:00 本地时钟（用户可见时间统一东八区；审计 ts 是 epoch） */
function fmtLocal(ts: number): string {
  const d = new Date(ts + 8 * 3600_000);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export interface HomeDerived {
  dateText: string;
  dataRootText: string;
  sessionText: string;
  healthOk: boolean;
  gains: Gain[];
  graph: LayerGraph;
  anomalies: RawAnomaly[];
  /** 真实 L0 写入锁定类阻断（仅当账本异常里确有该条才显示，绝不编造） */
  l0Alert: string | null;
  /** 首页常驻提示：只要真实读到「写密钥未解锁」就为 true（不依赖是否有写入被拒） */
  l0WriteLocked: boolean;
  /** 写锁状态读不到（浏览器模式/IPC 失败）：不猜已解锁，也不误报未解锁 */
  l0WriteUnknown: boolean;
  /** 写锁已确认解锁（内核真值）：历史被挡类提示不再挂在首页（解锁后不该继续催解锁） */
  l0WriteResolved: boolean;
  l0WriteDetail: string | null;
}

/** 纯派生：把真实快照翻译成版式所需的字符串/列表（可单测、可做变异验证） */
export function deriveHomeView(s: OverviewSnapshot): HomeDerived {
  const anomalies = s.raw.anomalies ?? [];
  const l0 = anomalies.find((a) => a.level === 'error' && /L0|写密钥|锁定/.test(`${a.title} ${a.detail}`));
  return {
    dateText: fmtLocal(s.loadedAt),
    dataRootText: s.dataRoot.available
      ? (s.dataRoot.root ?? s.dataRoot.error ?? '数据根未返回')
      : (s.dataRoot.error ?? '非桌面壳：无数据根'),
    sessionText: s.session ? '已登录' : '未登录 · 只读',
    healthOk: s.health.status === 'ok',
    gains: s.effectGains,
    graph: s.graph,
    anomalies,
    l0Alert: l0 ? l0.title : null,
    // 锁状态是唯一真源：available+unlocked=false → 常驻提示；读不到 → 绝不冒充「已解锁」
    l0WriteLocked: s.l0Write?.available === true && s.l0Write.unlocked === false,
    l0WriteUnknown: !s.l0Write || s.l0Write.available !== true,
    // 已解锁 → 历史被挡异常（近 30 分钟聚合）不再当待办提示：解锁动作已经处理，内核会重放/重采
    l0WriteResolved: s.l0Write?.available === true && s.l0Write.unlocked === true,
    l0WriteDetail: s.l0Write?.detail ?? null,
  };
}

/** 效果证据四卡（真实账本聚合；空账本 = 未取数，不伪造演示数字） */
function EffectCard({ g }: { g: Gain }) {
  return (
    <section className="af-panel af-stat">
      <div className="k">{g.title}<span>{g.icon}</span></div>
      <div className="v">{g.big}</div>
      {/* desc 由内核聚合生成、仅插值数字（含 <b> 强调），与 AgentOnboard/Gains 同一渲染口径 */}
      <div className="d" dangerouslySetInnerHTML={{ __html: g.desc }} />
      <div className="src">{g.src}</div>
    </section>
  );
}

/** 关系图谱：环轨 + 六层枢纽（真实层计数）+ 账本核（真实总数）。无卫星标签（没有真实映射，不编造）。 */
function LayerGraphSvg({ graph, focus }: { graph: LayerGraph; focus: Focus }) {
  const total = graph.stats.total;
  const inFocus = (layer: string) =>
    focus === 'all' ? true : focus === 'L4+' ? ['L4', 'L5', 'L6'].includes(layer) : layer === focus;
  return (
    <svg className="af-graph" viewBox="0 0 760 352" role="img" aria-label={`L1–L6 关系图谱，账本共 ${total} 条记忆`}>
      <defs>
        <radialGradient id="ov-core" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".9" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity=".25" />
        </radialGradient>
      </defs>
      <g stroke="var(--muted)" strokeOpacity=".45" strokeWidth="1" fill="none">
        <ellipse cx="380" cy="176" rx="300" ry="128" strokeDasharray="3 5" />
        <ellipse cx="380" cy="176" rx="196" ry="84" />
      </g>
      {graph.hubs.map((h) => {
        const p = HUB_POS[h.layer];
        if (!p) return null;
        return (
          <line key={`e-${h.layer}`} x1="380" y1="176" x2={p.x} y2={p.y}
            stroke="var(--accent)" strokeOpacity={inFocus(h.layer) ? .35 : .1} strokeWidth="1" />
        );
      })}
      {graph.hubs.map((h) => {
        const p = HUB_POS[h.layer];
        if (!p) return null;
        const labelY = p.y < 176 ? p.y - 22 : p.y + 34;
        return (
          <g key={h.layer} opacity={inFocus(h.layer) ? 1 : .3}>
            <circle className="af-hub" cx={p.x} cy={p.y} r="21" fill="var(--surface)" stroke={LAYER_COLOR[h.layer]} strokeWidth="1.6" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">{h.layer}</text>
            <text x={p.x} y={labelY} textAnchor="middle" fontSize="11" fill="var(--muted)">{LAYER_SHORT[h.layer] ?? ''} {h.count}</text>
          </g>
        );
      })}
      <circle cx="380" cy="176" r="34" fill="url(#ov-core)" stroke="var(--accent)" strokeWidth="1.5" />
      <text className="af-core-l" x="380" y="172" textAnchor="middle">账本核</text>
      <text className="af-core-n" x="380" y="188" textAnchor="middle">{total}</text>
    </svg>
  );
}

/** 层级行：L1–L6 六格横排（计数/占比来自同一次账本读取的层枢纽） */
function StrataRow({ graph }: { graph: LayerGraph }) {
  const total = graph.stats.total;
  return (
    <div className="af-strata-row" data-testid="home-strata">
      {graph.hubs.map((h) => {
        const pct = total > 0 ? Math.min(100, Math.round((h.count / total) * 100)) : 0;
        return (
          <div className="af-strata-cell" key={h.layer}>
            <div className="lb"><span>{h.layer}</span><span>{pct}%</span></div>
            <div className="bar"><i style={{ width: `${pct}%`, background: LAYER_COLOR[h.layer] }} /></div>
            <div className="vl">{h.count}</div>
          </div>
        );
      })}
    </div>
  );
}

function AnomalyRow({ a }: { a: RawAnomaly }) {
  const err = a.level === 'error';
  return (
    <li className={`af-anom ${err ? 'error' : 'warn'}`}>
      <span className="tag">{err ? '阻断' : '提醒'}</span>
      <span className="body">
        <span className="t">{a.title}</span>
        <span className="d">{a.detail}</span>
      </span>
      {a.request_id ? <span className="rid">{a.request_id}</span> : <span className="rid mut">账本无链路</span>}
    </li>
  );
}

function RefinePanel({ p }: { p: OverviewRefinePanel }) {
  let body: React.ReactNode;
  if (!p.available) body = <div className="af-pb"><div className="af-note">{p.error ?? '非桌面壳不可用'}</div></div>;
  else if (!p.ok || !p.view) body = <div className="af-pb"><div className="af-note bad">{p.error ?? '读取补炼队列失败'}</div></div>;
  else {
    const sm = p.view.summary;
    const eng = p.view.engine;
    const total = sm.pending + sm.done + sm.failed + sm.skipped;
    const w = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
    const stops = refineStopRows(sm.stop_codes).slice(0, 4);
    body = (
      <>
        <div className="af-pb">
          <div className="af-eng-state">{eng.loaded ? (eng.usable ? '引擎可用 · 队列在干活' : '引擎不可用 · 排队但不干活') : '网关未加载 · 队列只排队'}</div>
          <div className="af-prog">
            <i className="done" style={{ width: w(sm.done) }} />
            <i className="failed" style={{ width: w(sm.failed) }} />
            <i className="skip" style={{ width: w(sm.skipped) }} />
          </div>
          <div className="af-prog-lb">
            <span className="ok">done {sm.done}</span>
            <span>pending {sm.pending}</span>
            <span className="bad">failed {sm.failed}</span>
            <span className="warn">skip {sm.skipped}</span>
          </div>
          {stops.length > 0 && (
            <div className="af-stops">{stops.map((st) => <span key={st.code}>{st.label} ×{st.count}</span>)}</div>
          )}
        </div>
        <div className="af-list bordered">
          <div className="af-li"><span className="nm">单条 ≤ 3 引擎</span><span className="rt">llm_partial 不自动重试</span></div>
          <div className="af-li"><span className="nm">队列续炼</span><span className="ds">refine-queue.json</span>
            <span className={`rt ${eng.loaded && eng.usable ? 'ok' : ''}`}>{eng.loaded ? (eng.usable ? '运行中' : '待引擎') : '未加载'}</span>
          </div>
        </div>
      </>
    );
  }
  const sm = p.view?.summary;
  return (
    <div className="af-panel" data-testid="home-refine">
      <div className="af-ph">
        <h3>L2–L6 补炼队列</h3>
        {sm && <span className="hint">今日 {sm.day_rows}{sm.day_limit != null ? ` / ${sm.day_limit}` : ' · 不限额'}</span>}
        <button className="af-link" type="button" onClick={() => requestShellView('params')}>管理</button>
      </div>
      {body}
    </div>
  );
}

function McpPanel({ p }: { p: OverviewMcpPanel }) {
  let body: React.ReactNode;
  if (!p.available) body = <div className="af-pb"><div className="af-note">{p.error ?? '非桌面壳不可用'}</div></div>;
  else if (!p.ok) body = <div className="af-pb"><div className="af-note bad">{p.error ?? '读取本机 MCP 配置失败'}</div></div>;
  else if (p.clients.length === 0) body = <div className="af-pb"><div className="af-note">未检测到已安装的 MCP 客户端。</div></div>;
  else {
    body = (
      <div className="af-list">
        {p.clients.map((c) => {
          const dot = c.state === 'wired' ? 'var(--ok)' : c.state === 'missing_auth' ? 'var(--warn)' : 'var(--muted)';
          return (
            <div className="af-li" key={c.id}>
              <span className="st" style={{ background: dot }} />
              <span className="nm">{c.name}</span>
              {c.detail ? <span className="ds">{c.detail}</span> : null}
              <span className={`rt ${c.state === 'missing_auth' ? 'warn' : ''}`}>{c.label}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="af-panel" data-testid="home-mcp">
      <div className="af-ph">
        <h3>MCP 接入</h3>
        {p.endpoint && <span className="hint">{p.endpoint}</span>}
        <button className="af-link" type="button" onClick={() => requestShellView('agent')}>接入</button>
      </div>
      {body}
    </div>
  );
}

function EnginePanel({ p }: { p: OverviewEnginePanel }) {
  let body: React.ReactNode;
  if (!p.available) body = <div className="af-pb"><div className="af-note">{p.error ?? '非桌面壳不可用'}</div></div>;
  else if (!p.ok) body = <div className="af-pb"><div className="af-note bad">{p.error ?? '读取引擎配置失败'}</div></div>;
  else if (p.engines.length === 0) body = <div className="af-pb"><div className="af-note">未配置引擎。</div></div>;
  else {
    const rows = [...p.engines].sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    body = (
      <div className="af-list">
        {rows.map((e, i) => (
          <div className="af-li" key={`${e.name}-${i}`}>
            <span className="rk" style={i === 0 ? { color: 'var(--accent)' } : undefined}>{pad2(i + 1)}</span>
            <span className="nm">{e.name}{e.model ? <span className="ds">{e.model}</span> : null}</span>
            <span className="rt">{e.latencyMs == null ? '未拨测' : `${e.latencyMs}ms`}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="af-panel" data-testid="home-engine">
      <div className="af-ph">
        <h3>引擎延迟排行</h3>
        <span className="hint">最近拨测</span>
        <button className="af-link" type="button" onClick={() => requestShellView('cost')}>配置</button>
      </div>
      {body}
    </div>
  );
}

/** 今日概览：写入/召回/嫁接/过滤 四类真实计数（UTC+08:00 今日起内核审计实算） */
function TodayPanel({ p }: { p: OverviewTodayPanel }) {
  const rows = [
    { label: '写入', n: p.write, color: 'var(--accent)' },
    { label: '召回', n: p.recall, color: 'var(--ok)' },
    { label: '嫁接', n: p.graft, color: 'var(--c-l3)' },
    { label: '过滤', n: p.filtered, color: 'var(--warn)' },
  ];
  return (
    <div className="af-panel" data-testid="home-today">
      <div className="af-ph"><h3>今日概览</h3><span className="hint">UTC+08:00 · 内核审计实算</span></div>
      {!p.ok
        ? <div className="af-pb"><div className="af-note bad">{p.error ?? '审计未取到：今日数字暂不可用。'}</div></div>
        : (
          <div className="af-list">
            {rows.map((r) => (
              <div className="af-li" key={r.label}>
                <span className="st" style={{ background: r.color }} />
                <span className="nm">{r.label}</span>
                <span className="rt">{r.n}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

/** TOKEN 节省率：今日召回 payload 相对 2.4.1 全量预算的节省；sparkline 画真实 payload 走势 */
function TokenPanel({ p }: { p: OverviewTokenPanel }) {
  const has = p.ok && p.savedPct != null;
  return (
    <section className="af-panel af-stat" data-testid="home-token">
      <div className="k">TOKEN 节省率<span>今日</span></div>
      <div className="v">{has ? <>{p.savedPct}<em>%</em></> : '未取数'}</div>
      <div className={`d${has ? '' : ' mut'}`}>
        {has
          ? <>▲ 召回 {p.recallCount} 次 · 省 {(p.savedTokens / 1000).toFixed(1)}k tokens</>
          : p.ok ? '今日暂无召回 · 发起召回后自动累计' : (p.error ?? '账本读不到')}
      </div>
      {has && p.series.length >= 2 && <Sparkline series={p.series} />}
    </section>
  );
}

/** payload 走势（近 N 次召回 payload_tokens；纯真实序列，不足 2 个样本不画） */
function Sparkline({ series }: { series: number[] }) {
  const w = 280, h = 34, pad = 3;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = (w - pad * 2) / (series.length - 1);
  const pts = series.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  return (
    <svg className="af-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="今日召回 payload 走势">
      <polyline points={`${pad},${h - pad} ${line} ${w - pad},${h - pad}`} fill="var(--accent-soft)" stroke="none" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
    </svg>
  );
}

export function OverviewPage() {
  useHostTheme();
  const [snap, setSnap] = useState<OverviewSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [focus, setFocus] = useState<Focus>('all');

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await loadOverview();
      setSnap(next);
      setErr(null);
    } catch (e) {
      setErr((e as { message?: string })?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // 登录/登出会写 localStorage：同源 storage 事件里重建数据面并重新读取真实账本与会话
    const onStore = (e: StorageEvent) => {
      if (e.key === 'session:realpage') rebuildKernelForDataPlane();
      if (e.key === null || /theme|session|realpage/.test(e.key) || e.key.startsWith('memdesk')) void reload();
    };
    window.addEventListener('storage', onStore);
    // 切页/切窗口期间可能错过 storage 事件（后台 iframe 不保证收到）→ 回到前台补读一次
    const onWake = () => { if (document.visibilityState !== 'hidden') void reload(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('storage', onStore);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [reload]);

  const view = useMemo(() => (snap ? deriveHomeView(snap) : null), [snap]);

  return (
    <div className="ov-page" data-testid="overview-page">
      <div className="ov-scroll">
        <div className="hmx">
          {view && snap && (
            <>
              <div className="af-head">
                <div className="af-title">
                  <h1>总览工作台</h1>
                  <div className="sub">{view.dateText} · UTC+08:00 · {view.dataRootText}</div>
                </div>
                <div className="af-actions">
                  {snap && !snap.session && (
                    <button className="af-btn sm" type="button" onClick={() => requestShellView('login')}>
                      <Icon name="user" size={12} />去登录
                    </button>
                  )}
                  <button className="af-btn sm" type="button" onClick={() => requestShellView('security')}>
                    <Icon name="shield" size={12} />立即备份
                  </button>
                  <button className="af-btn sm pri" type="button" onClick={() => requestShellView('write')}>
                    <Icon name="plus" size={12} />写入记忆
                  </button>
                  <button className="af-btn sm" type="button" onClick={() => void reload()} disabled={busy} title="重新读取真实账本" data-testid="home-reload">
                    <Icon name="refresh" size={12} />{busy ? '读取中…' : '重读'}
                  </button>
                </div>
              </div>

              {err && (
                <div className="af-alert bad" role="alert">
                  概览聚合失败：{err}。这不是空数据；请确认内核与后端状态后点「重读」重试。
                </div>
              )}
              {/* 账本读取失败由壳层顶部 ov-error-strip 统一提示（57-D 去重），本页只保各自面板的诚实失败原因 */}
              {/* 常驻提示：只要 L0 写密钥锁没解就显示（真源 = l0Status.write_unlocked，不依赖近 30 分钟是否有写入被拒） */}
              {view.l0WriteLocked && (
                <div className="af-alert bad l0-lock-alert" role="alert" data-testid="home-l0-lock-alert">
                  <span className="tag">L0</span>
                  <span className="l0-lock-text">
                    <b>写密钥未解锁</b>：新的写入会被挡下并暂存到 pending 队列，解锁后自动重放落库，绝不落明文。
                    {view.l0Alert ? <span className="l0-lock-sub">近期已有写入因此被挡：{view.l0Alert}。</span> : null}
                  </span>
                  <button className="af-link" type="button" onClick={() => requestShellView('security')}>去安全页解锁 →</button>
                </div>
              )}
              {/* 状态读不到时如实标注（不猜已解锁、也不误报未解锁）；已有真实被挡异常则照常显示 */}
              {!view.l0WriteLocked && view.l0WriteUnknown && (
                <div className="af-alert l0-lock-unknown" data-testid="home-l0-lock-unknown">
                  <span className="tag">L0</span>
                  <span className="l0-lock-text">写密钥锁状态未取到：{view.l0WriteDetail ?? '桌面壳未返回状态'}（不能据此判断已解锁）。</span>
                  <button className="af-link" type="button" onClick={() => void reload()}>重读 →</button>
                </div>
              )}
              {/* 历史被挡（近 30 分钟聚合）只在【当前仍锁】或【锁状态读不到】时给提示；
                  已确认解锁则不再打扰——解锁动作已把被挡写入交给内核重放/重采 */}
              {!view.l0WriteLocked && !view.l0WriteResolved && view.l0Alert && (
                <div className="af-alert">
                  <span className="tag">L0</span>{view.l0Alert}
                  <button className="af-link" type="button" onClick={() => requestShellView('security')}>去安全页解锁 →</button>
                </div>
              )}

              <div className="af-g4" data-testid="home-gains">
                {view.gains.length > 0
                  ? view.gains.map((g) => <EffectCard key={g.title} g={g} />)
                  : <div className="af-note">效果证据未取到：账本读取失败或尚未返回。</div>}
              </div>

              <div className="af-cols">
                <div className="af-stack">
                  <section className="af-panel">
                    <div className="af-ph">
                      <h3>L1–L6 关系图谱</h3>
                      {(['all', 'L2', 'L3', 'L4+'] as const).map((f) => (
                        <button key={f} className={`af-chip${focus === f ? ' on' : ''}`} type="button" onClick={() => setFocus(f)}>
                          {f === 'all' ? '全部' : f}
                        </button>
                      ))}
                      <span className="hint">
                        {view.graph.stats.total} 节点 · {view.graph.stats.merges} 合并边 · {view.graph.stats.conflicts} 冲突
                      </span>
                    </div>
                    <LayerGraphSvg graph={view.graph} focus={focus} />
                    <StrataRow graph={view.graph} />
                  </section>

                  <section className="af-panel">
                    <div className="af-ph"><h3>异常速览</h3><span className="hint">近 1 小时 · 内核窗口聚合</span></div>
                    <div className="af-pb" data-testid="home-anomalies">
                      {view.anomalies.length === 0
                        ? <p className="af-note">账本里没有异常：无 LLM 降级、召回零命中或 L0 写入锁定记录。</p>
                        : <ul className="af-anoms">{view.anomalies.map((a, i) => <AnomalyRow key={`${a.title}-${i}`} a={a} />)}</ul>}
                    </div>
                  </section>

                  <section className="af-panel">
                    <div className="af-ph">
                      <h3>最近审计</h3>
                      <span className="hint">{snap.recentAudits.ok ? `audit.jsonl · 追加式 · ${snap.recentAudits.total} 行` : 'audit.jsonl'}</span>
                    </div>
                    {!snap.recentAudits.ok
                      ? <div className="af-pb"><div className="af-note bad">{snap.recentAudits.error ?? '审计未取到'}</div></div>
                      : snap.recentAudits.rows.length === 0
                        ? <div className="af-pb"><div className="af-note">账本为空：还没有审计记录。</div></div>
                        : (
                          <div className="af-audit" data-testid="home-audit">
                            {snap.recentAudits.rows.map((r, i) => (
                              <div className="row" key={`${r.t}-${i}`}>
                                <span className="t">{r.t}</span>
                                <span className="a">{r.action}</span>
                                <span className="m">{r.memo}</span>
                              </div>
                            ))}
                            <div className="row more">
                              <button className="af-link" type="button" onClick={() => requestShellView('audit')}>查看全部审计 →</button>
                            </div>
                          </div>
                        )}
                  </section>
                </div>

                <div className="af-stack">
                  <TokenPanel p={snap.token} />
                  <RefinePanel p={snap.refine} />
                  <McpPanel p={snap.mcp} />
                  <EnginePanel p={snap.engines} />
                  <TodayPanel p={snap.today} />
                </div>
              </div>

              <div className="af-foot">
                <span className={view.healthOk ? 'ok' : 'bad'}>● {snap.health.detail}</span>
                <span>{view.sessionText}</span>
                <span>home {HOME_PORT}</span>
                <span>onboard {ONBOARD_PORT}</span>
                <span>mcp :8202 / :8204</span>
                <span>webhook :8203</span>
                <span>{snap.recentAudits.ok ? `audit.jsonl ${snap.recentAudits.total} 行` : 'audit.jsonl 不可读'}</span>
              </div>
            </>
          )}

          {!view && (
            <div className="hmx-wait">{err ? `概览聚合失败：${err}` : '正在读取真实账本、审计与主进程遥测…'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
