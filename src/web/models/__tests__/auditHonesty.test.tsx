// 阶段4-G / B6：审计回显按账本真实事件类型。
// 旧实现把 param_save（保存 model_config）包装成 llm_proxy 回执，编造
// llm_proxy_source='agent:local' / cost=0 / mode='local'，UI 还把这三列显示出来。
// 本套件锁住：配置保存是 model_config 事件、字段取自账本 detail、真实代理审计不受影响。
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ModelsPage } from '../ModelsPage.tsx';
import { coreAuditTail, coreSaveConfig } from '../coreModels.ts';
import { clearModelConfig, hydrateUsages } from '../modelConfig.ts';
import { getKernelStorage, resetKernelForTests } from '../../kernel.ts';
import { applyHostLlmSnapshot } from '../../hostLlm.ts';

beforeEach(() => {
  clearModelConfig();
  resetKernelForTests();
  applyHostLlmSnapshot(null);
});

describe('审计回显事件类型诚实化（阶段4-G / B6 变异杀手）', () => {
  it('coreSaveConfig 回执是 model_config 事件，字段来自真实参数，零代理伪造字段', async () => {
    const out = await coreSaveConfig('bge-m3', 'bge-m3（本地）', 1024, hydrateUsages());
    expect(out.entry.event).toBe('model_config');
    expect(out.entry).toMatchObject({
      vector: 'bge-m3（本地）',
      dims: 1024,
      reembedded: out.reembedded,
      persisted: out.persisted,
      api_key_persisted: false,
    });
    expect('llm_proxy_source' in out.entry).toBe(false);
    expect('cost' in out.entry).toBe(false);
    expect('mode' in out.entry).toBe(false);
    expect(JSON.stringify(out.entry)).not.toContain('agent:local');
  });

  it('coreAuditTail：param_save 回显 model_config，字段取账本 detail，不伪造 source/cost/mode', async () => {
    expect(await coreAuditTail()).toEqual([]);
    await coreSaveConfig('st', 'sentence-transformers（本地）', 384, hydrateUsages());
    const entries = await coreAuditTail();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.event).toBe('model_config');
    expect('llm_proxy_source' in e).toBe(false);
    expect('cost' in e).toBe(false);
    expect('mode' in e).toBe(false);
    if (e.event === 'model_config') {
      expect(e.vector).toBe('sentence-transformers（本地）');
      expect(e.dims).toBe(384);
      expect(e.reembedded).toBe(0);
      expect(e.persisted).toBe(true);
    }
  });

  it('coreAuditTail：真实 llm_proxy 仍回显代理事件与真实 source/cost/mode（不误伤）', async () => {
    await getKernelStorage().appendAudit({
      request_id: 'req_b6_proxy', action: 'llm_proxy', ts: Date.now(),
      detail: { llm_proxy_source: 'agent:deepseek-chat', model: 'deepseek-chat', cost: 2.5, mode: 'auto' },
    });
    const [e] = await coreAuditTail();
    expect(e.event).toBe('llm_proxy');
    if (e.event === 'llm_proxy') {
      expect(e.llm_proxy_source).toBe('agent:deepseek-chat');
      expect(e.cost).toBe(2.5);
      expect(e.mode).toBe('auto');
    }
  });

  it('历史 param_save 缺 detail 字段 → null「未记录」，不得补 0 / 空串', async () => {
    await getKernelStorage().appendAudit({
      request_id: 'req_b6_legacy', action: 'param_save', ts: Date.now(),
      detail: { kind: 'model_config' },
    });
    const [e] = await coreAuditTail();
    expect(e.event).toBe('model_config');
    if (e.event === 'model_config') {
      expect(e.vector).toBeNull();
      expect(e.dims).toBeNull();
      expect(e.reembedded).toBeNull();
      expect(e.persisted).toBeNull();
      expect(e.api_key_persisted).toBeNull();
    }
  });

  it('ModelsPage 审计回显：保存配置显示真实配置字段，绝不显示 llm_proxy_source/cost/mode 假列', async () => {
    render(<ModelsPage />);
    fireEvent.click(screen.getByTestId('mtab-1')); // 计费页签
    fireEvent.click(screen.getByTestId('save-config'));
    await waitFor(() => expect(screen.getByTestId('audit-entry-0')).toBeInTheDocument());
    const row = screen.getByTestId('audit-entry-0');
    expect(row).toHaveTextContent('model_config');
    expect(row).toHaveTextContent('vector=');
    expect(row).toHaveTextContent('384 维');
    expect(row).toHaveTextContent('重嵌入');
    expect(row).not.toHaveTextContent('llm_proxy_source=');
    expect(row).not.toHaveTextContent('cost=¥');
    expect(row).not.toHaveTextContent('mode=');
  });

  it('源码声明契约：param_save 分支不得回流 llm_proxy 伪造回执与旧 kind 判别', () => {
    const core = readFileSync(resolve(process.cwd(), 'src/web/models/coreModels.ts'), 'utf8');
    const types = readFileSync(resolve(process.cwd(), 'src/web/models/types.ts'), 'utf8');
    const ui = readFileSync(resolve(process.cwd(), 'src/web/models/ModelsPage.tsx'), 'utf8');
    expect(core).not.toMatch(/kind: 'model_config' as const/);
    expect(core).not.toMatch(/llm_proxy_source: 'agent:local'/);
    expect(core).toMatch(/event: 'model_config'/);
    expect(core).toMatch(/vector: d\.vector \?\? null/);
    expect(types).toMatch(/export interface ModelConfigAuditEntry/);
    expect(types).not.toMatch(/kind\?: 'model_config'/);
    expect(ui).toMatch(/e\.event === 'model_config'/);
    expect(ui).not.toMatch(/e\.kind === 'model_config'/);
  });
});
