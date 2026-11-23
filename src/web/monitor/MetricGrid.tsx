// P6-T3 指标卡网格（12.1：8 组 20 卡 · 批次49 起 af-panel 版式，收进页面「全部指标」折叠）
// 诚实口径：有真实值的显示真实值；没有真实口径的卡不显示数值，值位说「暂无数据」——
// 不把破折号当读数，也不伪造 0 / 100%。
// UI 铁律：整页人话。内部键（含英文字段名）只用于查表与 data-testid，不进可见文本；
// 短中文名 / 一句白话 / 阈值 / 依据 / 单位统一取自 growth/recallLabels.ts（唯一真源）。
import type { MetricCard } from './types.ts';
import { groupMetrics, levelBadge } from './logic.ts';
import { monitorGroupText, monitorText, monitorValueText } from '../growth/recallLabels.ts';

export function MetricGrid({ cards }: { cards: MetricCard[] }) {
  const groups = groupMetrics(cards);
  return (
    <div data-testid="metric-grid">
      {groups.map(([g, list]) => (
        <div key={g} className="af-panel" data-testid={`mgroup-${g}`} style={{ marginBottom: 10 }}>
          <div className="af-ph">
            <h3>{monitorGroupText(g)}</h3>
            <span className="af-badge">{list.length} 项</span>
          </div>
          <div className="af-pb">
            <div className="mgrid">
              {list.map((c) => {
                const t = monitorText(c.metric);
                const empty = c.value === '未取数' && !c.parts;
                return (
                  <div key={c.metric} className={`mon-mcard ${c.level}${empty ? ' empty' : ''}`} data-testid={`metric-${c.metric}`}>
                    <div className="mon-mhead">
                      <span className="af-note" title={t.label}>{t.label}</span>
                      <span className={`level ${empty ? 'empty' : c.level}`} title={empty ? '没有样本，不给健康或告警结论' : c.level}>
                        {empty ? '暂无结论' : levelBadge(c.level)}
                      </span>
                    </div>
                    <div className={`mval${empty ? ' empty' : ''}`}>
                      {empty ? '暂无数据'
                        : c.parts ? (
                          <span className="mparts">成功 {c.parts.ok} · 失败 {c.parts.failed} · 等待 {c.parts.waiting}</span>
                        ) : <>{monitorValueText(c.value)}{c.unit ?? t.unit}</>}
                    </div>
                    <div className="af-note mon-mhint">
                      {t.hint}{c.parts ? ` 另有 ${c.parts.skipped} 条因内容太少跳过，不算失败。` : ''}
                    </div>
                    <div className="mon-mfoot">
                      <span className="af-note">{t.threshold} · 依据 {t.basis}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
      <div className="af-note" style={{ marginTop: 2 }}>
        显示「暂无数据」表示这一项还没有真实数据来源，或这个时间窗里没有记录；不会拿 0、100% 或「正常」冒充读数。
      </div>
    </div>
  );
}
