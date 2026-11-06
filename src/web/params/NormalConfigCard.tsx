// P5-T3 普通配置卡（17.6 文案化，G7 不暴露参数名）
import type { NormalConfig } from './types.ts';
import { IMPORTANCE_LABEL, RETENTION_LABEL, SPEED_LABEL } from './defaults.ts';
import { retentionToArchive, speedToHalfLife } from './logic.ts';

interface Props {
  cfg: NormalConfig;
  onChange: (next: NormalConfig, changed: string) => void;
}

export function NormalConfigCard({ cfg, onChange }: Props) {
  const set = (patch: Partial<NormalConfig>, label: string) => onChange({ ...cfg, ...patch }, label);
  return (
    <div className="card" data-testid="normal-config">
      <b>普通配置（17.6）</b>
      <div className="note">
        保存后由内核 6h 遗忘调度真实执行：遗忘速度 → 全局半衰期；保留时长 → 到龄自动归档；
        自动整理 → 后台任务总开关；重要程度=锁定 → 全局豁免。记忆行自带 half_life_days 时以行上为准。
      </div>
      <div className="row">
        <label>遗忘速度</label>
        {(['slow', 'mid', 'fast'] as const).map((s) => (
          <label key={s} style={{ cursor: 'pointer' }}>
            <input
              type="radio" name="forget" checked={cfg.forget_speed === s}
              data-testid={`speed-${s}`}
              onChange={() => set({ forget_speed: s }, `遗忘速度=${SPEED_LABEL[s]}`)}
            />{' '}
            {SPEED_LABEL[s]}
          </label>
        ))}
        <span className="dim">（内核全局半衰期 {speedToHalfLife(cfg.forget_speed)} 天；行上自带值优先）</span>
      </div>
      <div className="row">
        <label>保留时长</label>
        {(['long', 'months', 'weeks', 'short'] as const).map((r) => (
          <label key={r} style={{ cursor: 'pointer' }}>
            <input
              type="radio" name="retention" checked={cfg.retention === r}
              data-testid={`retention-${r}`}
              onChange={() => set({ retention: r }, `保留时长=${RETENTION_LABEL[r]}`)}
            />{' '}
            {RETENTION_LABEL[r]}
          </label>
        ))}
        <span className="dim">（到龄自动归档阈值 {retentionToArchive(cfg.retention)} 天）</span>
      </div>
      <div className="row">
        <label>自动整理</label>
        <input
          type="checkbox" checked={cfg.auto_organize} data-testid="auto-organize"
          onChange={(e) => set({ auto_organize: e.target.checked }, `自动整理=${e.target.checked ? '开' : '关'}`)}
        />
        <span className="dim">关则停用合并/摘要后台任务（15.2/17.10）</span>
      </div>
      <div className="row">
        <label>重要程度</label>
        {(['normal', 'important', 'locked'] as const).map((i) => (
          <label key={i} style={{ cursor: 'pointer' }}>
            <input
              type="radio" name="importance" checked={cfg.importance === i}
              data-testid={`importance-${i}`}
              onChange={() => set({ importance: i }, `重要程度=${IMPORTANCE_LABEL[i]}`)}
            />{' '}
            {IMPORTANCE_LABEL[i]}
          </label>
        ))}
        <span className="dim">锁定 → 全局豁免后台任务（本轮只记 skipped 审计）</span>
      </div>
      <div className="row">
        <label>成本单价</label>
        <input
          type="number" min={0} step={0.1} style={{ width: 96 }}
          value={cfg.cost_cny_per_mtok ?? ''}
          data-testid="cost-price"
          onChange={(e) => {
            const raw = e.target.value.trim();
            const v = raw === '' ? null : Number(raw);
            set({ cost_cny_per_mtok: Number.isFinite(v) ? v : null }, `成本单价=${raw === '' ? '未设置' : `¥${raw}/百万预算单位 t`}`);
          }}
        />
        <span className="dim">¥ / 百万预算单位 t；金额按本地预算单位估算（非厂商账单）；留空 = 不显示金额</span>
      </div>
    </div>
  );
}
