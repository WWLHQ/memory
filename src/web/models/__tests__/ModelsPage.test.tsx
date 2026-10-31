// Phase C3 页面级验收：配置回填 / 模拟 dry-run 不写账本 / 保存真落盘并重建
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelsPage } from '../ModelsPage.tsx';
import { clearModelConfig, readModelConfig, writeModelConfig } from '../modelConfig.ts';
import { getKernelWithSeed, getKernelStorage, resetKernelForTests } from '../../kernel.ts';

beforeEach(() => {
  clearModelConfig();
  resetKernelForTests();
});

describe('ModelsPage（Phase C3 接真）', () => {
  it('挂载回填已落盘的向量配置（刷新后选择仍生效）', async () => {
    writeModelConfig({ vectorKey: 'bge-m3', dims: 1024, updatedAt: Date.now() });
    render(<ModelsPage />);
    expect((screen.getByTestId('vector-select') as HTMLSelectElement).value).toBe('bge-m3');
    expect(screen.getByTestId('vector-dims')).toHaveTextContent('1024');
    await waitFor(() => expect(screen.getByTestId('models-page')).toBeInTheDocument());
  });

  it('模拟为 dry-run：不写审计、不扣额度，toast 明确标注未写账本', async () => {
    render(<ModelsPage />);
    fireEvent.click(screen.getByTestId('proxy-simulate'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('dry-run（未写账本）'));
    expect(await getKernelStorage().queryAudit({})).toHaveLength(0);
    expect(screen.queryByTestId('audit-entry-0')).toBeNull();
    // 重复模拟仍不产生任何审计
    fireEvent.click(screen.getByTestId('proxy-simulate'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('claude-code'));
    expect(await getKernelStorage().queryAudit({})).toHaveLength(0);
  });

  it('保存 model_config：真落盘 + 重嵌入已入库记忆 + 审计回显 model_config', async () => {
    const before = await getKernelWithSeed()._seedMemory({ content: '保存前写入的记忆 pre-save memory', category: 'fact', project_id: 'P1' });
    expect(before.embedding).toHaveLength(64);

    render(<ModelsPage />);
    fireEvent.click(screen.getByTestId('save-config'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('已持久化'));
    expect(screen.getByTestId('toast')).toHaveTextContent('384 维');
    expect(screen.getByTestId('toast')).toHaveTextContent('重嵌入 1 条');

    const cfg = readModelConfig();
    expect(cfg).toMatchObject({ vectorKey: 'st', dims: 384 });
    const stored = await getKernelStorage().getMemory(before.mem_id);
    expect(stored?.embedding).toHaveLength(384);

    const audits = await getKernelStorage().queryAudit({ action: 'param_save' });
    expect(audits).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('audit-entry-0')).toHaveTextContent('model_config'));
  });
});
