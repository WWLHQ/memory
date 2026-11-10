// 个人记忆双窗（第一轮本机闭环 + 第二轮跨端同步）：左「已确认」/ 右「收件箱」。
//
// 数据口径（定稿 UI-Design-Proposals/final-01-workspace.html 个人记忆部分）：
// - 只展示内核 personal.ts 返回的真实条目（PersonalSnapshot），无数据写空态，不编造计数；
// - 每个动作都经真实数据面（桌面壳 IPC / 登录后端 HTTP）落 personal_memory 审计并回执 request_id；
// - 「不是我的」只把条目移出本机视图（rejected，可撤销），不删账本；删除需二次确认并只写墓碑；
// - 个人确认不会自动变成团队可见；上行团队必须二次确认（explicit 授权）后走真实 PgSyncHub；
// - 同步失败如实显示阶段 + 错误码，绝不显示「已同步」；L0 原始内容不进收件箱。
//
// N8 回退改良（用户 2026-11-10 确认，全页 + 壳层常驻面板共用本组件）：
// - 样式自包含：本文件直接 import personalMemoryPane.css（pmp- 前缀变量，不覆盖宿主全局），
//   因此记忆库全页与壳层常驻面板都自动带上样式，不再依赖宿主是否引入 memoryManagement.css；
// - 改良 ① 「快速记一条 + 记一条」从右窗收件箱头部移到整个面板最上方通栏；
// - 改良 ② 所有卡片 / 分区框 / 空态框 / 搜索框 / 下拉 / 按钮 / 徽标统一圆角（9–12px）。
import './personalMemoryPane.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kernelErrorText } from '../shared/kernelLoad.tsx';
import {
  getPersonalPort, pushPersonalToTeam, retryPersonalSync, type PersonalPort,
} from '../shared/personalPort.ts';
import type { PersonalEntry } from '../../core/memagent/personalStore.ts';
import type { PersonalSnapshot, PersonalSyncReceipt } from '../../core/memagent/personal.ts';
import { publishNavCount } from '../shared/navCountChannel.ts';

