// M0-3：Δ 判定修正 —— 变坏必须显示「−」+ danger + 文字结论，不得恒加号恒绿。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeltaPanel } from '../GrowthPanels.tsx';
import type { DeltaPoint, GrowthAuditEntry, RegressionOutcome } from '../types.ts';

const baseProps = {
  series: [] as DeltaPoint[],
  audit: [] as GrowthAuditEntry[],
  onManualTrigger: () => {},
  regression: { kind: 'never_run', ts: null } as RegressionOutcome,
  receipt: null,
};

describe('DeltaPanel 方向感知（M0-3）', () => {
  it('负 Δ：显示负号 + data-dir=bad + danger 色 + 文字「使效果变差」', () => {
    render(<DeltaPanel {...baseProps} delta={-0.031} deltaMetric="f1_gain" />);
    const v = screen.getByTestId('delta-value');
    expect(v.textContent).toContain('-0.031');
    expect(v.getAttribute('data-dir')).toBe('bad');
    expect(v.style.color).toContain('var(--danger');
    expect(screen.getByTestId('delta-verdict')).toHaveTextContent('本次自生长使效果变差');
  });

  it('正 Δ：显示正号 + data-dir=good + ok 色 + 文字「改善了效果」', () => {
    render(<DeltaPanel {...baseProps} delta={0.036} deltaMetric="f1_gain" />);
    const v = screen.getByTestId('delta-value');
    expect(v.textContent).toContain('+0.036');
    expect(v.getAttribute('data-dir')).toBe('good');
    expect(v.style.color).toContain('var(--ok');
    expect(screen.getByTestId('delta-verdict')).toHaveTextContent('本次自生长改善了效果');
  });

  it('持平 Δ：data-dir=flat + 文字「持平」', () => {
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="hitrate_delta" />);
    const v = screen.getByTestId('delta-value');
    expect(v.getAttribute('data-dir')).toBe('flat');
    expect(screen.getByTestId('delta-verdict')).toHaveTextContent('本次前后效果持平');
  });

  it('口径分离：f1_gain 与 hitrate_delta 副标题不同', () => {
    const { rerender } = render(<DeltaPanel {...baseProps} delta={0.02} deltaMetric="f1_gain" />);
    expect(screen.getByText(/测试集 F1 提升/)).toBeInTheDocument();
    rerender(<DeltaPanel {...baseProps} delta={0.02} deltaMetric="hitrate_delta" />);
    expect(screen.getByText(/调权重前后命中率差/)).toBeInTheDocument();
  });
});

/**
 * 2026-11-14 真机事故：从未出现过 weight_tuned 时，deltaBefore 落 0，
 * 于是 Δ = 当前命中率（0.942）被当成「改善 +0.942」标绿写「本次自生长改善了效果」，
 * 与同一张卡的「暂无真实自生长调参记录」直接矛盾。
 * 红线：没有基线就不许印 Δ 数字，必须明说无基线，并把当前值标注为「现状」。
 */
describe('DeltaPanel 无基线（假改善修复）', () => {
  it('无 weight_tuned → 不印 Δ 数字，data-dir=none，明说无对比基线并点明当前命中率是现状', () => {
    render(<DeltaPanel {...baseProps} delta={0.942} deltaMetric="none" currentHitRate={0.942} />);
    const v = screen.getByTestId('delta-value');
    expect(v.textContent).toContain('无基线');
    expect(v.textContent).not.toContain('0.942'); // 不印任何可被读成「改善量」的数字
    expect(v.textContent).not.toContain('+');
    expect(v.getAttribute('data-dir')).toBe('none');
    expect(v.style.color).toContain('var(--muted');
    const verdict = screen.getByTestId('delta-verdict');
    expect(verdict).toHaveTextContent('无对比基线');
    expect(verdict).not.toHaveTextContent('改善了效果');
    expect(screen.getByText(/当前命中率 94\.2% 是现状，不是改善量/)).toBeInTheDocument();
  });

  it('无基线且拿不到命中率 → 只说明「还没有可比的基线」，仍然不编数字', () => {
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="none" />);
    expect(screen.getByTestId('delta-value').textContent).toBe('Δ 无基线');
    expect(screen.getByText(/还没有可比的基线/)).toBeInTheDocument();
  });
});

/**
 * 2026-11-14 用户硬性要求：**原始 JSON 禁止出现在 UI**，整页换成人话。
 * 审计回放区此前直接把 `payload`（账本 JSON 原文）吐到页面上，用户看不懂。
 */
