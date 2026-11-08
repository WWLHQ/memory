// 安全页 · L0 恢复卡（批次37-G）
// 为什么要有这张卡：L0 原数据库（memories.l0.json）只有靠密钥环里的 DEK 才解得开，而 DEK 又是管理密码包的。
// 用户的一句话诉求——「数据是宝贵的，万一忘记密码数据就废了」——只有一条诚实的出路：
// 同一个 DEK 再包一份，用一串**随机 256bit 恢复码**（不是密码的衍生物，弱密码也连累不到它）。
// 一次性口径（用户拍板）：恢复码用过即作废并当场换新，新卡必须重新导出——一张被拍照的纸不能无限次开门。
// 红线（写进卡面也写进这里）：管理密码 + 恢复码**同时**丢失 = L0 原文不可恢复，本应用没有后门。
// 码明文只在「生成那一次」的 IPC 返回值里出现；状态接口、日志、审计都只有指纹与时间。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
/** 用户可见时间统一 UTC+08:00（密钥环存的是 epoch 毫秒） */
const fmt8 = (ms: number): string => (ms > 0 ? new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : '未取数');

interface RecoveryStatus {
  ok: boolean;
  has_recovery?: boolean;
  created_at?: number;
  revoked_at?: number;
  fingerprint?: string;
  has_pending_card?: boolean;
  error?: string;
}

/** 发码三兄弟（init / issue / recover）返回同一种回执：码明文只在这里出现一次 */
interface RecoveryIssue {
  ok: boolean;
  recovery_code?: string;
  recovery_code_grouped?: string;
  fingerprint?: string;
  created_at?: number;
  error?: string;
}

const MIN_PW = 8;

