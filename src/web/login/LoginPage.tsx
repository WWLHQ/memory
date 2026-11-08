// 登录页（D7）：常规桌面登录形态（应用标识 + 账号 + 密码 + 登录按钮），走真实 POST /api/login。
// 失败按后端真实原因分别提示：401（密码错误）/ 423（账号锁定）/ 账号不存在 / 来源未受信 / 后端不可达。
// 会话持久化：useLoginMirror 登录成功即写入 localStorage（session:realpage），关闭应用后仍然有效。
// 本页不做任何演示登录；未登录时其它视图由壳层按程序实际能力标为只读/禁用。
import { useEffect, useState } from 'react';
import { useLoginMirror } from '../Home/useLoginMirror.ts';
import { clearStoredSessionId, getStoredSessionId, hasActiveSession } from '../Home/crossTabAuth.ts';
import { fetchSessionContext } from '../shared/session.ts';
import { homeBaseUrl } from '../backend.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { bindTenant, rebuildKernelForDataPlane } from '../kernel.ts';
import type { Form } from '../../types/agentOnboard.ts';
import type { TenantContext } from '../../types/home.ts';
import './loginPage.css';

/** 端形态识别（与 LoginModal 同口径） */
function detectForm(): Form {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 'cli';
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'desktop';
}

/** 失败提示（code 是后端 HTTP 状态或网络层标记，仅用于如实标注） */
interface LoginError {
  code: string;
  text: string;
}

function Ico({ name, size = 14 }: { name: 'mark' | 'account' | 'lock' | 'eye' | 'login' | 'logout' | 'check' | 'warn'; size?: number }) {
  const s = { width: size, height: size } as const;
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'mark':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M12 2.5l7.5 4.3v9.4L12 21.5 4.5 16.2V6.8Z" /><path d="M12 8l3.5 2v4L12 16l-3.5-2v-4Z" /></svg>;
    case 'account':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></svg>;
    case 'lock':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case 'eye':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'login':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M10 4H5v16h5" /><path d="M14 12h7M18 8l4 4-4 4" /></svg>;
    case 'logout':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M14 4h5v16h-5" /><path d="M3 12h11M10 8l4 4-4 4" /></svg>;
    case 'check':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>;
    case 'warn':
      return <svg viewBox="0 0 24 24" style={s} {...common} aria-hidden="true"><path d="M12 3l9 16H3L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>;
    default:
      return null;
  }
}

