// 按端置灰徽标（规格 T10 / AC-003.10 / 19.10）
// ⚠ 文案严格对齐原型 applyForm() 的 label 映射。
import type { Form } from '../../types/agentOnboard.ts';

const FORM_LABEL: Record<Form, string> = {
  desktop: '当前端：桌面（全量发现可用）',
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
  return (
    <span className="pill on" id="formBadge" style={{ marginLeft: 'auto' }}>
      {FORM_LABEL[form]}
    </span>
  );
}