export interface PersonalPaneProps {
  phase: 'loading' | 'ok' | 'error';
  data: PersonalSnapshot | undefined;
  error: string | null;
  onRetry: () => void;
  /** 动作成功后把最新快照回写页面级加载态（页签/导航计数同源） */
  onChanged: (next: PersonalSnapshot) => void;
  /** 窄容器（壳层常驻面板）：双窗改上下堆叠 */
  narrow?: boolean;
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

/** 条目级同步状态文案（失败必带阶段 + 错误码；成功才允许出现「已同步」） */
function syncBadge(e: PersonalEntry): { tone: 'ok' | 'warn' | 'err' | 'quiet'; text: string; title?: string } {
  switch (e.sync_state) {
    case 'synced':
      return {
        tone: 'ok',
        text: `已同步（团队）· ${e.sync_result ?? 'applied'} · sha256 ${e.sha256.slice(0, 8)}`,
        title: '已真实写入团队中枢（PgSyncHub），重复上行按 sha256 幂等',
      };
    case 'pending_sync':
      return { tone: 'warn', text: '待上行（尚未送达团队中枢）', title: '已显式授权，等待写入团队中枢' };
    case 'failed':
      return {
        tone: 'err',
        text: `同步失败 · 阶段 ${e.sync_error?.stage ?? '未知'} · ${e.sync_error?.code ?? 'E_UNKNOWN'}`,
        title: e.sync_error?.message ?? '上行失败，本机条目保留',
      };
    default:
      return { tone: 'quiet', text: '仅本机 · 本人', title: '个人记忆默认仅本机+本人；上行到团队需显式授权' };
  }
}

export function PersonalMemoryPane({ phase, data, error, onRetry, onChanged, narrow }: PersonalPaneProps) {
  const portRef = useRef<PersonalPort | null>(null);
  if (!portRef.current) portRef.current = getPersonalPort();
  const port = portRef.current;

  const [query, setQuery] = useState('');
  const [range, setRange] = useState<RangeKey>('all');
  const [quickText, setQuickText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingUplink, setPendingUplink] = useState<string | null>(null);

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

  // 显式授权上行 / 重试：失败如实显示阶段 + 错误码，绝不显示「已同步」
  const uplink = useCallback(async (entry: PersonalEntry, retry: boolean) => {
    setBusy(entry.id);
    setMsg(null);
    try {
      const receipt: PersonalSyncReceipt = retry
        ? await retryPersonalSync(entry.id, port)
        : await pushPersonalToTeam(entry.id, port);
      await refresh();
      if (receipt.sync.outcome === 'synced') {
        setMsg({
          kind: 'ok',
          text: `已上行到团队中枢（${receipt.sync.result ?? 'applied'}）· sha256 ${entry.sha256.slice(0, 8)} · request_id ${receipt.request_id}`,
        });
      } else {
        setMsg({
          kind: 'err',
          text: `上行失败：阶段 ${receipt.sync.stage ?? '未知'} · 错误码 ${receipt.sync.code ?? 'E_UNKNOWN'} · ${receipt.sync.message ?? '未送达团队'}（本机条目保留，未显示已同步）`,
        });
      }
      setPendingUplink(null);
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `上行未生效：${kernelErrorText(e)}` });
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
  const syncQueue = data?.sync_queue ?? [];
  const binding = data?.owner_binding;

  const rootClass = `mm-personal-pane${narrow ? ' pmp-narrow' : ''}`;

  if (phase === 'loading') {
    return (
      <div className={rootClass} data-testid="mm-personal-pane">
        <div className="pmp-empty" data-testid="pm-loading"><b>个人记忆读取中</b><div>正在从本机独立存储读取已确认与收件箱条目…</div></div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={rootClass} data-testid="mm-personal-pane">
        <div className="pmp-banner warn" data-testid="pm-error">
          <span><b>个人记忆没读到：</b>{error ?? '未知错误'}。这不是「没有个人记忆」，是数据面不可用；未显示任何编造条目。</span>
          <button type="button" className="pmp-btn" onClick={() => { setMsg(null); onRetry(); }} data-testid="pm-retry">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass} data-testid="mm-personal-pane">
      <div className="pmp-hd">
        <h3>个人记忆</h3>
        {/* 计数与标题同行（2026-11-10：删掉「左/右/数据面」说明行，计数并入标题行并调整宽度） */}
        <span className="pmp-tag mono" data-testid="pm-counts">已确认 {data?.counts.confirmed ?? 0} · 待确认 {data?.counts.pending ?? 0} · 已剔除 {data?.counts.rejected ?? 0} · 待上行 {data?.counts.pending_sync ?? 0} · 同步失败 {data?.counts.sync_failed ?? 0}</span>
      </div>

      {/* 改良 ① 快速记一条：置顶通栏（原在右窗收件箱头部） */}
      <div className="pmp-quick" data-testid="pm-quick-top">
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
        <button type="button" className="pmp-btn primary" disabled={busy === '__quick__'} onClick={() => void submitQuick()} data-testid="pm-quick-submit">
          {busy === '__quick__' ? '提交中…' : '记一条'}
        </button>
      </div>

      {binding ? (
        <div className={`pmp-ownerbar ${binding.bound ? 'ok' : 'warn'}`} data-testid="pm-owner-binding">
          召回归属：内核账号 <b className="mono">{binding.kernel_user_id}</b> · 登录账号 <b className="mono">{binding.login_account}</b> ·{' '}
          {binding.bound
            ? (binding.via === 'same_name' ? '同名直通' : binding.via === 'binding' ? '已按显式绑定映射' : '无内核身份配置，按登录账号口径')
            : '未绑定内核账号 → 本机可用，agent 暂不可召回（不会静默并号）'}
        </div>
      ) : null}

      {msg ? (
        <div className={`pmp-msg ${msg.kind}`} data-testid="pm-msg">{msg.text}</div>
      ) : null}

      <div className="pmp-wrap">
        {/* ── 左：已确认显示窗 ─────────────────────────────────────────────── */}
        <div className="pmp-col" data-testid="pm-confirmed">
          <div className="pmp-head">
            <div className="pmp-title">
              已确认显示窗<span className="n" data-testid="pm-confirmed-count">{data?.counts.confirmed ?? 0}</span>
              <span className="pmp-pin" title="已确认条目常驻本窗，不因搜索/时间范围被隐藏出账">pin · 常驻</span>
            </div>
            <div className="pmp-tools">
              <label className="pmp-search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索已确认内容"
                  aria-label="搜索已确认个人记忆"
                  data-testid="pm-search"
                />
              </label>
              <select
                className="pmp-select"
                value={range}
                aria-label="确认时间范围"
                data-testid="pm-range"
                onChange={(e) => setRange(e.target.value as RangeKey)}
              >
                {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="pmp-body" data-testid="pm-confirmed-list">
            {confirmed.length === 0 ? (
              <div className="pmp-empty" data-testid="pm-confirmed-empty">
                <b>{data?.counts.confirmed ? '当前筛选没有匹配条目' : '还没有已确认的个人记忆'}</b>
                <div>{data?.counts.confirmed ? '清空搜索或切换时间范围；总数仍显示在窗口标题。' : '在右侧收件箱点「是我的」后，条目会进入这里并参与召回。'}</div>
              </div>
            ) : confirmed.map((e) => {
              const badge = syncBadge(e);
              const retryable = e.sync_state === 'pending_sync' || e.sync_state === 'failed';
              return (
                <div className="pmp-item" key={e.id} data-testid={`pm-confirmed-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className={`pmp-badge ${badge.tone}`} title={badge.title} data-testid={`pm-sync-badge-${e.id}`}>{badge.text}</span>
                    <span className="pmp-time mono">确认于 {fmtWhen(e.confirmed_at)}</span>
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <span className="pmp-meta">v{e.version} · {e.layer} · sha256 {e.sha256.slice(0, 8)} · 时钟 {Object.entries(e.vclock).map(([k, v]) => `${k}:${v}`).join(' ')}</span>
                    {e.sync_state === 'synced' ? null : pendingUplink === e.id ? (
                      <>
                        <button type="button" className="pmp-btn danger" disabled={busy === e.id} data-testid={`pm-uplink-confirm-${e.id}`} onClick={() => void uplink(e, retryable)}>确认上行（团队可见）</button>
                        <button type="button" className="pmp-btn" onClick={() => setPendingUplink(null)}>取消</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="pmp-btn"
                        disabled={busy === e.id}
                        data-testid={`pm-uplink-${e.id}`}
                        onClick={() => {
                          setPendingUplink(e.id);
                          setMsg({ kind: 'warn', text: '上行会让本条在团队中枢可见：需再次点击「确认上行」才算显式授权（个人确认不会自动提权）' });
                        }}
                      >{retryable ? '重试上行' : '上行到团队'}</button>
                    )}
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-unconfirm-${e.id}`} onClick={() => act('revoke', e)}>取消确认</button>
                    {pendingDelete === e.id ? (
                      <>
                        <button type="button" className="pmp-btn danger" disabled={busy === e.id} data-testid={`pm-delete-confirm-${e.id}`} onClick={() => act('delete', e)}>确认删除</button>
                        <button type="button" className="pmp-btn" onClick={() => setPendingDelete(null)}>取消</button>
                      </>
                    ) : (
                      <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-delete-${e.id}`} onClick={() => { setPendingDelete(e.id); setMsg({ kind: 'warn', text: '删除需二次确认：再次点击「确认删除」才会写墓碑（账本记录保留）' }); }}>删除</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pmp-foot" data-testid="pm-confirmed-foot">
            共 {data?.counts.confirmed ?? 0} 条 · 本窗显示 {confirmed.length} 条 · 来源 {new Set((data?.confirmed ?? []).map((e) => e.source_agent ?? e.source)).size} 类
          </div>
        </div>

        <div className="pmp-div" />

        {/* ── 右：收件箱（快速记一条已移到顶部通栏） ─────────────────────── */}
        <div className="pmp-col" data-testid="pm-inbox">
          <div className="pmp-head">
            <div className="pmp-title">
              收件箱<span className="n" data-testid="pm-pending-count">{data?.counts.pending ?? 0}</span>
            </div>
          </div>
          <div className="pmp-body" data-testid="pm-inbox-list">
            <section className="pmp-sect" data-testid="pm-sect-sync">
              <h4>本机待上行 <span className="pmp-sect-n" data-testid="pm-sync-queue-count">{syncQueue.length}</span></h4>
              {syncQueue.length === 0 ? <div className="pmp-none">没有已授权但未送达团队中枢的条目</div> : syncQueue.map((e) => {
                const badge = syncBadge(e);
                return (
                  <div className="pmp-item" key={e.id} data-testid={`pm-sync-${e.id}`}>
                    <div className="pmp-item-top">
                      <span className="pmp-src">{sourceText(e)}</span>
                      <span className={`pmp-badge ${badge.tone}`} title={badge.title} data-testid={`pm-sync-state-${e.id}`}>{badge.text}</span>
                      <span className="pmp-time mono">目标团队 {e.team_id ?? '未记录'}</span>
                    </div>
                    <div className="pmp-item-body">{e.content}</div>
                    {e.sync_error ? (
                      <div className="pmp-syncerr mono" data-testid={`pm-sync-err-${e.id}`}>
                        阶段 {e.sync_error.stage} · 错误码 {e.sync_error.code} · {e.sync_error.message}
                      </div>
                    ) : null}
                    <div className="pmp-item-actions">
                      <span className="pmp-meta">sha256 {e.sha256.slice(0, 8)} · 时钟 {Object.entries(e.vclock).map(([k, v]) => `${k}:${v}`).join(' ')}</span>
                      <button type="button" className="pmp-btn primary" disabled={busy === e.id} data-testid={`pm-retry-${e.id}`} onClick={() => void uplink(e, true)}>重试上行</button>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="pmp-sect" data-testid="pm-sect-quick">
              <h4>本机待确认 · 不会自动上行 <span className="pmp-sect-n">{pendingQuick.length}</span></h4>
              {pendingQuick.length === 0 ? <div className="pmp-none">没有本机快速记录待确认</div> : pendingQuick.map((e) => (
                <div className="pmp-item" key={e.id} data-testid={`pm-pending-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className="pmp-time mono">{fmtWhen(e.delivered_at)}</span>
                    {e.team_shared ? <span className="pmp-badge warn" data-testid={`pm-teamcopy-${e.id}`}>团队副本已存在（不回撤）</span> : null}
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <button type="button" className="pmp-btn primary" disabled={busy === e.id} data-testid={`pm-confirm-${e.id}`} onClick={() => act('confirm', e)}>是我的</button>
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-reject-${e.id}`} onClick={() => act('reject', e)}>不是我的</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pmp-sect" data-testid="pm-sect-agent">
              <h4>待 agent 确认 <span className="pmp-sect-n">{pendingAgent.length}</span></h4>
              {pendingAgent.length === 0 ? <div className="pmp-none">没有 agent 投递待确认条目</div> : pendingAgent.map((e) => (
                <div className="pmp-item" key={e.id} data-testid={`pm-pending-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className="pmp-time mono">{fmtWhen(e.delivered_at)}</span>
                    {e.team_shared ? <span className="pmp-badge warn" data-testid={`pm-teamcopy-${e.id}`}>团队副本已存在（不回撤）</span> : null}
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <button type="button" className="pmp-btn primary" disabled={busy === e.id} data-testid={`pm-confirm-${e.id}`} onClick={() => act('confirm', e)}>是我的</button>
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-reject-${e.id}`} onClick={() => act('reject', e)}>不是我的</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pmp-sect" data-testid="pm-sect-rejected">
              <h4>已剔除 · 可撤销 <span className="pmp-sect-n">{rejected.length}</span></h4>
              {rejected.length === 0 ? <div className="pmp-none">没有被剔除的条目</div> : rejected.map((e) => (
                <div className="pmp-item rejected" key={e.id} data-testid={`pm-rejected-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className="pmp-time mono">剔除于 {fmtWhen(e.rejected_at)}</span>
                    {e.team_shared ? <span className="pmp-badge warn" data-testid={`pm-teamcopy-${e.id}`}>团队副本已存在（不回撤）</span> : null}
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-revoke-${e.id}`} onClick={() => act('revoke', e)}>撤销剔除</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pmp-rules" data-testid="pm-rules">
              <h4>判定口径</h4>
              <ul>
                <li>只有「已确认」条目参与 agent 召回；待确认与已剔除不进召回。</li>
                <li>「不是我的」只把条目移出本机视图，不删账本；撤销后回到待确认。</li>
                <li>删除需二次确认，只写墓碑（记录保留），不复用记忆主表。</li>
                <li>个人确认只属于本人：默认仅本机+本人，确认不会自动提权为团队可见。</li>
                <li>上行团队必须在条目上二次确认（显式授权），走真实 PgSyncHub；失败如实显示阶段+错误码，不写「已同步」。</li>
                <li>取消确认 / 删除只影响本机账本，不回撤已写入的团队副本（本轮未实现撤回）。</li>
                <li>内容指纹 sha256 相同视为同一内容：重复上行不会在团队中枢产生重复条目。</li>
                <li>L0 原始密文不进收件箱：这里只处理已有可读内容（L1）。</li>
              </ul>
            </section>
          </div>
          <div className="pmp-foot" data-testid="pm-inbox-foot">
            待确认 {data?.counts.pending ?? 0} · 已剔除 {data?.counts.rejected ?? 0} · 本机待确认 {data?.counts.pending_quick ?? 0} · 待上行 {data?.counts.pending_sync ?? 0} · 同步失败 {data?.counts.sync_failed ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}