export function LoginPage() {
  useHostTheme();
  const { login, logout } = useLoginMirror();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<LoginError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [context, setContext] = useState<TenantContext | null>(null);
  const [sid, setSid] = useState<string | null>(() => getStoredSessionId());
  const [sessionState, setSessionState] = useState<'none' | 'loading' | 'valid' | 'invalid'>(() =>
    hasActiveSession() ? 'loading' : 'none');

  // 挂载时核对本机会话：有 sessionId 就向 /api/me 查真实身份；查不到即如实标为「已失效」
  useEffect(() => {
    const current = getStoredSessionId();
    setSid(current);
    if (!current) {
      setSessionState('none');
      return;
    }
    let alive = true;
    setSessionState('loading');
    fetchSessionContext(current).then((ctx) => {
      if (!alive) return;
      if (ctx) {
        setContext(ctx);
        setSessionState('valid');
      } else {
        setContext(null);
        setSessionState('invalid');
      }
    });
    return () => { alive = false; };
  }, []);

  async function submit() {
    if (busy) return;
    setNotice(null);
    if (!account.trim()) {
      setErr({ code: '本地校验', text: '账号不能为空（本机校验，未发请求）' });
      return;
    }
    if (!password) {
      setErr({ code: '本地校验', text: '密码不能为空（本机校验，未发请求）' });
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await login({ account: account.trim(), password, form: detectForm() });
      if (res.ok) {
        setSid(res.context.session_id || getStoredSessionId());
        setContext(res.context);
        setSessionState('valid');
        setPassword('');
        // 与旧登录卡片同口径：登录成功即把真实租户绑定到内核身份，并把浏览器数据面切到会话账本
        bindTenant({
          user_id: res.context.user_id,
          team_id: res.context.team_id,
          enterprise_id: res.context.enterprise_id,
        });
        rebuildKernelForDataPlane();
        setNotice(`登录成功：${res.context.user_id} · 团队 ${res.context.team_id}。会话已保存在本机（关闭应用后仍有效）。`);
        return;
      }
      if (res.reason === 'wrong') {
        const remaining = typeof res.remaining === 'number' ? res.remaining : null;
        const tail = remaining === null
          ? '连续 5 次失败会锁定 15 分钟。'
          : remaining > 0
            ? `还可尝试 ${remaining} 次（连续 5 次将锁定 15 分钟）。`
            : '已达 5 次失败，账号即将锁定。';
        setErr({ code: 'HTTP 401', text: `密码错误。${tail}` });
      } else if (res.reason === 'locked') {
        const until = res.lockedUntil ? new Date(res.lockedUntil) : null;
        setErr({
          code: 'HTTP 423',
          text: `账号已锁定${until ? `，至 ${until.toLocaleTimeString()} 后可重试` : '（临时锁定 15 分钟）'}。`,
        });
      } else if (res.reason === 'no_account') {
        setErr({ code: '后端拒绝', text: '账号不存在（后端未受理该账号，未创建会话）。' });
      } else if (res.reason === 'empty') {
        setErr({ code: 'HTTP 400', text: '账号或密码为空（后端拒绝）。' });
      } else if (res.reason === 'origin_blocked') {
        setErr({
          code: '来源被拒',
          text: `后端在线（${homeBaseUrl()}），但当前页面来源不在受信白名单内。`
            + '该端口可能被安装版占用：请使用桌面端，或运行 npm run dev 拉起受信登录服务。',
        });
      } else {
        setErr({
          code: '后端不可达',
          text: `登录后端未响应（${homeBaseUrl()}）。请确认桌面主进程已启动，或运行 npm run dev / npm run dev:backend。`,
        });
      }
      // 登录失败后端已清掉旧会话：本页同步显示未登录
      setSid(getStoredSessionId());
      setContext(null);
      setSessionState('none');
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setErr(null);
    try {
      await logout();
      clearStoredSessionId();
      setSid(null);
      setContext(null);
      setSessionState('none');
      setNotice('已登出：本机会话已清除（其它视图回到只读）。');
    } finally {
      setBusy(false);
    }
  }

  const backend = homeBaseUrl();

  return (
    <div className="login-page" data-testid="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-mark"><Ico name="mark" size={26} /></span>
          <div>
            <h1>MemoryDesk 记忆工作台</h1>
            <p>登录后使用真实会话：账号、成本余额、同步与后端接口按会话鉴权。</p>
          </div>
        </div>

        {sessionState === 'valid' && context ? (
          <div className="login-session" data-testid="login-session-valid">
            <div className="ls-head"><Ico name="check" size={13} />已登录（会话有效）</div>
            <div className="ls-grid">
              <span>账号</span><b>{context.user_id}</b>
              <span>团队</span><b>{context.team_id}</b>
              <span>企业</span><b>{context.enterprise_id}</b>
              <span>角色</span><b>{context.role === 'admin' ? '管理员' : '成员'}</b>
              <span>会话</span><b className="mono">{sid ? `${sid.slice(0, 10)}…` : '本机已保存'}</b>
            </div>
            <div className="ls-note">会话保存在本机 localStorage（session:realpage），关闭应用后仍有效；后端重启后旧会话可能失效，本页会如实提示。</div>
            <button className="login-btn ghost" type="button" onClick={() => void doLogout()} disabled={busy}>
              <Ico name="logout" size={14} />{busy ? '处理中…' : '登出（清除本机会话）'}
            </button>
          </div>
        ) : (
          <>
            {(sessionState === 'invalid' || sessionState === 'loading') && (
              <div className="login-stale" data-testid="login-session-invalid">
                <Ico name="warn" size={13} />
                {sessionState === 'loading'
                  ? '正在核对本机会话（/api/me）…'
                  : '本机会话已失效：后端未受理该会话（多半是后端重启或已登出），请重新登录。'}
              </div>
            )}

            <div className="login-field">
              <span className="lf-ic"><Ico name="account" size={15} /></span>
              <input
                id="loginAccount"
                type="text"
                placeholder="账号（手机号或邮箱）"
                value={account}
                autoComplete="username"
                onChange={(e) => setAccount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              />
            </div>

            <div className="login-field">
              <span className="lf-ic"><Ico name="lock" size={15} /></span>
              <input
                id="loginPassword"
                type={showPwd ? 'text' : 'password'}
                placeholder="密码"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              />
              <button
                className="lf-eye"
                type="button"
                aria-label={showPwd ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPwd((v) => !v)}
              >
                <Ico name="eye" size={15} />
              </button>
            </div>

            <button className="login-btn" type="button" onClick={() => void submit()} disabled={busy}>
              <Ico name="login" size={15} />{busy ? '登录中…' : '登录'}
            </button>
          </>
        )}

        {err && (
          <div className="login-err" role="alert" data-testid="login-error">
            <span className="le-code">{err.code}</span>
            <span>{err.text}</span>
          </div>
        )}
        {notice && <div className="login-notice" role="status">{notice}</div>}

        <div className="login-foot">
          <span>后端 <b className="mono">{backend}</b></span>
          <span>POST /api/login · 会话 /api/me</span>
        </div>
      </div>
    </div>
  );
}
