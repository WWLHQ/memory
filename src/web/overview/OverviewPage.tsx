// 首页总览工作台（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-home）：
// af-head → L0/MCP 提示 → 效果四卡 → 双栏（左：图谱/异常/最近审计；右：今日概览/TOKEN 节省率/补炼/MCP/引擎）→ 页脚端口行。
// 所有读数来自 loadOverview 单次真实取数：内核账本 / 审计 / 主进程 IPC（refine:state · mcp:clients · llm:config · dataRoot:get）/ /api/health。
// 读不到就显示「读不到 / 未取数 / —」并给原因，绝不用演示数或 0 冒充成功读数。
// 问账本问答框已独立为整页（assistant.html · src/web/assistant/AssistantPage.tsx），本页不再渲染底部输入框。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadMcpPanel,
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
import { currentSessionId } from '../shared/session.ts';
import { requestShellView } from '../shared/shellNavigate.ts';
import { logoutCurrentSession } from '../shell/ShellLoginDialog.tsx';
import {
  deriveMcpSwitch, requestEnableMcpSwitch, MCP_SWITCH_POLL_MS,
  MCP_LAUNCH_HINT, MCP_MANUAL_HINT,
} from '../shared/mcpSwitch.ts';
import { McpSwitchAlert } from './McpSwitchAlert.tsx';
import { listMcpPending, markMcpPending, subscribeMcpPending } from '../shared/mcpPending.ts';
import { rebuildKernelForDataPlane } from '../kernel.ts';
import type { Gain } from '../../types/agentOnboard.ts';
import type { LayerGraph } from '../Home/layerGraph.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import '../shared/p0.css';
import './overviewPage.css';

type RawAnomaly = NonNullable<RawHomeFeed['anomalies']>[number];

const LAYER_COLOR: Record<string, string> = {
  L0: 'var(--c-l0)', L1: 'var(--c-l1)', L2: 'var(--c-l2)', L3: 'var(--c-l3)',
  L4: 'var(--c-l4)', L5: 'var(--c-l5)', L6: 'var(--c-l6)',
};
const LAYER_SHORT: Record<string, string> = {
  L0: '原文', L1: '脱敏', L2: '摘要', L3: '得失', L4: '模式', L5: '洞察', L6: '索引',
};
/** 图谱几何（viewBox 760×352）：L6 投影索引居中为汇聚点，L1–L5 自正上方起顺时针均分环绕。
   所有坐标都是常量推导（无随机数、不依赖真实数据多少），数据只决定计数与是否命中所选筛选。 */
const GRAPH_CENTER = { x: 380, y: 176 };
const GRAPH_RING = { rx: 286, ry: 122 };
const GRAPH_HUB_R = 21;
const GRAPH_CORE_R = 38;
/** L1–L5 按顺时针排列在环上（角度自正上方 -90° 起，每层间隔 72°） */
const RING_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;

const HUB_POS: Record<string, { x: number; y: number }> = (() => {
  const pos: Record<string, { x: number; y: number }> = { L6: GRAPH_CENTER };
  RING_LAYERS.forEach((layer, i) => {
    const rad = (-90 + i * 72) * (Math.PI / 180);
    pos[layer] = {
      x: Math.round((GRAPH_CENTER.x + GRAPH_RING.rx * Math.cos(rad)) * 10) / 10,
      y: Math.round((GRAPH_CENTER.y + GRAPH_RING.ry * Math.sin(rad)) * 10) / 10,
    };
  });
  return pos;
})();

/** 层 → L6 的辐条：从层枢边缘出发，箭头落在 L6 圆盘外沿（朝向随位置自动旋转） */
function spokeToCore(p: { x: number; y: number }): { x1: number; y1: number; x2: number; y2: number } {
  const dx = GRAPH_CENTER.x - p.x;
  const dy = GRAPH_CENTER.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: p.x + ux * (GRAPH_HUB_R + 2),
    y1: p.y + uy * (GRAPH_HUB_R + 2),
    x2: GRAPH_CENTER.x - ux * (GRAPH_CORE_R + 9),
    y2: GRAPH_CENTER.y - uy * (GRAPH_CORE_R + 9),
  };
}

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
  /** 是否已登录：L0 写密钥类提示只在登录后出现（未登录先引导登录，不提前催解锁） */
  session: boolean;
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
    session: s.session === true,
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
    <section className="af-panel af-stat" data-testid="home-gain-card">
      <div className="k">{g.title}</div>
      <div className="v">{g.big}</div>
      {/* desc 由内核聚合生成、仅插值数字（含 <b> 强调）；文案说人话（2026-11-16）。设计稿 stat 卡 = k/v/d 三段，无图标位与来源行 */}
      <div className="d mut" dangerouslySetInnerHTML={{ __html: g.desc }} />
    </section>
  );
}

