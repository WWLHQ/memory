// 批次61 GAP-1/GAP-2 闭环补齐验收：
//   A 召回权重「建议→采纳」真写 growth:v1；
//   B 反馈策略「策略→启用」真写 growth:v1；
//   C signal_summary 从 gc 审计读到并可显。
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecallWeightCard, FeedbackLoopCard } from '../GrowthPanels.tsx';
import { GrowthPage } from '../GrowthPage.tsx';
import { recallSuggestionFromLedger, feedbackSignalFromLedger } from '../useGrowthReal.ts';
import { coreGrowthAudit, coreLoadGrowthConfig } from '../coreGrowth.ts';
import { resetKernelForTests } from '../../kernel.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import type { GrowthAuditEntry } from '../types.ts';
import type { RecallWeights, FeedbackPolicy } from '../../../shared/growthConfig.ts';

const NOW = 1_800_000_000_000;
const FROM: RecallWeights = { w_f: 0.35, w_i: 0.30, w_c: 0.15, w_a: 0.20 };
const TO: RecallWeights = { w_f: 0.30, w_i: 0.30, w_c: 0.20, w_a: 0.20 };
const OFF: FeedbackPolicy = { enabled: false, window_days: 30, reject_downgrade_threshold: 3 };
const ON: FeedbackPolicy = { enabled: true, window_days: 30, reject_downgrade_threshold: 3 };

function growthOp(entry: GrowthAuditEntry): AuditRecord {
  return {
    request_id: 'req_op', action: 'growth_op', form: 'desktop', project_id: 'P_SYSTEM', ts: entry.at,
    detail: { entry },
  } as AuditRecord;
}

function suggestionEntry(overrides: Partial<GrowthAuditEntry> = {}): GrowthAuditEntry {
  return {
    event: 'recall_weight_suggested',
    action: 'suggest_recall_weights',
    payload: JSON.stringify({
      suggestion: { from: FROM, to: TO, reason: 'reject 占比过高', metrics: { recalls: 42 } },
      metrics: { recalls: 42 },
      applied: false,
    }),
    at: NOW,
    ...overrides,
  };
}

function gcAudit(summary: unknown, ok = true, ts = NOW): AuditRecord {
  return {
    request_id: 'req_gc', action: 'gc', form: 'desktop', project_id: 'P_SYSTEM', ts,
    detail: { signal_summary: { ok, summary } },
  } as AuditRecord;
}

const SIGNAL = {
  window_days: 30, recalls: 12, evidence_thin: 3,
  verdicts: { confirm: 5, reject: 2, disputed: 1 },
  reject_ratio: 0.25, rejected_mem_ids: 2,
};

describe('抽取器：recallSuggestionFromLedger（A）', () => {
  it('空审计 → null（不拿 0 冒充已评估）', () => {
    expect(recallSuggestionFromLedger([])).toBeNull();
  });

  it('合法建议 → 解析 from/to/reason/recalls', () => {
    const v = recallSuggestionFromLedger([growthOp(suggestionEntry())]);
    expect(v).not.toBeNull();
    expect(v!.from).toEqual(FROM);
    expect(v!.to).toEqual(TO);
    expect(v!.reason).toBe('reject 占比过高');
    expect(v!.recalls).toBe(42);
  });

  it('no_suggestion / 坏 payload → 跳过（不产生半截建议）', () => {
    const noSug = growthOp(suggestionEntry({ event: 'recall_weight_no_suggestion' }));
    const bad = growthOp(suggestionEntry({ payload: '{not json' }));
    expect(recallSuggestionFromLedger([noSug, bad])).toBeNull();
  });

  it('多条取 at 最新', () => {
    const older = growthOp(suggestionEntry({ at: NOW - 1000 }));
    const newer = growthOp(suggestionEntry({
      at: NOW,
      payload: JSON.stringify({ suggestion: { from: FROM, to: { w_f: 0.25, w_i: 0.35, w_c: 0.20, w_a: 0.20 }, reason: 'x', metrics: { recalls: 50 } } }),
    }));
    expect(recallSuggestionFromLedger([older, newer])!.to).toEqual({ w_f: 0.25, w_i: 0.35, w_c: 0.20, w_a: 0.20 });
  });

  it('建议权重结构非法（缺键/和≠1）→ 整条跳过，不让页面渲染崩在 toFixed', () => {
    const bad = growthOp(suggestionEntry({
      payload: JSON.stringify({ suggestion: { from: FROM, to: { w_f: 0.9 }, reason: 'x', metrics: { recalls: 40 } } }),
    }));
    expect(recallSuggestionFromLedger([bad])).toBeNull();
  });
});

describe('抽取器：feedbackSignalFromLedger（C）', () => {
  it('空审计 / ok:false → null（「读不到」不等于「没有反馈」）', () => {
    expect(feedbackSignalFromLedger([])).toBeNull();
    expect(feedbackSignalFromLedger([gcAudit(SIGNAL, false)])).toBeNull();
  });

  it('ok:true → 逐字段解析', () => {
    const v = feedbackSignalFromLedger([gcAudit(SIGNAL)]);
    expect(v).toMatchObject({
      window_days: 30, recalls: 12, evidence_thin: 3, reject_ratio: 0.25, rejected_mem_ids: 2,
    });
    expect(v!.verdicts).toEqual({ confirm: 5, reject: 2, disputed: 1 });
  });

  it('多条取最新 gc', () => {
    const older = gcAudit({ ...SIGNAL, recalls: 1 }, true, NOW - 1000);
    const newer = gcAudit({ ...SIGNAL, recalls: 9 }, true, NOW);
    expect(feedbackSignalFromLedger([older, newer])!.recalls).toBe(9);
  });
});

