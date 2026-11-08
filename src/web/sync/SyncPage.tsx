// 同步与裁决页（批次42-C）：「立即同步」（真实 push/pull 报告）+ 中枢对账 + §9.7 人工裁决队列
// + 通道与游标（真实 PgSyncHub 状态）+ L0 排除。
// 数据真相 = 内核引擎 + 主进程中枢；失败（含权限 401/403）如实展示错误码与原因，绝不显示「已同步」。
import { useCallback, useEffect, useState } from 'react';
import {
  hubOverview, listSyncConflicts, resolveConflict, runSync, syncChannels,
  type HubOverviewView, type SyncChannelsView, type SyncRunView,
} from './coreSyncPage.ts';
import type { SyncConflict } from '../../core/memagent/sync.ts';

const clip = (s: string | undefined, n = 80): string =>
  s && s.length > n ? `${s.slice(0, n)}…` : (s ?? '');

function errText(e: unknown): string {
  const o = e as { code?: string; message?: string };
  const msg = String(o?.message ?? e).replace(/^\[[A-Z0-9_]+\]\s*/, '');
  return `${o?.code ? `[${o.code}] ` : ''}${msg}`;
}

const fmtTime = (ts: number | null): string =>
  ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '未取数';

const CH_STATUS: Record<string, { text: string; color: string }> = {
  ok: { text: '正常', color: 'var(--ok,#3ddc84)' },
  warn: { text: '待处理', color: 'var(--warn,#ffb84d)' },
  fail: { text: '失败', color: 'var(--danger,#ff5d5d)' },
  idle: { text: '未运行', color: 'var(--muted,#a9b6c4)' },
  info: { text: '规则', color: 'var(--info,#7aa2ff)' },
};