/** 关系图谱：L6 居中（汇聚点，尺寸/金辉/光晕与外围区分），L1–L5 环绕一圈并各带指向 L6 的箭头。
    计数全部来自真实层枢纽，账本核总数取自 stats.total；筛选只改变「聚焦/变暗」，不增删数据。 */
function LayerGraphSvg({ graph, focus }: { graph: LayerGraph; focus: Focus }) {
  const total = graph.stats.total;
  const inFocus = (layer: string) =>
    focus === 'all' ? true : focus === 'L4+' ? ['L4', 'L5', 'L6'].includes(layer) : layer === focus;
  const l6 = graph.hubs.find((h) => h.layer === 'L6');
  return (
    <svg className="af-graph" viewBox="0 0 760 352" role="img" aria-label={`L1–L6 关系图谱，L6 居中汇聚，账本共 ${total} 条记忆`}>
      <defs>
        {/* L6 圆盘：金色球面（浅色/深色都足够亮，文字用深色墨保证对比） */}
        <radialGradient id="ov-core" cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#FFF0BC" />
          <stop offset="52%" style={{ stopColor: 'var(--c-l6)', stopOpacity: .98 }} />
          <stop offset="100%" style={{ stopColor: 'var(--c-l6)', stopOpacity: .58 }} />
        </radialGradient>
        {/* 外围层枢：表面到深一档的球面渐变，形成层次 */}
        <radialGradient id="af-hub-face" cx="34%" cy="28%" r="82%">
          <stop offset="0%" style={{ stopColor: 'var(--surface)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--surface4)' }} />
        </radialGradient>
        <radialGradient id="af-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: 'var(--c-l6)', stopOpacity: .34 }} />
          <stop offset="100%" style={{ stopColor: 'var(--c-l6)', stopOpacity: 0 }} />
        </radialGradient>
        {/* 箭头：orient=auto 按线段方向自动旋转，refX=8 让尖端落在线端点（L6 外沿） */}
        <marker id="af-arrow" viewBox="0 0 8 8" refX="8" refY="4"
          markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* 透视底：中心辉光 + 两道椭圆轨道（远景细、近景粗），制造景深 */}
      <circle cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r="156" fill="url(#af-core-glow)" opacity=".5" />
      <g fill="none" stroke="var(--muted)">
        <ellipse cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} rx="300" ry="128" strokeOpacity=".30" strokeDasharray="3 5" />
        <ellipse cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} rx="196" ry="84" strokeOpacity=".14" />
      </g>

      {/* L1–L5 → L6 辐条（箭头指向 L6，朝向随位置旋转） */}
      {RING_LAYERS.map((layer) => {
        const p = HUB_POS[layer];
        if (!p) return null;
        const s = spokeToCore(p);
        return (
          <line
            key={`e-${layer}`}
            className="af-spoke"
            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke="var(--accent)"
            strokeOpacity={inFocus(layer) ? .55 : .12}
            strokeWidth="1.2"
            markerEnd="url(#af-arrow)"
          />
        );
      })}

      {/* 外围五层枢：真实层计数，球面高光 + 落影 */}
      {RING_LAYERS.map((layer) => {
        const p = HUB_POS[layer];
        const h = graph.hubs.find((x) => x.layer === layer);
        if (!p || !h) return null;
        const labelY = p.y < GRAPH_CENTER.y ? p.y - 24 : p.y + 33;
        return (
          <g key={h.layer} className={`af-hub-g${inFocus(layer) ? '' : ' off'}`} data-graph-layer={layer}>
            <circle className="af-hub-ring" cx={p.x} cy={p.y} r={GRAPH_HUB_R + 6}
              fill="none" stroke={LAYER_COLOR[layer]} strokeOpacity=".26" />
            <circle className="af-hub" cx={p.x} cy={p.y} r={GRAPH_HUB_R}
              fill="url(#af-hub-face)" stroke={LAYER_COLOR[layer]} strokeWidth="1.6" />
            <ellipse className="af-hub-hl" cx={p.x - 7} cy={p.y - 8} rx="8" ry="4.6"
              fill="#FFFFFF" opacity=".18" transform={`rotate(-28 ${p.x - 7} ${p.y - 8})`} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">{h.layer}</text>
            <text className="af-hub-lb" x={p.x} y={labelY} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
              {LAYER_SHORT[h.layer] ?? ''} {h.count}
            </text>
          </g>
        );
      })}

      {/* L6 汇聚点：更大的金盘 + 光晕环 + 账本核总数（全部真实读数） */}
      <g className={`af-core${inFocus('L6') ? '' : ' off'}`}>
        <circle className="af-core-halo" cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r="64" fill="url(#af-core-glow)" />
        <circle cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r="47" fill="none"
          stroke="var(--c-l6)" strokeOpacity=".45" strokeDasharray="4 4" />
        <circle className="af-hub af-hub-core" cx={GRAPH_CENTER.x} cy={GRAPH_CENTER.y} r={GRAPH_CORE_R}
          fill="url(#ov-core)" stroke="var(--c-l6)" strokeWidth="2" />
        <text x={GRAPH_CENTER.x} y={GRAPH_CENTER.y - 4} textAnchor="middle" fontSize="13" fontWeight="800" fill="#2A1B00">L6</text>
        <text x={GRAPH_CENTER.x} y={GRAPH_CENTER.y + 12} textAnchor="middle" fontSize="9.5" fill="#3A2600">
          {l6?.count ?? 0} 条
        </text>
        <text className="af-core-l" x={GRAPH_CENTER.x} y={GRAPH_CENTER.y + 62} textAnchor="middle">账本核</text>
        <text className="af-core-n" x={GRAPH_CENTER.x} y={GRAPH_CENTER.y + 78} textAnchor="middle">{total}</text>
      </g>
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
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="vl">{h.count}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 异常行：设计稿模板 = af-alert（error→bad / 其余→warn）+ tag + 单行文本 + rid mono 内联（无独立卡片版式）。 */
function AnomalyRow({ a }: { a: RawAnomaly }) {
  const err = a.level === 'error';
  return (
    <div className={`af-alert ${err ? 'bad' : 'warn'}`}>
      <span className="tag">{err ? '阻断' : '提醒'}</span>
      <span style={{ minWidth: 0 }}>
        {a.title}{a.detail ? `：${a.detail}` : ''}
        {a.request_id ? <span className="af-mono" style={{ marginLeft: 6, opacity: .8 }}>{a.request_id}</span> : null}
      </span>
    </div>
  );
}