describe('DeltaPanel 审计回放人话化（禁止原始 JSON 上屏）', () => {
  const AT = 1_700_000_000_000;
  const suggestionPayload = JSON.stringify({
    suggestion: {
      from: { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
      to: { w_f: 0.30, w_i: 0.35, w_c: 0.15, w_a: 0.20 },
      reason: '证据不足占比偏高',
    },
    metrics: { window_days: 7, recalls: 185, evidence_thin: 111, evidence_thin_ratio: 0.6 },
  });
  const suggestionEntry: GrowthAuditEntry = {
    event: 'recall_weight_suggested', action: 'growth_op', payload: suggestionPayload, at: AT,
  };

  it('建议审计 → 一句中文说清窗口/样本/证据不足/权重变化，且不出 JSON 字符', () => {
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="none" audit={[suggestionEntry]} />);
    const line = screen.getByTestId('audit-human').textContent ?? '';
    expect(line).toContain('召回权重建议（仅建议，未改动配置）');
    expect(line).toContain('最近 7 天 185 次召回');
    expect(line).toContain('111 次（60.0%）证据不足');
    expect(line).toContain('重要性 0.30 → 0.35（+0.05）');
    expect(line).toContain('新鲜度 0.35 → 0.30（-0.05）');
    expect(line).toContain('置信度、访问热度不变');
    // 硬红线：整块审计区不出现 JSON 语法字符与字段名
    const box = screen.getByTestId('growth-audit').textContent ?? '';
    expect(box).not.toContain('{');
    expect(box).not.toContain('w_f');
    expect(box).not.toContain('"suggestion"');
    expect(screen.queryByTestId('audit-raw')).toBeNull();
  });

  it('指标缺字段 → 写「未记进审计」，不补 0、不猜', () => {
    const noMetrics: GrowthAuditEntry = {
      event: 'recall_weight_suggested', action: 'growth_op',
      payload: JSON.stringify({
        suggestion: {
          from: { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
          to: { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
        },
      }),
      at: AT,
    };
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="none" audit={[noMetrics]} />);
    const line = screen.getByTestId('audit-human').textContent ?? '';
    expect(line).toContain('评估窗口未记进审计');
    expect(line).toContain('召回次数未记进审计');
    expect(line).toContain('四个维度权重都没变');
  });

  it('不可翻译的审计（weight_tuned）→ 出中文事件名 + 审计 ID 供回查，仍不吐 JSON/原名', () => {
    const tuned: GrowthAuditEntry = {
      event: 'weight_tuned', action: 'regress_mode_weights',
      payload: JSON.stringify({ delta_before: 0.42 }), at: AT, requestId: 'req_tuned_1',
    };
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="none" audit={[tuned]} />);
    const human = screen.getByTestId('audit-human').textContent ?? '';
    expect(human).toContain('权重调优已采纳');
    expect(human).toContain('没有可翻译的明细');
    expect(human).not.toContain('weight_tuned');
    // 回查靠审计 ID，不靠把 JSON 糊给用户
    expect(screen.getByTestId('audit-meta').textContent).toContain('req_tuned_1');
    const box = screen.getByTestId('growth-audit').textContent ?? '';
    expect(box).not.toContain('delta_before');
    expect(box).not.toContain('{');
    expect(box).not.toContain('regress_mode_weights');
  });

  it('账本没带审计 ID → 写「账本未带」，不编一个', () => {
    const noId: GrowthAuditEntry = {
      event: 'schedule_changed', action: 'toggle_x', payload: '{}', at: AT,
    };
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="none" audit={[noId]} />);
    expect(screen.getByTestId('audit-human').textContent).toContain('调度开关已更新');
    expect(screen.getByTestId('audit-meta').textContent).toContain('审计 ID 账本未带');
  });

  it('坏 payload（非法 JSON）→ 不崩、不显示原文', () => {
    const broken: GrowthAuditEntry = {
      event: 'recall_weight_suggested', action: 'growth_op', payload: '{not json', at: AT,
    };
    render(<DeltaPanel {...baseProps} delta={0} deltaMetric="none" audit={[broken]} />);
    expect(screen.getByTestId('audit-human').textContent).toContain('没有可翻译的明细');
    expect(screen.getByTestId('growth-audit').textContent).not.toContain('not json');
  });
});
