// P14-T3 自净化侧组件：五维评分卡 + 短路嫁接流程 + 24h 统计 + 开发者调参（6.1/6.2，G7）
import type { DedupSample, DimKey, DimWeights, LayerThresholds, ShortCircuitStep } from './types.ts';
import { DIM_LABELS, LAYERS } from './spec.ts';
import { isDuplicate, layerThresholdOf, weightedScore } from './logic.ts';

export function DedupCard({
  sample, weights, thresholds, onResample,
}: {
  sample: DedupSample | null;
  weights: DimWeights;
  thresholds: LayerThresholds;
  onResample: () => void;
}) {
  if (!sample) {
    return (
      <div className="card" data-testid="dedup-card">
        <b>五维判重 · 当前样本</b>
        <div className="note" data-testid="dedup-empty">
          当前记忆账本为空，无真实判重样本。请先在「写入页」或「记忆库管理页」产生真实记忆，本页将自动取最近 4 条真实记忆作判重样本（仅展示有可信测量的维度）。
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn" data-testid="resample-btn" onClick={onResample}>🔄 重新判重</button>
        </div>
      </div>
    );
  }
  const score = weightedScore(sample.dims, weights);
  const threshold = layerThresholdOf(sample.target, thresholds);
  const dup = isDuplicate(score, threshold);

  return (
    <div className="card" data-testid="dedup-card">
      <b>五维判重 · 当前样本（真实记忆）</b>
      <div className="note">
        样本 = 记忆表真实最近写入内容。semantic 取账本写时真实查重相似度，keyword/entity 为本地词面实算；
        structure 与 llm_judge 无可信单条测量（内核未接 LLM 仲裁）→ 显示「未测量」，绝不填中性值。
        综合分按已测维度权重归一化，与内核无 LLM 时的四维口径一致。
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1 }} data-testid="sample-label">{sample.label}</span>
        <button className="btn" data-testid="resample-btn" onClick={onResample}>🔄 重新判重</button>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10 }}>
        {(Object.keys(DIM_LABELS) as DimKey[]).map((k) => {
          const v = sample.dims[k];
          return (
            <span key={k} style={{ fontSize: 12 }}>
              {DIM_LABELS[k]}：<b data-testid={`dim-${k}`}>{v === null ? '未测量' : v.toFixed(2)}</b>
              <span className="dim"> ×{weights[k]}</span>
            </span>
          );
        })}
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

export function ShortCircuitFlow({ steps, stats }: { steps: ShortCircuitStep[]; stats: { short_circuit_hits: number; merged: number; avg_cost_ms: number; avg_cost_samples: number } }) {
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
      {steps.length > 0 && steps[steps.length - 1].action && (
        <div className="note" style={{ marginTop: 6 }}>{steps[steps.length - 1].action}</div>
      )}
      <div className="row" style={{ gap: 22, marginTop: 10 }} data-testid="stats-24h">
        <span>24h 查重/质量门拦截（真实 write 审计）：<b>{stats.short_circuit_hits}</b></span>
        <span>24h 嫁接数（真实 graft 审计）：<b>{stats.merged}</b></span>
        <span>平均查重耗时：{stats.avg_cost_samples > 0 ? <b>{stats.avg_cost_ms}ms</b> : <b>—</b>}（{stats.avg_cost_samples > 0 ? `真实采样 ${stats.avg_cost_samples} 条写入` : '账本未采样'}）</span>
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
