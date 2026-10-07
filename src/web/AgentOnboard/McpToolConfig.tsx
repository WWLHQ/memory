// MCP 工具配置行（规格 T5 / 19.5 · 须带 project_id）
// ⚠ 结构与文案严格对齐原型 renderCards 的「MCP 工具（19.5，须带 project_id）」一行。
import type { ToolToggle, ToolToggleOrFalse, UiRecallTool } from '../../types/agentOnboard.ts';

/**
 * 工具开关的取值归一化。
 * 原型用 `pref:false` 表示"该工具未启用"（布尔），其余为对象。
 * 写入时必须归一化，否则 `false.on = x` 会抛
 * "Cannot create property 'on' on boolean 'false'"（真实 BUG，勿改回直接赋值）。
 */
export function toolRef(t: ToolToggleOrFalse): ToolToggle {
  if (typeof t !== 'object' || t === null) return { on: false };
  return t;
}

interface Props {
  tools: {
    recall: UiRecallTool;
    write: ToolToggle;
    pref: ToolToggleOrFalse;
  };
  onChange: (tool: 'recall' | 'write' | 'pref', checked: boolean) => void;
}

export function McpToolConfig({ tools, onChange }: Props) {
  const recall = toolRef(tools.recall);
  const write = toolRef(tools.write);
  const pref = toolRef(tools.pref);
  return (
    <div className="row">
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>MCP 工具（19.5，须带 project_id）：</span>
      <label className="sw">
        <input
          type="checkbox"
          data-tool="recall"
          checked={recall.on}
          onChange={(e) => onChange('recall', e.target.checked)}
        />
        recall_memory top_k={tools.recall.topk} scene={tools.recall.scene}
      </label>
      <label className="sw">
        <input
          type="checkbox"
          data-tool="write"
          checked={write.on}
          onChange={(e) => onChange('write', e.target.checked)}
        />
        write_memory
      </label>
      <label className="sw">
        <input
          type="checkbox"
          data-tool="pref"
          checked={pref.on}
          onChange={(e) => onChange('pref', e.target.checked)}
        />
        get_user_preferences
      </label>
    </div>
  );
}