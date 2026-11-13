// 批次61 GAP-3 页面用例（规格 C4）：Agent 侧使用卡在空账本显示「暂无数据」，不显示 0。
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentUsageCard } from '../GrowthPanels.tsx';
import { GrowthPage } from '../GrowthPage.tsx';
import { resetKernelForTests } from '../../kernel.ts';
import { summarizeAgentUsage } from '../../../core/memagent/agentUsage.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';

const NOW = 1_800_000_000_000;

function usageWith(rows: Array<{ client: string; recalls: number; saved: number }>) {
  const audits: AuditRecord[] = [];
  let i = 0;
  for (const r of rows) {
    for (let k = 0; k < r.recalls; k++) {
      audits.push({
        request_id: `r${i}`, action: 'recall', form: 'desktop', project_id: 'P1', ts: NOW - 1000 - i,
        detail: { hits: 1, client: r.client, saved_tokens: r.saved, evidence_thin: false },
      } as AuditRecord);
      i++;
    }
  }
  return summarizeAgentUsage(audits, NOW, 7);
}

describe('AgentUsageCard（C4 空态诚实）', () => {
  it('空审计 → 显示「暂无数据」，且不渲染 0 值表格', () => {
    render(<AgentUsageCard usage={summarizeAgentUsage([], NOW, 7)} />);
    expect(screen.getByTestId('agent-usage-empty')).toHaveTextContent(/暂无数据/);
    expect(screen.queryByTestId('agent-usage-rows')).toBeNull();
  });

  it('有数据 → 逐行渲染，且写明 verdict 不可按 Agent 拆分', () => {
    render(<AgentUsageCard usage={usageWith([{ client: 'qoder', recalls: 3, saved: 900 }, { client: 'cursor', recalls: 1, saved: 100 }])} />);
    expect(screen.queryByTestId('agent-usage-empty')).toBeNull();
    const qoder = screen.getByTestId('agent-row-qoder');
    expect(qoder).toHaveTextContent('qoder');
    expect(qoder).toHaveTextContent('3');
    expect(qoder).toHaveTextContent('2700');   // 每次 recall 各计 900，三次求和（不按条均摊）
    expect(screen.getByTestId('agent-row-total')).toHaveTextContent('2800'); // 2700 + 100
    expect(screen.getByTestId('agent-usage-verdicts')).toHaveTextContent(/不可按 Agent 拆分/);
    expect(screen.getByTestId('agent-usage-concurrency')).toHaveTextContent(/双计/);
  });
});

describe('GrowthPage × Agent 侧卡（回归评估页签内）', () => {
  beforeEach(() => resetKernelForTests());

  it('空账本 → 卡片存在且显「暂无数据」（不把空账本画成 0）', async () => {
    render(<GrowthPage />);
    await waitFor(() => expect(screen.getByTestId('gtab-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('gtab-1'));
    await waitFor(() => expect(screen.getByTestId('agent-usage')).toBeInTheDocument());
    expect(screen.getByTestId('agent-usage-empty')).toHaveTextContent(/暂无数据/);
  });
});
