// REQ-004 T9 开关控件（full / token_only / off），切换经回调通知（toast 由宿主处理）
// 来源：需求规格书_Agent界面内联记忆标识.md §4（19.7 可开关）、原型 177-192 行
import { useAttributionConfig } from './AttributionConfig.tsx';
import type { AttributionLevel } from '../../types/inlineAttribution.ts';

const LEVELS: Array<{ value: AttributionLevel; label: string }> = [
  { value: 'full', label: '完整 (full)' },
  { value: 'token_only', label: '仅 token (token_only)' },
  { value: 'off', label: '关闭 (off)' },
];

export function AttributionToggle({ onChange }: { onChange?: (level: AttributionLevel) => void }) {
  const { level, setLevel } = useAttributionConfig();
  return (
    <div className="attr-toggle" role="radiogroup" aria-label="内联标识级别">
      <span className="attr-toggle-label">内联标识（19.7）：</span>
      {LEVELS.map((l) => (
        <label key={l.value} className="attr-toggle-opt">
          <input
            type="radio"
            name="attribution-level"
            value={l.value}
            checked={level === l.value}
            onChange={() => {
              setLevel(l.value);
              onChange?.(l.value);
            }}
          />
          {l.label}
        </label>
      ))}
    </div>
  );
}
