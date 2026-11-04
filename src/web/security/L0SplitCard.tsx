// 安全页 · L0 存量拆分迁移卡（批次37-C）
// 背景：批次37-A 把 L0 原文独立成 memories.l0.json，但**历史行还带着当年的字段**——本机实测
// 1642 行里 1641 行是**明文** content_orig（约 5.5 MB），content_l0_enc 为 0 行。拆库只改了「新行往哪写」，
// 存量不会自己搬家。本卡把两类都收口：明文经 L0 写密钥**封存成 v2 信封**再搬，行上已有的信封**原样搬**
// （重封是 l0:migrate 的活），搬完行上只留 has_l0——记忆库里从此不再有任何 L0 原文。
// 执行走主进程 IPC：仅管理员 + 逐字口令 SPLIT + 强制先备份双库，备份失败一律拒绝改写；
// 有明文却没解锁写密钥时在备份之前就如实拒绝，绝不把明文当 L0 存。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { SplitPreview, SplitReport } from '../../core/memagent/l0Split.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
const CONFIRM_WORD = 'SPLIT';

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

export function L0SplitCard({ enabled }: { enabled: boolean }) {
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [report, setReport] = useState<SplitReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [writeUnlocked, setWriteUnlocked] = useState<boolean | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{ ok: boolean; preview?: SplitPreview; error?: string }>(
        'l0:splitPreview', [currentSessionId()],
      );
      if (res?.ok) { setPreview(res.preview ?? null); setErr(null); }
      else setErr(res?.error ?? '预览失败（主进程未返回结果）');
    } catch (e) {
      setPreview(null);
      setErr(`预览失败：${errText(e)}`);
    }
    // 写密钥状态单独取：预览是只读的，不该因为没解锁就报失败
    try {
      const st = await hostCall<{ ok?: boolean; write_unlocked?: boolean; error?: string }>('l0:status', [currentSessionId()]);
      setWriteUnlocked(typeof st?.write_unlocked === 'boolean' ? st.write_unlocked : null);
    } catch {
      setWriteUnlocked(null);
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
      const res = await hostCall<{ ok: boolean; report?: SplitReport; backup_dir?: string; error?: string }>(
        'l0:splitRun', [confirmText.trim(), currentSessionId()],
      );
      if (res?.ok) {
        setReport(res.report ?? null);
        setBackup(res.backup_dir);
        setConfirmText('');
        setPreview(res.report ?? null);
      } else {
        setErr(res?.error ?? '拆分失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`拆分失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toMove = preview?.to_move ?? 0;
  const needSeal = (preview?.plaintext_orig ?? 0) > 0;
  const canRun = enabled && hostReady && toMove > 0
    && (!needSeal || writeUnlocked === true)
    && confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="card" data-testid="l0-split-card">
      <div className="section-title">L0 存量拆分迁移（批次37：把还躺在记忆库里的原文搬进 L0 原数据库）</div>
      {!hostReady && (
        <div className="note" data-testid="l0-split-unavailable">
          当前为浏览器环境，L0 原数据库由桌面主进程持有写锁，存量拆分需在桌面端执行。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="l0-split-need-admin">需管理员账号才能执行拆分（预览需会话，执行需管理员 + 双库备份）。</div>
      )}
      {enabled && hostReady && (
        <>
          <div className="row">
            <button type="button" className="btn" data-testid="l0-split-preview" disabled={busy} onClick={() => void refresh()}>
              重新预览
            </button>
            <span className="dim">只读：核对两个库文件各有什么、本轮会搬多少，不改任何数据</span>
          </div>
          {preview && (
            <div className="note" data-testid="l0-split-preview-report">
              记忆库 <b>{preview.total}</b> 条（墓碑 {preview.tombstones} · 已拆好 {preview.already_split}）
              <div>
                带<b>明文</b> content_orig <b>{preview.plaintext_orig}</b> 条（需封存后搬走）·
                行上还留信封 <b>{preview.on_row_cipher}</b> 条（v2 {preview.on_row_cipher_v.v2} · 遗留 v1 {preview.on_row_cipher_v.legacy_v1}）·
                信封解析不出、既不搬也不删 <b>{preview.invalid_envelope}</b> 条
              </div>
              <div>本轮搬入 L0 原数据库 <b>{preview.to_move}</b> 条</div>
              <div>
                L0 原库现状：<b>{preview.l0_count}</b> 条 / {kb(preview.l0_bytes)}
                {preview.orphan_blobs > 0 && <> · 孤儿密文（库里没有任何行认领）<b>{preview.orphan_blobs}</b> 条</>}
                {preview.broken_links > 0 && (
                  <> · <b style={{ color: 'var(--err)' }}>断链 {preview.broken_links} 条</b>（行说有 L0，库里取不到 → 查阅必报错）
                    <code>{preview.broken_link_ids.slice(0, 5).join(' ')}</code></>
                )}
              </div>
              {preview.sample_ids.length > 0 && (
                <div className="dim">样本 id（最多 20 条）：<code>{preview.sample_ids.slice(0, 8).join(' ')}</code></div>
              )}
            </div>
          )}
          {preview && toMove === 0 && (
            <div className="note" data-testid="l0-split-clean">
              本轮没有要搬的：记忆库里已不再有 L0 原文或信封。
              {preview.broken_links > 0 && '但仍有断链行——那些行的原文已经不在任何库里，只能从备份恢复。'}
            </div>
          )}
          {needSeal && writeUnlocked === false && (
            <div className="note" data-testid="l0-split-need-write-key" style={{ color: 'var(--err)' }}>
              有 <b>{preview?.plaintext_orig}</b> 行带着明文原文：请先在上方解锁 L0 写密钥，否则本卡拒绝执行——绝不把明文当 L0 存进原数据库。
            </div>
          )}
          {toMove > 0 && (
            <div className="row" data-testid="l0-split-confirm">
              <span className="dim">
                搬家不可逆：执行前自动备份记忆库 + L0 原库 + 密钥环到备份目录，备份失败一律拒绝改写；
                L1–L6 正文、层级、向量、采集游标都不动。逐字输入 {CONFIRM_WORD} 才能点执行。
              </span>
              <input
                data-testid="l0-split-word"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`输入 ${CONFIRM_WORD}`}
                aria-label="L0 存量拆分确认口令"
              />
              <button type="button" className="btn danger" data-testid="l0-split-run" disabled={!canRun} onClick={() => void doRun()}>
                搬进 L0 原数据库（{preview?.plaintext_orig ?? 0} 封存 + {preview?.on_row_cipher ?? 0} 直搬）
              </button>
            </div>
          )}
          {report && (
            <div className="note" data-testid="l0-split-report">
              已搬走 <b>{report.moved}</b> 条（明文封存 {report.sealed_from_plaintext} · 信封直搬 {report.cipher_moved}）·
              失败 <b>{report.failed}</b> 条 · 搬完后记忆库里明文 <b>{report.plaintext_orig}</b> 条 ·
              L0 原库 <b>{report.l0_count}</b> 条 / {kb(report.l0_bytes)}
              <div>
                完整性核对：孤儿密文 <b>{report.orphan_blobs}</b> 条 · 断链 <b>{report.broken_links}</b> 条
                {report.broken_link_ids.length > 0 && <code> {report.broken_link_ids.slice(0, 5).join(' ')}</code>}
              </div>
              {report.failed_ids.length > 0 && <div className="dim">失败行 id：<code>{report.failed_ids.join(' ')}</code>（单行失败不中断整轮）</div>}
              {backup && <div>备份：<code>{backup}</code></div>}
              <div className="dim">
                审计留痕：每搬一行一条 memory_op / op=l0_split（只记字段与字节数，绝不记正文），
                整轮一条 security_change / op=l0_split（request_id 可在审计页回查）。
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="l0-split-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        口径边界：本卡只<b>换地方存</b>——明文交给 L0 写密钥封成新信封，行上已有的信封原样搬，
        <b>可检索的 L1–L6 正文一字不改</b>，所以不重建向量、不需要调 LLM。
        遗留 v1 信封想升级成 v2 用「L0 明文迁移」（l0:migrate，需要旧密码）；
        搬完之后 <code>memories.db.json</code> 里再无任何原文，但 <code>memories.l0.json</code> 是<b>唯一的原件副本</b>——
        它只有配合密钥环 + L0 管理密码（或恢复码）才还原得出，三者请分开备份存放。
      </div>
    </div>
  );
}
