// REQ-005 T8：登录卡片组件（§0.3 弹出子视图）
// 结构对齐 design/ui/登录与首页_原型.html：.login-modal(#loginModal)/.login-box/#acc/#pwd/#btnLogin/#btnScan/#btnKey/#loginErr/#btnCloseLogin/.toast
// 行为：默认隐藏（无 .show）；open→.login-modal.show；校验非空；密码错记审计+锁定提示；成功 onSuccess(context)；
// 端形态自动识别只读（无输入控件）+ 团队只读（无编辑控件）；扫码/系统密钥走回调+toast。
// 登录动作经 T5 useLogin（注入 loginFn 便于测试 mock）；审计由 T3/T10 落盘，本组件只消费结果文案。
// 新增：支持用户自助注册（POST /api/register），账号支持手机号/邮箱，含验证码+确认密码
import { useState, useEffect } from 'react';
import { useLogin } from './tenantContext.tsx';
import type { TenantContext } from '../../types/home.ts';
import type { Form } from '../../types/agentOnboard.ts';
import { runAutoOnboardOnLogin } from '../AgentOnboard/autoOnboard.ts';
import { getStoredSessionId } from './crossTabAuth.ts';
import { bindTenant, rebuildKernelForDataPlane } from '../kernel.ts';
import { homeBaseUrl } from '../backend.ts';

const FORM_LABEL: Record<Form, string> = {
  desktop: '桌面端',
  web: '网页端',
  mobile: '移动端',
  mac: 'Mac 端',
  linux: 'Linux 端',
  cli: 'CLI 端',
};

/** 端形态自动识别（19.10）。若将来 REQ-003 抽出 formMatrix.detectForm 可替换为复用。 */
function detectForm(): Form {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 'cli';
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'desktop';
}

export interface LoginModalProps {
  /** 是否显示（父级控制，默认隐藏） */
  open: boolean;
  /** 关闭（×）回调 */
  onClose: () => void;
  /** 登录成功回调，注入 TenantContext */
  onSuccess: (ctx: TenantContext) => void;
  /** 扫码回调（Web） */
  onScan?: () => void;
  /** 系统密钥回调（mac/CLI） */
  onKey?: () => void;
  /** 端形态；默认自动识别 */
  form?: Form;
}

