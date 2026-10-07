// 隔离粒度配置行（规格 19.4 · R1 project_id 共享 / user_id 偏好跨项目）
// ⚠ 结构与文案严格对齐原型 renderCards 的「隔离粒度（19.4）」一行。
import type { UiIso } from '../../types/agentOnboard.ts';

interface Props {
  iso: UiIso;
  onChange: (key: 'projShare' | 'prefCross', checked: boolean) => void;
}

export function IsolationConfig({ iso, onChange }: Props) {
  return (
    <div className="row">
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>隔离粒度（19.4）：</span>
      <label className="sw">
        <input
          type="checkbox"
          data-iso="projShare"
          checked={iso.projShare}
          onChange={(e) => onChange('projShare', e.target.checked)}
        />
        项目层按 project_id 跨 Agent 共享
      </label>
      <label className="sw">
        <input
          type="checkbox"
          data-iso="prefCross"
          checked={iso.prefCross}
          onChange={(e) => onChange('prefCross', e.target.checked)}
        />
        个人偏好跨项目共享（user_id 级）
      </label>
    </div>
  );
}