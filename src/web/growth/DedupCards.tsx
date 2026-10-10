// P14-T3 自净化侧组件：五维评分卡 + 短路嫁接流程 + 24h 统计 + 开发者调参（6.1/6.2，G7）
import type { DedupSample, DimKey, DimWeights, LayerThresholds, ShortCircuitStep } from './types.ts';
import { DIM_LABELS, LAYERS } from './seed.ts';
import { isDuplicate, layerThresholdOf, weightedScore } from './logic.ts';

export function DedupCard({
  sample, weights, thresholds, onResample,
}: {
  sample: DedupSample;
  weights: DimWeights;
  thresholds: LayerThresholds;
  onResample: () => void;
}) {
  const score = weightedScore(sample.dims, weights);
  const threshold = layerThresholdOf(sample.target, thresholds);
  const dup = isDuplicate(score, threshold);

  return (
    <div className="card" data-testid="dedup-card">
      <b>五维判重 · 当前样本</b>
      <div className="note">五维权重来自 6.1（只读展示，开发者模式可调）；llm_judge 维度依赖 P13 的 judge 模型（温度恒 0）。</div>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1 }} data-testid="sample-label">{sample.label}</span>
        <button className="btn" data-testid="resample-btn" onClick={onResample}>🔄 重新判重</button>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10 }}>
        {(Object.keys(DIM_LABELS) as DimKey[]).map((k) => (
          <span key={k} style={{ fontSize: 12 }}>
            {DIM_LABELS[k]}：<b data-testid={`dim-${k}`}>{sample.dims[k].toFixed(2)}</b>
            <span className="dim"> ×{weights[k]}</span>
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 18, marginTop: 10, alignItems: 'center' }}>
        <span data-testid="dedup-score">综合分：<b>{score.toFixed(3)}</b></span>
        <span data-testid="dedup-target">目标层：{sample.target}（阈值 {threshold.toFixed(2)}）</span>
        <span
          data-testid="dedup-verdict"
          style={{ fontWeight: 700, color: dup ? 'var(--danger,#ff5d5d)' : 'var(--ok,#5dd39e)' }}
        >
          {dup ? '🔁 is_duplicate=true → 合并' : '✨ 未命中 → 走短路嫁接'}
        </span>
      </div>
    </div>
  );
}

export function ShortCircuitFlow({ steps, stats }: { steps: ShortCircuitStep[]; stats: { short_circuit_hits: number; merged: number; avg_cost_ms: number } }) {
  return (
    <div className="card" data-testid="short-circuit-card">
      <b>短路嫁接路径（6.2）</b>
      <div className="note">写入 → 从 L1 逐层查重 → 命中层即合并停止，未命中走新建 —— 避免全层扫描。</div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }} data-testid="sc-flow">
        <span className="badge">写入</span>
        {steps.map((s, i) => (
          <span key={`${s.layer}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>→</span>
            <span
              className="badge"
              style={{
                background: s.hit ? 'rgba(93,211,158,.15)' : undefined,
                borderColor: s.hit ? 'var(--ok,#5dd39e)' : undefined,
                fontWeight: s.hit ? 700 : 400,
              }}
            >
              {s.layer}{s.hit ? ' ✅合并·短路' : ' 未命中'}
            </span>
          </span>
        ))}
      </div>
      {steps[steps.length - 1].action && (
        <div className="note" style={{ marginTop: 6 }}>{steps[steps.length - 1].action}</div>
      )}
      <div className="row" style={{ gap: 22, marginTop: 10 }} data-testid="stats-24h">
        <span>24h 短路命中：<b>{stats.short_circuit_hits}</b></span>
        <span>合并数（15.2）：<b>{stats.merged}</b></span>
        <span>平均查重耗时：<b>{stats.avg_cost_ms}ms</b></span>
      </div>
    </div>
  );
}

export function DevTunePanel({
  devMode, weights, thresholds, onWeights, onThresholds,
}: {
  devMode: boolean;
  weights: DimWeights;
  thresholds: LayerThresholds;
  onWeights: (k: DimKey, v: number) => void;
  onThresholds: (l: (typeof LAYERS)[number], v: number) => void;
}) {
  if (!devMode) {
    return (
      <div className="card" data-testid="dev-tune-collapsed">
        <b>判重参数（开发者模式）</b>
        <div className="note">G7：底层参数名（权重/阈值）不向普通用户暴露 —— 本页开发者模式开启后可调。</div>
      </div>
    );
  }
  return (
    <div className="card" data-testid="dev-tune-panel">
      <b>判重参数 · 开发者模式（17.6）</b>
      <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        {(Object.keys(DIM_LABELS) as DimKey[]).map((k) => (
          <label key={k} style={{ fontSize: 12 }}>
            {DIM_LABELS[k]}：
            <input
              data-testid={`w-${k}`}
              type="number" min={0} max={1} step={0.05} value={weights[k]}
              onChange={(e) => onWeights(k, Number(e.target.value))}
              style={{ width: 70, marginLeft: 4 }}
            />
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        {LAYERS.map((l) => (
          <label key={l} style={{ fontSize: 12 }}>
            {l} 阈值：
            <input
              data-testid={`th-${l}`}
              type="number" min={0} max={1} step={0.01} value={thresholds[l]}
              onChange={(e) => onThresholds(l, Number(e.target.value))}
              style={{ width: 70, marginLeft: 4 }}
            />
          </label>
        ))}
      </div>
      <div className="note" style={{ marginTop: 8 }}>R1：权重和=1.0；逐层阈值 L1→L6 单调不减。</div>
    </div>
  );
}
