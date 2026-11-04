// 安全页 · 存量字段回填卡（批次41-T）
// 背景：`sha256` 与 `embedding` 两个字段随提交 843282c（2026-10-31）才进写入路径，那之前落库的
// 历史行行上就是空的（本机实测 533 行缺 sha256、1 行缺 embedding）。代价可查证：缺向量的行语义召回
// 恒 0 分，缺指纹的行在云端同步对账里会被列进 missing。本卡只填这两个空字段——
// 正文、层级、version、updated_at、质量门戳、L0 一概不动，所以**不设逐字口令**（与 REJUDGE/RESET/REBUILD 不同类）。
// 执行仍走主进程：仅管理员 + 强制先备份数据根，备份失败一律拒绝改写；填不出的行跳过并如实计数，绝不猜。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { BackfillDecision, BackfillPreview, BackfillReport } from '../../core/memagent/fieldBackfill.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

function kv(by: Record<string, number>): string {
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} × ${n}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

function codesOf(d: BackfillDecision): string {
  return d.codes.length > 0 ? d.codes.join('/') : '—';
}

/** 样本行的人话缺口：能补的说「缺 X」，补不了的由 reason 给出原因 */
function gapOf(d: BackfillDecision): string {
  const parts: string[] = [];
  if (d.need_sha256) parts.push('sha256');
  if (d.need_embedding) parts.push('embedding');
  return parts.length > 0 ? `缺 ${parts.join(' + ')}` : '字段齐全';
}

export function FieldBackfillCard({ enabled }: { enabled: boolean }) {
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{ ok: boolean; preview?: BackfillPreview; error?: string }>(
        'ledger:fieldsPreview', [currentSessionId()],
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
      const res = await hostCall<{ ok: boolean; report?: BackfillReport; backup_dir?: string; error?: string }>(
        'ledger:fieldsBackfill', [currentSessionId()],
      );
      if (res?.ok) {
        setReport(res.report ?? null);
        setBackup(res.backup_dir);
        setPreview(res.report ?? null);
      } else {
        setErr(res?.error ?? '回填失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`回填失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const fillable = preview?.fillable_rows ?? 0;
  const canRun = enabled && hostReady && fillable > 0 && !busy;

  return (
    <div className="card" data-testid="fields-backfill-card">
      <div className="section-title">
        存量补齐缺失的指纹与向量（批次41：历史行的 sha256 / embedding 回填）
      </div>
      {!hostReady && (
        <div className="note" data-testid="fields-backfill-unavailable">
          当前为浏览器环境，记忆库由桌面主进程持有写锁，字段回填需在桌面端执行。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="fields-backfill-need-admin">需管理员账号才能执行回填（预览需会话，执行需管理员 + 备份）。</div>
      )}
      {enabled && hostReady && (
        <>
          <div className="row">
            <button type="button" className="btn" data-testid="fields-backfill-preview" disabled={busy} onClick={() => void refresh()}>
              重新预览
            </button>
            <span className="dim">只读：逐行看缺哪个字段、能不能从行上正文算出来，不改任何数据</span>
          </div>
          {preview && (
            <div className="note" data-testid="fields-backfill-preview-report">
              库内 <b>{preview.total}</b> 条（墓碑 {preview.tombstones} · 两字段齐全 {preview.already_complete}）
              <div>
                缺 sha256 <b>{preview.missing_sha256}</b> 条
                {preview.unfillable_sha256 > 0 && <>（其中 <b>{preview.unfillable_sha256}</b> 条行上没正文，算不出——不猜，原样留着）</>}
                · 缺 embedding <b>{preview.missing_embedding}</b> 条
                {preview.unfillable_embedding > 0 && <>（其中 <b>{preview.unfillable_embedding}</b> 条缺 content_l1，向量只源自 L1、不从别的层凑）</>}
              </div>
              <div>
                本轮会写盘 <b>{preview.fillable_rows}</b> 条
                {preview.protected_rows > 0 && <>（含 pinned/locked <b>{preview.protected_rows}</b> 条——补字段不删内容，照常补并单列上报）</>}
                · 按原层级 {kv(preview.by_layer)}
              </div>
            </div>
          )}
          {preview && preview.sample.length > 0 && (
            <div className="note" data-testid="fields-backfill-sample">
              样本（本轮会写盘的行，最多 20 条 · 只报字段缺口，正文一个字不上屏；补不出的行只计数、不列样本）：
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {preview.sample.slice(0, 8).map((s) => (
                  <li key={s.mem_id} className="dim">
                    <code>{s.mem_id}</code> [{s.layer} · {codesOf(s)}
                    {s.protected ? ' · 受保护' : ''}] {gapOf(s)}{s.reason ? ` —— ${s.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview && fillable === 0 && (
            <div className="note" data-testid="fields-backfill-clean">
              该补的都补上了：没有可从行上正文算出却仍为空的字段。补不出的行（上面明列的条数）保持原样，本通道不猜。
            </div>
          )}
          {fillable > 0 && (
            <div className="row" data-testid="fields-backfill-confirm">
              <span className="dim">
                执行前自动备份数据根到备份目录，备份失败一律拒绝改写。本通道<b>不删行、不改正文、不动层级与 version</b>
                （所以没有逐字口令），但仍是批量改写账本，请确认预览数字无误再点。
              </span>
              <button type="button" className="btn" data-testid="fields-backfill-run" disabled={!canRun} onClick={() => void doRun()}>
                补齐缺失字段（{fillable} 行）
              </button>
            </div>
          )}
          {report && (
            <div className="note" data-testid="fields-backfill-report">
              已补 sha256 <b>{report.sha256_filled}</b> 条 · 已补 embedding <b>{report.embedding_filled}</b> 条 ·
              进向量索引 <b>{report.indexed}</b> 条 · 受保护行 <b>{report.protected_rows}</b> 条 ·
              算不出跳过 <b>{report.unfillable_sha256 + report.unfillable_embedding}</b> 项 · 写盘失败 <b>{report.failed}</b> 条
              {report.failed_ids.length > 0 && (
                <div className="dim">失败样本：<code>{report.failed_ids.join(' ')}</code></div>
              )}
              {backup && <div>备份：<code>{backup}</code></div>}
              <div className="dim">
                审计留痕：每补一行一条 memory_op / op=field_backfill（只有字段名与长度，无正文），
                整轮一条 security_change / op=field_backfill（request_id 可在审计页回查）。
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="fields-backfill-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        口径边界：指纹取 <code>sha256hex(content)</code>、向量取 <code>embedSync(content_l1)</code>，
        与正常写入 / 补炼 / 重建三条管道<b>同一套公式</b>（批次41-B 同口径）——不是新造判据。
        它<b>不改</b>的是：正文、层级 <code>layer</code>、<code>version</code>、<code>updated_at</code>、质量门戳与 L0；
        已删除行（墓碑）与算不出的行一律不碰。幂等：第二次预览「本轮会写盘」必为 0。
        缺 content_l1 的行<b>不会</b>被从别的层凑出向量——宁可这行继续召不回，也不给它一个来路不明的向量。
      </div>
    </div>
  );
}
