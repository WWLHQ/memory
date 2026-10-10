// 生命周期页（REQ-006 / P4）调参面板（T4）
// §P4 调参面板：half_life/confidence/importance 滑杆实时刷新 freshness 预览；pinned/locked 开关；
// decay 徽标；access/reinforce 只读分家；locked 后全部置灰（G4）。
import type { LifecycleRecord } from './types.ts';
import { freshnessPreview } from './logic.ts';

export function ParamPanel({
  rec,
  onParam,
}: {
  rec: LifecycleRecord;
  onParam: (patch: Partial<Pick<LifecycleRecord, 'half_life_days' | 'confidence' | 'importance' | 'pinned' | 'locked'>>) => void;
}) {
  const fresh = freshnessPreview(rec.ageDays, rec.half_life_days);
  const lockDisabled = rec.locked;

  const slider = (
    label: string,
    key: 'half_life_days' | 'confidence' | 'importance',
    min: number, max: number, step: number,
  ) => (
    <div className="slider" key={key}>
      <label>{label}</label>
      <input
        type="range"
        min={min} max={max} step={step}
        value={rec[key]}
        disabled={lockDisabled}
        data-testid={`sl-${key}`}
        onChange={(e) => onParam({ [key]: Number(e.target.value) })}
      />
      <span className="val">{rec[key]}</span>
    </div>
  );

  return (
    <div className={`panel${rec.locked ? ' locked' : ''}`} data-testid="param-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>调参面板 · <span className="mid">{rec.id}</span></b>
        <span className={`temp ${rec.decay_class}`}>{rec.decay_class}</span>
      </div>

      {rec.locked && (
        <div className="locked-hint show" data-testid="locked-hint">已锁定，先解锁才能调参</div>
      )}

      {slider('半衰期（天）', 'half_life_days', 1, 365, 1)}
      {slider('confidence', 'confidence', 0.05, 1, 0.05)}
      {slider('importance', 'importance', 0.1, 1, 0.1)}

      <div className="freshness" data-testid="freshness">
        freshness 预览 = {fresh.toFixed(2)}（0.5^(age/half)）
      </div>

      <div className="kv">
        <b>access_count</b><span>{rec.access_count}</span>
        <b>reinforce_count</b><span>{rec.reinforce_count}</span>
      </div>

      <div className="row">
        <label className="sw">
          <input type="checkbox" checked={rec.pinned} disabled={lockDisabled} data-testid="sw-pinned"
            onChange={(e) => onParam({ pinned: e.target.checked })} />
          置顶（pinned）
        </label>
        <label className="sw">
          <input type="checkbox" checked={rec.locked} data-testid="sw-locked"
            onChange={(e) => onParam({ locked: e.target.checked })} />
          锁定（locked，豁免后台）
        </label>
      </div>
    </div>
  );
}
