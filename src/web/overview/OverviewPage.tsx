// 概览页（定稿 .ovx 版式）：一句话结论 + 4 张统计卡 + 范围行 + 编号洞察 01–04 + 快捷胶囊。
// 数据全部来自真实账本与审计（loadOverview 单次读取）；读不到显示「读不到/未取数」+ 原因，不用「—」冒充。
// 问账本问答框已收进壳层快捷栏「记忆助手」（MemoryAssistant），本页不再渲染底部输入框。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadOverview, type OverviewSnapshot } from '../shell/overview.ts';
import { deriveOverviewView } from './overviewPageData.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { requestShellView } from '../shared/shellNavigate.ts';
import { rebuildKernelForDataPlane } from '../kernel.ts';
import './overviewPage.css';

function Ico({ name, size = 12 }: { name: 'spark' | 'db' | 'write' | 'recall' | 'cost' | 'alert' | 'check' | 'arrow' | 'logout'; size?: number }) {
  const s = { width: size, height: size } as const;
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'spark':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7l1.6 3.4L17 12l-3.4 1.6L12 17l-1.6-3.4L7 12l3.4-1.6Z" /></svg>;
    case 'db':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7" ry="2.5" /><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></svg>;
    case 'write':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="M14 6l4 4" /></svg>;
    case 'recall':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>;
    case 'cost':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M4 18h16" /><path d="M6 15V9M11 15V5M16 15v-4" /></svg>;
    case 'alert':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M12 3l9 16H3L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>;
    case 'check':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>;
    case 'arrow':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
    case 'logout':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M14 4h5v16h-5" /><path d="M3 12h11M10 8l4 4-4 4" /></svg>;
    default:
      return null;
  }
}

const STAT_ICONS = ['db', 'write', 'recall', 'cost'] as const;

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

  const view = useMemo(() => (snap ? deriveOverviewView(snap) : null), [snap]);

  return (
    <div className="ov-page" data-testid="overview-page">
      <div className="ov-scroll">
        <div className="ovx">
          <div className="ovx-top">
            <span className="ovx-logo"><Ico name="spark" size={16} /></span>
            <h1 className="ovx-title">
              今天 <span className="dim">· {view ? view.timeText.slice(0, 5) : '读取中'} 发生了什么</span>
            </h1>
            <button
              className="ovx-time"
              type="button"
              title="点击重新读取真实账本"
              onClick={() => void reload()}
              disabled={busy}
            >
              {busy ? '读取中…' : view ? `账本读取 ${view.timeText}` : '未读取'}
            </button>
          </div>

          {err && (
            <div className="ovx-concl error" role="alert">
              概览聚合失败：{err}。这不是空数据；请确认内核与后端状态后点右上角时间重试。
            </div>
          )}
          {view && <p className="ovx-concl">{view.conclusion}</p>}

          {view && (
            <>
              <div className="ovx-stats">
                {view.stats.map((st, i) => (
                  <div className="ovx-stat" key={st.label}>
                    <div className="k"><Ico name={STAT_ICONS[i]} size={11} />{st.label}</div>
                    <div className="v">
                      {st.value}
                      {st.em ? <span className="em"> {st.em}</span> : null}
                    </div>
                    <div className="m" title={st.note}>{st.note}</div>
                  </div>
                ))}
              </div>

              <div className="ovx-scope">
                {view.scope.map((sc) => (
                  <span className="sc" key={sc.label}>
                    <Ico name="check" size={11} />
                    {sc.label} <b>{sc.value}</b>
                  </span>
                ))}
              </div>

              <ul className="ovx-list">
                {view.insights.map((it) => (
                  <li
                    className={`ovx-row${it.go ? ' clickable' : ''}`}
                    key={it.n}
                    onClick={it.go ? () => requestShellView(it.go as string) : undefined}
                    role={it.go ? 'button' : undefined}
                    tabIndex={it.go ? 0 : undefined}
                    onKeyDown={it.go ? (e) => { if (e.key === 'Enter') requestShellView(it.go as string); } : undefined}
                  >
                    <span className="num">{it.n}</span>
                    <span className="main">
                      <span className="t">{it.title}</span>
                      <span className="src">{it.src}</span>
                    </span>
                    <span className={`ovx-pill ${it.tone}`}><span className="dot" />{it.pill}</span>
                    {it.go ? <span className="go"><Ico name="arrow" size={13} /></span> : null}
                  </li>
                ))}
              </ul>

              <div className="ovx-quick">
                {view.quick.map((q) => (
                  <button className="ovx-pillbtn" key={q.go} type="button" onClick={() => requestShellView(q.go)}>
                    <Ico name="arrow" size={12} />
                    {q.label}
                  </button>
                ))}
              </div>

            </>
          )}

          {!view && !err && (
            <div className="ovx-wait">正在读取真实账本与会话状态…</div>
          )}
        </div>
      </div>
    </div>
  );
}
