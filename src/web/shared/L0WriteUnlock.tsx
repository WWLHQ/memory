// 批次41-W：L0 写密钥未解锁 → 就地提示 + 就地解锁入口。
// 背景：写密钥锁定时**每一次** L0 写入都返回 E_L0_LOCKED（§4.4.4 不落明文是硬规则），
// 但旧口径只留下一句「请管理员在安全页解锁」，用户既看不出这是锁了、也要跳到别的页面才能解。
// 本组件把那句话变成可执行动作：管理员当场输入管理密码解锁（走内核 l0UnlockWrite → 主进程 requireAdmin），
// 非管理员如实告知「需管理员解锁」并指出位置——不给一个点了必然失败的按钮。
// 密码边界：只进 l0UnlockWrite 这一次调用，不写 state 以外的任何地方；成功/失败后立刻清空输入框，
// 不进动作日志与内核审计（IPC 层只记 {ms}，见 main.ts handleIpc）。
import { useState } from 'react';
import { getKernel } from '../kernel.ts';
import { useSessionContext } from './session.ts';
import { kernelErrorText } from './kernelLoad.tsx';
import { signalL0WriteLockChanged } from './l0WriteLockSignal.ts';

export interface L0WriteUnlockProps {
  /** 失败来自哪条通道（「手动写入」/「后台采集」），出现在提示语里让用户知道是谁被挡住了 */
  scene: string;
  /** 解锁成功后回调（写入页用它把刚被挡住的那条重新提交） */
  onUnlocked?: () => void;
}

export function L0WriteUnlock({ scene, onUnlocked }: L0WriteUnlockProps) {
  const { role } = useSessionContext();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

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
        // 失败原因原样显示（内核会给「密码不符/未播种」等真实文案），但密码本身不留任何痕迹
        setPassword('');
        setError(kernelErrorText(e));
      } finally {
        setBusy(false);
      }
    })();
  }

  if (unlocked) {
    return (
      <div className="card" data-testid="l0-unlock-done">
        <b>写密钥已解锁</b>
        <div className="note">L0 写入恢复可用（只加密，不能解密查阅）。{scene}可以再试一次了。</div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="l0-write-unlock" style={{ borderColor: 'var(--warn)' }}>
      <b>写入被挡下：L0 写密钥未解锁</b>
      <div className="note">
        {scene}需要先把原文封成 L0 密文才能入库，而写密钥只在内存里、当前是锁着的
        （应用重启或上次会话中断都会锁）。<b>输入 L0 管理密码解锁后即可继续</b>——这不是数据出错，也不是没内容可写。
      </div>
      {role === 'admin' ? (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="password"
              data-testid="l0-unlock-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="L0 管理密码"
              disabled={busy}
              autoComplete="off"
            />
            <button type="button" className="btn primary" data-testid="l0-unlock-submit" disabled={busy} onClick={submit}>
              {busy ? '解锁中…' : '解锁写密钥'}
            </button>
          </div>
          <div className="note">密码只用于本次解锁，不显示、不落盘、不进日志；改管理密码仍在安全页「L0 管理」卡。</div>
        </>
      ) : (
        <div className="note" data-testid="l0-unlock-need-admin">
          {role === null
            ? '未登录：解锁写密钥需要管理员会话。请先登录后由管理员输入管理密码解锁。'
            : '当前账号不是管理员：请管理员在「安全页 → L0 管理 → 写密钥」输入管理密码解锁后再试。'}
        </div>
      )}
      {error && <div className="err" data-testid="l0-unlock-error">解锁失败：{error}</div>}
    </div>
  );
}
