import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParamsPage } from '../ParamsPage.tsx';
import { DevPanel } from '../DevPanel.tsx';
import { DEFAULT_DEV } from '../seed.ts';
import { coreLoadParams, coreSaveParams } from '../coreParams.ts';

describe('ParamsPage (P5-T4 编排)', () => {
  it('挂载渲染三区块', async () => {
    render(<ParamsPage />);
    expect(screen.getByTestId('params-page')).toBeInTheDocument();
    expect(screen.getByTestId('normal-config')).toBeInTheDocument();
    expect(screen.getByTestId('kb-table')).toBeInTheDocument();
    expect(screen.getByTestId('dev-panel')).toBeInTheDocument();
    // 默认值（规格表：中/数月/开/重要）——等挂载回填（无快照 → 默认）稳定后断言
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    expect(screen.getByTestId('retention-months')).toBeChecked();
    expect(screen.getByTestId('auto-organize')).toBeChecked();
    expect(screen.getByTestId('importance-important')).toBeChecked();
  });

  it('改档位 → 待保存列表 + 保存 toast（G6 request_id，内核回执驱动）', async () => {
    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    fireEvent.click(screen.getByTestId('speed-fast'));
    expect(screen.getByTestId('changed-list')).toHaveTextContent(/遗忘速度=快/);
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_p1/));
  });

  it('权重和≠1 时保存被拦截', async () => {
    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    fireEvent.change(screen.getByTestId('w-w_f'), { target: { value: '0.5' } });
    expect(screen.getByTestId('w-sum')).toHaveTextContent(/须为 1.0|和 = 1.35/);
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/拦截/));
  });

  it('关自动整理出现警示且保存拦截', async () => {
    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    fireEvent.click(screen.getByTestId('auto-organize'));
    expect(screen.getByTestId('save-errors')).toHaveTextContent(/自动整理/);
  });
});

describe('ParamsPage × 内核持久化（preference 快照）', () => {
  it('保存 → 快照落内核（version 单调）；重挂载回填保存值', async () => {
    const first = render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    fireEvent.click(screen.getByTestId('speed-fast'));
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_p1/));
    first.unmount();

    // 快照真写内核（getPrefs 口径：preference + user_id=system）
    const saved = await coreLoadParams();
    expect(saved).not.toBeNull();
    expect(saved!.cfg.forget_speed).toBe('fast');
    // 再保存一次 → 版本单调（快照可反复更新）
    const again = await coreSaveParams(saved!.cfg, saved!.kbs, saved!.dev, 'req_px');
    expect(again.version).toBeGreaterThanOrEqual(2);

    // 重挂载 → 回填快照值（speed-fast 选中而非默认 mid）
    render(<ParamsPage />);
    await waitFor(() => expect((screen.getByTestId('speed-fast') as HTMLInputElement).checked).toBe(true));
  });
});

describe('DevPanel (T3)', () => {
  it('折叠默认收起，展开后可见底层参数', () => {
    render(<DevPanel dev={DEFAULT_DEV} onChange={() => {}} />);
    expect(screen.getByTestId('dev-panel')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/开发者模式/));
    expect(screen.getByTestId('w-w_f')).toHaveValue(0.35);
    expect(screen.getByTestId('payload-soft')).toHaveValue(1500);
    expect(screen.getByTestId('n-days')).toHaveValue(90);
    expect(screen.getByTestId('level-mapping')).toHaveTextContent(/等级 5 永不清除/);
  });
});
