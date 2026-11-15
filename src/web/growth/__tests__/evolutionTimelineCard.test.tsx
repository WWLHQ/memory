// M4：进化时间线卡（展示层）——空账本不显示 0 / 每行可回查 / 漂移数字 = 真实差。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvolutionTimelineCard } from '../EvolutionTimelineCard.tsx';
import type { EvolutionTimelineEntry } from '../evolutionTimeline.ts';
import { DEFAULT_RECALL_WEIGHTS, type RecallWeights } from '../../../shared/growthConfig.ts';

const adoptedEntry: EvolutionTimelineEntry = {
  requestId: 'req_evo_1', ts: 1_700_000_000_000, family: 'recall_weights', decision: 'adopted',
  reason: 'NDCG 提升 0.031 且符号检验 p=0.043', applied: true,
  from: { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 },
  to: { w_f: 0.40, w_i: 0.25, w_c: 0.15, w_a: 0.20 },
  gain: 0.031, p: 0.043, meanFrom: 0.512, meanTo: 0.543, samples: 34,
  rollbackDueAt: 1_700_604_800_000, historySaved: true,
};

const insufficientEntry: EvolutionTimelineEntry = {
  requestId: 'req_evo_0', ts: 1_699_000_000_000, family: 'recall_weights',
  decision: 'insufficient', reason: '', applied: false,
};

describe('EvolutionTimelineCard（M4）', () => {
  it('M4-2 空账本：显「暂无进化记录」，不出表格、不显示 0', () => {
    render(<EvolutionTimelineCard entries={[]} current={DEFAULT_RECALL_WEIGHTS} />);
    const empty = screen.getByTestId('evolution-timeline-empty');
    expect(empty.textContent).toContain('暂无进化记录');
    // 空态不得渲染出「0 条」之类的假计数
    expect(empty.textContent).not.toContain('0 条');
    expect(screen.queryByTestId('evolution-timeline-table')).toBeNull();
    expect(screen.queryByTestId('evo-row-req_evo_1')).toBeNull();
  });

  it('M4-1 逐条对应审计：行数 = 记录数，审计 ID / 决策 / 参数变化 / 指标都可回查', () => {
    render(<EvolutionTimelineCard entries={[adoptedEntry, insufficientEntry]} current={DEFAULT_RECALL_WEIGHTS} />);
    expect(screen.getByTestId('evolution-timeline-table')).toBeInTheDocument();
    expect(screen.queryByTestId('evolution-timeline-empty')).toBeNull();

    // 决策标签（文字 + data-decision 双编码）
    const tag = screen.getByTestId('evo-decision-req_evo_1');
    expect(tag.getAttribute('data-decision')).toBe('adopted');
    expect(tag.textContent).toBe('已采纳');

    // 参数变化只列真变了的维度（置信度 / 访问热度未变不出现），且出中文名不出字段名
    const diff = screen.getByTestId('evo-diff-req_evo_1').textContent ?? '';
    expect(diff).toContain('新鲜度 0.35→0.40');
    expect(diff).toContain('重要性 0.30→0.25');
    expect(diff).not.toContain('w_c');
    expect(diff).not.toContain('w_f');

    // 离线指标来自审计 eval，不重算；用中文说明，不出现裸 n= / p= 字段风格
    const metric = screen.getByTestId('evo-metric-req_evo_1').textContent ?? '';
    expect(metric).toContain('排序质量提升 +0.031');
    expect(metric).toContain('NDCG');
    expect(metric).toContain('显著性 p=0.043');
    expect(metric).toContain('基于 34 次召回');

    // 审计没写原因 → 写明「未写原因」，不编、也不用破折号冒充读数
    expect(screen.getByTestId('evo-reason-req_evo_0').textContent).toBe('本条审计未写原因');
    // 无参数前后 / 无离线指标 → 同样写明缺什么
    expect(screen.getByTestId('evo-diff-req_evo_0').textContent).toBe('审计未带参数前后');
    expect(screen.getByTestId('evo-metric-req_evo_0').textContent).toBe('本条审计未带离线指标');
  });

  it('M4-3 漂移仪表：数值 = 当前 − 基准的真实差（正负号与 data-drift 一致）', () => {
    const current: RecallWeights = { w_f: 0.40, w_i: 0.25, w_c: 0.15, w_a: 0.20 };
    render(<EvolutionTimelineCard entries={[]} current={current} />);
    expect(screen.getByTestId('drift-gauge')).toBeInTheDocument();

    expect(screen.getByTestId('drift-cur-w_f').textContent).toBe('0.400');
    const up = screen.getByTestId('drift-delta-w_f');
    expect(up.textContent).toBe('+0.050');
    expect(up.getAttribute('data-drift')).toBe('0.05');

    const down = screen.getByTestId('drift-delta-w_i');
    expect(down.textContent).toBe('-0.050');
    expect(down.getAttribute('data-drift')).toBe('-0.05');

    // 未漂移维度如实显示 0.000（这里是真实相等的差，不是补零遮数据）
    expect(screen.getByTestId('drift-delta-w_c').textContent).toBe('+0.000');
  });

  it('M5-3 回诊三态：未到期带剩余天数 / 已过期如实标注 / 无计划写明', () => {
    const DAY = 24 * 3600 * 1000;
    const now = 1_700_000_000_000;
    const base: EvolutionTimelineEntry = {
      requestId: 'req_rb3', ts: now - DAY, family: 'recall_weights', decision: 'adopted',
      reason: 'NDCG 提升', phase: 'evolution', applied: true, rollbackDueAt: now + 6 * DAY,
    };
    const noPlan: EvolutionTimelineEntry = {
      requestId: 'req_np', ts: now - 2 * DAY, family: 'feedback_policy',
      decision: 'rejected', reason: '反馈策略暂无自动建议', phase: 'evolution',
    };

    const { unmount } = render(
      <EvolutionTimelineCard entries={[noPlan, base]} current={DEFAULT_RECALL_WEIGHTS} now={now} />,
    );
    const pending = screen.getByTestId('evo-rollback-req_rb3');
    expect(pending.getAttribute('data-rb')).toBe('pending');
    expect(pending.textContent).toContain('未到期，还有 6 天');
    expect(screen.getByTestId('evo-rollback-req_np').textContent).toBe('无回诊计划');
    unmount();

    // 时间推进到过期后 → overdue，不再显示「还有 0 天」这种含糊读数
    render(<EvolutionTimelineCard entries={[base]} current={DEFAULT_RECALL_WEIGHTS} now={now + 9 * DAY} />);
    const overdue = screen.getByTestId('evo-rollback-req_rb3');
    expect(overdue.getAttribute('data-rb')).toBe('overdue');
    expect(overdue.textContent).toContain('已到期未回诊');
  });
});
