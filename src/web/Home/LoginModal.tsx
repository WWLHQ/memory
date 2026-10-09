// REQ-005 T8：登录卡片组件（§0.3 弹出子视图）
// 结构对齐 design/ui/登录与首页_原型.html：.login-modal(#loginModal)/.login-box/#acc/#pwd/#btnLogin/#btnScan/#btnKey/#loginErr/#btnCloseLogin/.toast
// 行为：默认隐藏（无 .show）；open→.login-modal.show；校验非空；密码错记审计+锁定提示；成功 onSuccess(context)；
// 端形态自动识别只读（无输入控件）+ 团队只读（无编辑控件）；扫码/系统密钥走回调+toast。
// 登录动作经 T5 useLogin（注入 loginFn 便于测试 mock）；审计由 T3/T10 落盘，本组件只消费结果文案。
import { useState } from 'react';
import { useLogin } from './tenantContext.tsx';
import type { TenantContext } from '../../types/home.ts';
import type { Form } from '../../types/agentOnboard.ts';

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
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const detectedForm = form ?? detectForm();

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
      onSuccess(res.context);
    } else if (res.reason === 'locked') {
      const at = res.lockedUntil ? new Date(res.lockedUntil).toLocaleTimeString() : '稍后';
      setErr(`账号已锁定，请于 ${at} 后重试（错 5 次锁 15min）`);
    } else if (res.reason === 'no_account') {
      setErr('账号不存在，已记审计');
    } else {
      setErr('密码错误，已记审计（错 5 次锁 15min）');
    }
  }

  return (
    <div className={`login-modal${open ? ' show' : ''}`} id="loginModal">
      <div className="login-box">
        <h3>
          登录（确定同步身份）
          <span className="close" id="btnCloseLogin" role="button" tabIndex={0} onClick={onClose}>
            ×
          </span>
        </h3>
        <div className="row">
          <span className="lbl">账号</span>
          <input
            type="text"
            id="acc"
            placeholder="user_001 或邮箱"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <div className="row">
          <span className="lbl">密码</span>
          <input
            type="password"
            id="pwd"
            placeholder="········"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="row" id="rowForm">
          <span className="lbl">端形态</span>
          <span className="pill on">自动识别 = {FORM_LABEL[detectedForm]}</span>
        </div>
        <div className="row" id="rowTeam">
          <span className="lbl">团队</span>
          <span className="pill">团队（管理员分配 · 只读 · P12）</span>
        </div>
        <div className="row">
          <button className="btn primary" id="btnLogin" type="button" onClick={handleLogin}>
            登 录
          </button>
          <button className="btn" id="btnScan" type="button" onClick={() => { onScan?.(); setToast('Web 扫码登录：同账号（审计 form:web）'); }}>
            扫码（Web）
          </button>
          <button className="btn" id="btnKey" type="button" onClick={() => { onKey?.(); setToast('mac/CLI 系统密钥登录：非交互 token（审计 form:cli）'); }}>
            系统密钥（mac/CLI）
          </button>
        </div>
        <div className="err" id="loginErr">
          {err}
        </div>
        <div className="toast" id="toast" style={{ display: toast ? 'block' : 'none' }}>
          {toast}
        </div>
      </div>
    </div>
  );
}
