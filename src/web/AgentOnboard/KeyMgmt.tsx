// 密钥管理行（规格 T7 / §4 · R5 恒脱敏不回显 / R6 轮换宽限 24h / 超 90 天告警）
// ⚠ 结构与文案严格对齐原型 renderCards 的「密钥（4.1 脱敏）」一行。
import type { UiKey } from '../../types/agentOnboard.ts';

interface Props {
  apiKey: UiKey;
}

export function KeyMgmt({ apiKey }: Props) {
  return (
    <div className="row">
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>密钥（4.1 脱敏）：</span>
      <span className="pill on" data-mask>{apiKey.mask}{apiKey.rotated ? '（新）' : ''}</span>
      <span className="pill">轮换宽限 {apiKey.grace}h · 上次 {apiKey.last}</span>
      {apiKey.last.includes('92') ? <span className="pill gold">⚠ 超 90 天未轮换</span> : null}
    </div>
  );
}