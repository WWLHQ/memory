// 写入页「就地解锁 L0 写密钥」面板（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write）：
// af-panel warn 边框（af-ph h3 就地解锁 L0 写密钥 + hint 按角色）→ af-pb：密码框 + 「解锁并自动重放」同行（nowrap）。
// 仅在写密钥锁定 / 状态不可读时渲染（已解锁按设计稿不出现解锁卡）。
// 密码边界：只进 l0UnlockWrite / l0UnlockWriteForMember 一次调用，成功/失败立刻清空，不落任何痕迹（§4.4.4-B 成员自解锁）。
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
  const { role, context } = useSessionContext();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const done = status.phase === 'ready' && (status.unlocked === true || unlocked);

  const hint = status.phase === 'loading'
    ? '读取中'
    : status.phase === 'error'
      ? '状态不可读'
      : triggered
        ? 'E_L0_LOCKED · 解锁后自动重放'
        : role === 'member' && context?.user_id
          ? '写解锁口令 · 只进这一次调用'
          : '仅管理员 · 密码只进这一次调用';

  function submit() {
    if (busy) return;
    if (!password) {
      setError(role === 'member' ? '请输入你的写解锁口令' : '请输入管理密码以解锁写密钥');
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        if (role === 'member' && context?.user_id) {
          // §4.4.4-B：成员用管理员发给自己的写解锁口令自解锁（与管理密码互不替代）
          await getKernel().l0UnlockWriteForMember({ password, member_id: context.user_id });
        } else {
          await getKernel().l0UnlockWrite(password);
        }
        setPassword('');
        setUnlocked(true);
        // 广播写锁变化信号：首页红条与壳层状态栏监听后立刻重读真实锁状态
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
    <section className="af-panel af-unlock" data-testid="l0-unlock-card">
      <div className="af-ph">
        <h3>就地解锁 L0 写密钥</h3>
        <span className="hint">{hint}</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 8 }}>
        {status.phase === 'loading' && (
          <div className="af-empty" data-testid="l0-unlock-loading">正在读取写密钥状态…</div>
        )}
        {status.phase === 'error' && (
          <p className="af-note bad" data-testid="l0-unlock-status-error">
            写密钥状态读取失败 · {status.error ?? '原因未知'} —— 不猜已解锁，解锁入口不可用。
          </p>
        )}
        {status.phase === 'ready' && !done && (
          <>
            {role === 'admin' ? (
              <>
                <div className="af-row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    className="af-input"
                    type="password"
                    data-testid="l0-unlock-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    placeholder="L0 管理密码"
                    disabled={busy}
                    autoComplete="off"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="af-btn pri"
                    data-testid="l0-unlock-submit"
                    disabled={busy}
                    onClick={submit}
                    style={{ flex: 'none' }}
                  >
                    {busy ? '解锁中…' : '解锁并自动重放'}
                  </button>
                </div>
                <span className="af-note">成功/失败都立刻清空密码，绝不进日志与审计。普通成员请找管理员在安全页解锁。</span>
              </>
            ) : role === 'member' && context?.user_id ? (
              <>
                <div className="af-row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    className="af-input"
                    type="password"
                    data-testid="l0-unlock-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    placeholder="你的写解锁口令"
                    disabled={busy}
                    autoComplete="off"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="af-btn pri"
                    data-testid="l0-unlock-submit"
                    disabled={busy}
                    onClick={submit}
                    style={{ flex: 'none' }}
                  >
                    {busy ? '解锁中…' : '解锁并自动重放'}
                  </button>
                </div>
                <span className="af-note">用管理员发给你的写解锁口令自解锁（§4.4.4-B · 与管理密码互不替代）。成功/失败都立刻清空口令，绝不进日志与审计。</span>
              </>
            ) : (
              <p className="af-note" data-testid="l0-unlock-need-admin">
                {role === null
                  ? '未登录：解锁写密钥需要会话。请先登录后由管理员输入管理密码解锁，或成员用写解锁口令解锁。'
                  : '当前账号不是管理员：不给点了必然失败的按钮，请管理员到「安全页 → L0 管理 → 写密钥」解锁后再试。'}
              </p>
            )}
            {error && <p className="af-note bad" data-testid="l0-unlock-error">解锁失败：{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}
