// 参数页 · L2–L6 后台补炼队列卡（批次39）。
// 干什么：把「写入只落 L0+脱敏 L1，深层交给后台补炼」这条口径做成可见可控的一块——
//   看进度（待炼 / 已炼 / 失败 / 跳过）、看额度（今日 500 行还剩几行）、开关队列、把存量入队、重试失败行。
// 三条拍板规则要在卡面上说清，不要让用户猜：单条最多试 3 个引擎、每日最多 500 行、llm_partial 不自动重试。
// 批次40-C 追加第四条与一处口径：深度按这条 L1 的料给（不是每条都要炼到 L6），并显示「阶梯停在哪、为什么停」的原因码分布。
// 队列文件只有 mem_id 与状态：正文（L0 原文、L1、新深层）一律不出主进程，也不进日志。
import { useCallback, useEffect, useState } from 'react';
import {
  refineQueueAvailable, refineQueueBackfill, refineQueueRetryFailed, refineQueueSetEnabled, refineQueueState,
  refineStopRows, type RefineQueueSummary,
} from './refineQueue.ts';
import { useSessionContext } from '../shared/session.ts';

/** 后台队列在动，页面按 20s 跟着刷新；用户手动「刷新」随时可点 */
const POLL_MS = 20_000;

const hhmmss8 = (ms: number | null): string =>
  ms === null ? '—' : new Date(ms + 8 * 3600_000).toISOString().slice(11, 19);

