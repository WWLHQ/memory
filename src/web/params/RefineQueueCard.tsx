// 参数页 · L2–L6 后台补炼队列卡（批次39）。
// 干什么：把「写入只落 L0+脱敏 L1，深层交给后台补炼」这条口径做成可见可控的一块——
//   看进度（待炼 / 已炼 / 失败 / 跳过）、看额度（限额几行 / 不限额，今日已用）、开关队列、把存量入队、重试失败行。
// 批次39 拍板 + 批次40 梳理的规则要在卡面上说清，不要让用户猜：单条最多试 3 个引擎、每日额度默认 500 行、llm_partial 不自动重试。
// 批次40-C 追加第四条与一处口径：深度按这条 L1 的料给（不是每条都要炼到 L6），并显示「阶梯停在哪、为什么停」的原因码分布。
// 批次41-I 后续：每日额度做成「限额 / 不限额」运行时可控（仅管理员）——选「限额」额度框可改，选「不限额」额度框灰掉不可改。
// 队列文件只有 mem_id 与状态：正文（L0 原文、L1、新深层）一律不出主进程，也不进日志。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  refineQueueAvailable, refineQueueBackfill, refineQueueRetryFailed, refineQueueSetCap, refineQueueSetEnabled, refineQueueState,
  refineStopRows, type RefineQueueSummary,
} from './refineQueue.ts';
import { useSessionContext } from '../shared/session.ts';

/** 后台队列在动，页面按 20s 跟着刷新；用户手动「刷新」随时可点 */
const POLL_MS = 20_000;

const hhmmss8 = (ms: number | null): string =>
  ms === null ? '未取数' : new Date(ms + 8 * 3600_000).toISOString().slice(11, 19);

export function RefineQueueCard() {
  const { role } = useSessionContext();
  const isAdmin = role === 'admin';
  const [summary, setSummary] = useState<RefineQueueSummary | null>(null);
  const [engine, setEngine] = useState<{ loaded: boolean; usable: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 额度输入框的本地草稿：管理员改数字但还没点「保存」时不影响队列，点保存才落盘
  const [capDraft, setCapDraft] = useState<string>('');
  // 用户是否在草稿框里有未保存的编辑——true 时后台轮询/首帧同步都不得覆盖正在打的字
  const capDirty = useRef(false);
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

  // 额度草稿只在「持久值变了」且用户没在手打时跟随刷新（20s 轮询/首帧同步都不能把用户正在打的字顶掉）
  const savedCapRows = summary?.cap_rows;
  useEffect(() => {
    if (typeof savedCapRows === 'number' && !capDirty.current) setCapDraft(String(savedCapRows));
  }, [savedCapRows]);

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

  /** 批次41-I 后续：限额/不限额与额度行数的落盘。rows 只在「限额」时发送。 */
  const applyCap = async (enabled: boolean, rows?: number) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await refineQueueSetCap(enabled, rows);
      if (!r.ok || !r.view) { setErr(r.error ?? '设置额度没有回执'); return; }
      setSummary(r.view.summary);
      setEngine(r.view.engine);
      // 落盘成功：草稿已等于持久值，解除「手打中」闸门，后续轮询可正常回填框值
      capDirty.current = false;
      setMsg(r.view.summary.cap_enabled
        ? `已设为限额：每自然日最多补炼 ${r.view.summary.cap_rows} 行`
        : '已设为不限额：今日不按行数截断，pending 会一直排空（唯一约束仍是单条 ≤3 引擎与模型吞吐）');
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
            口径四条（批次39 拍板 + 批次40 梳理）：单条记忆一次<b>最多试 {summary?.max_engines_per_call ?? 3} 个引擎</b>、
            每自然日（UTC+08:00）<b>默认最多补炼 {summary?.cap_rows ?? 500} 行</b>（可在下面「限额 / 不限额」里改，仅管理员）、
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
              今日（{summary.day}）已用 {summary.day_rows} 行
              {summary.cap_enabled
                ? <> / 限额 {summary.day_limit} 行，还剩 {summary.day_left} 行</>
                : <>（不限额：今日不按行数截断）</>}
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
          {/* 批次41-I 后续：每日额度「限额 / 不限额」——限额时额度框可改，不限额时额度框灰掉不可改（仅管理员） */}
          <div className="row" data-testid="refine-cap-row">
            <label data-testid="refine-cap-toggle-wrap">
              <input
                type="checkbox"
                data-testid="refine-cap-toggle"
                checked={summary?.cap_enabled ?? true}
                disabled={!isAdmin || busy || !summary}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (!on) { void applyCap(false); return; }
                  const n = Math.floor(Number(capDraft));
                  void applyCap(true, Number.isFinite(n) && n >= 1 ? n : summary?.cap_rows ?? 500);
                }}
              />{' '}
              限额（取消勾选＝不限额，今日不按行数截断）
            </label>
            <input
              type="number"
              data-testid="refine-cap-rows"
              min={1}
              step={1}
              value={capDraft}
              disabled={!isAdmin || busy || !(summary?.cap_enabled ?? false)}
              onChange={(e) => { capDirty.current = true; setCapDraft(e.target.value); }}
              aria-label="每自然日最多补炼行数"
            />{' '}
            行 / 日
            <button
              type="button"
              className="btn"
              data-testid="refine-cap-save"
              disabled={!isAdmin || busy || !(summary?.cap_enabled ?? false)
                || !(Math.floor(Number(capDraft)) >= 1)
                || Math.floor(Number(capDraft)) === (summary?.cap_rows ?? -1)}
              onClick={() => void applyCap(true, Math.floor(Number(capDraft)))}
            >
              保存限额
            </button>
          </div>
          {!isAdmin && <div className="note" data-testid="refine-need-admin">需管理员：开关、额度（限额/不限额）、存量入队与重试失败行都是管理员动作；只读进度不限角色。</div>}
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
