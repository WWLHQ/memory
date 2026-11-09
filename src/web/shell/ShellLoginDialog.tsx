// 壳层登录弹窗（批次49）：菜单栏 / 快速访问工具条 / 登录状态处三处入口共用同一个实例。
//
// 口径：
// - 只走真实 POST /api/login，并用 /api/me 核对身份；会话仍存 localStorage（session:realpage）；
// - 401（密码错误/账号不存在）、后端不可达、成功三态如实显示，文案与登录页同源；
// - 已登录时在弹窗内显示账号 / 团队 / 角色，并提供登出（登出结果同样如实回执）。

import { useEffect, useState } from 'react';
import { useLoginMirror } from '../Home/useLoginMirror.ts';
import { clearStoredSessionId, getStoredSessionId } from '../Home/crossTabAuth.ts';
import { fetchSessionContext } from '../shared/session.ts';
import { homeBaseUrl } from '../backend.ts';
import { Icon } from './Icons.tsx';
import type { Form } from '../../types/agentOnboard.ts';
import type { TenantContext } from '../../types/home.ts';

/** 端形态识别（与登录页同口径） */
function detectForm(): Form {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 'cli';
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'desktop';
}

export interface ShellLoginDialogProps {
  open: boolean;
  onClose: () => void;
  /** 会话变化回传（登录成功 / 登出 / 会话失效）；壳层据此更新登录状态处 */
  onSession: (ctx: TenantContext | null) => void;
}

interface DialogError {
  code: string;
  text: string;
}

export function ShellLoginDialog({ open, onClose, onSession }: ShellLoginDialogProps) {
  const { login } = useLoginMirror();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<DialogError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [context, setContext] = useState<TenantContext | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [check, setCheck] = useState<'none' | 'loading' | 'valid' | 'invalid'>('none');
  /** 密码显示切换：默认隐藏；切换只改 type，不改值也不抢焦点 */
  const [showPw, setShowPw] = useState(false);

  // 每次打开都核对本机会话：有 sessionId 就向 /api/me 查真实身份，查不到即如实标为失效
  useEffect(() => {
    if (!open) return;
    setShowPw(false);
    const current = getStoredSessionId();
    setSid(current);
    setErr(null);
    setNotice(null);
    if (!current) {
      setContext(null);
      setCheck('none');
      onSession(null);
      return;
    }
    let alive = true;
    setCheck('loading');
    fetchSessionContext(current).then((ctx) => {
      if (!alive) return;
      setContext(ctx);
      setCheck(ctx ? 'valid' : 'invalid');
      onSession(ctx);
    });
    return () => { alive = false; };
  }, [open, onSession]);

  // Esc 关闭（点击遮罩由 onMouseDown 处理）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

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
        setCheck('valid');
        setPassword('');
        onSession(res.context);
        setNotice(`登录成功：${res.context.user_id} · 团队 ${res.context.team_id} · 角色 ${res.context.role === 'admin' ? '管理员' : '成员'}。会话已保存在本机。`);
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
          text: `后端在线（${homeBaseUrl()}），但当前页面来源不在受信白名单内。请使用桌面端，或运行 npm run dev 拉起受信登录服务。`,
        });
      } else {
        setErr({
          code: '后端不可达',
          text: `登录后端未响应（${homeBaseUrl()}）。请确认桌面主进程已启动，或运行 npm run dev / npm run dev:backend。`,
        });
      }
      // 登录失败后端已清掉旧会话：弹窗同步回到未登录
      setSid(getStoredSessionId());
      setContext(null);
      setCheck('none');
      onSession(null);
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
      const current = getStoredSessionId();
      let backendAccepted = false;
      if (current) {
        try {
          const res = await fetch(`${homeBaseUrl()}/api/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-id': current },
          });
          backendAccepted = res.ok;
        } catch {
          backendAccepted = false;
        }
      }
      clearStoredSessionId();
      setSid(null);
      setContext(null);
      setCheck('none');
      onSession(null);
      setNotice(backendAccepted
        ? '已登出：后端已受理，本机会话已清除（其它视图回到只读）。'
        : `已清除本机会话；后端未确认登出（${homeBaseUrl()} 不可达或未受理）。`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const role = context ? (context.role === 'admin' ? '管理员' : '成员') : '未登录（无角色）';

  return (
    <div className="slm-mask" data-testid="shell-login-modal" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="slm-box" role="dialog" aria-modal="true" aria-label="登录与会话">
        <div className="slm-head">
          <span className="slm-mark"><span className="dot ok" /></span>
          <b>登录与会话</b>
          <span className="slm-spring" />
          <button className="slm-x" type="button" aria-label="关闭登录弹窗" data-testid="slm-close" onClick={onClose}>✕</button>
        </div>

        {check === 'valid' && context ? (
          <div className="slm-session" data-testid="slm-session">
            <div className="slm-ok-title">已登录（/api/me 已确认）</div>
            <div className="slm-grid">
              <span>账号</span><b data-testid="slm-session-account">{context.user_id}</b>
              <span>团队</span><b data-testid="slm-session-team">{context.team_id}</b>
              <span>企业</span><b>{context.enterprise_id}</b>
              <span>角色</span><b data-testid="slm-session-role">{role}</b>
              <span>会话</span><b className="slm-mono">{sid ? `${sid.slice(0, 10)}…` : '本机已保存'}</b>
            </div>
            <div className="slm-note">会话保存在本机 localStorage（session:realpage），关闭应用后仍有效；后端重启后旧会话可能失效，此处会如实提示。</div>
            <button className="slm-btn ghost" type="button" data-testid="slm-logout" onClick={() => void doLogout()} disabled={busy}>
              {busy ? '处理中…' : '登出（清除本机会话）'}
            </button>
          </div>
        ) : (
          <>
            {check !== 'none' && (
              <div className="slm-stale" data-testid="slm-session-invalid">
                {check === 'loading'
                  ? '正在核对本机会话（/api/me）…'
                  : '本机会话已失效：后端 /api/me 未授权（会话 401），请重新登录。'}
              </div>
            )}
            <label className="slm-field">
              <span>账号</span>
              <input
                type="text"
                data-testid="slm-account"
                placeholder="账号（手机号或邮箱）"
                value={account}
                autoComplete="username"
                onChange={(e) => setAccount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              />
            </label>
            <label className="slm-field">
              <span>密码</span>
              <span className="slm-pw">
                <input
                  type={showPw ? 'text' : 'password'}
                  data-testid="slm-password"
                  placeholder="密码"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                />
                <button
                  type="button"
                  className="slm-pw-eye"
                  data-testid="slm-pw-toggle"
                  aria-label={showPw ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPw}
                  title={showPw ? '隐藏密码' : '显示密码'}
                  // 按下时不抢焦点，输入框保持光标位置；只切换 type，内容不变
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowPw((v) => !v)}
                >
                  <Icon name={showPw ? 'eye' : 'eye-off'} size={13} />
                </button>
              </span>
            </label>
            <button className="slm-btn" type="button" data-testid="slm-submit" onClick={() => void submit()} disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
          </>
        )}

        {err && (
          <div className="slm-err" role="alert" data-testid="slm-error">
            <span className="slm-code">{err.code}</span>
            <span>{err.text}</span>
          </div>
        )}
        {notice && <div className="slm-notice" role="status" data-testid="slm-notice">{notice}</div>}

        <div className="slm-foot">
          <span>后端 <b className="slm-mono">{homeBaseUrl()}</b></span>
          <span>POST /api/login · 会话 /api/me · 兜底页 login.html</span>
        </div>
      </div>
    </div>
  );
}
