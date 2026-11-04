// 安全页 · 按 L0 原文重建 L1–L6 卡（批次37-E）
// 用户口径：「删的只是 L1–L6 那份库，不用重新采集，直接从 L0 重新生成」。
// 与批次36 重判卡的分工：重判只看行上**已有的旧 L1**（读不到原文，也看不出原文本该被拦）；
// 本卡把每行拉回它的 L0 原文，重走写入管道：原文 →（当前质量门）→ 新 L1 →（勾选且有真引擎才）逐层 L2–L6
// → 重算 sha256 / 语义向量 / layer_specs / layers_generated_at / quality_gate_v。
// 原文只有两条来源：行上的历史明文，或经**管理员的 L0 查阅会话**解密——本卡不开新的解密口子：
// 密文行没解锁就整类判 view_locked，执行时主进程在**备份之前**就如实拒绝（§4.4.3，绝不猜正文）。
// 执行走主进程 IPC：仅管理员 + 逐字口令 REBUILD + 强制先备份双库与密钥环，备份失败一律拒绝改写；
// 取不到原文的行、pinned/locked 行一行都不碰——重建不是「顺手清理」。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { RebuildDecision, RebuildPreview, RebuildReport } from '../../core/memagent/rebuild.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
const CONFIRM_WORD = 'REBUILD';

function kv(by: Record<string, number>): string {
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} × ${n}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

