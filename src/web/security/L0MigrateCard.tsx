// 安全页 · L0 旧数据迁移卡（§4.4.6；从 L0AdminCard 里拆出来单独成卡）
// 干什么：把**还躺在记忆库行上**的 L0 原文换成正宗的 v2 封法——
//   ① 行上有明文 `content_orig` → 用当前 DEK 封存成 v2 信封；
//   ② 行上是遗留 **v1 信封**（更早那套「直接拿管理密码加密」的格式）→ 必须用**旧 v1 密码**解开，再用当前 DEK 重封成 v2。
// 与批次37-C「L0 存量拆分迁移」的分工要说清：那张卡管**换地方存**（信封搬进 `memories.l0.json`，行上只留 `has_l0`），
// 本卡管**换封法**（v1 → v2）。所以顺序是先本卡、后 37-C；拆完库的本机通常无事可做
// （2026-11-02 21:03 UTC+08:00 实机回显：扫描 1642 · 明文迁移 0 · v1 迁移 0 · 待处理 0 · 跳过 1642）。
// 迁移要重新加密 → 写密钥没解锁就不给点；执行前内核自动备份数据根；解不开的行标 `l0_migration_pending` 原样保留，**绝不删**。
import { useCallback, useEffect, useState } from 'react';
import type { L0MigrationReport } from '../../core/memagent/types.ts';
import { coreL0Migrate, coreL0Status } from './coreSecurity.ts';

const inputStyle = {
  background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)',
  borderRadius: 8, padding: 6, fontSize: 12,
} as const;

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

export function L0MigrateCard({ enabled }: { enabled: boolean }) {
  const [writeUnlocked, setWriteUnlocked] = useState<boolean | null>(null);
  const [oldPw, setOldPw] = useState('');
  const [report, setReport] = useState<L0MigrationReport | null>(null);
  const [backup, setBackup] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  /** 写密钥状态单独拉：读不到就按「未确认」处理，不给点执行（宁可少给一次点击，不可凭空重加密） */
  const refresh = useCallback(async () => {
    try {
      const st = await coreL0Status();
      setWriteUnlocked(Boolean(st?.write_unlocked));
    } catch {
      setWriteUnlocked(null);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const doMigrate = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await coreL0Migrate(oldPw || undefined);
      setReport(r.report);
      setBackup(r.backup_dir);
      setOldPw('');
      setMsg('迁移跑完了：报告如下（迁移前内核已自动备份数据根）');
    } catch (e) {
      setErr(`迁移旧数据失败：${errText(e)}`);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="l0-migrate-card">
      <div className="section-title">L0 旧数据迁移（§4.4.6：把行上的明文 / 遗留 v1 信封换成正宗 v2 封法）</div>
      {!enabled ? (
        <div className="note" data-testid="l0-migrate-need-admin">需管理员账号：重加密与迁移前备份都是管理员动作。</div>
      ) : (
        <>
          <div className="note">
            两种活：<b>①</b> 行上还带明文 <code>content_orig</code> → 用当前 DEK 封成 v2 信封；
            <b> ②</b> 行上是遗留 <b>v1 信封</b>（更早直接拿管理密码加密的格式）→ 需填<b>旧 v1 密码</b>解开再重封成 v2。
            解不开的一律标 <code>l0_migration_pending</code> 原样保留、计入「待处理」，<b>绝不删</b>，换对密码再跑一轮即可。
          </div>
          <div className="row" data-testid="l0-migrate-form">
            <input
              type="password"
              data-testid="l0-mig-old-pw"
              value={oldPw}
              placeholder="旧 v1 密码（无旧数据可留空）"
              style={{ ...inputStyle, width: 220 }}
              onChange={(e) => setOldPw(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              data-testid="l0-migrate"
              disabled={busy || writeUnlocked !== true}
              title={writeUnlocked === true ? '迁移前自动备份数据根' : '请先解锁写密钥'}
              onClick={() => void doMigrate()}
            >
              迁移旧数据
            </button>
            <button type="button" className="btn" data-testid="l0-migrate-refresh" disabled={busy} onClick={() => void refresh()}>
              刷新写密钥状态
            </button>
            {writeUnlocked !== true && (
              <span className="dim" data-testid="l0-migrate-need-write-key">
                需先解锁写密钥（迁移要重新加密）{writeUnlocked === null ? '——本机读不到密钥环状态，刷新后再试' : ''}
              </span>
            )}
          </div>
          {msg && <div className="note" data-testid="l0-migrate-msg">{msg}</div>}
          {report && (
            <div className="note" data-testid="l0-mig-report">
              扫描 {report.scanned} · 明文迁移 {report.migrated_orig} · v1 迁移 {report.migrated_v1} ·
              待处理 <b>{report.pending}</b> · 跳过 {report.skipped}
              {backup && <> · 备份 <code>{backup}</code></>}
              {report.pending > 0 && (
                <div style={{ color: 'var(--warn)' }}>仍有 {report.pending} 条待迁移：请提供正确的旧密码后重试（这些行一行没动）。</div>
              )}
              {report.scanned > 0 && report.migrated_orig === 0 && report.migrated_v1 === 0 && report.pending === 0 && (
                <div className="dim">本轮无事可做：行上已没有明文，也没有遗留 v1 信封。</div>
              )}
            </div>
          )}
          {err && <div className="note" data-testid="l0-migrate-error" style={{ color: 'var(--err)' }}>{err}</div>}
          <div className="note">
            与「L0 存量拆分迁移」的分工：那张卡是<b>换地方存</b>（信封搬进 <code>memories.l0.json</code>，行上只留 <code>has_l0</code>），
            本卡是<b>换封法</b>（v1 → v2），所以要先本卡、后拆分。
            红线：管理密码 / 授权密码 / DEK 不进日志、审计与 URL；审计只记动作与结果（§4.4.7）。
          </div>
        </>
      )}
    </div>
  );
}