export function SyncPage() {
  const [tab, setTab] = useState(0);
  const [run, setRun] = useState<SyncRunView | null>(null);
  const [overview, setOverview] = useState<HubOverviewView | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[] | null>(null);
  const [conflictErr, setConflictErr] = useState('');
  const [channels, setChannels] = useState<SyncChannelsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ov = await hubOverview().catch((e) => ({
      ok: false, mirror_rows: 0, losers: 0, integrity_issues: [], team_id: '-',
      local_memories: null, local_audits: null, error: errText(e),
    }));
    let cf: SyncConflict[] = [];
    let cErr = '';
    try {
      cf = await listSyncConflicts();
    } catch (e) {
      cErr = errText(e);
    }
    setOverview(ov);
    setConflicts(cf);
    setConflictErr(cErr);
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      setChannels(await syncChannels());
    } catch (e) {
      setToast({ kind: 'err', text: `通道状态读取失败：${errText(e)}` });
    }
  }, []);

  useEffect(() => { void refresh(); void loadChannels(); }, [refresh, loadChannels]);

  async function handleSync() {
    setBusy(true);
    setToast(null);
    try {
      const r = await runSync();
      setRun(r);
      if (!r.ok) {
        // 失败如实：错误码 + 阶段 + 原因；绝不显示「已同步」
        const phase = r.phase === 'push' ? '上行未完成（未进入下行）' : '上行已返回，下行失败';
        setToast({ kind: 'err', text: `同步失败 [${r.code ?? 'E_SYNC_FAILED'}]：${phase} · ${r.error ?? '未知错误'}` });
      } else {
        setToast({ kind: 'ok', text: `同步完成：上行 push ${r.pushed}，下行 pull ${r.pulled}，冲突 ${r.conflicts}（真实回执）` });
      }
      await Promise.all([refresh(), loadChannels()]);
    } catch (e) {
      setToast({ kind: 'err', text: `同步失败：${errText(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(conflictId: string, winner: 'local' | 'remote') {
    setResolving(conflictId);
    setToast(null);
    try {
      await resolveConflict(conflictId, winner);
      setToast({ kind: 'ok', text: `已裁决 ${conflictId}：保留${winner === 'local' ? '本端' : '镜像'}（conflict_resolve 审计已落中枢）` });
      await refresh();
    } catch (e) {
      setToast({ kind: 'err', text: `裁决失败：${errText(e)}` });
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="p0-page" data-testid="sync-page">
      <div className="p0-hd">
        <h2>🔄 同步与裁决</h2>
        <span className="p0-tag">批次42-C · §9.7</span>
        <span className="p0-tag info">真实中枢 PgSyncHub</span>
      </div>
      <div className="sub">
        上行（sha256 幂等 + 自动 LWW）→ 下行（since 增量）；通道/游标直读本机中枢；失败时如实显示错误码与原因，绝不谎报成功。
      </div>

      <div className="p0-tabs" role="tablist" data-testid="sync-tabs">
        {['同步与对账', '冲突裁决', '通道与游标', 'L0 排除'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`sync-tab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}{i === 1 && conflicts !== null && !conflictErr ? ` ${conflicts.length}` : ''}</button>
        ))}
      </div>

      {/* ── 1. 同步与对账 ── */}
      <div hidden={tab !== 0}>
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>同步与对账</h3>
            <span className="p0-tag">立即同步 · 真实 push/pull</span>
          </div>
          <div className="card">
            <b>立即同步</b>
            <div className="note">上行与下行都走内核 agent.sync；报告数字直接来自真实回执。L0 密文行不参与上行（引擎红线）。</div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn" id="btnSyncNow" data-testid="btnSyncNow" type="button" disabled={busy} onClick={handleSync}>
                {busy ? '同步中…' : '立即同步'}
              </button>
              <button className="btn" type="button" onClick={() => void loadChannels()}>检查节点</button>
            </div>
            {run && (
              <div id="syncReport" className="report" data-testid="sync-report">
                {!run.ok && (
                  <div className="p0-banner err" data-testid="sync-error">
                    [{run.code ?? 'E_SYNC_FAILED'}] {run.phase === 'push'
                      ? '上行未完成（未进入下行）'
                      : '上行已返回，下行失败'} · {run.error}
                  </div>
                )}
                <div>
                  上行 pushed：<b data-testid="pushed">{run.pushed}</b>
                  {!run.ok && run.phase === 'push' ? '（未完成，非成功计数）' : `（LWW 胜 ${run.lww} / 幂等跳过 ${run.dedup} / 中枢更新 ${run.behind}）`}
                </div>
                <div>下行 pulled：<b data-testid="pulled">{run.ok ? run.pulled : '未取数'}</b>（新游标 {run.ok ? (run.cursor ?? '-') : '未取得'}）</div>
                <div>语义互斥冲突：<b data-testid="conflicts">{run.ok ? run.conflicts : '未取数'}</b>；L0 红线跳过：<b data-testid="l0skipped">{run.l0_skipped ?? '未取数'}</b></div>
              </div>
            )}
          </div>

          <div className="card">
            <b>中枢对账视图（team {overview?.team_id ?? '-'}）</b>
            {overview && !overview.error && (
              <div id="hubOverview" className="report" data-testid="hub-overview">
                <table className="ltable" data-testid="recon-table">
                  <thead>
                    <tr><th style={{ textAlign: 'left' }}>对象</th><th>本端（内核账本）</th><th>中枢镜像</th><th>差异</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ textAlign: 'left' }}>记忆行</td>
                      <td data-testid="localMemories">{overview.local_memories ?? '不可读'}</td>
                      <td data-testid="mirrorRows">{overview.mirror_rows}</td>
                      <td>{overview.local_memories != null ? overview.mirror_rows - overview.local_memories : '未取数'}</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'left' }}>审计条目</td>
                      <td data-testid="localAudits">{overview.local_audits ?? '不可读'}</td>
                      <td>—（中枢仅有引擎同步审计）</td>
                      <td>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'left' }}>败者留档（9.7 archived）</td>
                      <td>—</td>
                      <td data-testid="losers">{overview.losers}</td>
                      <td>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'left' }}>待裁决冲突</td>
                      <td>—</td>
                      <td>—</td>
                      <td>{conflicts?.length ?? '读取中'}</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'left' }}>指纹异常（需人工核查）</td>
                      <td>—</td>
                      <td>—</td>
                      <td data-testid="integrity">{overview.integrity_issues.length}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="note">
                  差异 = 中枢镜像 − 本端账本（团队镜像可能含其他端的行）。
                  {overview.integrity_issues.length > 0 && `（指纹异常 ids：${overview.integrity_issues.join(', ')}）`}
                </div>
              </div>
            )}
            {overview?.error && <div className="p0-banner err">中枢不可用：{overview.error}</div>}
          </div>
        </div>
      </div>

      {/* ── 2. 冲突裁决 ── */}
      <div hidden={tab !== 1}>
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>§9.7 冲突裁决队列</h3>
            <span className="p0-tag">{conflictErr ? '读取失败' : `${conflicts?.length ?? '未取数'} 条待裁决`}</span>
          </div>
          <div className="card">
            <b>冲突列表（真实中枢队列）</b>
            <div className="note">
              程序仅提供「保留本端 / 保留镜像」两种裁决（内核 resolve 只接受 local | remote）；
              定稿里的「镜像合并 / 暂缓」程序无该接口，故不提供。裁决成功落 conflict_resolve 审计。
            </div>
            {conflictErr && <div className="p0-banner err" data-testid="conflict-error">裁决队列读取失败：{conflictErr}</div>}
            {conflicts !== null && !conflictErr && conflicts.length === 0 && (
              <p className="dim" id="noConflicts" data-testid="noConflicts">当前无待裁决冲突（自动 LWW 已处理全部语义并发）。</p>
            )}
            {conflicts !== null && !conflictErr && conflicts.length > 0 && (
              <table className="ltable" id="conflictTable">
                <thead>
                  <tr><th>conflict_id</th><th>mem_id</th><th>本端版本</th><th>镜像版本</th><th>裁决</th></tr>
                </thead>
                <tbody>
                  {conflicts.map((c) => (
                    <tr key={c.conflict_id} data-testid={`conflict-${c.conflict_id}`}>
                      <td className="dim">{clip(c.conflict_id, 20)}</td>
                      <td className="dim">{clip(c.mem_id, 16)}</td>
                      <td>{clip(c.local?.content)}</td>
                      <td>{clip(c.remote?.content)}</td>
                      <td>
                        <button className="btn" type="button" disabled={resolving === c.conflict_id}
                          onClick={() => handleResolve(c.conflict_id, 'local')}>保留本端</button>
                        <button className="btn" type="button" disabled={resolving === c.conflict_id}
                          onClick={() => handleResolve(c.conflict_id, 'remote')}>保留镜像</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. 通道与游标 ── */}
      <div hidden={tab !== 2} data-testid="sync-channels">
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>通道与游标</h3>
            <span className="p0-tag">直读本机中枢</span>
          </div>
          <div className="card">
            <b>节点（真实 hub 状态）</b>
            {channels ? (
              <>
                <div className="note">
                  {channels.node.name}：
                  <span style={{ color: channels.node.status === 'ok' ? 'var(--ok,#3ddc84)' : 'var(--danger,#ff5d5d)', fontWeight: 700 }}>
                    {channels.node.status === 'ok' ? '连通' : '不可达'}
                  </span>
                  {' '}· {channels.node.detail}
                </div>
                {!channels.ok && channels.code && (
                  <div className="p0-banner err" data-testid="channel-error">[{channels.code}] {channels.error}</div>
                )}
                <table className="ltable" data-testid="channel-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>通道</th><th>方向</th><th>游标</th><th>最近动作</th>
                      <th>最近时间</th><th>状态</th><th style={{ textAlign: 'left' }}>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.channels.map((c) => (
                      <tr key={c.channel} data-testid={`channel-${c.direction}-${c.channel}`}>
                        <td style={{ textAlign: 'left' }}>{c.channel}</td>
                        <td>{c.direction}</td>
                        <td>{c.cursor ?? '未取数'}</td>
                        <td>{c.last_action ?? '未取数'}</td>
                        <td>{fmtTime(c.last_at)}</td>
                        <td style={{ color: CH_STATUS[c.status]?.color, fontWeight: 700 }}>{CH_STATUS[c.status]?.text ?? c.status}</td>
                        <td style={{ textAlign: 'left' }}>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn" type="button" onClick={() => void loadChannels()}>刷新通道状态</button>
                </div>
              </>
            ) : <div className="note">读取真实中枢通道状态中…</div>}
          </div>
        </div>
      </div>

      {/* ── 4. L0 排除 ── */}
      <div hidden={tab !== 3}>
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>L0 排除</h3>
            <span className="p0-tag">42-A 红线 · 程序事实</span>
          </div>
          <div className="card">
            <b>L0 密文层同步规则（内核执行，非页面约定）</b>
            <ul className="note" style={{ paddingLeft: 18 }}>
              <li>L0 密文行（has_l0 / content_l0_enc）不参与上行，引擎逐条计数 l0_skipped，绝不静默丢弃。</li>
              <li>L0 不参与下游检索与镜像对账；中枢镜像不含 L0 内容。</li>
              <li>L0 驳回写入的回执只给密文哈希，不回显明文。</li>
              <li>未解锁会话不展示 L0 条数（页面不提供查看接口）——程序无该接口（未解锁查看）。</li>
            </ul>
            <div className="note" data-testid="l0-run-fact">
              {run?.ok
                ? `最近一次真实同步：L0 红线跳过 ${run.l0_skipped ?? 0} 行（来自上行真实回执）。`
                : '尚未运行同步 → L0 跳过行数未测量（不显示 0 充当读数）。'}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className={toast.kind === 'ok' ? 'toast ok' : 'toast err'} id="syncToast" data-testid="syncToast">
          {toast.text}
        </div>
      )}
    </div>
  );
}
