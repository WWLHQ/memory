// 阶段5-C：镜像上抛失败的全局可见提示。
// 所有页面入口都已 import actionLog，由它调用一次 installMirrorFailureNotice()（幂等）。
// 只在真实页面（存在 #root）且真的收到失败事件时创建 DOM —— 单测环境不留残留。
// 提示条 pointer-events:none（仅关闭按钮可点），绝不拦截页面交互。
import { MIRROR_FAILURE_EVENT, type MirrorFailure } from './mirrorFailureEvent.ts';

const TESTID = 'mirror-failure-notice';
let installed = false;
let dismissed = false;
let box: HTMLDivElement | null = null;
let handler: ((e: Event) => void) | null = null;

function isRealPage(): boolean {
  return typeof document !== 'undefined' && document.getElementById('root') !== null;
}

function ensureBox(): HTMLDivElement | null {
  if (box && box.isConnected) return box;
  if (!isRealPage()) return null;
  const el = document.createElement('div');
  el.dataset.testid = TESTID;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed', bottom: '8px', right: '8px', zIndex: '2147483000',
    maxWidth: '420px', padding: '8px 12px', borderRadius: '6px',
    background: '#4a1d1d', color: '#ffe9e9', font: '12px/1.5 system-ui, sans-serif',
    pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,.35)',
  });
  document.body.appendChild(el);
  box = el;
  return el;
}

function render(f: MirrorFailure): void {
  if (dismissed) return;
  const el = ensureBox();
  if (!el) return;
  el.textContent = '';

  const text = document.createElement('span');
  text.textContent = `镜像上抛失败：${f.source}/${f.action} · ${f.reason}（可选后端不可达，本地数据未受影响）`;
  el.appendChild(text);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '×';
  btn.setAttribute('aria-label', '关闭镜像失败提示');
  btn.dataset.testid = 'mirror-failure-dismiss';
  Object.assign(btn.style, {
    marginLeft: '8px', pointerEvents: 'auto', background: 'transparent',
    color: 'inherit', border: '0', cursor: 'pointer', fontSize: '14px',
  });
  btn.addEventListener('click', () => {
    dismissed = true;
    el.remove();
    box = null;
  });
  el.appendChild(btn);
}

/** 由 actionLog 在模块加载时调用一次（幂等）；只监听事件，不 import mirrorClient */
export function installMirrorFailureNotice(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  handler = (e: Event) => {
    const f = (e as CustomEvent<MirrorFailure>).detail;
    if (f && typeof f.reason === 'string') render(f);
  };
  window.addEventListener(MIRROR_FAILURE_EVENT, handler);
}

/** 测试用：卸载监听并复位提示条状态 */
export function resetMirrorFailureNoticeForTests(): void {
  if (handler && typeof window !== 'undefined') window.removeEventListener(MIRROR_FAILURE_EVENT, handler);
  handler = null;
  installed = false;
  dismissed = false;
  box?.remove();
  box = null;
}