export function L0RecoveryCard({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [issued, setIssued] = useState<RecoveryIssue | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady || !enabled) return;
    try {
      const res = await hostCall<RecoveryStatus>('l0:recoveryStatus', [currentSessionId()]);
      setStatus(res);
      if (!res?.ok) setErr(res?.error ?? '恢复码状态读取失败');
    } catch (e) {
      setStatus(null);
      setErr(`恢复码状态读取失败：${errText(e)}`);
    }
  }, [hostReady, enabled]);

  useEffect(() => {
    if (enabled && hostReady) void refresh();
  }, [enabled, hostReady, refresh]);

  /** 一次发码后统一收口：展示新码 + 强制导出提示 + 刷新状态 */
  const afterIssue = (res: RecoveryIssue) => {
    setIssued(res);
    setExported(false);
    setExportMsg(null);
    void refresh();
  };

  const doIssue = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<RecoveryIssue>('l0:recoveryIssue', [currentSessionId()]);
      if (res?.ok) afterIssue(res);
      else setErr(res?.error ?? '换发恢复码失败（主进程未返回结果）');
    } catch (e) {
      setErr(`换发恢复码失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doRecover = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<RecoveryIssue>(
        'l0:recover', [{ code: codeInput, newPassword: newPw }, currentSessionId()],
      );
      if (res?.ok) {
        setCodeInput('');
        setNewPw('');
        afterIssue(res);
      } else {
        setErr(res?.error ?? '恢复失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`恢复失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{ ok: boolean; file_name?: string; inside_data_root?: boolean; canceled?: boolean; error?: string }>(
        'l0:recoveryExport', [currentSessionId()],
      );
      if (res?.ok) {
        setExported(true);
        setExportMsg(res.inside_data_root
          ? `已导出 ${res.file_name}，但它就在数据目录里——同一次磁盘事故会把库和卡一起带走，请再存一份到别处。`
          : `已导出 ${res.file_name}。`);
      } else {
        setExported(false);
        setExportMsg(res?.canceled ? '本次取消了保存：卡还没落盘，恢复码仍在内存里，可再次导出。' : null);
        if (!res?.canceled) setErr(res?.error ?? '导出失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`导出失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const hasCard = Boolean(status?.has_recovery);
  const canRecover = enabled && hostReady && hasCard
    && codeInput.replace(/\s+/g, '').length >= 32
    && newPw.length >= MIN_PW && !busy;

  return (
    <div className="card" data-testid="l0-recovery-card">
      <div className="section-title">L0 恢复卡（忘记管理密码时把原数据库捞回来的唯一通道）</div>
      {!hostReady && (
        <div className="note" data-testid="l0-recovery-unavailable">
          当前为浏览器环境：L0 密钥环与恢复码由桌面主进程持有，需在桌面端生成与找回。
        </div>
      )}
      {hostReady && !enabled && (
        <div className="note" data-testid="l0-recovery-need-admin">
          需管理员账号：恢复码等同 L0 原数据库的钥匙，生成、换发、找回、导出都只对管理员开放。
        </div>
      )}
      {enabled && hostReady && (
        <>
          <div className="note" data-testid="l0-recovery-status">
            {hasCard
              ? <>已生成恢复卡 · 库指纹 <code data-testid="l0-recovery-fingerprint">{status?.fingerprint || '未取数'}</code>
                · 生成时间 {fmt8(status?.created_at ?? 0)}（UTC+08:00）</>
              : <span data-testid="l0-recovery-no-card">本机还没有 L0 恢复码：忘记管理密码将无法找回原数据库。</span>}
          </div>
          <div className="row">
            <button type="button" className="btn" data-testid="l0-recovery-issue" disabled={busy} onClick={() => void doIssue()}>
              {hasCard ? '换发新恢复码' : '生成恢复码（需先解锁 L0 写密钥）'}
            </button>
            <button type="button" className="btn" data-testid="l0-recovery-refresh" disabled={busy} onClick={() => void refresh()}>
              刷新状态
            </button>
            <span className="dim">换发是覆盖式的：新码一生成，旧卡当场失效。</span>
          </div>

          {issued?.recovery_code && (
            <div className="note" data-testid="l0-recovery-card-body">
              <div><b>恢复码（只显示这一次，请立即导出或抄存）：</b></div>
              <div data-testid="l0-recovery-code" style={{ fontSize: 15, letterSpacing: 1 }}>
                <code>{issued.recovery_code_grouped ?? issued.recovery_code}</code>
              </div>
              <div className="dim">库指纹 <code>{issued.fingerprint}</code> · 生成时间 {fmt8(issued.created_at ?? 0)}（UTC+08:00）</div>
              <div className="row">
                <button type="button" className="btn danger" data-testid="l0-recovery-export" disabled={busy} onClick={() => void doExport()}>
                  导出恢复卡（另存为…）
                </button>
                {!exported && <b style={{ color: 'var(--err)' }} data-testid="l0-recovery-not-exported">尚未导出：关掉本窗口就再也取不回这串码。</b>}
              </div>
              {exportMsg && <div data-testid="l0-recovery-export-result">{exportMsg}</div>}
            </div>
          )}

          <div className="row" data-testid="l0-recovery-form">
            <span className="dim">忘记管理密码？输入恢复卡上的码 + 新管理密码（≥{MIN_PW} 位）：</span>
            <input
              data-testid="l0-recovery-code-input"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="恢复码（可带空格/换行）"
              aria-label="L0 恢复码"
            />
            <input
              data-testid="l0-recovery-newpw-input"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="新管理密码"
              aria-label="新 L0 管理密码"
            />
            <button type="button" className="btn" data-testid="l0-recovery-submit" disabled={!canRecover} onClick={() => void doRecover()}>
              用恢复码找回
            </button>
          </div>
          {!hasCard && (
            <div className="note">本机没有恢复码时上面的找回不可用——先「生成恢复码」（需 L0 写密钥已解锁，即当前管理密码有效）。</div>
          )}
        </>
      )}
      {err && <div className="note" data-testid="l0-recovery-error" style={{ color: 'var(--err)' }}>{err}</div>}
      <div className="note">
        口径边界：恢复码是随机 256bit，不是密码的衍生物，也推不出密码；它和管理密码开的是<b>同一个 DEK</b>，
        所以找回后老密文照样读得出。恢复码<b>用过一次即作废</b>，成功后立刻换新，必须重新导出新卡。
        <b>管理密码 + 恢复码同时丢失 = L0 原文不可恢复</b>（没有后门，只能重采）。
        本卡还原的是 L0 原数据库的解密能力，不含 L1–L6 正文——那些一直在记忆库里。
        码明文不进日志与审计，落盘的只有库指纹与动作。
      </div>
    </div>
  );
}
