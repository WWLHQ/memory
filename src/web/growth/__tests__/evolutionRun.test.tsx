// M5-2：页面「手动跑一轮进化」走真实内核函数，回执只说账本里真发生的事。
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GrowthPage } from '../GrowthPage.tsx';
import { coreRunEvolution } from '../coreGrowth.ts';
import { getKernelStorage, resetKernelForTests } from '../../kernel.ts';
import { normalizeGrowthConfig } from '../../../shared/growthConfig.ts';
import { saveGrowthConfigToLedger } from '../../../core/memagent/paramsSnapshot.ts';

async function openRegressionTab() {
  render(<GrowthPage />);
  await waitFor(() => expect(screen.getByTestId('gtab-1')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('gtab-1'));
  await waitFor(() => expect(screen.getByTestId('evo-run-now')).toBeInTheDocument());
}

async function setMode(mode: 'off' | 'suggest' | 'auto'): Promise<void> {
  const cfg = normalizeGrowthConfig(null);
  await saveGrowthConfigToLedger(
    getKernelStorage(),
    { ...cfg, evolution: { ...cfg.evolution, mode } },
    { requestId: 'seed_mode', form: 'web' },
  );
}

describe('M5-2 手动跑一轮进化', () => {
  beforeEach(() => resetKernelForTests());

  it('冷启动（默认 suggest）→ 回执报真实条数与「还需 N 次」，不伪造采纳', async () => {
    await openRegressionTab();
    fireEvent.click(screen.getByTestId('evo-run-now'));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/本轮新增/));
    const receipt = screen.getByTestId('evo-run-receipt').textContent ?? '';
    // 空账本 → 召回族样本不足（0/30），且从不宣称「已采纳」
    expect(receipt).toContain('样本不足');
    expect(receipt).toContain('还需 30 次');
    expect(receipt).not.toContain('adopted');
    // 真实新增审计：只有 feedback_policy 那一条（recalls=0 时召回族不写审计）
    expect(receipt).toContain('本轮新增 1 条 growth_op 审计');
    // 无回诊计划 → none
    expect(receipt).toContain('回诊：none');
  });

  it('core 层回执与账本一致：added = growth_op 真实增量', async () => {
    const storage = getKernelStorage();
    const before = (await storage.queryAudit({ action: 'growth_op' })).length;
    const r = await coreRunEvolution({ force: true });
    const after = (await storage.queryAudit({ action: 'growth_op' })).length;
    expect(r.mode).toBe('suggest');
    expect(r.added).toBe(after - before);
    expect(r.added).toBeGreaterThan(0);
  });

  it('mode=off → 零审计 + 明确提示「进化已关闭」（不假装跑过）', async () => {
    await setMode('off');
    const storage = getKernelStorage();
    const before = (await storage.queryAudit({ action: 'growth_op' })).length;

    await openRegressionTab();
    fireEvent.click(screen.getByTestId('evo-run-now'));
    await waitFor(() => expect(screen.getByTestId('evo-run-receipt')).toBeInTheDocument());
    expect(screen.getByTestId('evo-run-receipt').textContent).toContain('进化已关闭');
    expect((await storage.queryAudit({ action: 'growth_op' })).length).toBe(before);
  });

  it('运行中按钮短暂禁用（不重复触发同一轮）', async () => {
    await openRegressionTab();
    const btn = screen.getByTestId('evo-run-now');
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('evo-run-receipt')).toBeInTheDocument());
    // 跑完后恢复可点，回执只有一条（内容为本轮真实结论）
    expect((screen.getByTestId('evo-run-now') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getAllByTestId('evo-run-receipt')).toHaveLength(1);
  });
});
