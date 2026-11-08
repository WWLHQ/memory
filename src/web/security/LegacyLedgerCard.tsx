// 安全页 · 遗留账本清理卡（批次24）
// §2.2 规则落地前，stub 精炼器给历史行编满了 L2–L6，可召回正文 content 取的也是 stub L2；
// 规则落地后写入只落 L1。本卡让管理员先只读预览（扫描到多少条脏行），再显式二次确认执行降级。
// 执行走主进程 IPC：仅管理员 + 清理前自动备份数据根，备份失败一律拒绝改写；结果落 security_change 审计。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { LegacyDemoteReport, LegacyScan } from '../../core/memagent/legacyLayers.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

function layerSummary(by: Record<string, number>): string {
  const parts = Object.entries(by).sort().map(([layer, n]) => `${layer} × ${n}`);
  return parts.length > 0 ? parts.join('、') : '无';
}

export function LegacyLedgerCard({ enabled }: { enabled: boolean }) {
  const [scan, setScan] = useState<LegacyScan | null>(null);
  const [report, setReport] = useState<LegacyDemoteReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{ ok: boolean; scan?: LegacyScan; error?: string }>('legacy:scan', [currentSessionId()]);
      if (res?.ok) { setScan(res.scan ?? null); setErr(null); } else setErr(res?.error ?? '预览失败（主进程未返回结果）');
    } catch (e) {
      setScan(null);
      setErr(`预览失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [hostReady]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const doDemote = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{ ok: boolean; report?: LegacyDemoteReport; backup_dir?: string; error?: string }>(
        'legacy:demote', [currentSessionId()],
      );
      if (res?.ok) {
        setReport(res.report ?? null);
        setBackup(res.backup_dir);
        setScan(null);
        setConfirming(false);
      } else {
        setErr(res?.error ?? '清理失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`清理失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="legacy-card">
      <div className="section-title">遗留账本清理（批次24：未接 LLM 却带 L2–L6 的历史行降级回 L1）</div>
      {!hostReady && (
        <div className="note" data-testid="legacy-unavailable">
          当前为浏览器环境，无主进程账本可清理（需桌面端）。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="legacy-need-admin">需管理员账号才能执行清理（预览与执行都在主进程校验）。</div>
      )}
      {enabled && hostReady && (
        <>
          <div className="row">
            <button type="button" className="btn" data-testid="legacy-scan" disabled={busy} onClick={() => void refresh()}>
              重新预览
            </button>
            <span className="dim">只读扫描，不改动任何数据</span>
          </div>
          {scan && (
            <div className="note" data-testid="legacy-scan-report">
              扫描 {scan.scanned} 条 · 待降级 <b>{scan.hits}</b> 条（{layerSummary(scan.by_layer)}）
              {scan.missing_l1 > 0 && (
                <> · 其中 <b>{scan.missing_l1}</b> 条缺 L1 正文，将被跳过（不伪造内容）</>
              )}
            </div>
          )}
          {scan && scan.hits > 0 && !confirming && (
            <div className="row">
              <button type="button" className="btn danger" data-testid="legacy-demote" disabled={busy}
                onClick={() => setConfirming(true)}>
                清理遗留层级（{scan.hits} 条）
              </button>
            </div>
          )}
          {scan && scan.hits === 0 && (
            <div className="note" data-testid="legacy-clean">账本干净：没有「未接 LLM 却带 L2–L6」的历史行。</div>
          )}
          {confirming && (
            <div className="row" data-testid="legacy-confirm">
              <span className="dim">
                确认把这 {scan?.hits ?? 0} 条的历史层级内容删掉、正文改回真实的 L1 脱敏原文？
                执行前自动备份数据根，L0 密文不受影响。
              </span>
              <button type="button" className="btn danger" data-testid="legacy-demote-yes" disabled={busy}
                onClick={() => void doDemote()}>
                确认执行
              </button>
              <button type="button" className="btn" data-testid="legacy-demote-no" disabled={busy}
                onClick={() => setConfirming(false)}>
                取消
              </button>
            </div>
          )}
          {report && (
            <div className="note" data-testid="legacy-report">
              扫描 {report.scanned} · 命中 {report.hits} · 已降级 <b>{report.demoted}</b> ·
              跳过 {report.skipped}（缺 L1 {report.missing_l1}） · 原层级 {layerSummary(report.by_layer)}
              {backup && <> · 备份 <code>{backup}</code></>}
              <div className="dim">审计留痕：security_change / op=legacy_layer_demote（request_id 可在审计页回查）。</div>
            </div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="legacy-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        判定口径：refined_by 不是 llm（即未接入真实 LLM 时写出的历史行）却带 L2–L6 内容 → 视为无效产物。
        真实 LLM 产出的层级永不被本功能触碰；历史行的向量本就按 L1 正文生成（实测与降级后正文余弦 1.0），降级只改层级与正文，不动向量。
      </div>
    </div>
  );
}