export function LoginModal({ open, onClose, onSuccess, onScan, onKey, form }: LoginModalProps) {
  const login = useLogin();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [isRegister, setIsRegister] = useState(false);

  const detectedForm = form ?? detectForm();

  // 获取验证码
  useEffect(() => {
    if (!isRegister) return;
    fetchCaptcha();
  }, [isRegister]);

  async function fetchCaptcha() {
    try {
      const backend = homeBaseUrl();
      const res = await fetch(`${backend}/api/captcha`);
      const body = await res.json();
      if (body.id) {
        setCaptchaId(body.id);
        setCaptchaText(body.code); // 本地应用无短信通道：验证码直出给本机用户
      }
    } catch {
      // 验证码获取失败不影响主流程
    }
  }

  async function handleLogin() {
    if (!account.trim()) {
      setErr('账号不能为空');
      return;
    }
    if (!password) {
      setErr('密码不能为空');
      return;
    }
    const res = await login({ account: account.trim(), password, form: detectedForm });
    if (res.ok) {
      setErr('');
      setToast('');
      // 登录成功即把真实租户绑定到内核身份（后续写入/审计按真实 user/team/enterprise 记账）
      bindTenant({
        user_id: res.context.user_id,
        team_id: res.context.team_id,
        enterprise_id: res.context.enterprise_id,
      });
      // 批次28-A：浏览器模式登录成功即把内核数据面切到 HTTP 直连真实账本（桌面壳内无害）
      rebuildKernelForDataPlane();
      onSuccess(res.context);
      // 登录瞬间即在后台跑「一键接入本机 Agent」扫描并持久化结果：
      // 用户之后切到 Agent 接入页时直接显示「已自动接入」完成态，不用等切页才开始扫。
      // 传真实会话（role/sid）：连通的 MCP 客户端才允许自动写入（管理员门槛由主进程二次校验）。
      runAutoOnboardOnLogin({
        role: res.context.role ?? null,
        sid: res.context.session_id || getStoredSessionId(),
        form: detectedForm,
      });
    } else if (res.reason === 'locked') {
      const at = res.lockedUntil ? new Date(res.lockedUntil).toLocaleTimeString() : '稍后';
      setErr(`账号已锁定，请于 ${at} 后重试（错 5 次锁 15min）`);
    } else if (res.reason === 'no_account') {
      setErr('账号不存在，已记审计');
    } else if (res.reason === 'origin_blocked') {
      setErr(`本机登录后端在线（${homeBaseUrl().replace(/^https?:\/\//, '')}），但当前页面来源未被信任（CORS 白名单外）`
        + '——该端口多半被安装版桌面端占用。本页已自动探测备用端口（8211–8215）未发现受信的开发后端：'
        + '请启动/重跑 npm run dev（自动拉起受信登录服务）；桌面端可直接使用已登录的应用。');
    } else if (res.reason === 'backend_unreachable') {
      setErr(`登录后端未响应（${homeBaseUrl().replace(/^https?:\/\//, '')}）。`
        + '请从桌面端打开本应用，或运行 npm run dev（自动拉起登录服务）/ npm run dev:backend（仅起服务）。');
    } else {
      setErr('密码错误，已记审计（错 5 次锁 15min）');
    }
  }

  async function handleRegister() {
    if (!account.trim()) {
      setErr('账号不能为空');
      return;
    }
    // 账号格式校验
    const isPhone = /^1[3-9]\d{9}$/.test(account);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account);
    if (!isPhone && !isEmail) {
      setErr('账号必须是手机号或邮箱');
      return;
    }
    if (password.length < 6) {
      setErr('密码至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      setErr('两次密码不一致');
      return;
    }
    if (!captchaCode) {
      setErr('请输入验证码');
      return;
    }
    try {
      const backend = homeBaseUrl();
      const res = await fetch(`${backend}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.trim(),
          password,
          confirmPassword,
          captchaCode,
          captchaId,
        }),
      });
      const body = await res.json();
      if (res.ok && body.ok) {
        setErr('');
        setToast(`注册成功！团队 ID: ${body.team_id}，请登录`);
        setIsRegister(false);
      } else if (body.reason === 'exists') {
        setErr(body.message ?? '账号已存在，请直接登录');
      } else if (body.reason === 'invalid_captcha') {
        setErr(body.message ?? '验证码错误');
        await fetchCaptcha(); // 刷新验证码
      } else if (body.reason === 'password_mismatch') {
        setErr(body.message ?? '两次密码不一致');
      } else if (body.reason === 'weak_password') {
        setErr(body.message ?? '密码至少 6 位');
      } else if (body.reason === 'invalid_account') {
        setErr(body.message ?? '账号必须是手机号或邮箱');
      } else {
        setErr(body.message ?? '注册失败，请重试');
      }
    } catch {
      setErr('网络错误，请检查后端是否启动');
    }
  }

  return (
    <div className={`login-modal${open ? ' show' : ''}`} id="loginModal">
      <div className="login-box">
        <h3>
          {isRegister ? '注册新账号' : '登录（确定同步身份）'}
          <span className="close" id="btnCloseLogin" role="button" tabIndex={0} onClick={onClose}>
            ×
          </span>
        </h3>
        <div className="row">
          <span className="lbl">账号</span>
          <input
            type="text"
            id="acc"
            placeholder="手机号或邮箱"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <div className="row">
          <span className="lbl">密码</span>
          <input
            type="password"
            id="pwd"
            placeholder={isRegister ? '至少 6 位' : '········'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {isRegister && (
          <>
            <div className="row">
              <span className="lbl">确认密码</span>
              <input
                type="password"
                id="confirmPwd"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div className="row">
              <span className="lbl">验证码</span>
              <input
                type="text"
                id="captcha"
                placeholder={captchaText ? `输入: ${captchaText}` : '获取验证码'}
                value={captchaCode}
                onChange={(e) => setCaptchaCode(e.target.value)}
                style={{ flex: 2 }}
              />
              <button
                className="btn"
                type="button"
                onClick={fetchCaptcha}
                style={{ whiteSpace: 'nowrap', fontSize: 11 }}
              >
                {captchaText ? `${captchaText} 换` : '获取验证码'}
              </button>
            </div>
          </>
        )}
        {!isRegister && (
          <>
            <div className="row" id="rowForm">
              <span className="lbl">端形态</span>
              <span className="pill on">自动识别 = {FORM_LABEL[detectedForm]}</span>
            </div>
            <div className="row" id="rowTeam">
              <span className="lbl">团队</span>
              <span className="pill">团队（管理员分配 · 只读 · P12）</span>
            </div>
            <div className="note" data-testid="admin-hint" style={{ fontSize: 11, color: 'var(--muted)' }}>
              首次使用管理员：<code>admin</code> / <code>Admin@123456</code>（登录后请在「账号与安全」页修改默认密码）
            </div>
          </>
        )}
        <div className="row">
          {isRegister ? (
            <>
              <button className="btn primary" id="btnRegister" type="button" onClick={handleRegister}>
                注 册
              </button>
              <button className="btn" type="button" onClick={() => setIsRegister(false)}>
                返回登录
              </button>
            </>
          ) : (
            <>
              <button className="btn primary" id="btnLogin" type="button" onClick={handleLogin}>
                登 录
              </button>
              <button className="btn" id="btnScan" type="button" onClick={() => { onScan?.(); setToast('Web 扫码登录：同账号（审计 form:web）'); }}>
                扫码（Web）
              </button>
              <button className="btn" id="btnKey" type="button" onClick={() => { onKey?.(); setToast('mac/CLI 系统密钥登录：非交互 token（审计 form:cli）'); }}>
                系统密钥（mac/CLI）
              </button>
            </>
          )}
        </div>
        <div className="err" id="loginErr">
          {err}
        </div>
        <div className="toast" id="toast" style={{ display: toast ? 'block' : 'none' }}>
          {toast}
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button
            className="btn"
            style={{ fontSize: 11, color: 'var(--muted)', border: 'none', background: 'transparent' }}
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setErr('');
              setToast('');
              setConfirmPassword('');
              setCaptchaCode('');
            }}
          >
            {isRegister ? '已有账号？返回登录' : '没有账号？点击注册'}
          </button>
        </div>
      </div>
    </div>
  );
}
