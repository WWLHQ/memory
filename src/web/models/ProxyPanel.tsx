// P13-T3 反代理面板：全量映射表 + 来源单选 + auto/manual 模式 + price_cap/cost_cap/预算条（19.8 / R7–R12）
import type { ProxySelectMode, ProxySource } from './types.ts';
import { remainingOf, proxyBudgetOf } from './logic.ts';

interface Props {
  sources: ProxySource[];
  /** manual 模式下勾选的 agent 名单 */
  selected: string[];
  selectMode: ProxySelectMode;
  priceCap: number;
  costCap: number;
  onToggleSource: (agent: string) => void;
  onSelectMode: (m: ProxySelectMode) => void;
  onPriceCap: (v: number) => void;
  onCostCap: (v: number) => void;
  onSimulate: () => void;
}

function tierBadge(t: ProxySource['tier']): string {
  return t === 'free' ? '免费' : t === 'cheap' ? '低价' : '付费';
}

function Bar({ used, budget }: { used: number; budget: number }) {
  const pct = Math.min(100, Math.max(0, (used / Math.max(1, budget)) * 100));
  const over = used > budget;
  return (
    <div style={{ background: 'var(--border,#2a3442)', height: 6, borderRadius: 3, minWidth: 90 }}>
      <div
        style={{
          background: over ? 'var(--danger,#ff5d5d)' : pct > 80 ? 'var(--warn,#ffb84d)' : 'var(--accent,#4f8cff)',
          height: 6,
          borderRadius: 3,
          width: `${pct}%`,
        }}
      />
    </div>
  );
}

export function ProxyPanel(p: Props) {
  return (
    <div className="card" data-testid="proxy-panel">
      <b>反代理来源映射（19.8）</b>
      <div className="note">
        R7 仅免费/低价（≤ price_cap）源可入代理，paid 档永不 · R8 当日预算 = 声明额度 × 0.9 ·
        R12 全不可用一律回退本地 · R10 每次代理调用写审计。
      </div>
      <table className="ltable" data-testid="proxy-rows">
        <thead>
          <tr>
            <th style={{ width: 36 }}></th>
            <th style={{ textAlign: 'left' }}>Agent</th>
            <th style={{ textAlign: 'left' }}>模型</th>
            <th>档位</th>
            <th>单价(¥/千次)</th>
            <th>声明额度</th>
            <th style={{ textAlign: 'left' }}>余量 / 预算</th>
          </tr>
        </thead>
        <tbody>
          {p.sources.map((s) => {
            const budget = proxyBudgetOf(s);
            const remain = remainingOf(s);
            const checked = p.selected.includes(s.agent);
            return (
              <tr key={s.agent} data-testid={`proxy-${s.agent}`} style={remain <= 0 ? { opacity: 0.55 } : undefined}>
                <td>
                  <input
                    type="checkbox"
                    data-testid={`proxy-check-${s.agent}`}
                    checked={checked}
                    onChange={() => p.onToggleSource(s.agent)}
                    title="manual 模式勾选源"
                  />
                </td>
                <td style={{ textAlign: 'left' }}>{s.agent}</td>
                <td style={{ textAlign: 'left' }}>{s.model}</td>
                <td style={{ textAlign: 'center' }}>{tierBadge(s.tier)}</td>
                <td style={{ textAlign: 'center' }}>{s.price === 0 ? '—' : `¥${s.price}`}</td>
                <td style={{ textAlign: 'center' }}>{s.quota}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span data-testid={`proxy-remain-${s.agent}`} style={{ color: remain <= 0 ? 'var(--danger,#ff5d5d)' : undefined }}>
                      {remain}
                    </span>
                    <Bar used={s.used} budget={budget} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="row" style={{ gap: 24, marginTop: 12, alignItems: 'center' }}>
        <span>
          选择模式：
          <label style={{ marginLeft: 6 }}>
            <input type="radio" name="selmode" data-testid="mode-auto" checked={p.selectMode === 'auto'} onChange={() => p.onSelectMode('auto')} /> auto 择优
          </label>
          <label style={{ marginLeft: 10 }}>
            <input type="radio" name="selmode" data-testid="mode-manual" checked={p.selectMode === 'manual'} onChange={() => p.onSelectMode('manual')} /> manual 指定
          </label>
        </span>
        <button className="btn" data-testid="proxy-simulate" onClick={p.onSimulate}>模拟一次代理调用</button>
      </div>

      <div className="row" style={{ gap: 24, marginTop: 10, alignItems: 'center' }}>
        <label>
          price_cap（¥/千次）：
          <input data-testid="price-cap" type="number" min={0} step={0.01} value={p.priceCap} onChange={(e) => p.onPriceCap(Number(e.target.value))} style={{ width: 80 }} />
        </label>
        <label>
          cost_cap（¥/日）：
          <input data-testid="cost-cap" type="number" min={0} step={0.5} value={p.costCap} onChange={(e) => p.onCostCap(Number(e.target.value))} style={{ width: 80 }} />
        </label>
      </div>
      {p.priceCap === 0 && (
        <div className="note" data-testid="free-only-hint" style={{ marginTop: 8 }}>
          C13：price_cap=0 —— 仅免费源可代理，付费源一律回退本地。
        </div>
      )}
    </div>
  );
}
