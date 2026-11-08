// 个人记忆双窗（第一轮本机闭环）：左「已确认」/ 右「收件箱」。
//
// 数据口径（定稿 UI-Design-Proposals/final-01-workspace.html 个人记忆部分）：
// - 只展示内核 personal.ts 返回的真实条目（PersonalSnapshot），无数据写空态，不编造计数；
// - 每个动作都经真实数据面（桌面壳 IPC / 登录后端 HTTP）落 personal_memory 审计并回执 request_id；
// - 「不是我的」只把条目移出本机视图（rejected，可撤销），不删账本；删除需二次确认并只写墓碑；
// - 个人确认不会自动变成团队可见（跨端同步/团队上行留第二轮）；L0 原始内容不进收件箱。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kernelErrorText } from '../shared/kernelLoad.tsx';
import { getPersonalPort, type PersonalPort } from '../shared/personalPort.ts';
import type { PersonalEntry } from '../../core/memagent/personalStore.ts';
import type { PersonalSnapshot } from '../../core/memagent/personal.ts';
import { publishNavCount } from '../shared/navCountChannel.ts';

export interface PersonalPaneProps {
  phase: 'loading' | 'ok' | 'error';
  data: PersonalSnapshot | undefined;
  error: string | null;
  onRetry: () => void;
  /** 动作成功后把最新快照回写页面级加载态（页签/导航计数同源） */
  onChanged: (next: PersonalSnapshot) => void;
}

