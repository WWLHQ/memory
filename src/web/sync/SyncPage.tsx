// 同步与裁决页（批次42-C）：「立即同步」（真实 push/pull 报告）+ 中枢对账 + §9.7 人工裁决队列
// + 通道与游标（真实 PgSyncHub 状态）+ L0 排除。
// 数据真相 = 内核引擎 + 主进程中枢；失败（含权限 401/403）如实展示错误码与原因，绝不显示「已同步」。
// 批次53-R：版式按用户截图重做为密集表格流（对齐冲突裁决页），数据逻辑与全部 testid 零改动。
// 批次63：对齐设计稿 pg-sync——页头 implemented 徽标、同步/对账双列 af-g2、pushed/pulled stat 卡、
// §9.7 面板头「去冲突裁决 →」链接、底部「形态」说明条；通道与游标 / L0 排除两分区原样保留。
import { useCallback, useEffect, useState } from 'react';
import { useHostTheme } from '../shared/hostTheme.ts';
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

const CH_STATUS: Record<string, { text: string; cls: string }> = {
  ok: { text: '正常', cls: 'ok' },
  warn: { text: '待处理', cls: 'warn' },
  fail: { text: '失败', cls: 'bad' },
  idle: { text: '未运行', cls: '' },
  info: { text: '规则', cls: 'acc' },
};