describe('RecallWeightCard（A）', () => {
  it('无建议 → 显「暂无建议」，不渲染采纳按钮', () => {
    render(<RecallWeightCard current={FROM} suggestion={null} onApply={() => {}} />);
    expect(screen.getByTestId('recall-weight-empty')).toHaveTextContent(/暂无建议/);
    expect(screen.queryByTestId('recall-weight-apply')).toBeNull();
  });

  it('有建议 → 展示 from→to 与理由；点击回传 to', () => {
    const onApply = vi.fn();
    render(
      <RecallWeightCard
        current={FROM}
        suggestion={{ at: NOW, requestId: 'r', from: FROM, to: TO, reason: 'r', recalls: 40 }}
        onApply={onApply}
      />,
    );
    expect(screen.getByTestId('recall-weight-suggestion')).toHaveTextContent('w_f=0.35');
    expect(screen.getByTestId('recall-weight-suggestion')).toHaveTextContent('w_c=0.20');
    fireEvent.click(screen.getByTestId('recall-weight-apply'));
    expect(onApply).toHaveBeenCalledWith(TO);
  });

  it('当前权重已等于建议值 → 按钮置灰并显「已采纳」', () => {
    render(
      <RecallWeightCard
        current={TO}
        suggestion={{ at: NOW, requestId: 'r', from: FROM, to: TO, reason: 'r', recalls: 40 }}
        onApply={() => {}}
      />,
    );
    const btn = screen.getByTestId('recall-weight-apply');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/已采纳/);
  });
});

describe('FeedbackLoopCard（B+C）', () => {
  it('默认关闭显「未启用」；无信号显「暂无数据」', () => {
    render(<FeedbackLoopCard policy={OFF} signal={null} onSave={() => {}} />);
    expect(screen.getByTestId('feedback-policy-state')).toHaveTextContent(/未启用/);
    expect(screen.getByTestId('feedback-signal-empty')).toHaveTextContent(/暂无数据/);
    expect(screen.getByTestId('feedback-save')).toBeDisabled(); // 未改动不可保存
  });

  it('开启并保存 → 回传 enabled:true；有信号则逐项展示', () => {
    const onSave = vi.fn();
    render(<FeedbackLoopCard policy={OFF} signal={{ at: NOW, ...SIGNAL }} onSave={onSave} />);
    fireEvent.click(screen.getByTestId('feedback-enabled'));
    fireEvent.click(screen.getByTestId('feedback-save'));
    expect(onSave).toHaveBeenCalledWith(ON);
    expect(screen.getByTestId('feedback-signal')).toHaveTextContent('召回 12 次');
    expect(screen.getByTestId('feedback-signal')).toHaveTextContent('拒绝 2');
    expect(screen.getByTestId('feedback-signal')).toHaveTextContent('25%');
  });

  it('窗口非法（0）→ 保存置灰且给原因', () => {
    render(<FeedbackLoopCard policy={ON} signal={null} onSave={() => {}} />);
    fireEvent.change(screen.getByTestId('feedback-window'), { target: { value: '0' } });
    expect(screen.getByTestId('feedback-save')).toBeDisabled();
    expect(screen.getByTestId('feedback-invalid')).toBeInTheDocument();
  });
});

describe('GrowthPage × 闭环端到端', () => {
  beforeEach(() => resetKernelForTests());

  async function openRegressionTab() {
    render(<GrowthPage />);
    await waitFor(() => expect(screen.getByTestId('gtab-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('gtab-1'));
  }

  it('A：采纳建议 → growth:v1.recall_weights 真改 + 落 applied 审计', async () => {
    await coreGrowthAudit(suggestionEntry(), 'req_seed_sug');
    await openRegressionTab();
    await waitFor(() => expect(screen.getByTestId('recall-weight-apply')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('recall-weight-apply'));

    await waitFor(async () => {
      const cfg = await coreLoadGrowthConfig();
      expect(cfg.recall_weights).toEqual(TO);
    });
    await waitFor(() => expect(screen.getByTestId('recall-weight-apply')).toBeDisabled());
  });

  it('B：启用反馈策略 → growth:v1.feedback_policy.enabled 真变 true', async () => {
    await openRegressionTab();
    await waitFor(() => expect(screen.getByTestId('feedback-enabled')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('feedback-enabled'));
    fireEvent.click(screen.getByTestId('feedback-save'));

    await waitFor(async () => {
      const cfg = await coreLoadGrowthConfig();
      expect(cfg.feedback_policy.enabled).toBe(true);
    });
    await waitFor(() => expect(screen.getByTestId('feedback-policy-state')).toHaveTextContent(/已启用/));
  });
});
