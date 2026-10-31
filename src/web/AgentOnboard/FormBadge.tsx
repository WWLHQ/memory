// 按端置灰徽标（规格 T10 / AC-003.10 / 19.10）
// ⚠ 文案严格对齐原型 applyForm() 的 label 映射。
// 真实化：桌面端按真实宿主能力标注——
//   native=顶层 preload 直连 / bridge=概览页 iframe 内经宿主桥转发 / none=浏览器无宿主能力。
// （Electron preload 只在主 frame 执行，iframe 内无 window.__ELECTRON__，故不能只看该标记。）
import { hostCapability } from '../../desktop/hostBridge.ts';
import type { Form } from '../../types/agentOnboard.ts';

const FORM_LABEL: Record<Form, string> = {
  desktop: '当前端：桌面',
  web: '当前端：Web（仅注册表+心跳）',
  mobile: '当前端：移动端（仅心跳+手动）',
  mac: '当前端：macOS（全量发现可用）',
  linux: '当前端：Linux 系统（CLI，系统注册+进程，无 GUI）',
  cli: '当前端：CLI（注册+进程，命令触发）',
};

/** 各端需置灰的信号源（19.10 矩阵） */
export const GRAYED_BY_FORM: Record<Form, string[]> = {
  desktop: [], web: ['proc'], mobile: ['proc', 'mcp'], mac: [], linux: ['hb'], cli: ['hb'],
};

interface Props {
  form: Form;
}

export function FormBadge({ form }: Props) {
  const cap = hostCapability();
  // 仅 desktop 追加真实宿主能力后缀；其余端保持原型原文
  const label = form === 'desktop'
    ? `当前端：桌面${
        cap === 'native' ? '（桌面壳 · 宿主真扫可用）'
        : cap === 'bridge' ? '（桌面壳·概览页内嵌 · 宿主真扫可用）'
        : '（浏览器 · 宿主真扫不可用）'
      }`
    : FORM_LABEL[form];
  return (
    <span
      className={`pill${cap !== 'none' ? ' on' : ''}`}
      id="formBadge"
      style={cap === 'none' ? { background: 'var(--warn, #b8860b)' } : undefined}
    >
      {label}
    </span>
  );
}