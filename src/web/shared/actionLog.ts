// 渲染层动作日志（批次7）：任何页面 import 本模块即自动安装全局捕获。
// 自动记录：页面进入 / 点击可交互元素 / 表单提交 / 复选与下拉变更 / JS 错误 / 未处理 Promise。
// 写入路径：顶层窗口 → preload log.write → 主进程 actions.log；iframe → 父窗口消息桥转发。
// 敏感值绝不记录：输入框只记类型，不记内容（密码/密钥永不出渲染层）。
import { hostLog, type HostLogOptions } from '../../desktop/hostBridge.ts';
import { installMirrorFailureNotice } from './mirrorFailureNotice.ts';

export function uiLog(scope: string, action: string, detail?: unknown, opts?: HostLogOptions): void {
  try {
    hostLog(scope, action, detail, opts);
  } catch {
    /* 日志绝不打断业务 */
  }
}

const MAX_TEXT = 80;

function pageName(): string {
  try {
    return `${window.location.pathname.split('/').pop() || 'index'}${window.location.hash}`;
  } catch {
    return 'unknown';
  }
}

function cleanText(raw: string | null | undefined): string | undefined {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

/** 交互元素摘要：标签/ID/testid/文案/类型（不含输入值） */
function describeElement(el: Element): Record<string, unknown> {
  const out: Record<string, unknown> = { tag: el.tagName.toLowerCase(), page: pageName() };
  const id = el.getAttribute('id');
  if (id) out.id = id;
  const testid = el.getAttribute('data-testid');
  if (testid) out.testid = testid;
  if (el instanceof HTMLInputElement) out.type = el.type;
  const text = cleanText(el.textContent);
  if (text) out.text = text;
  if (el instanceof HTMLButtonElement && el.disabled) out.disabled = true;
  return out;
}

/** 从事件目标向上找最近的交互元素（文本点击命中的是内层 span） */
function findInteractive(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest('button,a,[role="button"],input,select,textarea,[data-testid]');
}

let installed = false;

/** 安装全局 UI 动作捕获（幂等；在 document 就绪前调用会自动等到 DOMContentLoaded） */
export function installUiActionLog(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  uiLog('ui', 'page_view', { page: pageName() });

  document.addEventListener('click', (e) => {
    try {
      const el = findInteractive(e.target);
      if (!el) return;
      uiLog('ui', 'click', describeElement(el));
    } catch { /* 捕获失败不影响交互 */ }
  }, true);

  document.addEventListener('submit', (e) => {
    try {
      const form = e.target instanceof HTMLFormElement ? e.target : null;
      uiLog('ui', 'submit', form ? describeElement(form) : { page: pageName() });
    } catch { /* ignore */ }
  }, true);

  document.addEventListener('change', (e) => {
    try {
      const el = e.target;
      // 只记勾选/下拉这类布尔或枚举值；文本/密码输入不记内容
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        uiLog('ui', 'change', { ...describeElement(el), checked: el.checked });
      } else if (el instanceof HTMLSelectElement) {
        uiLog('ui', 'change', { ...describeElement(el), value: cleanText(el.value) });
      }
    } catch { /* ignore */ }
  }, true);

  window.addEventListener('error', (e) => {
    uiLog('ui', 'script_error', {
      page: pageName(),
      message: cleanText(e.message),
      source: cleanText(`${e.filename ?? ''}:${e.lineno ?? 0}`),
    }, { level: 'error' });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
    uiLog('ui', 'unhandled_rejection', { page: pageName(), reason: cleanText(reason) }, { level: 'error' });
  });
}

// 模块加载即安装（引擎会把它注入每个页面入口）
installUiActionLog();
// 阶段5-C：镜像上抛失败的全局可见提示（幂等；只在真实页面且真失败时创建 DOM）
installMirrorFailureNotice();
