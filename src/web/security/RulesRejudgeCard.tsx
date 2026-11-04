// 安全页 · 规则重判存量卡（批次36-C）
// 背景：质量门收紧（批次35）只挡住**以后**的写入，库里已经落下的噪声行不会自己变干净；
// 而「整库清空重采」动静太大（要 L0 写密钥、要重采几千条）。本卡做轻的那一半：
// 把每行的 content_l1 重新过一遍**生产质量门**，拦下的删（pinned/locked 受保护不碰），
// 放行的只重盖版本戳 `quality_gate_v`——正文、层级、向量、采集游标一律不动，也不需要解锁 L0。
// 执行走主进程 IPC：仅管理员 + 逐字口令 REJUDGE + 强制先备份数据根，备份失败一律拒绝改写。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { RejudgeDecision, RejudgePreview, RejudgeReport } from '../../core/memagent/rejudge.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
const CONFIRM_WORD = 'REJUDGE';

function kv(by: Record<string, number>): string {
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} × ${n}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

function clip(s: string, n = 42): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function RulesRejudgeCard({ enabled }: { enabled: boolean }) {
  const [preview, setPreview] = useState<RejudgePreview | null>(null);
  const [report, setReport] = useState<RejudgeReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{ ok: boolean; preview?: RejudgePreview; error?: string }>(
        'rules:rejudgePreview', [currentSessionId()],
      );
      if (res?.ok) { setPreview(res.preview ?? null); setErr(null); }
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

  const doRun = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{ ok: boolean; report?: RejudgeReport; backup_dir?: string; error?: string }>(
        'rules:rejudgeRun', [confirmText.trim(), currentSessionId()],
      );
      if (res?.ok) {
        setReport(res.report ?? null);
        setBackup(res.backup_dir);
        setConfirmText('');
        setPreview(res.report ?? null);
      } else {
        setErr(res?.error ?? '重判失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`重判失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const purge = preview?.purge ?? 0;
  const restamp = preview?.keep_restamp ?? 0;
  const canRun = enabled && hostReady && (purge > 0 || restamp > 0)
    && confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="card" data-testid="rules-rejudge-card">
      <div className="section-title">
        规则重判存量（批次36：入库规则更新后，历史行按当前口径重过一遍）
        {preview && <span className="dim"> · 质量门 v{preview.gate_version}</span>}
      </div>
      {!hostReady && (
        <div className="note" data-testid="rules-rejudge-unavailable">
          当前为浏览器环境，记忆库由桌面主进程持有写锁，存量重判需在桌面端执行（命令行只读回放仍可用：<code>npm run rejudge</code>）。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="rules-rejudge-need-admin">需管理员账号才能执行重判（预览需会话，执行需管理员 + 备份）。</div>
      )}
      {enabled && hostReady && (
        <>
          <div className="row">
            <button type="button" className="btn" data-testid="rules-rejudge-preview" disabled={busy} onClick={() => void refresh()}>
              重新预览
            </button>
            <span className="dim">只读：把每行的 L1 重新过一遍质量门，不改任何数据</span>
          </div>
          {preview && (
            <div className="note" data-testid="rules-rejudge-preview-report">
              库内 <b>{preview.total}</b> 条（墓碑 {preview.tombstones} · 缺 L1 未判定 {preview.missing_l1}）·
              行戳 {kv(preview.by_row_gate_version)}
              <div>
                按当前规则应删 <b>{preview.purge}</b> 条
                {preview.purge_protected > 0 && <>（其中 <b>{preview.purge_protected}</b> 条 pinned/locked 受保护，执行时跳过）</>}
                · 放行需重盖版本戳 <b>{preview.keep_restamp}</b> 条 · 放行且已最新 <b>{preview.keep_unchanged}</b> 条
              </div>
              {preview.purge > 0 && <div>拦截码分布：{kv(preview.by_code)} · 原层级 {kv(preview.by_layer)}</div>}
              {preview.with_l0_cipher > 0 && (
                <div style={{ color: 'var(--err)' }} data-testid="rules-rejudge-l0-warn">
                  这 <b>{preview.with_l0_cipher}</b> 条待删行带 L0 原文：删除会<b>同步销毁其 L0 密文</b>，且<b>不能</b>用「按 L0 重建」找回
                  （重建只救整库丢失，救不回逐行删掉的那条原文）——唯一退路是本次执行前生成的备份目录。
                </div>
              )}
            </div>
          )}
          {preview && preview.sample.length > 0 && (
            <div className="note" data-testid="rules-rejudge-sample">
              样本（最多 20 条，正文取已脱敏的 L1）：
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {preview.sample.slice(0, 8).map((s: RejudgeDecision) => (
                  <li key={s.mem_id} className="dim">
                    <code>{s.mem_id}</code> [{s.code ?? '—'} · {s.layer} · 行戳 v{s.row_gate_v}
                    {s.protected ? ' · 受保护' : ''}] {clip(s.reason ?? '')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview && purge === 0 && restamp === 0 && (
            <div className="note" data-testid="rules-rejudge-clean">
              按质量门 v{preview.gate_version} 复核：没有需要删除的行，版本戳也已全部是最新。
            </div>
          )}
          {(purge > 0 || restamp > 0) && (
            <div className="row" data-testid="rules-rejudge-confirm">
              <span className="dim">
                删除不可逆：执行前自动备份数据根（memories.db.json / l0-keyring.json）到备份目录，备份失败一律拒绝改写；
                pinned / locked 行一律保留。逐字输入 {CONFIRM_WORD} 才能点执行。
                {preview && preview.with_l0_cipher > 0 && (
                  <> 注意：<b style={{ color: 'var(--err)' }}>{preview.with_l0_cipher}</b> 条待删行的 L0 原文会一起消失，只能靠这次备份恢复。</>
                )}
              </span>
              <input
                data-testid="rules-rejudge-word"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`输入 ${CONFIRM_WORD}`}
                aria-label="重判确认口令"
              />
              <button type="button" className="btn danger" data-testid="rules-rejudge-run" disabled={!canRun} onClick={() => void doRun()}>
                按当前规则重判（删 {purge} · 重盖 {restamp}）
              </button>
            </div>
          )}
          {report && (
            <div className="note" data-testid="rules-rejudge-report">
              已删除 <b>{report.purged}</b> 条 · 受保护跳过 <b>{report.skipped_protected}</b> 条 ·
              缺 L1 跳过 <b>{report.skipped_no_l1}</b> 条 · 重盖版本戳 <b>{report.restamped}</b> 条 · 失败 <b>{report.failed}</b> 条
              {report.with_l0_cipher > 0 && (
                <div style={{ color: 'var(--err)' }} data-testid="rules-rejudge-l0-receipt">
                  连带销毁 <b>{report.with_l0_cipher}</b> 条 L0 原文（不可逆，重建无法找回，只能靠下方备份目录恢复）。
                </div>
              )}
              {backup && <div>备份：<code>{backup}</code></div>}
              <div className="dim">
                审计留痕：每删一行一条 memory_op / op=rejudge_purge，整轮一条 security_change / op=rules_rejudge
                （request_id 可在审计页回查）。
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="rules-rejudge-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        口径边界：重判<b>只喂 content_l1</b>（缺失才退回正文），不解密 L0、不调 LLM、不动采集游标——
        所以它<b>不需要解锁 L0 写密钥</b>，也不会把已删行的位置留给新数据。
        它救不回的是「采集口径变更」：助手消息缺省不再采集属批次35 的采集器改动，
        那部分只能走「记忆库清空重采」。命令行同口径只读回放：<code>npm run rejudge</code>（--code / --limit / --json）。
      </div>
    </div>
  );
}