export function RefineQueueCard() {
  const { role } = useSessionContext();
  const isAdmin = role === 'admin';
  const [summary, setSummary] = useState<RefineQueueSummary | null>(null);
  const [engine, setEngine] = useState<{ loaded: boolean; usable: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = refineQueueAvailable();
  const stops = refineStopRows(summary?.stop_codes);

  const refresh = useCallback(async () => {
    const r = await refineQueueState();
    if (r.ok && r.view) {
      setSummary(r.view.summary);
      setEngine(r.view.engine);
      setErr(null);
    } else setErr(r.error ?? '读不到补炼队列状态');
  }, []);

  useEffect(() => {
    if (!available) { setErr('当前不是桌面宿主环境：补炼队列由主进程维护，浏览器模式没有它'); return; }
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [available, refresh]);

  const run = async (action: 'backfill' | 'retry' | 'toggle', next?: boolean) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = action === 'backfill'
        ? await refineQueueBackfill()
        : action === 'retry'
          ? await refineQueueRetryFailed()
          : await refineQueueSetEnabled(next === true);
      if (!r.ok || !r.view) { setErr(r.error ?? '操作没有回执'); return; }
      setSummary(r.view.summary);
      setEngine(r.view.engine);
      if (action === 'backfill') {
        const p = r.report;
        setMsg(p
          ? `已入队 ${p.added} 行（原本就在队列 ${p.already_queued} · 已炼过 ${p.settled} · 受保护不入队 ${p.protected_skipped} · 不合格 ${p.not_eligible}${p.thin_skipped ? ` · 料太短直接跳过 ${p.thin_skipped}` : ''}）`
          : '存量入队已执行，但主进程没回计数——请刷新看进度');
      } else if (action === 'retry') setMsg(`失败行已放回队列：${r.retried ?? 0} 行（不自动重试，这是你手动点的）`);
      else setMsg(r.view.summary.enabled ? '队列已开启：后台会按额度逐行补炼' : '队列已暂停：新行仍会入队，但不起活');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="refine-card">
      <div className="section-title">L2–L6 后台补炼队列（写入只落 L0+L1，深层在后台炼）</div>
      {!available ? (
        <div className="note" data-testid="refine-unavailable">{err ?? '补炼队列不可用'}</div>
      ) : (
        <>
          <div className="note">
            口径四条（批次39 拍板 + 批次40 梳理，写进代码里的常量）：单条记忆一次<b>最多试 {summary?.max_engines_per_call ?? 3} 个引擎</b>、
            每自然日（UTC+08:00）<b>最多补炼 {summary?.day_limit ?? 500} 行</b>、
            残缺产物 <code>llm_partial</code> <b>不自动重试</b>——要重试请点下面「重试失败行」、
            <b>炼到多深由这条 L1 的料决定</b>（<code>depthCapFor</code>：有效字 ≥30 才炼 L2，≥60 到 L3，≥120 到 L4，≥240 到 L5；L6 索引任何深度都炼）。
          </div>
          {engine && !engine.usable && (
            <div className="note" data-testid="refine-engine-warn" style={{ color: 'var(--warn)' }}>
              {engine.loaded
                ? 'LLM 引擎当前不可用（未启用 / 未拨通 / 未配密钥）：队列只排不炼，行不会被判失败，也不消耗当日额度。'
                : '主进程还没加载 LLM 网关：稍后再看，队列不会把行判死。'}
            </div>
          )}
          {summary ? (
            <div className="note" data-testid="refine-summary">
              待补炼 <b>{summary.pending}</b> · 已炼成 {summary.done} · 失败 <b>{summary.failed}</b> · 跳过 {summary.skipped}
              <br />
              今日（{summary.day}）已用 {summary.day_rows} / {summary.day_limit}，还剩 {summary.day_left} 行
              · 队列状态：{summary.enabled ? '开启' : '暂停'} · 上次更新 {hhmmss8(summary.updated_at)}（UTC+08:00）
              <br />
              <span className="dim">状态文件 <code>{summary.queue_path}</code>（只有 mem_id 与状态，正文不落这里）</span>
              {stops.length > 0 && (
                <div className="dim" data-testid="refine-stop-codes">
                  阶梯停在哪：
                  {stops.map((s) => ` ${s.label}（${s.code}）${s.count} 行`).join(' · ')}
                  ——「已炼成」不等于「炼到 L6」：短料行炼满它该炼的层就是 <code>llm</code>。
                </div>
              )}
            </div>
          ) : (
            <div className="note" data-testid="refine-summary-none">{err ?? '队列状态加载中…'}</div>
          )}
          <div className="row">
            <label data-testid="refine-toggle-wrap">
              <input
                type="checkbox"
                data-testid="refine-toggle"
                checked={summary?.enabled ?? false}
                disabled={!isAdmin || busy || !summary}
                onChange={(e) => void run('toggle', e.target.checked)}
              />{' '}
              开启后台补炼
            </label>
            <button type="button" className="btn" data-testid="refine-backfill" disabled={!isAdmin || busy} onClick={() => void run('backfill')}>
              把存量入队补炼
            </button>
            <button
              type="button"
              className="btn"
              data-testid="refine-retry"
              disabled={!isAdmin || busy || (summary?.failed ?? 0) === 0}
              onClick={() => void run('retry')}
            >
              重试失败行
            </button>
            <button type="button" className="btn" data-testid="refine-refresh" disabled={busy} onClick={() => void refresh()}>
              刷新
            </button>
          </div>
          {!isAdmin && <div className="note" data-testid="refine-need-admin">需管理员：开关、存量入队与重试失败行都是管理员动作；只读进度不限角色。</div>}
          {msg && <div className="note" data-testid="refine-msg">{msg}</div>}
          {err && <div className="note" data-testid="refine-error" style={{ color: 'var(--err)' }}>{err}</div>}
          <div className="note">
            为什么不同步炼：本机 7B 模型单次精炼实测约 28 秒，五层就是两分钟量级——写入路径必须保持快，
            所以 <code>coreWrite</code> 仍只落 L0 密文 + 脱敏 L1，深层交给这块后台队列（MCP 写入同理，只落 L0+L1）。
            整轮重炼（含把正文按 L0 原文重新生成）请走安全页的「按 L0 重建 L1–L6」。
            <br />
            批次40 起「短且没有硬事实」的话在<b>入库那一步</b>就拦（质量门 v3 <code>short_low_signal</code>），不再放进来等精炼时才发现；
            放行的短行也按料给深度，炼不到 L5 是正常结果，不是故障。
          </div>
        </>
      )}
    </div>
  );
}