/** 补炼队列：设计稿模板 = af-ph(h3 + 今日 hint，无链接) + prog + prog-lb + 两行说明列表；引擎态并入「运行中/待引擎」行。 */
function RefinePanel({ p }: { p: OverviewRefinePanel }) {
  if (!p.available || !p.ok || !p.view) {
    const msg = !p.available ? (p.error ?? '非桌面壳不可用') : (p.error ?? '读取补炼队列失败');
    return (
      <div className="af-panel" data-testid="home-refine">
        <div className="af-ph"><h3>L2–L6 补炼队列</h3></div>
        <div className="af-pb"><div className={`af-note${p.available ? ' bad' : ''}`}>{msg}</div></div>
      </div>
    );
  }
  const sm = p.view.summary;
  const eng = p.view.engine;
  const total = sm.pending + sm.done + sm.failed + sm.skipped;
  const w = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="af-panel" data-testid="home-refine">
      <div className="af-ph">
        <h3>L2–L6 补炼队列</h3>
        <span className="hint">今日 {sm.day_rows}{sm.day_limit != null ? ` / ${sm.day_limit}` : ' · 不限额'}</span>
      </div>
      <div className="af-pb" style={{ paddingBottom: 4 }}>
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
      </div>
      <div className="af-list bordered">
        <div className="af-li"><span className="nm">单条 ≤ 3 引擎</span><span className="rt">llm_partial 不自动重试</span></div>
        <div className="af-li"><span className="nm">队列续炼</span><span className="ds">refine-queue.json</span>
          <span className={`rt ${eng.loaded && eng.usable ? 'ok' : ''}`}>{eng.loaded ? (eng.usable ? '运行中' : '待引擎') : '未加载'}</span>
        </div>
      </div>
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
          const dot = c.disabled === true ? 'var(--bad)'
            : c.state === 'wired' ? 'var(--ok)' : c.state === 'missing_auth' ? 'var(--warn)' : 'var(--muted)';
          return (
            <div className="af-li" key={c.id} data-switch={c.disabled === true ? 'off' : undefined}>
              <span className="st" style={{ background: dot }} />
              <span className="nm">{c.name}</span>
              {c.detail ? <span className="ds">{c.detail}</span> : null}
              <span className={`rt ${c.disabled === true || c.state === 'missing_auth' ? 'warn' : ''}`}>
                {c.disabled === true ? '客户端已关闭' : c.label}
              </span>
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
            <span className="rk" style={i < 3 ? { color: 'var(--accent)' } : undefined}>{pad2(i + 1)}</span>
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
        <span className="hint">最近成功拨测</span>
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
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      <polyline points={`${pad},${h - pad} ${line} ${w - pad},${h - pad}`} fill="var(--accent-soft)" stroke="none" />
    </svg>
  );
}

