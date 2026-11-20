// 网页端接入页 ·「网页会话自动采集」卡（2026-11-19 自参数页迁入）。
//
// 为什么必须有这张卡：插件降级为手动入口后，这里是**唯一**的自动采集开关；
// 没有它就只能改配置文件，等于没交付。
//
// 三条纪律：
//   ① 「需要重新登录」必须显眼——登录失效后整条链路静默停摆，藏起来就是假装全自动；
//   ② 本轮结果按站点列「发现 / 已采 / 新增 / 失败」，没有分母就永远答不了「是不是漏了」；
//   ③ 立即采一轮会跑几十秒，按钮期间必须禁用并显示「正在采集」，不能让人重复点。
import { useCallback, useEffect, useState } from 'react';
import {
  AUTO_STATUS_LABEL, webchatAutoAvailable, webchatAutoLogin, webchatAutoRun, webchatAutoSet,
  webchatAutoState, webchatAutoSweep, webchatExportDir, webchatExportOpen, webchatExportSet,
  type AutoStateView, type AutoSiteStatus,
} from './webchatAuto.ts';
import '../params/recallHard.css';

const INTERVALS = [15, 30, 60, 120];
const PER_ROUNDS = [3, 5, 10, 20, 50];
const errText = (e: unknown): string => String((e as Error)?.message ?? e);

const stCls = (s: AutoSiteStatus): string => (s === 'exported' ? 'rh-st on' : s === 'no_new' ? 'rh-st idle' : 'rh-st idle');

