// 批次58：写入页右栏常驻「L0 UNLOCK」卡（定稿版式）。
// 与共享 L0WriteUnlock 的分工：共享版是条件渲染的拦截提示（其他页面在用，不动）；
// 本卡常驻右栏，真实读 loadL0Status().write_unlocked，锁着时给管理员就地解锁入口。
// 密码边界与共享版一致：只进 l0UnlockWrite 一次调用，成功/失败立刻清空，不落任何痕迹。
import { useState } from 'react';
import { getKernel } from '../kernel.ts';
import { useSessionContext } from '../shared/session.ts';
import { kernelErrorText } from '../shared/kernelLoad.tsx';
import { signalL0WriteLockChanged } from '../shared/l0WriteLockSignal.ts';

export interface L0UnlockStatus {
  phase: 'loading' | 'ready' | 'error';
  unlocked?: boolean;
  error?: string;
}

export function WriteL0UnlockCard({
  status, triggered, onUnlocked,
}: {
  status: L0UnlockStatus;
  /** 本次会话是否真的被 E_L0_LOCKED 挡过一条写入（区分「将被挡」与「被挡了」） */
  triggered: boolean;
  onUnlocked?: () => void;
}) {
  const { role } = useSessionContext();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const done = status.phase === 'ready' && (status.unlocked === true || unlocked);

  const meta = done
    ? '写密钥已解锁'
    : status.phase === 'loading'
      ? '读取中'
      : status.phase === 'error'
        ? '不可读'
        : triggered
          ? 'E_L0_LOCKED 触发'
          : '写密钥未解锁';

  function submit() {
    if (busy) return;
    if (!password) {
      setError('请输入管理密码以解锁写密钥');
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await getKernel().l0UnlockWrite(password);
        setPassword('');
        setUnlocked(true);
        // 广播写锁变化信号：首页红条与壳层状态栏监听 storage 后立刻重读真实锁状态
        signalL0WriteLockChanged();
        onUnlocked?.();
      } catch (e) {
        setPassword('');
        setError(kernelErrorText(e));
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <div className="wf-card wf-unlock">
      <div className="wf-hd">
        <span className="wf-zh">就地解锁</span>
        <span className="wf-meta">{meta}</span>
      </div>
      <div className="wf-bd">
        {status.phase === 'loading' && (
          <div className="wf-empty" data-testid="l0-unlock-loading">正在读取写密钥状态…</div>
        )}
        {status.phase === 'error' && (
          <div className="wf-status bad" data-testid="l0-unlock-status-error">
            <b>写密钥状态读取失败</b> · {status.error ?? '原因未知'}
          </div>
        )}
        {done && (
          <div className="wf-status ok" data-testid="l0-unlock-done">
            <b>写密钥已解锁</b> · L0 写入恢复可用（只加密，不能解密查阅）
          </div>
        )}
        {status.phase === 'ready' && !done && (
          <>
            <div className="wf-status bad" data-testid="l0-unlock-alert">
              {triggered
                ? <><b>写密钥未解锁</b> · 这条写入被挡（E_L0_LOCKED）</>
                : <><b>写密钥未解锁</b> · 写入将被挡（E_L0_LOCKED）</>}
            </div>
            {role === 'admin' ? (
              <>
                <label className="wf-lbl" htmlFor="l0-unlock-password">L0 管理密码（仅管理员 · 成功失败都立刻清空）</label>
                <input
                  id="l0-unlock-password"
                  className="wf-in"
                  type="password"
                  data-testid="l0-unlock-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder="L0 管理密码"
                  disabled={busy}
                  autoComplete="off"
                />
                <button type="button" className="wf-btn" data-testid="l0-unlock-submit" disabled={busy} onClick={submit}>
                  {busy ? '解锁中…' : '解锁并自动重放'}
                </button>
                <div className="wf-note">
                  解锁成功后自动重放被挡那条，无需再点写入 · 密码只用于本次解锁，不显示、不落盘、不进日志。
                </div>
              </>
            ) : (
              <div className="wf-note" data-testid="l0-unlock-need-admin">
                {role === null
                  ? '未登录：解锁写密钥需要管理员会话。请先登录后由管理员输入管理密码解锁。'
                  : '当前账号不是管理员：不给点了必然失败的按钮，请管理员到「安全页 → L0 管理 → 写密钥」解锁后再试。'}
              </div>
            )}
            {error && <div className="wf-err" data-testid="l0-unlock-error">解锁失败：{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