function clip(s: string, n = 40): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function RebuildFromL0Card({ enabled }: { enabled: boolean }) {
  const [preview, setPreview] = useState<RebuildPreview | null>(null);
  const [report, setReport] = useState<RebuildReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [llmReady, setLlmReady] = useState(false);
  const [useLlm, setUseLlm] = useState(false);
  const [l0SessionId, setL0SessionId] = useState('');
  const [l0Pwd, setL0Pwd] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{
        ok: boolean; llm_ready?: boolean; preview?: RebuildPreview; error?: string;
      }>('l0:rebuildPreview', [{ l0_session_id: l0SessionId || undefined, use_llm: useLlm }, currentSessionId()]);
      if (res?.ok) {
        setPreview(res.preview ?? null);
        setLlmReady(res.llm_ready === true);
        setErr(null);
      } else setErr(res?.error ?? '预览失败（主进程未返回结果）');
    } catch (e) {
      setPreview(null);
      setErr(`预览失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [hostReady, l0SessionId, useLlm]);

  useEffect(() => {
    if (enabled && hostReady) void refresh();
  }, [enabled, hostReady, refresh]);

  const doUnlock = async () => {
    setBusy(true);
    try {
      const res = await hostCall<{ ok: boolean; l0_session_id?: string; error?: string }>(
        'l0:unlock', [{ password: l0Pwd }, currentSessionId()],
      );
      if (res?.ok && res.l0_session_id) {
        setL0SessionId(res.l0_session_id);
        setL0Pwd('');
        setErr(null);
      } else setErr(res?.error ?? '解锁失败（主进程未返回结果）');
    } catch (e) {
      setErr(`解锁失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doLock = async () => {
    setBusy(true);
    try {
      await hostCall<{ ok: boolean; error?: string }>('l0:lock', [l0SessionId, currentSessionId()]);
    } catch {
      /* 主进程按空闲自行回收：页面态照样清掉 */
    }
    setL0SessionId('');
    setBusy(false);
  };

  const doRun = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{
        ok: boolean; report?: RebuildReport; backup_dir?: string; error?: string;
      }>('l0:rebuildRun', [{
        confirm_text: confirmText.trim(),
        l0_session_id: l0SessionId || undefined,
        use_llm: useLlm,
      }, currentSessionId()]);
      if (res?.ok) {
        setReport(res.report ?? null);
        setBackup(res.backup_dir);
        setConfirmText('');
        setPreview(res.report ?? null);
      } else {
        setErr(res?.error ?? '重建失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`重建失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const willRebuild = preview?.rebuild ?? 0;
  const willPurge = preview?.purge ?? 0;
  const locked = preview?.by_unavailable.view_locked ?? 0;
  const canRun = enabled && hostReady && (willRebuild > 0 || willPurge > 0)
    && locked === 0
    && confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="card" data-testid="l0-rebuild-card">
      <div className="section-title">
        按 L0 重建 L1–L6（批次37-E：不重新采集，用已有原文把可检索层重炼一遍）
        {preview && <span className="dim"> · 质量门 v{preview.gate_version}</span>}
      </div>
      {!hostReady && (
        <div className="note" data-testid="l0-rebuild-unavailable">
          当前为浏览器环境，L0 原数据库与记忆库都由桌面主进程持有写锁，按 L0 重建需在桌面端执行。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="l0-rebuild-need-admin">需管理员账号才能执行重建（预览需会话，执行需管理员 + 双库备份；密文行还需 L0 查阅会话）。</div>
      )}
      {enabled && hostReady && (
        <>
          <div className="row">
            <button type="button" className="btn" data-testid="l0-rebuild-preview" disabled={busy} onClick={() => void refresh()}>
              重新预览
            </button>
            <span className="dim">只读：会按每行的 L0 原文判一轮（不改任何数据），所以确实<b>读到了原文</b>——只是不写盘</span>
          </div>
          <div className="row" data-testid="l0-rebuild-llm">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox" data-testid="l0-rebuild-use-llm" checked={useLlm} disabled={busy || !llmReady}
                onChange={(e) => setUseLlm(e.target.checked)}
              />
              同时用 LLM 重炼 L2–L6
            </label>
            <span className="dim" data-testid="l0-rebuild-llm-note">
              {llmReady
                ? '勾选后逐行 × 逐层真调引擎（本机 7B 单次精炼实测约 28s，上千行会跑很久）；每层仍过规格校验，判废即停该层并如实记 refine_failed'
                : '当前没有「已启用且可运行」的 LLM 引擎：本次只能重建到 L1（L2–L6 会被清空并记 refined_by=stub）。请到参数页配好引擎并「测试连通」后再勾'}
            </span>
          </div>
          <div className="row" data-testid="l0-rebuild-view">
            {l0SessionId ? (
              <>
                <span className="status active" data-testid="l0-rebuild-view-on">L0 查阅会话已解锁</span>
                <button type="button" className="btn danger" data-testid="l0-rebuild-view-lock" disabled={busy} onClick={() => void doLock()}>
                  立即锁上
                </button>
                <span className="dim">重建会在这一步把密文解成原文（只进判定，绝不进日志/审计/回执）；主进程 5 分钟空闲自动锁（§4.4.3）</span>
              </>
            ) : (
              <>
                <input
                  type="password" data-testid="l0-rebuild-view-pw" value={l0Pwd} placeholder="L0 管理密码"
                  onChange={(e) => setL0Pwd(e.target.value)} aria-label="L0 管理密码"
                />
                <button type="button" className="btn" data-testid="l0-rebuild-view-unlock" disabled={busy || !l0Pwd.trim()} onClick={() => void doUnlock()}>
                  解锁 L0 查阅会话
                </button>
                <span className="dim">库里若还有 L0 密文原文，不解锁这些行一律判 view_locked 并且一行不碰</span>
              </>
            )}
          </div>
          {preview && (
            <div className="note" data-testid="l0-rebuild-preview-report">
              库内 <b>{preview.total}</b> 条（墓碑 {preview.tombstones} · pinned/locked 受保护 <b>{preview.protected_total}</b> 条不碰）
              <div>
                按原文重炼 <b>{preview.rebuild}</b> 条
                （其中新 L1 与现有 L1 不同、正文真的会变 <b>{preview.rebuild_l1_changed}</b> 条）·
                按当前质量门原文就不该进库、应删 <b>{preview.purge}</b> 条
              </div>
              {!preview.llm_available && preview.rebuild_deep_cleared > 0 && (
                <div style={{ color: 'var(--warn)' }}>
                  本次不调 LLM：<b>{preview.rebuild_deep_cleared}</b> 行当前带着 L2–L6 正文，重建后会被清空（改回真实 L1、refined_by=stub）
                </div>
              )}
              {preview.purge > 0 && <div>拦截码分布：{kv(preview.by_code)} · 原层级 {kv(preview.by_layer)}</div>}
              {preview.unavailable > 0 && (
                <div>
                  取不到原文、本轮<b>一行都不碰</b> <b>{preview.unavailable}</b> 条：{kv(preview.by_unavailable)}
                  {locked > 0 && <span style={{ color: 'var(--err)' }}>（view_locked = 密文未解锁，解锁后重新预览即可）</span>}
                </div>
              )}
            </div>
          )}
          {preview && preview.sample.length > 0 && (
            <div className="note" data-testid="l0-rebuild-sample">
              样本（最多 20 条，只记 id / 处置 / 原因码 / 原文来源，正文一个字都不显示）：
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {preview.sample.slice(0, 8).map((s: RebuildDecision) => (
                  <li key={s.mem_id} className="dim">
                    <code>{s.mem_id}</code> [{s.action}{s.code ? ` · ${s.code}` : ''} · {s.layer} · 原文 {s.source}] {clip(s.reason ?? '')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview && willRebuild === 0 && willPurge === 0 && (
            <div className="note" data-testid="l0-rebuild-clean">
              按质量门 v{preview.gate_version} 与当前层级规格复核：没有需要重炼或删除的行。
              {preview.unavailable > 0 && '但仍有取不到原文的行——那些行本轮不碰，需先解锁 L0 查阅或从备份恢复。'}
            </div>
          )}
          {(willRebuild > 0 || willPurge > 0) && (
            <div className="row" data-testid="l0-rebuild-confirm">
              <span className="dim">
                {locked > 0
                  ? `有 ${locked} 行原文是 L0 密文：请先解锁 L0 查阅会话（主进程在备份之前就拒绝，绝不猜正文）`
                  : '覆盖不可逆：现有 L1–L6 正文会被新产物替换，执行前自动备份记忆库 + L0 原库 + 密钥环，备份失败一律拒绝改写；逐字输入 ' + CONFIRM_WORD + ' 才能点执行。'}
              </span>
              <input
                data-testid="l0-rebuild-word" value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`输入 ${CONFIRM_WORD}`} aria-label="按 L0 重建确认口令"
              />
              <button type="button" className="btn danger" data-testid="l0-rebuild-run" disabled={!canRun} onClick={() => void doRun()}>
                按 L0 重建（炼 {willRebuild} · 删 {willPurge}）
              </button>
            </div>
          )}
          {report && (
            <div className="note" data-testid="l0-rebuild-report">
              已重炼 <b>{report.rebuilt}</b> 条（正文变化 {report.rebuilt_l1_changed} · 新产出深层 {report.deep_generated} 层 ·
              真调 LLM {report.llm_calls} 次 · 判废/失败 {report.refine_failed} 条）·
              已删除 <b>{report.purged}</b> 条 · 未调 LLM 被清空 L2–L6 <b>{report.deep_cleared}</b> 条 ·
              受保护跳过 <b>{report.skipped_protected}</b> 条 · 取不到原文跳过 <b>{report.skipped_unavailable}</b> 条 ·
              写盘失败 <b>{report.failed}</b> 条
              {report.failed_ids.length > 0 && <div className="dim">失败行 id：<code>{report.failed_ids.join(' ')}</code>（单行失败不中断整轮）</div>}
              {backup && <div>备份：<code>{backup}</code></div>}
              <div className="dim">
                审计留痕：每改一行一条 memory_op / op=l0_rebuild_row、每删一行一条 memory_op / op=rebuild_purge（只记来源字段、产出层名与计数，
                绝不记 L0 原文与新正文），整轮一条 security_change / op=layers_rebuild（request_id 可在审计页回查）。
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="l0-rebuild-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        口径边界：本卡<b>只重炼已有行自己的正文</b>——不重新采集、不动采集游标、不新建行、不跨行嫁接；
        L0 原文的位置（行上明文或 <code>memories.l0.json</code>）一个字都不改。
        它和相邻三张卡的分工：<b>规则重判</b>只看旧 L1、不读原文；<b>L0 存量拆分</b>只搬原文位置、一行不删；
        <b>记忆库清空重采</b>才是整库推倒重来（动静最大，要 L0 写密钥）。
        判定口径与写入管道同源（同一 <code>checkL0ToL1Quality</code> + 层级规格），所以重建后「新规则」才真正落到正文上。
        红线：被覆盖的旧 L1–L6 只能从回执里的备份目录恢复；取不到原文与受保护的行一律不碰，宁可留着也不凭空删。
      </div>
    </div>
  );
}
