// Phase C3 页面级验收：配置回填 / 模拟 dry-run 不写账本 / 保存真落盘并重建
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelsPage } from '../ModelsPage.tsx';
import { clearModelConfig, readModelConfig, writeModelConfig } from '../modelConfig.ts';
import { getKernelWithSeed, getKernelStorage, resetKernelForTests } from '../../kernel.ts';
import { applyHostLlmSnapshot, type LlmGatewaySnapshot } from '../../hostLlm.ts';

beforeEach(() => {
  clearModelConfig();
  resetKernelForTests();
  applyHostLlmSnapshot(null); // 默认无网关（诚实空态），配置态测试另行注入
});

const SNAP: LlmGatewaySnapshot = {
  usable: true,
  engines: [
    { id: 'e1', name: 'Local Ollama', enabled: true, baseURL: 'http://localhost:11434', model: 'local-llama', needsKey: false, keySet: false, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null },
    { id: 'e2', name: 'Cloud DeepSeek', enabled: true, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', needsKey: true, keySet: true, lastLatencyMs: 10, lastProbeAt: Date.now(), lastProbeOk: true },
  ],
  presets: [],
};

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
    // 重复模拟仍不产生任何审计（无网关快照 → dry-run 回退本地，同样不写账本）
    fireEvent.click(screen.getByTestId('proxy-simulate'));
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('dry-run（未写账本）'));
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

describe('ModelsPage 三态与列隐藏（阶段3-C）', () => {
  it('未配置网关（unconfigured）→ 诚实空态，绝不渲染假代理行', async () => {
    render(<ModelsPage />);
    await waitFor(() => expect(screen.getByTestId('proxy-empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('proxy-rows')).toBeNull(); // 无假目录行
    expect(screen.getByTestId('proxy-empty-state')).toHaveTextContent('未配置引擎');
    // price/quota 列已隐藏：表头不存在
    expect(screen.queryByText('单价(¥/千次)')).toBeNull();
    expect(screen.queryByText('声明额度')).toBeNull();
  });

  it('已配置（configured）→ 渲染真实快照引擎，且不展示 price/quota 列', async () => {
    applyHostLlmSnapshot(SNAP);
    render(<ModelsPage />);
    await waitFor(() => expect(screen.getByTestId('proxy-rows')).toBeInTheDocument());
    expect(screen.queryByTestId('proxy-empty-state')).toBeNull();
    // 真实引擎 + 模型名（来自快照，非硬编码）
    expect(screen.getByText('Local Ollama')).toBeInTheDocument();
    expect(screen.getByText('Cloud DeepSeek')).toBeInTheDocument();
    expect(screen.getByText('local-llama')).toBeInTheDocument();
    expect(screen.getByText('deepseek-chat')).toBeInTheDocument();
    // 列隐藏判据：单价/声明额度表头不存在
    expect(screen.queryByText('单价(¥/千次)')).toBeNull();
    expect(screen.queryByText('声明额度')).toBeNull();
    // 余量/预算列仍在（真实 used/预算，不展示原始额度数字）
    expect(screen.getByText('余量 / 预算')).toBeInTheDocument();
  });

  it('降级（degraded）→ 网关不可用提示，不渲染代理行', async () => {
    applyHostLlmSnapshot({ usable: false, engines: [], presets: [] });
    render(<ModelsPage />);
    await waitFor(() => expect(screen.getByTestId('proxy-empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('proxy-empty-state')).toHaveTextContent('已降级');
    expect(screen.queryByTestId('proxy-rows')).toBeNull();
  });
});
