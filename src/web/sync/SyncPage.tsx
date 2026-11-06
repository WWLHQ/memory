// 同步与裁决页（批次42-C）：「立即同步」（真实报告）+ 中枢对账视图 + §9.7 人工裁决队列。
// 数据真相 = 内核引擎 + 主进程中枢；裁决失败（含权限 401/403）如实展示，绝不静默。
import { useCallback, useEffect, useState } from 'react';
import {
  hubOverview, listSyncConflicts, resolveConflict, runSync,
  type HubOverviewView, type SyncRunView,
} from './coreSyncPage.ts';
import type { SyncConflict } from '../../core/memagent/sync.ts';

const clip = (s: string | undefined, n = 80): string =>
  s && s.length > n ? `${s.slice(0, n)}…` : (s ?? '');

export function SyncPage() {
  const [run, setRun] = useState<SyncRunView | null>(null);
  const [overview, setOverview] = useState<HubOverviewView | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [ov, cf] = await Promise.all([
      hubOverview().catch((e) => ({ ok: false, mirror_rows: 0, losers: 0, integrity_issues: [], team_id: '-', error: String((e as Error)?.message ?? e) })),
      listSyncConflicts().catch((e) => { setToast({ kind: 'err', text: `裁决队列读取失败：${String((e as Error)?.message ?? e)}` }); return []; }),
    ]);
    setOverview(ov);
    setConflicts(cf);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleSync() {
    setBusy(true);
    setToast(null);
    try {
      const r = await runSync();
      setRun(r);
      if (!r.ok) setToast({ kind: 'err', text: `同步失败：${r.error ?? '未知错误'}` });
      else setToast({ kind: 'ok', text: `同步完成：上行 ${r.pushed}，下行 ${r.pulled}，冲突 ${r.conflicts}` });
      await refresh();
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
      setToast({ kind: 'err', text: `裁决失败：${String((e as Error)?.message ?? e)}` });
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="wrap">
      <h1>同步与裁决 <span className="dim">（批次42-C · §9.7）</span></h1>

      <div className="card">
        <h2>立即同步</h2>
        <p className="dim">上行（sha256 幂等 + 自动 LWW）→ 下行（since 增量）。L0 密文行不参与上行（引擎红线）。</p>
        <button className="btn" id="btnSyncNow" data-testid="btnSyncNow" type="button" disabled={busy} onClick={handleSync}>
          {busy ? '同步中…' : '立即同步'}
        </button>
        {run && (
          <div id="syncReport" className="report">
            {!run.ok && <div className="err">同步失败：{run.error}</div>}
            <div>上行 pushed：<b data-testid="pushed">{run.pushed}</b>（LWW 胜 {run.lww} / 幂等跳过 {run.dedup} / 中枢更新 {run.behind}）</div>
            <div>下行 pulled：<b data-testid="pulled">{run.pulled}</b>（新游标 {run.cursor ?? '-'}）</div>
            <div>语义互斥冲突：<b data-testid="conflicts">{run.conflicts}</b>；L0 红线跳过：<b data-testid="l0skipped">{run.l0_skipped}</b></div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>中枢对账视图（team {overview?.team_id ?? '-'}）</h2>
        {overview && !overview.error && (
          <div id="hubOverview" className="report">
            <div>中枢镜像行数：<b data-testid="mirrorRows">{overview.mirror_rows}</b></div>
            <div>败者留档（9.7 archived）：<b data-testid="losers">{overview.losers}</b></div>
            <div>
              指纹异常（需人工核查，不静默覆盖）：<b data-testid="integrity">{overview.integrity_issues.length}</b>
              {overview.integrity_issues.length > 0 && <span className="dim">（{overview.integrity_issues.join(', ')}）</span>}
            </div>
          </div>
        )}
        {overview?.error && <div className="err">中枢不可用：{overview.error}</div>}
      </div>

      <div className="card">
        <h2>§9.7 冲突裁决队列 {conflicts !== null && <span className="dim">（{conflicts.length} 条待裁决）</span>}</h2>
        {conflicts !== null && conflicts.length === 0 && <p className="dim" id="noConflicts" data-testid="noConflicts">当前无待裁决冲突（自动 LWW 已处理全部语义并发）。</p>}
        {conflicts !== null && conflicts.length > 0 && (
          <table className="tbl" id="conflictTable">
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

      {toast && (
        <div className={toast.kind === 'ok' ? 'toast ok' : 'toast err'} id="syncToast" data-testid="syncToast">
          {toast.text}
        </div>
      )}
    </div>
  );
}
