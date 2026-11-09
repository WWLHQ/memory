// 首页总览工作台（批次57-B · Stratum A 版式）：效果证据四卡 + L1–L6 图谱/层级行 + 异常速览 + 最近审计
// + 右侧遥测（补炼队列 / MCP 接入 / 引擎延迟 / 今日概览）。所有读数来自 loadOverview 单次真实取数：
// 内核账本 / 审计 / 主进程 IPC（refine:state · mcp:clients · llm:config · dataRoot:get）/ /api/health。
// 读不到就显示「读不到 / 未取数 / 不可用」并给原因，绝不用演示数或 0 冒充成功读数。
// 问账本问答框已收进壳层快捷栏「记忆助手」（MemoryAssistant），本页不再渲染底部输入框。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadOverview,
  type OverviewSnapshot,
  type OverviewBilling,
  type OverviewRefinePanel,
  type OverviewMcpPanel,
  type OverviewEnginePanel,
} from '../shell/overview.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { requestShellView } from '../shared/shellNavigate.ts';
import { rebuildKernelForDataPlane } from '../kernel.ts';
import { Icon } from '../shell/Icons.tsx';
import { refineStopRows } from '../params/refineQueue.ts';
import type { Gain } from '../../types/agentOnboard.ts';
import type { LayerGraph } from '../Home/layerGraph.ts';
import type { HomeFacts, HomeStrataCount } from '../Home/coreHome.ts';
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
  };
}

function EffectCard({ g }: { g: Gain }) {
  return (
    <div className="af-panel af-stat">
      <div className="k"><Icon name="chart" size={12} />{g.title}</div>
      <div className="v">{g.big}</div>
      {/* desc 由内核聚合生成、仅插值数字（含 <b> 强调），与 AgentOnboard/Gains 同一渲染口径 */}
      <div className="d" dangerouslySetInnerHTML={{ __html: g.desc }} />
      <div className="src">{g.src}</div>
    </div>
  );
}

function LayerGraphSvg({ graph }: { graph: LayerGraph }) {
  const total = graph.stats.total;
  return (
    <svg className="af-graph" viewBox="0 0 760 352" role="img" aria-label={`L1–L6 层级图谱，账本共 ${total} 条记忆`}>
      {graph.hubs.map((h) => {
        const p = HUB_POS[h.layer];
        if (!p) return null;
        return <line key={`e-${h.layer}`} className="af-edge" x1={p.x} y1={p.y} x2={380} y2={176} />;
      })}
      <circle className="af-core" cx={380} cy={176} r={46} />
      <text className="af-core-n" x={380} y={174} textAnchor="middle">{total}</text>
      <text className="af-core-l" x={380} y={194} textAnchor="middle">账本核</text>
      {graph.hubs.map((h) => {
        const p = HUB_POS[h.layer];
        if (!p) return null;
        const color = LAYER_COLOR[h.layer];
        return (
          <g key={h.layer}>
            <circle className="af-hub" cx={p.x} cy={p.y} r={34} style={{ stroke: color }} />
            <text className="af-hub-l" x={p.x} y={p.y - 3} textAnchor="middle" style={{ fill: color }}>{h.layer}</text>
            <text className="af-hub-n" x={p.x} y={p.y + 15} textAnchor="middle">{h.count}</text>
          </g>
        );
      })}
    </svg>
  );
}

