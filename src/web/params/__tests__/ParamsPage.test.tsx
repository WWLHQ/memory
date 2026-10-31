import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParamsPage } from '../ParamsPage.tsx';
import { DevPanel } from '../DevPanel.tsx';
import { DEFAULT_DEV } from '../defaults.ts';
import { coreLoadParams, coreSaveParams } from '../coreParams.ts';
import { getKernelStorage, resetKernelForTests } from '../../kernel.ts';

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
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_/));
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
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_/));
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

describe('ParamsPage × 成本单价（批次11）', () => {
  it('设置单价 → 保存快照 → 重挂载回填；清空 = 未设置', async () => {
    resetKernelForTests();
    const first = render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    expect(screen.getByTestId('cost-price')).toHaveValue(null); // 默认未设置（空）

    fireEvent.change(screen.getByTestId('cost-price'), { target: { value: '10' } });
    expect(screen.getByTestId('changed-list')).toHaveTextContent(/成本单价/);
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_/));
    first.unmount();

    expect((await coreLoadParams())!.cfg.cost_cny_per_mtok).toBe(10);

    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('cost-price')).toHaveValue(10));
    fireEvent.change(screen.getByTestId('cost-price'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/req_/));
    expect((await coreLoadParams())!.cfg.cost_cny_per_mtok).toBeNull();
  });

  it('负单价 → 保存被拦截', async () => {
    resetKernelForTests();
    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('speed-mid')).toBeChecked());
    fireEvent.change(screen.getByTestId('cost-price'), { target: { value: '-1' } });
    expect(screen.getByTestId('save-errors')).toHaveTextContent(/成本单价不可为负/);
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/拦截/));
  });

  it('旧快照（无 cost 字段）→ 加载归一为 null', async () => {
    resetKernelForTests();
    await getKernelStorage().putMemory({
      mem_id: 'mem_legacy_params', project_id: 'P_SYSTEM', user_id: 'system',
      enterprise_id: 'e1', team_id: 't1', category: 'preference', layer: 'L2',
      content: 'params:v1:{"cfg":{"auto_organize":true},"kbs":[],"dev":{}}',
      decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: 1,
    });
    const loaded = await coreLoadParams();
    expect(loaded).not.toBeNull();
    expect(loaded!.cfg.cost_cny_per_mtok).toBeNull();
  });
});

describe('ParamsPage × 内核加载三态（批次25 P0-7）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('内核不可达 → 显示内核原因与重试，绝不把默认值冒充成已保存参数', async () => {
    vi.spyOn(await import('../coreParams.ts'), 'coreLoadParams')
      .mockRejectedValue(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('params-default')).not.toBeInTheDocument();
    expect(screen.queryByTestId('params-from-kernel')).not.toBeInTheDocument();
  });

  it('真空账本（读到但无快照）→ 诚实标注「默认值」，不显示错误卡', async () => {
    resetKernelForTests();
    render(<ParamsPage />);
    await waitFor(() => expect(screen.getByTestId('params-default')).toBeInTheDocument());
    expect(screen.getByTestId('params-default')).toHaveTextContent('默认值');
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
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