/** 时间统一走这里；没有值就写人话（不许用破折号冒充读数，见 tools/check-no-demo.mjs · P02） */
function fmtTime(ts: number | null, empty: string): string {
  if (!ts) return empty;
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function WebchatAutoCard() {
  const [state, setState] = useState<AutoStateView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [dir, setDir] = useState<string | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [dirBusy, setDirBusy] = useState(false);
  const available = webchatAutoAvailable();

  const load = useCallback(async () => {
    if (!available) return;
    const r = await webchatAutoState();
    if (r.state) setState(r.state);
    if (!r.ok) setErr(r.error);
  }, [available]);

  /** 导出目录只从主进程读，渲染层不硬编码；读失败如实显示，不伪造路径 */
  const loadDir = useCallback(async () => {
    if (!available) return;
    try {
      const r = await webchatExportDir();
      // 目录不存在时主进程仍回 dir（ok=false）：此时更要显示路径，让用户能「更改路径」救回来
      if (r.dir) { setDir(r.dir); setDirErr(r.ok ? null : (r.error ?? '目录不存在')); }
      else setDirErr(r.error ?? '读取导出目录失败');
    } catch (e) { setDirErr(errText(e)); }
  }, [available]);

  useEffect(() => { void load(); void loadDir(); }, [load, loadDir]);

  const apply = async (patch: { enabled?: boolean; intervalMinutes?: number; perRound?: number; sites?: string[] }) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await webchatAutoSet(patch);
      if (r.state) setState(r.state);
      if (!r.ok) setErr(r.error);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const runOnce = async () => {
    if (running) return;
    setRunning(true); setErr(null);
    try {
      const r = await webchatAutoRun();
      if (r.state) setState(r.state);
      if (!r.ok) setErr(r.error);
    } catch (e) { setErr(errText(e)); } finally { setRunning(false); }
  };

  /**
   * 补齐历史（全量对账）：每批从侧栏顶部发现，与导出目录已有文件做差集。
   * 没有位置游标；删掉某会话的 md 文件后再点它，那条会被重新采回来。
   */
  const sweepOnce = async () => {
    if (running) return;
    setRunning(true); setErr(null);
    try {
      const r = await webchatAutoSweep();
      if (r.state) setState(r.state);
      if (!r.ok) setErr(r.error);
    } catch (e) { setErr(errText(e)); } finally { setRunning(false); }
  };

  const relogin = async (site: string) => {
    const r = await webchatAutoLogin(site);
    if (!r.ok) setErr(r.error ?? '打开登录窗口失败');
    else await load();
  };

  /** 打开导出目录：主进程在系统文件管理器里打开，失败如实报错 */
  const openDir = async () => {
    if (dirBusy) return;
    setDirBusy(true);
    try {
      const r = await webchatExportOpen();
      if (!r.ok) setDirErr(r.error ?? '打开目录失败');
    } catch (e) { setDirErr(errText(e)); } finally { setDirBusy(false); }
  };

  /** 更改导出目录：弹系统目录选择框；取消 = 现状不变，成功 = 新路径立即生效并回显 */
  const changeDir = async () => {
    if (dirBusy) return;
    setDirBusy(true);
    try {
      const r = await webchatExportSet();
      if (r.canceled) return;                       // 取消：现状不变，不弹错
      if (r.ok && r.dir) { setDir(r.dir); setDirErr(null); }
      else if (!r.canceled) setDirErr(r.error ?? '更改目录失败');
    } catch (e) { setDirErr(errText(e)); } finally { setDirBusy(false); }
  };

  if (!available) {
    return (
      <div className="card rh-card" data-testid="webchat-auto-card">
        <div className="rh-h">网页会话自动采集<span className="rh-ref">无头浏览器 · 定时巡检</span></div>
        <div className="note" data-testid="webchat-auto-unavailable">
          当前不是桌面宿主环境：自动采集要起隐藏浏览器、访问站点并经本机接收端落盘，浏览器模式没有它。
        </div>
      </div>
    );
  }

  const st = state;
  const needRelogin = (st?.lastRound?.results ?? []).filter((r) => r.status === 'need_relogin');
  // config 理论上必填，但主进程失败回执可能只带 ok/error：这里再兜一层，宁可少显示也不整页崩
  const sitesOf = new Set(st?.config?.sites ?? []);

  return (
    <div className="card rh-card" data-testid="webchat-auto-card">
      <div className="rh-h">
        网页会话自动采集
        <span className="rh-ref">隐藏浏览器定时巡检 · 不依赖插件</span>
      </div>
      <div className="note">
        关掉浏览器也能采：应用自己起一个隐藏浏览器，按周期打开站点、只导新增会话。
        首次需要在弹窗里登录一次（登录态存在本机，之后不用再登）。
      </div>

      {!st && !err && <div className="note" data-testid="webchat-auto-loading">正在读取本机真实状态…</div>}
      {err && <div className="rh-err" data-testid="webchat-auto-err">{err}</div>}
      {st?.blocked && <div className="rh-warn" data-testid="webchat-auto-blocked">{st.blocked}</div>}

      {st?.config && (
        <>
          <div className="rh-layer" data-testid="wa-enable">
            <div className="rh-head">
              <span className="rh-name">定时自动采集</span>
              <span className={`rh-st ${st.config.enabled ? 'on' : 'idle'}`} data-testid="wa-enable-st">
                {st.config.enabled ? '已启用' : '已停用'}
              </span>
            </div>
            <div className="rh-desc">
              关掉后定时器不再跑，但仍可随时点「立即采一轮」。关窗不退出的常驻设置见上方「后台常驻」。
            </div>
            <div className="rh-foot">
              <span className="rh-pick" role="radiogroup" aria-label="定时自动采集" data-testid="wa-enable-pick">
                <button type="button" className={`rh-choice${st.config.enabled ? ' active' : ''}`}
                  data-value="on" aria-pressed={st.config.enabled} disabled={busy}
                  onClick={() => void apply({ enabled: true })}>启用</button>
                <button type="button" className={`rh-choice${st.config.enabled ? '' : ' active'}`}
                  data-value="off" aria-pressed={!st.config.enabled} disabled={busy}
                  onClick={() => void apply({ enabled: false })}>不启用</button>
              </span>
              <span className="rh-state" data-testid="wa-next">
                下次：{st.config.enabled ? fmtTime(st.nextAt, '等待排程') : '未排程'}
              </span>
            </div>
          </div>

          <div className="rh-layer" data-testid="wa-interval">
            <div className="rh-head">
              <span className="rh-name">采集周期</span>
              <span className="rh-st idle" data-testid="wa-interval-st">{st.config.intervalMinutes} 分钟</span>
            </div>
            <div className="rh-desc">越短越容易被站点风控盯上；默认 60 分钟。</div>
            <div className="rh-foot">
              <span className="rh-pick" role="radiogroup" aria-label="采集周期" data-testid="wa-interval-pick">
                {INTERVALS.map((m) => (
                  <button key={m} type="button"
                    className={`rh-choice${st.config.intervalMinutes === m ? ' active' : ''}`}
                    data-value={m} aria-pressed={st.config.intervalMinutes === m} disabled={busy}
                    onClick={() => void apply({ intervalMinutes: m })}>{m} 分钟</button>
                ))}
              </span>
            </div>
          </div>

          <div className="rh-layer" data-testid="wa-per-round">
            <div className="rh-head">
              <span className="rh-name">每轮导出条数</span>
              <span className="rh-st idle" data-testid="wa-per-round-st">{st.config.perRound ?? 3} 条</span>
            </div>
            <div className="rh-desc">定时轮每轮最多导这么多条「新的」；已采过的会跳过不占名额。选大点能更快追上新增，但单轮耗时更长。</div>
            <div className="rh-foot">
              <span className="rh-pick" role="radiogroup" aria-label="每轮导出条数" data-testid="wa-per-round-pick">
                {PER_ROUNDS.map((m) => (
                  <button key={m} type="button"
                    className={`rh-choice${(st.config.perRound ?? 3) === m ? ' active' : ''}`}
                    data-value={m} aria-pressed={(st.config.perRound ?? 3) === m} disabled={busy}
                    onClick={() => void apply({ perRound: m })}>{m} 条</button>
                ))}
              </span>
            </div>
          </div>

          <div className="rh-layer" data-testid="wa-sites">
            <div className="rh-head"><span className="rh-name">采集站点</span></div>
            <div className="rh-desc">本期只实测过 DeepSeek；其余站点已接好入口，但选择器可能随改版失效，启用后请先点「立即采一轮」看结果。</div>
            <div className="rh-foot">
              {st.sites.map((s) => {
                const on = sitesOf.has(s.key);
                return (
                  <button key={s.key} type="button" className={`rh-choice${on ? ' active' : ''}`}
                    data-testid={`wa-site-${s.key}`} aria-pressed={on} disabled={busy}
                    style={{ border: '1px solid var(--line)', borderRadius: 8 }}
                    onClick={() => void apply({
                      sites: on ? st.config.sites.filter((k) => k !== s.key) : [...st.config.sites, s.key],
                    })}>{s.label}</button>
                );
              })}
            </div>
          </div>

          <div className="rh-layer" data-testid="wa-login-win">
            <div className="rh-head">
              <span className="rh-name">登录窗口</span>
              <span className={`rh-st ${st.loginWindows.length ? 'on' : 'idle'}`} data-testid="wa-login-win-count">
                {st.loginWindows.length ? `已打开 ${st.loginWindows.length} 个` : '未打开'}
              </span>
            </div>
            <div className="rh-desc">
              随时点开对应站点的登录窗去登录或看会话；登录态存在本机，登一次之后不用再登。窗口开着或关掉都不影响后台采集。
            </div>
            <div className="rh-foot">
              {st.sites.map((s) => {
                const opened = st.loginWindows.includes(s.key);
                return (
                  <button key={s.key} type="button" className="btn" data-testid={`wa-login-open-${s.key}`}
                    disabled={busy} onClick={() => void relogin(s.key)}>
                    {opened ? '重新打开' : '打开登录窗'} · {s.label}
                  </button>
                );
              })}
            </div>
            <div className="rh-state" data-testid="wa-login-win-status">
              当前已打开：{st.loginWindows.length
                ? st.loginWindows.map((k) => st.sites.find((s) => s.key === k)?.label ?? k).join('、')
                : '无'}
            </div>
          </div>

          <div className="rh-layer" data-testid="wa-export-dir">
            <div className="rh-head">
              <span className="rh-name">导出文件保存目录</span>
            </div>
            <div className="rh-desc">
              采集到的对话写成 Markdown 存在这里；点「打开目录」看文件，点「更改路径」换位置（采集每轮现取，改完立即生效）。
            </div>
            <div className="rh-foot" style={{ wordBreak: 'break-all' }}>
              {dir ? (
                <>
                  <code data-testid="wa-export-dir-path">{dir}</code>{' '}
                  <button type="button" className="btn" data-testid="wa-export-dir-open" disabled={dirBusy}
                    onClick={() => void openDir()}>打开目录</button>{' '}
                  <button type="button" className="btn" data-testid="wa-export-dir-change" disabled={dirBusy}
                    onClick={() => void changeDir()}>更改路径</button>
                </>
              ) : (
                <span data-testid="wa-export-dir-loading">{dirErr ?? '读取中…'}</span>
              )}
            </div>
            {dirErr && dir && <div className="rh-err" data-testid="wa-export-dir-err">{dirErr}</div>}
          </div>

          <div className="rh-layer" data-testid="wa-run">
            <div className="rh-head">
              <span className="rh-name">立即采一轮</span>
              <span className={`rh-st ${st.running || running ? 'on' : 'idle'}`} data-testid="wa-run-st">
                {st.running || running ? '正在采集' : '空闲'}
              </span>
              <span className="rh-state" data-testid="wa-last-at">上次：{fmtTime(st.lastRound?.at ?? null, '还没有采过')}</span>
            </div>
            <div className="rh-foot">
              <button type="button" className="btn" data-testid="wa-run-btn"
                disabled={running || st.running} onClick={() => void runOnce()}>
                {running || st.running ? '正在采集…' : '立即采一轮'}
              </button>
              <button type="button" className="btn" data-testid="wa-sweep-btn"
                disabled={running || st.running} onClick={() => void sweepOnce()}
                title="从侧栏顶部全量对账：只补导出目录里还没有的会话；删掉某个 md 文件后可重新采回">
                {running || st.running ? '正在同步…' : '补齐历史会话'}
              </button>
              {needRelogin.length > 0 && (
                <button type="button" className="btn" data-testid="wa-relogin-btn"
                  onClick={() => void relogin(needRelogin[0].site)}>
                  重新登录 {needRelogin[0].site}
                </button>
              )}
            </div>
            <div className="rh-desc" data-testid="wa-sweep-hint">
              按会话 ID 全量对账：每批都从侧栏顶部发现会话，导出目录里已有同名文件的跳过，只补还没采过的；每站最多 10 批、每批最多 30 条新的。删掉某个 md 文件再点它，那条会重新采回来。
            </div>
            {needRelogin.length > 0 && (
              <div className="rh-warn" data-testid="wa-need-relogin">
                登录已失效：这些站点不会自动入库，点上面「重新登录」或「登录窗口」里的站点按钮，在弹窗里登一次即可恢复。
              </div>
            )}

            {st.lastRound && st.lastRound.results.length > 0 && (
              <table className="ltable" data-testid="wa-results" style={{ marginTop: 8 }}>
                <thead><tr><th>站点</th><th>结果</th><th>发现</th><th>已采</th><th>新增</th><th>失败</th><th>说明</th></tr></thead>
                <tbody>
                  {st.lastRound.results.map((r) => (
                    <tr key={r.site} data-testid={`wa-row-${r.site}`}>
                      <td>{st.sites.find((s) => s.key === r.site)?.label ?? r.site}</td>
                      <td><span className={stCls(r.status)}>{AUTO_STATUS_LABEL[r.status]}</span></td>
                      <td>{r.scanned}</td>
                      <td>{r.skipped ?? 0}</td>
                      <td>{r.exported}</td>
                      <td>{r.missing ?? 0}</td>
                      {/* 说明可能是长诊断（体检数字）：限定两行 + title 看全文，不撑破表格 */}
                      <td className="rh-state" title={r.reason ?? ''} style={{ maxWidth: 320, whiteSpace: 'normal' }}>
                        {r.reason ?? '无异常'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