type RangeKey = 'all' | '7d' | '30d';
const RANGE_LABEL: Record<RangeKey, string> = { all: '全部时间', '7d': '近 7 天', '30d': '近 30 天' };
const RANGE_MS: Record<RangeKey, number> = { all: 0, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtWhen(ts: number | null): string {
  if (!ts) return '时间未记录';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function sourceText(e: PersonalEntry): string {
  return e.source === 'agent' ? `来源 agent · ${e.source_agent ?? '未记名'}` : '来源 本机快速记';
}

export function PersonalMemoryPane({ phase, data, error, onRetry, onChanged }: PersonalPaneProps) {
  const portRef = useRef<PersonalPort | null>(null);
  if (!portRef.current) portRef.current = getPersonalPort();
  const port = portRef.current;

  const [query, setQuery] = useState('');
  const [range, setRange] = useState<RangeKey>('all');
  const [quickText, setQuickText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // 页签/左侧导航的真实待确认计数（未登录或读失败时清 0，不显示假数字）
  useEffect(() => {
    publishNavCount('ledger-personal', phase === 'ok' ? (data?.counts.pending ?? 0) : 0);
  }, [phase, data?.counts.pending]);

  const refresh = useCallback(async (): Promise<PersonalSnapshot | null> => {
    try {
      const next = await port.invoke<PersonalSnapshot>('list');
      onChanged(next);
      return next;
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `重读个人记忆失败：${kernelErrorText(e)}` });
      return null;
    }
  }, [onChanged, port]);

  const act = useCallback(async (op: 'confirm' | 'reject' | 'revoke' | 'delete', entry: PersonalEntry) => {
    setBusy(entry.id);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = { id: entry.id };
      if (op === 'delete') payload.confirm = true;
      const receipt = await port.invoke<{ request_id: string }>(op, payload);
      await refresh();
      setMsg({ kind: 'ok', text: `${op === 'confirm' ? '已确认是我的' : op === 'reject' ? '已剔除（只移出本机视图，账本保留）' : op === 'revoke' ? '已撤销，回到待确认' : '已删除（墓碑保留）'} · request_id ${receipt.request_id}` });
      setPendingDelete(null);
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `动作未生效：${kernelErrorText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [port, refresh]);

  const submitQuick = useCallback(async () => {
    const text = quickText.trim();
    if (!text) {
      setMsg({ kind: 'warn', text: '内容为空：未提交（不会把空条目写进个人记忆）' });
      return;
    }
    setBusy('__quick__');
    setMsg(null);
    try {
      const receipt = await port.invoke<{ request_id: string }>('quick_add', { content: text });
      setQuickText('');
      await refresh();
      setMsg({ kind: 'ok', text: `已记入本机收件箱（待确认）· request_id ${receipt.request_id}` });
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `未记入：${kernelErrorText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [port, quickText, refresh]);

  const confirmed = useMemo(() => {
    const list = data?.confirmed ?? [];
    const q = query.trim().toLowerCase();
    const since = range === 'all' ? 0 : Date.now() - RANGE_MS[range];
    return list.filter((e) => {
      if (q && !e.content.toLowerCase().includes(q)) return false;
      if (since && (e.confirmed_at ?? 0) < since) return false;
      return true;
    });
  }, [data?.confirmed, query, range]);

  const pendingQuick = data?.pending.filter((e) => e.source === 'quick_note') ?? [];
  const pendingAgent = data?.pending.filter((e) => e.source === 'agent') ?? [];
  const rejected = data?.rejected ?? [];

  if (phase === 'loading') {
    return (
      <div className="mm-scrollpane" data-testid="mm-personal-pane">
        <div className="pm-empty" data-testid="pm-loading"><b>个人记忆读取中</b><div>正在从本机独立存储读取已确认与收件箱条目…</div></div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mm-scrollpane" data-testid="mm-personal-pane">
        <div className="p0-banner warn" data-testid="pm-error">
          <span><b>个人记忆没读到：</b>{error ?? '未知错误'}。这不是「没有个人记忆」，是数据面不可用；未显示任何编造条目。</span>
          <button type="button" className="mm-btn" onClick={() => { setMsg(null); onRetry(); }} data-testid="pm-retry">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mm-scrollpane pm-scroll" data-testid="mm-personal-pane">
      <div className="p0-hd">
        <h3>个人记忆</h3>
        <span className="p0-sub">左：已确认（进入召回）· 右：收件箱（待确认 / 已剔除）· 数据面：{port.channel === 'host' ? '桌面壳 IPC' : '登录后端 HTTP'}</span>
        <span className="p0-right">
          <span className="p0-tag mono" data-testid="pm-counts">已确认 {data?.counts.confirmed ?? 0} · 待确认 {data?.counts.pending ?? 0} · 已剔除 {data?.counts.rejected ?? 0}</span>
        </span>
      </div>

      {msg ? (
        <div className={`pm-msg ${msg.kind}`} data-testid="pm-msg">{msg.text}</div>
      ) : null}

      <div className="pm-wrap mm-pm">
        {/* ── 左：已确认显示窗 ─────────────────────────────────────────────── */}
        <div className="pm-col pm-confirmed" data-testid="pm-confirmed">
          <div className="pm-head">
            <div className="pm-title">
              已确认显示窗<span className="n" data-testid="pm-confirmed-count">{data?.counts.confirmed ?? 0}</span>
              <span className="pm-pin" title="已确认条目常驻本窗，不因搜索/时间范围被隐藏出账">pin · 常驻</span>
            </div>
            <div className="pm-tools">
              <label className="pm-search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索已确认内容"
                  aria-label="搜索已确认个人记忆"
                  data-testid="pm-search"
                />
              </label>
              <select
                className="pm-select"
                value={range}
                aria-label="确认时间范围"
                data-testid="pm-range"
                onChange={(e) => setRange(e.target.value as RangeKey)}
              >
                {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="pm-body pm-scrollpane" data-testid="pm-confirmed-list">
            {confirmed.length === 0 ? (
              <div className="pm-empty" data-testid="pm-confirmed-empty">
                <b>{data?.counts.confirmed ? '当前筛选没有匹配条目' : '还没有已确认的个人记忆'}</b>
                <div>{data?.counts.confirmed ? '清空搜索或切换时间范围；总数仍显示在窗口标题。' : '在右侧收件箱点「是我的」后，条目会进入这里并参与召回。'}</div>
              </div>
            ) : confirmed.map((e) => (
              <div className="pm-item" key={e.id} data-testid={`pm-confirmed-${e.id}`}>
                <div className="pm-item-top">
                  <span className="pm-src">{sourceText(e)}</span>
                  <span className="pm-time mono">确认于 {fmtWhen(e.confirmed_at)}</span>
                </div>
                <div className="pm-item-body">{e.content}</div>
                <div className="pm-item-actions">
                  <span className="pm-meta mono">v{e.version} · {e.layer} · {e.content_hash.slice(0, 8)}</span>
                  <button type="button" className="mm-btn" disabled={busy === e.id} data-testid={`pm-unconfirm-${e.id}`} onClick={() => act('revoke', e)}>取消确认</button>
                  {pendingDelete === e.id ? (
                    <>
                      <button type="button" className="mm-btn danger" disabled={busy === e.id} data-testid={`pm-delete-confirm-${e.id}`} onClick={() => act('delete', e)}>确认删除</button>
                      <button type="button" className="mm-btn" onClick={() => setPendingDelete(null)}>取消</button>
                    </>
                  ) : (
                    <button type="button" className="mm-btn" disabled={busy === e.id} data-testid={`pm-delete-${e.id}`} onClick={() => { setPendingDelete(e.id); setMsg({ kind: 'warn', text: '删除需二次确认：再次点击「确认删除」才会写墓碑（账本记录保留）' }); }}>删除</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="pm-foot" data-testid="pm-confirmed-foot">
            共 {data?.counts.confirmed ?? 0} 条 · 本窗显示 {confirmed.length} 条 · 来源 {new Set((data?.confirmed ?? []).map((e) => e.source_agent ?? e.source)).size} 类
          </div>
        </div>

        <div className="pm-div" />

        {/* ── 右：收件箱 ─────────────────────────────────────────────────── */}
        <div className="pm-col pm-inbox" data-testid="pm-inbox">
          <div className="pm-head">
            <div className="pm-title">
              收件箱<span className="n" data-testid="pm-pending-count">{data?.counts.pending ?? 0}</span>
            </div>
            <div className="pm-quick">
              <textarea
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitQuick(); }
                }}
                placeholder="快速记一条：Enter 提交，Shift+Enter 换行"
                aria-label="快速记一条个人记忆"
                data-testid="pm-quick-input"
                rows={2}
                disabled={busy === '__quick__'}
              />
              <button type="button" className="mm-btn primary" disabled={busy === '__quick__'} onClick={() => void submitQuick()} data-testid="pm-quick-submit">
                {busy === '__quick__' ? '提交中…' : '记一条'}
              </button>
            </div>
          </div>
          <div className="pm-body pm-scrollpane" data-testid="pm-inbox-list">
            <section className="pm-sect" data-testid="pm-sect-quick">
              <h4>本机待上行 <span className="pm-sect-n">{pendingQuick.length}</span></h4>
              {pendingQuick.length === 0 ? <div className="pm-none">没有本机快速记录待确认</div> : pendingQuick.map((e) => (
                <div className="pm-item" key={e.id} data-testid={`pm-pending-${e.id}`}>
                  <div className="pm-item-top">
                    <span className="pm-src">{sourceText(e)}</span>
                    <span className="pm-time mono">{fmtWhen(e.delivered_at)}</span>
                  </div>
                  <div className="pm-item-body">{e.content}</div>
                  <div className="pm-item-actions">
                    <button type="button" className="mm-btn primary" disabled={busy === e.id} data-testid={`pm-confirm-${e.id}`} onClick={() => act('confirm', e)}>是我的</button>
                    <button type="button" className="mm-btn" disabled={busy === e.id} data-testid={`pm-reject-${e.id}`} onClick={() => act('reject', e)}>不是我的</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pm-sect" data-testid="pm-sect-agent">
              <h4>待 agent 确认 <span className="pm-sect-n">{pendingAgent.length}</span></h4>
              {pendingAgent.length === 0 ? <div className="pm-none">没有 agent 投递待确认条目</div> : pendingAgent.map((e) => (
                <div className="pm-item" key={e.id} data-testid={`pm-pending-${e.id}`}>
                  <div className="pm-item-top">
                    <span className="pm-src">{sourceText(e)}</span>
                    <span className="pm-time mono">{fmtWhen(e.delivered_at)}</span>
                  </div>
                  <div className="pm-item-body">{e.content}</div>
                  <div className="pm-item-actions">
                    <button type="button" className="mm-btn primary" disabled={busy === e.id} data-testid={`pm-confirm-${e.id}`} onClick={() => act('confirm', e)}>是我的</button>
                    <button type="button" className="mm-btn" disabled={busy === e.id} data-testid={`pm-reject-${e.id}`} onClick={() => act('reject', e)}>不是我的</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pm-sect" data-testid="pm-sect-rejected">
              <h4>已剔除 · 可撤销 <span className="pm-sect-n">{rejected.length}</span></h4>
              {rejected.length === 0 ? <div className="pm-none">没有被剔除的条目</div> : rejected.map((e) => (
                <div className="pm-item rejected" key={e.id} data-testid={`pm-rejected-${e.id}`}>
                  <div className="pm-item-top">
                    <span className="pm-src">{sourceText(e)}</span>
                    <span className="pm-time mono">剔除于 {fmtWhen(e.rejected_at)}</span>
                  </div>
                  <div className="pm-item-body">{e.content}</div>
                  <div className="pm-item-actions">
                    <button type="button" className="mm-btn" disabled={busy === e.id} data-testid={`pm-revoke-${e.id}`} onClick={() => act('revoke', e)}>撤销剔除</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pm-sect pm-rules" data-testid="pm-rules">
              <h4>判定口径</h4>
              <ul>
                <li>只有「已确认」条目参与 agent 召回；待确认与已剔除不进召回。</li>
                <li>「不是我的」只把条目移出本机视图，不删账本；撤销后回到待确认。</li>
                <li>删除需二次确认，只写墓碑（记录保留），不复用记忆主表。</li>
                <li>个人确认只属于本人；不会自动变成团队可见（跨端/团队上行留第二轮）。</li>
                <li>L0 原始密文不进收件箱：这里只处理已有可读内容（L1）。</li>
              </ul>
            </section>
          </div>
          <div className="pm-foot" data-testid="pm-inbox-foot">
            待确认 {data?.counts.pending ?? 0} · 已剔除 {data?.counts.rejected ?? 0} · 本机待上行 {data?.counts.pending_quick ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}