export function OverviewPage() {
  useHostTheme();
  const [snap, setSnap] = useState<OverviewSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>('all');
  // T3/①：待生效来自共享信号（首页/接入页/壳层同源），不再用本地布尔，避免一处点了另两处消失
  const [mcpPendingIds, setMcpPendingIds] = useState<string[]>(() => listMcpPending());
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpHint, setMcpHint] = useState<string | null>(null);
  /** 批次51：页头登出（用户要求放在「立即备份」前）；busy 防重复点击 */
  const [loggingOut, setLoggingOut] = useState(false);
  /**
   * 登出（真实 POST /api/logout + 清本机会话，与登录弹窗同一口径）。
   * 本页是壳层的同源 iframe：清完会话后整壳重载（window.parent 同源可重载），
   * 让壳层状态栏 / 头像 / 各页登录态同步回到「只读」，不保留任何假登录态。
   */
  const handleLogout = useCallback(() => {
    if (loggingOut) return;
    setLoggingOut(true);
    void logoutCurrentSession().finally(() => window.parent.location.reload());
  }, [loggingOut]);

  const reload = useCallback(async () => {
    setMcpError(null);
    try {
      const next = await loadOverview();
      setSnap(next);
      setErr(null);
    } catch (e) {
      setErr((e as { message?: string })?.message ?? String(e));
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

  // ①待生效共享信号：其它落点（接入页/壳层）改了这个信号，首页立刻跟上；12s 轮询也顺带刷新
  useEffect(() => {
    setMcpPendingIds(listMcpPending());
    return subscribeMcpPending(() => setMcpPendingIds(listMcpPending()));
  }, []);

  const view = useMemo(() => (snap ? deriveHomeView(snap) : null), [snap]);

  /** 每 12 秒只复核 MCP 客户端配置这一路，不整页重读账本；失败保留上一轮真值。
   *  依赖为空：快照还没到时更新会被 setSnap 的前值判断忽略，无需随快照重建定时器。 */
  useEffect(() => {
    const timer = setInterval(() => {
      void loadMcpPanel(currentSessionId())
        .then((mcp) => {
          setSnap((prev) => (prev ? { ...prev, mcp } : prev));
          // ①顺带让过期的待生效自动掉（TTL 到期不发事件）
          setMcpPendingIds(listMcpPending());
        })
        .catch(() => { /* 复核失败：保留上一轮，不冒充最新 */ });
    }, MCP_SWITCH_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const switchState = useMemo(
    () => (snap && view
      ? deriveMcpSwitch({
        healthOk: view.healthOk, mcpOk: snap.mcp.ok,
        clients: snap.mcp.clients, pendingIds: mcpPendingIds,
      })
      : null),
    [snap, view, mcpPendingIds],
  );

  /** 手动打开提示只在「开关态消失（已正常 / 未知）」时收起。
   *  用户 2026-11-15 实机反馈：点完像没反应——原先 reload() 一开始就 setMcpHint(null)，
   *  任何 storage/focus 触发的整页重读都会把刚点出来的提示抹掉。 */
  useEffect(() => {
    if (!switchState) return;
    if (switchState.view !== 'off' && switchState.view !== 'pending') setMcpHint(null);
  }, [switchState]);

  const onMcpEnable = async () => {
    if (!switchState?.canEnable || !switchState.enableId) return;
    const id = switchState.enableId;
    setMcpBusy(true);
    setMcpError(null);
    const r = await requestEnableMcpSwitch(id);
    setMcpBusy(false);
    if (!r.ok) { setMcpError(r.error ?? '未知原因'); return; }
    // ①登记共享待生效：首页/接入页/壳层三处一起保持「待生效」，不再只有本页知道
    markMcpPending(id);
    setMcpPendingIds(listMcpPending());
  };

  return (
    <div className="ov-page" data-testid="overview-page">
      <div className="ov-scroll">
        <div className="hmx">
          {view && snap && (
            <>
              <div className="af-head" data-testid="overview-head">
                <h1>总览工作台</h1>
                <span className="sub">
                  {view.dateText} · UTC+08:00 · {snap.dataRoot.available ? `数据根 ${view.dataRootText}` : view.dataRootText}
                </span>
                <div className="right">
                  {snap && !snap.session && (
                    <button className="af-btn" type="button" onClick={() => requestShellView('login')}>去登录</button>
                  )}
                  {snap?.session && (
                    <button className="af-btn" type="button" data-testid="ov-logout" disabled={loggingOut}
                      title="登出：真实 POST /api/logout 并清除本机会话，随后整壳重载回到只读态"
                      onClick={handleLogout}>{loggingOut ? '登出中…' : '登出'}</button>
                  )}
                  <button className="af-btn" type="button" onClick={() => requestShellView('security')}>立即备份</button>
                  <button className="af-btn pri" type="button" onClick={() => requestShellView('write')}>+ 写入记忆</button>
                </div>
              </div>

              {err && (
                <div className="af-alert bad" role="alert">
                  概览聚合失败：{err}。这不是空数据；请确认内核与后端状态，切回本页会自动重读。
                </div>
              )}
              {/* 账本读取失败由壳层顶部 ov-error-strip 统一提示（57-D 去重），本页只保各自面板的诚实失败原因 */}
              {/* 常驻提示：已登录且 L0 写密钥锁没解才显示（真源 = l0Status.write_unlocked，不依赖近 30 分钟是否有写入被拒）。
                  未登录时先引导登录，不提前催解锁（2026-11-16） */}
              {view.session && view.l0WriteLocked && (
                <div className="af-alert" role="alert" data-testid="home-l0-lock-alert">
                  <span className="tag">L0</span>
                  <span>写密钥未解锁：新的写入会被挡下并暂存到 pending 队列，解锁后自动重放落库，绝不落明文。{view.l0Alert ? `近期已有写入因此被挡：${view.l0Alert}。` : ''}</span>
                  <button className="af-link" type="button" onClick={() => requestShellView('security')}>去安全页解锁 →</button>
                </div>
              )}
              {/* 状态读不到时如实标注（不猜已解锁、也不误报未解锁）；已有真实被挡异常则照常显示 */}
              {view.session && !view.l0WriteLocked && view.l0WriteUnknown && (
                <div className="af-alert" data-testid="home-l0-lock-unknown">
                  <span className="tag">L0</span>
                  <span>写密钥锁状态未取到：{view.l0WriteDetail ?? '桌面壳未返回状态'}（不能据此判断已解锁）。</span>
                  <button className="af-link" type="button" onClick={() => void reload()}>重读 →</button>
                </div>
              )}
              {/* 历史被挡（近 30 分钟聚合）只在【当前仍锁】或【锁状态读不到】时给提示；
                  已确认解锁则不再打扰——解锁动作已把被挡写入交给内核重放/重采 */}
              {view.session && !view.l0WriteLocked && !view.l0WriteResolved && view.l0Alert && (
                <div className="af-alert" data-testid="home-l0-blocked-alert">
                  <span className="tag">L0</span>{view.l0Alert}
                  <button className="af-link" type="button" onClick={() => requestShellView('security')}>去安全页解锁 →</button>
                </div>
              )}

              {/* T3 落点①：客户端 MCP 开关状态（服务端在线但客户端关了 → 红条 + 一键打开） */}
              {switchState && (
                <McpSwitchAlert
                  state={switchState}
                  busy={mcpBusy}
                  error={mcpError}
                  hint={mcpHint}
                  onEnable={() => void onMcpEnable()}
                  onManual={() => setMcpHint(MCP_MANUAL_HINT)}
                  onLaunch={() => setMcpHint(MCP_LAUNCH_HINT)}
                  onReload={() => void reload()}
                />
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
                    <div className="af-ph"><h3>异常速览</h3><span className="hint">近 30 分钟 · 窗口聚合</span></div>
                    <div className="af-pb" data-testid="home-anomalies">
                      {view.anomalies.length === 0
                        ? <p className="af-note">账本里没有异常：无 LLM 降级、召回零命中或 L0 写入锁定记录。</p>
                        : (
                          <>
                            <div className="af-stack" style={{ gap: 7 }}>
                              {view.anomalies.map((a, i) => <AnomalyRow key={`${a.title}-${i}`} a={a} />)}
                            </div>
                            <p className="af-note" style={{ marginTop: 8 }}>正文不进首页；本条随窗口老化自动消失，可凭 request_id 到日志页真查。</p>
                          </>
                        )}
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
                  {/* 右栏顺序（用户 2026-11-21）：今日概览上移至 TOKEN 节省率位置（首位），其余顺延 */}
                  <TodayPanel p={snap.today} />
                  <TokenPanel p={snap.token} />
                  <RefinePanel p={snap.refine} />
                  <McpPanel p={snap.mcp} />
                  <EnginePanel p={snap.engines} />
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
