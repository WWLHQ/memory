// 成员端「本账号写密钥」卡（§4.4.4-B）
// 为什么独立成一张卡：管理动作卡（L0AdminCard）挂在「危险操作卡」区，成员进去只会看到「需管理员权限」；
// 而「我有没有钥匙 / 现在是不是已开锁 / 在哪开锁」是成员的**自身信息**，位置应在「账号与密钥」页签。
//
// 两个必须分开的状态（上一版把它们混成一句「已发放…可以写入 L0」，会让人以为已解锁）：
//   ① has_wrap       有没有写解锁口令（管理员发的是钥匙）
//   ② write_unlocked 写密钥当前是否在内存（锁开着才真能写；重启/锁定后回到 false）
// 并且本卡直接给主动解锁入口：不必等写入失败才出现输入框。
import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../shared/session.ts';
import { coreL0MyWriteWrap, coreL0UnlockWriteForMember } from './coreSecurity.ts';

const MIN_LEN = 8;
const inputStyle = {
  background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)',
  borderRadius: 8, padding: 6, fontSize: 12,
} as const;
const errText = (e: unknown): string => String((e as Error)?.message ?? e);

interface MyWrapState {
  has_wrap: boolean;
  write_unlocked: boolean;
}

export function MyWriteWrapCard() {
  const { context } = useSessionContext();
  const [state, setState] = useState<MyWrapState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await coreL0MyWriteWrap());
      setErr(null);
    } catch (e) {
      setState(null);
      const m = errText(e);
      setErr(/E_AUTH_SESSION|需要登录|未登录/.test(m)
        ? '需要会话：登录后才能查看本账号的写密钥状态'
        : `读取失败：${m}`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const doUnlock = async () => {
    if (busy) return;
    if (!context?.user_id) { setUnlockErr('需要会话：登录后才能解锁写密钥'); return; }
    if (pw.length < MIN_LEN) { setUnlockErr(`写解锁口令至少 ${MIN_LEN} 位（§4.4.4-B）`); return; }
    setBusy(true); setUnlockErr(null); setMsg(null);
    try {
      await coreL0UnlockWriteForMember(context.user_id, pw);
      setPw(''); // 口令不留在 DOM
      setMsg('写密钥已解锁：现在可以写入 L0（只加密，不能查阅）');
      await refresh();
    } catch (e) {
      setPw('');
      setUnlockErr(`解锁失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const locked = state !== null && state.has_wrap && !state.write_unlocked;
  const ready = state !== null && state.has_wrap && state.write_unlocked;

  return (
    <div className="card" data-testid="my-write-wrap-card">
      <div className="row-head">
        <b>🔐 本账号写密钥（只能写入，不能查阅）</b>
        <button type="button" className="btn" data-testid="my-wrap-refresh" disabled={busy} onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      {err ? (
        <div className="note" data-testid="my-wrap-error" style={{ color: 'var(--warn)' }}>{err}</div>
      ) : state === null ? (
        <div className="note" data-testid="my-wrap-loading">读取中…</div>
      ) : (
        <>
          {/* 状态一：有没有钥匙（管理员发的） */}
          <div className="row" data-testid="my-wrap-grant">
            <span className="dim">写解锁口令</span>
            {state.has_wrap ? (
              <span className="status active" data-testid="my-wrap-grant-state">已发放</span>
            ) : (
              <span className="status deprecated" data-testid="my-wrap-grant-state">未发放</span>
            )}
          </div>
          {/* 状态二：现在锁开着没有（重启/锁定后回到未解锁） */}
          <div className="row" data-testid="my-wrap-unlocked">
            <span className="dim">写密钥当前状态</span>
            {state.write_unlocked ? (
              <span className="status active" data-testid="my-wrap-unlocked-state">已解锁 · 现在可以写入 L0</span>
            ) : (
              <span className="status deprecated" data-testid="my-wrap-unlocked-state">未解锁 · 现在写入会被挡下</span>
            )}
          </div>
        </>
      )}

      {/* 主动解锁入口：不必等写入失败才出现 */}
      {locked && (
        <div className="row" data-testid="my-wrap-unlock-form">
          <input type="password" data-testid="my-wrap-unlock-pw" value={pw} placeholder="你的写解锁口令"
            style={{ ...inputStyle, width: 200 }} onChange={(e) => setPw(e.target.value)} />
          <button type="button" className="btn primary" data-testid="my-wrap-unlock-submit"
            disabled={busy} onClick={() => void doUnlock()}>
            解锁写密钥
          </button>
          <span className="dim">用你自己的口令（不是管理员密码）</span>
        </div>
      )}

      {msg && <div className="note" data-testid="my-wrap-msg">{msg}</div>}
      {unlockErr && <div className="note" data-testid="my-wrap-unlock-error" style={{ color: 'var(--warn)' }}>{unlockErr}</div>}

      {state !== null && !state.has_wrap && (
        <div className="note" data-testid="my-wrap-no-grant-note">
          还没有写解锁口令：请联系管理员在「账号与安全 → 危险操作卡 → L0 密钥环」里为你的账号发放，
          发放后此处会出现输入框。
        </div>
      )}
      {ready && (
        <div className="note" data-testid="my-wrap-ready-note">
          已解锁（进程级）：本机重启或被管理员锁定后会回到「未解锁」，届时在本卡重新输入口令即可。
        </div>
      )}

      <div className="note" data-testid="my-wrap-where">
        <b>还有一处会要你输口令：</b>写入页提交后若提示「L0 写密钥未解锁」，页面会就地出现「解锁写密钥」输入框，
        填同一个写解锁口令，解锁成功后那条写入会自动重放。采集器等其它写入入口同理。
      </div>
      <div className="note" data-testid="my-wrap-scope-note">
        口径：写解锁口令只解「写密钥」（加密写入），<b>不能</b>解密查阅；解密查阅要管理员单独发的查阅授权。
        两样东西不在一张表里，别互相找。
      </div>
    </div>
  );
}