export function SyncPage() {
  useHostTheme();
  // 批次54：去掉页签，四个分区直接堆叠（与冲突裁决页同一版式语言）；全部 testid 与数据逻辑零改动。
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
    <div className="sy-page" data-testid="sync-page">
      <div className="sy-scroll"><div className="sy-main"><div className="af-stack">
        <div className="af-head">
          <h1>同步中枢</h1>
          <span className="sub">sync-hub/ · 单机 pglite 进程内 Postgres · 衍生可重建数据，不进备份四源</span>
          <span className="af-badge ok">implemented: true</span>
        </div>

        {/* ── 1. 同步与对账（设计稿 pg-sync：双列 af-g2，窄屏回落单列） ── */}
        <div className="af-g2 sy-pair" data-testid="sync-pair">
          <section className="af-panel">
            <div className="af-ph">
              <h3>立即同步</h3>
              <span className="hint">上行 sha256 幂等 + LWW · 下行 since 增量</span>
            </div>
            <div className="af-pb af-stack" style={{ gap: 10 }}>
              <div className="af-row">
                <span className="af-badge bad">红线</span>
                <span className="af-note">L0 密文行不上行（l0_skipped）· 向量时钟保证不丢不重</span>
              </div>
              <div className="af-g2">
                <div className="sy-stat">
                  <div className="k">上行 pushed</div>
                  <div className="v" data-testid="pushed">{run ? String(run.pushed) : '未取数'}</div>
                  <div className="d">
                    {run == null
                      ? '尚未运行同步（不显示 0 充当读数）'
                      : run.ok
                        ? `跳过 L0 密文 ${run.l0_skipped ?? 0}`
                        : run.phase === 'push' ? '上行未完成 · 非成功计数' : '下行失败 · 上行计数仍真实'}
                  </div>
                </div>
                <div className="sy-stat">
                  <div className="k">下行 pulled</div>
                  <div className="v" data-testid="pulled">{run ? (run.ok ? String(run.pulled) : '未取数') : '未取数'}</div>
                  <div className="d">{run?.ok ? 'since 增量 · sha256 去重' : '尚未取得下行读数'}</div>
                </div>
              </div>
              <div className="sy-actions" data-testid="sync-actions">
                <button className="btn primary" id="btnSyncNow" data-testid="btnSyncNow" type="button" disabled={busy} onClick={handleSync}>
                  {busy ? '同步中…' : '立即同步'}
                </button>
                <button className="btn" type="button" onClick={() => void loadChannels()}>检查节点</button>
              </div>
              <span className="af-note sy-actions-note">req 链路可查 · 每日全量对账只补缺不覆盖 · 失败如实报错</span>
              {run && (
                <div id="syncReport" className="report" data-testid="sync-report">
                  {!run.ok && (
                    <div className="banner err" data-testid="sync-error">
                      [{run.code ?? 'E_SYNC_FAILED'}] {run.phase === 'push'
                        ? '上行未完成（未进入下行）'
                        : '上行已返回，下行失败'} · {run.error}
                    </div>
                  )}
                  <div>
                    上行明细：LWW 胜 <b>{run.lww ?? 0}</b> / 幂等跳过 <b>{run.dedup ?? 0}</b> / 中枢更新 <b>{run.behind ?? 0}</b>
                    {!run.ok && run.phase === 'push' ? '（未完成，非成功计数）' : ''}
                  </div>
                  <div>下行明细：新游标 {run.ok ? (run.cursor ?? '-') : '未取得'}</div>
                  <div>语义互斥冲突：<b data-testid="conflicts">{run.ok ? run.conflicts : '未取数'}</b>；L0 红线跳过：<b data-testid="l0skipped">{run.l0_skipped ?? '未取数'}</b></div>
                </div>
              )}
            </div>
          </section>

          <section className="af-panel">
            <div className="af-ph">
              <h3>中枢对账 · team {overview?.team_id ?? '-'}</h3>
              <span className="hint">差异 = 中枢镜像 − 本端账本（团队镜像可能含其他端的行）</span>
            </div>
            <div className="af-pb">
              {overview && !overview.error && (
                <div id="hubOverview" className="report" data-testid="hub-overview">
                  <table className="ltable" data-testid="recon-table">
                    <thead>
                      <tr><th className="left">对象</th><th>本端（内核账本）</th><th>中枢镜像</th><th>差异</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="left">记忆行</td>
                        <td data-testid="localMemories">{overview.local_memories ?? '不可读'}</td>
                        <td data-testid="mirrorRows">{overview.mirror_rows}</td>
                        <td>{overview.local_memories != null ? overview.mirror_rows - overview.local_memories : '未取数'}</td>
                      </tr>
                      <tr>
                        <td className="left">审计条目</td>
                        <td data-testid="localAudits">{overview.local_audits ?? '不可读'}</td>
                        <td>—（中枢仅有引擎同步审计）</td>
                        <td>—</td>
                      </tr>
                      <tr>
                        <td className="left">败者留档（9.7 archived）</td>
                        <td>—</td>
                        <td data-testid="losers">{overview.losers}</td>
                        <td>—</td>
                      </tr>
                      <tr>
                        <td className="left">待裁决冲突</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{conflicts?.length ?? '读取中'}</td>
                      </tr>
                      <tr>
                        <td className="left">指纹异常（需人工核查）</td>
                        <td>—</td>
                        <td>—</td>
                        <td data-testid="integrity">{overview.integrity_issues.length}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="note">
                    {overview.integrity_issues.length > 0 && `指纹异常 ids：${overview.integrity_issues.join(', ')}`}
                  </div>
                </div>
              )}
              {overview?.error && <div className="banner err">中枢不可用：{overview.error}</div>}
            </div>
          </section>
        </div>

        {/* ── 2. 冲突裁决 ── */}
        <div className="af-stack">
          <section className="af-panel">
            <div className="af-ph">
              <h3>§9.7 冲突裁决队列</h3>
              <span className="hint">{conflictErr ? '读取失败' : `${conflicts?.length ?? '未取数'} 条待裁决 · 程序仅提供 保留本端 / 保留镜像（内核 resolve 只接受 local | remote）`}</span>
              <a className="sy-link" href="../dispute.html" data-testid="goto-dispute">去冲突裁决 →</a>
            </div>
            <div className="af-pb">
              {conflictErr && <div className="banner err" data-testid="conflict-error">裁决队列读取失败：{conflictErr}</div>}
              {conflicts !== null && !conflictErr && conflicts.length === 0 && (
                <p className="dim" id="noConflicts" data-testid="noConflicts">当前无待裁决冲突（自动 LWW 已处理全部语义并发）。</p>
              )}
              {conflicts !== null && !conflictErr && conflicts.length > 0 && (
                <table className="ltable" id="conflictTable">
                  <thead>
                    <tr><th className="left">conflict_id</th><th className="left">mem_id</th><th className="left">本端版本</th><th className="left">镜像版本</th><th>裁决</th></tr>
                  </thead>
                  <tbody>
                    {conflicts.map((c) => (
                      <tr key={c.conflict_id} data-testid={`conflict-${c.conflict_id}`}>
                        <td className="left mid">{clip(c.conflict_id, 20)}</td>
                        <td className="left mid">{clip(c.mem_id, 16)}</td>
                        <td className="left">{clip(c.local?.content)}</td>
                        <td className="left">{clip(c.remote?.content)}</td>
                        <td>
                          <button className="chip-btn" type="button" disabled={resolving === c.conflict_id}
                            onClick={() => handleResolve(c.conflict_id, 'local')}>保留本端</button>
                          <button className="chip-btn" type="button" disabled={resolving === c.conflict_id}
                            onClick={() => handleResolve(c.conflict_id, 'remote')}>保留镜像</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {/* ── 3. 通道与游标 ── */}
        <div className="af-stack" data-testid="sync-channels">
          <section className="af-panel">
            <div className="af-ph">
              <h3>通道与游标</h3>
              <span className="hint">直读本机中枢（真实 hub 状态）</span>
            </div>
            <div className="af-pb">
              {channels ? (
                <>
                  <div className="note">
                    {channels.node.name}：
                    <i className={`chip ${channels.node.status === 'ok' ? 'ok' : 'bad'}`}>
                      {channels.node.status === 'ok' ? '连通' : '不可达'}
                    </i>
                    {' '}· {channels.node.detail}
                  </div>
                  {!channels.ok && channels.code && (
                    <div className="banner err" data-testid="channel-error">[{channels.code}] {channels.error}</div>
                  )}
                  <table className="ltable" data-testid="channel-table">
                    <thead>
                      <tr>
                        <th className="left">通道</th><th>方向</th><th>游标</th><th>最近动作</th>
                        <th>最近时间</th><th>状态</th><th className="left">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channels.channels.map((c) => (
                        <tr key={c.channel} data-testid={`channel-${c.direction}-${c.channel}`}>
                          <td className="left">{c.channel}</td>
                          <td>{c.direction}</td>
                          <td>{c.cursor ?? '未取数'}</td>
                          <td>{c.last_action ?? '未取数'}</td>
                          <td>{fmtTime(c.last_at)}</td>
                          <td><i className={`chip ${CH_STATUS[c.status]?.cls ?? ''}`}>{CH_STATUS[c.status]?.text ?? c.status}</i></td>
                          <td className="left">{c.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="sy-actions">
                    <button className="btn" type="button" onClick={() => void loadChannels()}>刷新通道状态</button>
                  </div>
                </>
              ) : <div className="note">读取真实中枢通道状态中…</div>}
            </div>
          </section>
        </div>

        {/* ── 4. L0 排除 ── */}
        <div className="af-stack">
          <section className="af-panel">
            <div className="af-ph">
              <h3>L0 排除</h3>
              <span className="hint">42-A 红线 · 程序事实（内核执行，非页面约定）</span>
            </div>
            <div className="af-pb">
              <ul className="note sy-list">
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
          </section>
        </div>

        {/* ── 5. 形态说明（设计稿 pg-sync 底部 af-alert） ── */}
        <div className="sy-alert">
          <span className="tag">形态</span>
          <span>sync-hub 是衍生可重建数据 · 真源在各端本地账本 · 丢失恢复 = 任一端 syncUp 全量上行（sha256 幂等 + 向量时钟不丢不重）</span>
        </div>
      </div></div></div>

      {toast && (
        <div className={toast.kind === 'ok' ? 'toast ok' : 'toast err'} id="syncToast" data-testid="syncToast">
          {toast.text}
        </div>
      )}
    </div>
  );
}
