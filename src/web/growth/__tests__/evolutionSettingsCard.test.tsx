// M0-5：自生长进化设置卡 —— mode 切换 / 调度频率过密拦截 / 可行性预测 / 保存态。
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvolutionSettingsCard } from '../EvolutionSettingsCard.tsx';
import {
  DEFAULT_EVOLUTION, DEFAULT_SCHEDULE_EXPRS,
  type ScheduleExprs,
} from '../../../shared/growthConfig.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';

const DAY = 86400000;
const now = Date.now();

function rec(ts: number, negatives: number): AuditRecord {
  return {
    request_id: 'r', action: 'weight_regression', form: 'web', project_id: 'P1',
    ts,
    detail: { kind: 'dedup_regression', status: 'not_adopted', counts: { total: 1, positives: 0, negatives, window_days: 30 } },
  } as unknown as AuditRecord;
}

function manyRecs(n: number, perNeg: number, spanDays: number): AuditRecord[] {
  const out: AuditRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rec(now - Math.floor((spanDays * DAY) * (i / Math.max(1, n - 1))), perNeg));
  }
  return out;
}

describe('EvolutionSettingsCard（M0-5）', () => {
  it('默认渲染：mode=suggest + 4 个频率输入 + 可行性文案', () => {
    render(
      <EvolutionSettingsCard
        evolution={DEFAULT_EVOLUTION}
        scheduleExprs={DEFAULT_SCHEDULE_EXPRS}
        audit={[]}
        onSave={() => {}}
      />,
    );
    expect((screen.getByTestId('evolution-mode') as HTMLSelectElement).value).toBe('suggest');
    expect(screen.getByTestId('expr-input-decay')).toBeInTheDocument();
    expect(screen.getByTestId('expr-input-self_growth')).toBeInTheDocument();
    expect(screen.getByTestId('feasibility').textContent).toContain('可行性');
  });

  it('mode 切换为 auto：select 值 + hint 文案同步', () => {
    render(
      <EvolutionSettingsCard
        evolution={DEFAULT_EVOLUTION}
        scheduleExprs={DEFAULT_SCHEDULE_EXPRS}
        audit={[]}
        onSave={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('evolution-mode'), { target: { value: 'auto' } });
    expect((screen.getByTestId('evolution-mode') as HTMLSelectElement).value).toBe('auto');
    expect(screen.getByTestId('evolution-mode-hint').textContent).toContain('自动');
  });

  it('调度频率过密：*/1 * * * * 被拦 → 提示间隔过密 + 保存按钮禁用', () => {
    render(
      <EvolutionSettingsCard
        evolution={DEFAULT_EVOLUTION}
        scheduleExprs={DEFAULT_SCHEDULE_EXPRS}
        audit={[]}
        onSave={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('expr-input-self_growth'), { target: { value: '*/1 * * * *' } });
    expect(screen.getByTestId('expr-check-self_growth').textContent).toContain('间隔过密');
    expect(screen.getByTestId('evolution-save')).toBeDisabled();
  });

  it('可行性预测：窗口内样本充足 → 显示“已达最小样本”', () => {
    render(
      <EvolutionSettingsCard
        evolution={DEFAULT_EVOLUTION}
        scheduleExprs={DEFAULT_SCHEDULE_EXPRS}
        audit={manyRecs(45, 1, 20)}
        onSave={() => {}}
      />,
    );
    expect(screen.getByTestId('feasibility').textContent).toContain('已达最小样本');
  });

  it('可行性预测：样本不足 → 显示“距最小样本还差” + 预计天数', () => {
    render(
      <EvolutionSettingsCard
        evolution={DEFAULT_EVOLUTION}
        scheduleExprs={DEFAULT_SCHEDULE_EXPRS}
        audit={manyRecs(5, 2, 10)}
        onSave={() => {}}
      />,
    );
    const f = screen.getByTestId('feasibility').textContent ?? '';
    expect(f).toContain('距最小样本还差');
    expect(f).toMatch(/预计还需约 \d+ 天/);
  });

  it('保存：expr 合法时点击 → 调用 onSave 并带 evolution/schedule_exprs', () => {
    const onSave = vi.fn();
    render(
      <EvolutionSettingsCard
        evolution={DEFAULT_EVOLUTION}
        scheduleExprs={DEFAULT_SCHEDULE_EXPRS}
        audit={[]}
        onSave={onSave}
      />,
    );
    expect(screen.getByTestId('evolution-save')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('evolution-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [e, x] = onSave.mock.calls[0];
    expect(e.mode).toBe('suggest');
    expect((x as ScheduleExprs).self_growth).toBe(DEFAULT_SCHEDULE_EXPRS.self_growth);
    expect(screen.getByTestId('evolution-saved').textContent).toBe('已保存');
  });
});
