// P5-T3 开发者模式（折叠面板，暴露底层参数；2.4.3 / 2.4.1 / 15.3 / 9.10 / 15.1）
import type { DevParams } from './types.ts';
import { LEVEL_MAPPING } from './seed.ts';
import { payloadOrdered, validateNM, validateWeights } from './logic.ts';

interface Props {
  dev: DevParams;
  onChange: (next: DevParams, changed: string) => void;
}

const WK = ['w_f', 'w_i', 'w_c', 'w_a'] as const;

export function DevPanel({ dev, onChange }: Props) {
  const setW = (k: (typeof WK)[number], v: number) => {
    const weights = { ...dev.weights, [k]: v };
    onChange({ ...dev, weights }, `权重 ${k}=${v}`);
  };
  const setP = (k: keyof DevParams['payload'], v: number) =>
    onChange({ ...dev, payload: { ...dev.payload, [k]: v } }, `payload ${k}=${v}`);
  const setC = (k: keyof DevParams['cold'], v: number) =>
    onChange({ ...dev, cold: { ...dev.cold, [k]: v } }, `补查 ${k}=${v}`);

  const wErr = validateWeights(dev.weights);
  const pErr = payloadOrdered(dev.payload);
  const nmErr = validateNM(dev.n_days, dev.m_days);

  return (
    <details className="card" data-testid="dev-panel">
      <summary style={{ cursor: 'pointer' }}><b>开发者模式（底层参数）</b> <span className="dim">— 普通用户无需展开（G7）</span></summary>

      <div className="row" style={{ marginTop: 10 }}>
        <b>模式权重（2.4.3，和 = 1.0）</b>
        {WK.map((k) => (
          <label key={k} style={{ fontSize: 12 }}>
            {k}
            <input
              type="number" step={0.05} min={0} max={1} value={dev.weights[k]} style={{ width: 64 }}
              data-testid={`w-${k}`}
              onChange={(e) => setW(k, Number(e.target.value))}
            />
          </label>
        ))}
        <span className={wErr ? 'status deprecated' : 'dim'} data-testid="w-sum">
          和 = {(dev.weights.w_f + dev.weights.w_i + dev.weights.w_c + dev.weights.w_a).toFixed(2)}
          {wErr ? `（${wErr}）` : ' ✓'}
        </span>
      </div>

      <div className="row">
        <b>payload 三档（2.4.1）</b>
        {(['soft', 'warn', 'break'] as const).map((k) => (
          <label key={k} style={{ fontSize: 12 }}>
            {{ soft: '软上限', warn: '告警', break: '熔断' }[k]}
            <input
              type="number" min={100} value={dev.payload[k]} style={{ width: 72 }}
              data-testid={`payload-${k}`}
              onChange={(e) => setP(k, Number(e.target.value))}
            />
          </label>
        ))}
        <span className={pErr ? 'status deprecated' : 'dim'} data-testid="payload-check">{pErr ?? '递增 ✓'}</span>
      </div>

      <div className="row">
        <b>Cold/dormant 补查（15.3）</b>
        <label style={{ fontSize: 12 }}>Cold sim≥<input type="number" step={0.01} value={dev.cold.cold_sim} style={{ width: 56 }} data-testid="cold-sim" onChange={(e) => setC('cold_sim', Number(e.target.value))} /></label>
        <label style={{ fontSize: 12 }}>dormant sim≥<input type="number" step={0.01} value={dev.cold.dormant_sim} style={{ width: 56 }} data-testid="dormant-sim" onChange={(e) => setC('dormant_sim', Number(e.target.value))} /></label>
        <label style={{ fontSize: 12 }}>Top1≥<input type="number" step={0.1} value={dev.cold.top1_min} style={{ width: 48 }} data-testid="top1-min" onChange={(e) => setC('top1_min', Number(e.target.value))} /></label>
        <label style={{ fontSize: 12 }}>L2≤<input type="number" value={dev.cold.l2_max_tokens} style={{ width: 56 }} data-testid="l2-max" onChange={(e) => setC('l2_max_tokens', Number(e.target.value))} />t</label>
        <span className="dim">dormant 门槛须不低于 Cold</span>
      </div>

      <div className="row">
        <b>老化 N/M 天（9.10）</b>
        <label style={{ fontSize: 12 }}>N=<input type="number" value={dev.n_days} style={{ width: 56 }} data-testid="n-days" onChange={(e) => onChange({ ...dev, n_days: Number(e.target.value) }, `N=${e.target.value}d`)} /></label>
        <label style={{ fontSize: 12 }}>M=<input type="number" value={dev.m_days} style={{ width: 56 }} data-testid="m-days" onChange={(e) => onChange({ ...dev, m_days: Number(e.target.value) }, `M=${e.target.value}d`)} /></label>
        <span className={nmErr ? 'status deprecated' : 'dim'} data-testid="nm-check">{nmErr ?? 'N<M ✓'}</span>
      </div>

      <div className="note" data-testid="level-mapping">
        重要性等级映射（15.1）：{LEVEL_MAPPING.map((l) => `L${l.level}=${l.weight}·${l.decay}`).join('，')}；
        <b>等级 5 永不清除</b>。
      </div>
    </details>
  );
}
