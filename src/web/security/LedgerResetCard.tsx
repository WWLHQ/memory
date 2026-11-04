// 安全页 · 记忆库清空重采卡（批次35）
// 用户拍板「库内内容全部删除、按新入库规则重新拉取」：质量门收紧只能挡住以后的写入，
// 救不回旧采集口径（助手消息照采）灌进来的噪声行，所以这里提供整库清空 + 采集游标归零 + 立即追采。
// 执行走主进程 IPC：仅管理员 + 逐字确认口令 + 强制先备份数据根（含 collector-cursor.json），
// 备份失败一律拒绝清空；结果落 security_change/op=ledger_purge 审计 + llm 之外的 kernel 动作日志。
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { LedgerPurgeReport, LedgerResetPreview } from '../../core/memagent/ledgerReset.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

const CONFIRM_WORD = 'RESET';

function kv(by: Record<string, number>): string {
  const parts = Object.entries(by).sort().map(([k, n]) => `${k} × ${n}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

interface CollectorStatus {
  ok: boolean;
  running?: boolean;
  last?: { collected: number; deduped: number; roleSkipped: number; ts: number } | null;
  apply?: { written: number; filtered: number; failed: number; ts: number } | null;
  recollecting?: boolean;
  error?: string;
}

export function LedgerResetCard({ enabled }: { enabled: boolean }) {
  const [preview, setPreview] = useState<LedgerResetPreview | null>(null);
  const [collector, setCollector] = useState<{ sourceCount: number; recollecting: boolean; maxPerRound: number } | null>(null);
  const [report, setReport] = useState<LedgerPurgeReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [cursorReset, setCursorReset] = useState<boolean | undefined>(undefined);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<CollectorStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{
        ok: boolean; preview?: LedgerResetPreview; error?: string;
        collector?: { sourceCount: number; recollecting: boolean; maxPerRound: number };
      }>('ledger:resetPreview', [currentSessionId()]);
      if (res?.ok) { setPreview(res.preview ?? null); setCollector(res.collector ?? null); setErr(null); }
      else setErr(res?.error ?? '预览失败（主进程未返回结果）');
    } catch (e) {
      setPreview(null);
      setErr(`预览失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [hostReady]);

  useEffect(() => {
    if (enabled && hostReady) void refresh();
  }, [enabled, hostReady, refresh]);

  // 追采是后台循环（单轮 50 条上限），清空后每 2s 拉一次采集状态，直到本轮不再采到新消息
  const watching = !!status?.recollecting || (status?.last?.collected ?? 0) > 0;
  useEffect(() => {
    if (!hostReady || !report || !watching) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const tick = async () => {
      try {
        const res = await hostCall<CollectorStatus>('collector:status', []);
        if (res?.ok) setStatus(res);
      } catch {
        // 状态拉取失败不打断清库回执展示，下次 tick 继续
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [hostReady, report, watching]);

  const doReset = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{
        ok: boolean; report?: LedgerPurgeReport; backup_dir?: string;
        cursor_reset?: boolean; cursor_error?: string; error?: string;
      }>('ledger:resetRecollect', [confirmText.trim(), currentSessionId()]);
      if (res?.ok) {
        setReport(res.report ?? null);
        setBackup(res.backup_dir);
        setCursorReset(res.cursor_reset);
        setPreview({ total: 0, by_layer: {}, by_source: {}, with_l0_cipher: 0, llm_refined: 0, tombstones: 0, sample_ids: [] });
        setConfirmText('');
        setStatus({ ok: true, recollecting: true });
      } else {
        setErr(res?.error ?? '清空失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`清空失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const total = preview?.total ?? 0;
  const canRun = enabled && hostReady && total > 0 && confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="card" data-testid="ledger-reset-card">
      <div className="section-title">记忆库清空重采（批次35：无意义内容禁止入库后，历史噪声只能整库重来）</div>
      {!hostReady && (
        <div className="note" data-testid="ledger-reset-unavailable">
          当前为浏览器环境，记忆库由桌面主进程持有写锁，清空与重采需在桌面端执行。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="ledger-reset-need-admin">需管理员账号才能执行清空（预览与执行都在主进程校验）。</div>
      )}
      {enabled && hostReady && (
        <>
          <div className="row">
            <button type="button" className="btn" data-testid="ledger-reset-preview" disabled={busy} onClick={() => void refresh()}>
              重新预览
            </button>
            <span className="dim">只读统计当前库内容，不改动任何数据</span>
            {collector && (
              <span className="dim">采集源 {collector.sourceCount} 个 · 单轮上限 {collector.maxPerRound} 条</span>
            )}
          </div>
          {preview && (
            <div className="note" data-testid="ledger-reset-preview-report">
              当前库内 <b>{preview.total}</b> 条（含墓碑 {preview.tombstones}）· 层级 {kv(preview.by_layer)} ·
              来源 {kv(preview.by_source)}
              {preview.with_l0_cipher > 0 && <> · 其中 <b>{preview.with_l0_cipher}</b> 条带 L0 密文原文</>}
              {preview.llm_refined > 0 && <> · <b>{preview.llm_refined}</b> 条是真实 LLM 精炼产物（删了不会自动重生成）</>}
            </div>
          )}
          {preview && preview.with_l0_cipher > 0 && (
            <div className="note" style={{ color: 'var(--err)' }} data-testid="ledger-reset-l0-warn">
              这 <b>{preview.with_l0_cipher}</b> 条带 L0 原文的行删掉后，其 L0 密文会<b>同步销毁</b>，且<b>不能</b>用「按 L0 重建」找回
              （重建只救整库丢失，救不回逐行删掉的原文）——唯一退路是执行前生成的备份目录。
            </div>
          )}
          {preview && total === 0 && (
            <div className="note" data-testid="ledger-reset-empty">库内已无记忆行；如需重采，点下方「采集状态」里的立即采集即可。</div>
          )}
          {total > 0 && (
            <div className="row" data-testid="ledger-reset-confirm">
              <span className="dim">
                清空不可逆：执行前自动备份数据根（memories.db.json / l0-keyring.json / collector-cursor.json）到备份目录，
                备份失败一律拒绝清空。逐字输入 {CONFIRM_WORD} 才能点执行。
                {preview && preview.with_l0_cipher > 0 && (
                  <> 注意：<b style={{ color: 'var(--err)' }}>{preview.with_l0_cipher}</b> 条 L0 原文会一起消失，只能靠这次备份恢复。</>
                )}
              </span>
              <input
                data-testid="ledger-reset-word"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`输入 ${CONFIRM_WORD}`}
                aria-label="清空确认口令"
              />
              <button type="button" className="btn danger" data-testid="ledger-reset-run" disabled={!canRun} onClick={() => void doReset()}>
                清空并按新规则重采（{total} 条）
              </button>
            </div>
          )}
          {report && (
            <div className="note" data-testid="ledger-reset-report">
              已删除 <b>{report.purged}</b> 条（应删 {report.total}，失败 {report.failed}）· 层级 {kv(report.by_layer)}
              {report.with_l0_cipher > 0 && (
                <div style={{ color: 'var(--err)' }} data-testid="ledger-reset-l0-receipt">
                  连带销毁 <b>{report.with_l0_cipher}</b> 条 L0 原文（不可逆，重建无法找回，只能靠下方备份目录恢复）。
                </div>
              )}
              {backup && <div>备份：<code>{backup}</code></div>}
              {cursorReset === false && (
                <div style={{ color: 'var(--err)' }} data-testid="ledger-reset-cursor-warn">
                  采集游标文件写入失败——本次内存游标已归零、正在重采，但应用重启后会退回旧游标（可能漏采历史段）。
                </div>
              )}
              {cursorReset === true && <div className="dim">采集游标与去重指纹已归零，正在按新规则从各 Agent 会话日志重采。</div>}
              <div className="dim">审计留痕：security_change / op=ledger_purge（request_id 可在审计页回查）。</div>
            </div>
          )}
          {report && status && (
            <div className="note" data-testid="ledger-reset-progress">
              {status.recollecting ? (
                <>追采进行中：本轮采到 {status.last?.collected ?? 0} 条 · 入库 {status.apply?.written ?? 0} 条 ·
                  质量门拦下 {status.apply?.filtered ?? 0} 条 · 角色白名单挡下 {status.last?.roleSkipped ?? 0} 条。</>
              ) : (
                <>追采已收敛：最后一轮采到 {status.last?.collected ?? 0} 条 · 入库 {status.apply?.written ?? 0} 条 ·
                  质量门拦下 {status.apply?.filtered ?? 0} 条。</>
              )}
              <div className="dim">
                单轮最多 50 条，未采完的部分由 5 分钟周期的自动对账继续补齐；历史会话太多时一次性追不完属正常，不是丢数据。
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="ledger-reset-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        重采口径（批次35）：采集器缺省<b>只采用户消息</b>（助手消息是「我先看一下…/更新 HANDOVER…」这类过程旁白的主体），
        例外是 WorkBuddy 工作日志（整篇按 <code>##</code> 分块、本身就是任务记录，显式声明采 assistant）；
        采到的每条仍要过 L0→L1 质量门（身份自述 / 能力清单 / 过程旁白 / 无硬事实的元信息段一律拦截并留 filtered 审计）。
      </div>
    </div>
  );
}