function StrataBars({ strata, total }: { strata: HomeStrataCount[] | null; total: number }) {
  if (!strata) return <div className="af-note">层级计数未取到：账本读取失败或尚未返回。</div>;
  if (strata.length === 0) return <div className="af-note">账本为空：还没有任何层的记忆。</div>;
  return (
    <div className="af-strata" data-testid="home-strata">
      {strata.map((c) => {
        const pct = total > 0 ? Math.min(100, Math.round((c.count / total) * 100)) : 0;
        const color = LAYER_COLOR[c.layer];
        return (
          <div className="af-strata-row" key={c.layer}>
            <span className="lb" style={{ color }}>{c.layer} {LAYER_SHORT[c.layer] ?? ''}</span>
            <span className="bar"><i style={{ width: `${pct}%`, background: color }} /></span>
            <span className="vl">{c.count}</span>
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
  if (!p.available) body = <div className="af-note">{p.error ?? '非桌面壳不可用'}</div>;
  else if (!p.ok || !p.view) body = <div className="af-note bad">{p.error ?? '读取补炼队列失败'}</div>;
  else {
    const sm = p.view.summary;
    const eng = p.view.engine;
    const total = sm.pending + sm.done + sm.failed + sm.skipped;
    const w = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
    const stops = refineStopRows(sm.stop_codes).slice(0, 4);
    body = (
      <>
        <div className="af-eng-state">{eng.loaded ? (eng.usable ? '引擎可用 · 队列在干活' : '引擎不可用 · 排队但不干活') : '网关未加载 · 队列只排队'}</div>
        <div className="af-nums">
          <span>待炼 <b>{sm.pending}</b></span>
          <span>完成 <b>{sm.done}</b></span>
          <span>失败 <b>{sm.failed}</b></span>
          <span>跳过 <b>{sm.skipped}</b></span>
        </div>
        {total > 0 ? (
          <div className="af-prog">
            <i className="done" style={{ width: w(sm.done) }} />
            <i className="failed" style={{ width: w(sm.failed) }} />
            <i className="skip" style={{ width: w(sm.skipped) }} />
          </div>
        ) : <div className="af-note">队列为空：暂无待补炼行。</div>}
        <div className="af-prog-lb">{sm.day} 已用 {sm.day_rows}{sm.day_limit != null ? ` / ${sm.day_limit}` : ' · 不限额'}</div>
        {stops.length > 0 && (
          <div className="af-stops">{stops.map((st) => <span key={st.code}>{st.label} ×{st.count}</span>)}</div>
        )}
      </>
    );
  }
  return (
    <div className="af-panel" data-testid="home-refine">
      <div className="af-ph"><h3>补炼队列</h3><button className="af-link" type="button" onClick={() => requestShellView('params')}>管理</button></div>
      {body}
    </div>
  );
}

function McpPanel({ p }: { p: OverviewMcpPanel }) {
  let body: React.ReactNode;
  if (!p.available) body = <div className="af-note">{p.error ?? '非桌面壳不可用'}</div>;
  else if (!p.ok) body = <div className="af-note bad">{p.error ?? '读取本机 MCP 配置失败'}</div>;
  else if (p.clients.length === 0) body = <div className="af-note">未检测到已安装的 MCP 客户端。</div>;
  else {
    body = (
      <div className="af-list">
        {p.clients.map((c) => (
          <div className="af-li" key={c.id}>
            <span className={`st ${c.state === 'wired' ? 'ok' : 'mut'}`}>{c.label}</span>
            <span className="nm">{c.name}{c.detail ? <span className="ds">{c.detail}</span> : null}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="af-panel" data-testid="home-mcp">
      <div className="af-ph"><h3>MCP 接入</h3><button className="af-link" type="button" onClick={() => requestShellView('agent')}>接入</button></div>
      {p.endpoint ? <div className="af-endpoint">{p.endpoint}</div> : null}
      {body}
    </div>
  );
}

function EnginePanel({ p }: { p: OverviewEnginePanel }) {
  let body: React.ReactNode;
  if (!p.available) body = <div className="af-note">{p.error ?? '非桌面壳不可用'}</div>;
  else if (!p.ok) body = <div className="af-note bad">{p.error ?? '读取引擎配置失败'}</div>;
  else if (p.engines.length === 0) body = <div className="af-note">未配置引擎。</div>;
  else {
    const rows = [...p.engines].sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    body = (
      <div className="af-list">
        {rows.map((e, i) => (
          <div className="af-li" key={`${e.name}-${i}`}>
            <span className="rank">{i + 1}</span>
            <span className="nm">{e.name}<span className="ds">{e.model}</span></span>
            <span className="rt">{e.latencyMs == null ? '未拨测' : `${e.latencyMs} ms`}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="af-panel" data-testid="home-engine">
      <div className="af-ph"><h3>引擎延迟</h3><button className="af-link" type="button" onClick={() => requestShellView('cost')}>配置</button></div>
      {body}
    </div>
  );
}

function TodayPanel({ facts, billing }: { facts: HomeFacts | null; billing: OverviewBilling }) {
  return (
    <div className="af-panel" data-testid="home-today">
      <div className="af-ph"><h3>今日概览</h3><span className="hint">本次账本读取</span></div>
      {!facts ? <div className="af-note">账本未读到：今日数字暂不可用。</div> : (
        <div className="af-today">
          <div><span>记忆</span><b>{facts.memories}</b></div>
          <div><span>审计</span><b>{facts.audits}</b></div>
          <div><span>今日写入</span><b>{facts.writeToday}</b></div>
          <div><span>今日召回</span><b>{facts.recallToday}</b></div>
          <div><span>待裁决</span><b>{facts.conflicts}</b></div>
        </div>
      )}
      <div className="af-billing">{billing.status === 'ok' ? billing.detail : `成本未取数 · ${billing.detail}`}</div>
    </div>
  );
}

export function OverviewPage() {
  useHostTheme();
  const [snap, setSnap] = useState<OverviewSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

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
    return () => window.removeEventListener('storage', onStore);
  }, [reload]);

  const view = useMemo(() => (snap ? deriveHomeView(snap) : null), [snap]);

  return (
    <div className="ov-page" data-testid="overview-page">
      <div className="ov-scroll">
        <div className="hmx">
          <div className="af-head">
            <div className="af-title">
              <h1>总览工作台</h1>
              <div className="sub">
                {view ? `${view.dateText} · ${view.dataRootText}` : '正在读取真实账本…'}
              </div>
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
          {snap?.storageError && (
            <div className="af-alert bad" role="alert">
              账本读取失败：{snap.storageError}。下方读数按读取失败显示，不是 0。
            </div>
          )}
          {view?.l0Alert && (
            <div className="af-alert">
              <Icon name="lock" size={12} />{view.l0Alert}
              <button className="af-link" type="button" onClick={() => requestShellView('memory-bank')}>去处理</button>
            </div>
          )}

          {view && (
            <>
              <div className="af-g4" data-testid="home-gains">
                {view.gains.length > 0
                  ? view.gains.map((g) => <EffectCard key={g.title} g={g} />)
                  : <div className="af-note">效果证据未取到：账本读取失败或尚未返回。</div>}
              </div>

              <div className="af-cols">
                <div className="hmx-main">
                  <div className="af-panel">
                    <div className="af-ph"><h3>L1–L6 层级图谱</h3><span className="hint">枢纽数 = 该层有内容的记忆条数</span></div>
                    <LayerGraphSvg graph={view.graph} />
                    <StrataBars strata={snap?.strata ?? null} total={view.graph.stats.total} />
                  </div>

                  <div className="af-panel">
                    <div className="af-ph">
                      <h3>异常速览</h3>
                      <button className="af-link" type="button" onClick={() => requestShellView('audit')}>看审计</button>
                    </div>
                    {view.anomalies.length === 0
                      ? <div className="af-note">账本里没有异常：无 LLM 降级、召回零命中或 L0 写入锁定记录。</div>
                      : <ul className="af-anoms" data-testid="home-anomalies">{view.anomalies.map((a, i) => <AnomalyRow key={`${a.title}-${i}`} a={a} />)}</ul>}
                  </div>

                  <div className="af-panel">
                    <div className="af-ph">
                      <h3>最近审计</h3>
                      <button className="af-link" type="button" onClick={() => requestShellView('audit')}>
                        查看全部{snap && snap.recentAudits.ok ? `（${snap.recentAudits.total}）` : ''}
                      </button>
                    </div>
                    {!snap?.recentAudits.ok
                      ? <div className="af-note bad">{snap?.recentAudits.error ?? '审计未取到'}</div>
                      : snap.recentAudits.rows.length === 0
                        ? <div className="af-note">账本为空：还没有审计记录。</div>
                        : (
                          <div className="af-audit" data-testid="home-audit">
                            {snap.recentAudits.rows.map((r, i) => (
                              <div className="row" key={`${r.t}-${i}`}>
                                <span className="t">{r.t}</span>
                                <span className="a">{r.action}</span>
                                <span className="m">{r.memo}</span>
                              </div>
                            ))}
                          </div>
                        )}
                  </div>
                </div>

                <div className="hmx-side">
                  {snap && <RefinePanel p={snap.refine} />}
                  {snap && <McpPanel p={snap.mcp} />}
                  {snap && <EnginePanel p={snap.engines} />}
                  {snap && <TodayPanel facts={snap.facts} billing={snap.billing} />}
                </div>
              </div>

              <div className="af-foot">
                <span className={view.healthOk ? 'ok' : 'bad'}>
                  <Icon name={view.healthOk ? 'check' : 'warn'} size={11} />后端 {snap?.health.detail ?? '未探测'}
                </span>
                <span>{snap?.kernelMode === 'host' ? '桌面壳 · 本机账本' : '浏览器 · 临时账本'}</span>
                <span>{view.sessionText}</span>
                <span className="rt">账本读取 {view.dateText}</span>
              </div>
            </>
          )}

          {!view && !err && <div className="hmx-wait">正在读取真实账本、审计与主进程遥测…</div>}
        </div>
      </div>
    </div>
  );
}