// 全局参数页 · LLM 引擎卡单测（批次32 建口径 / 批次33-B 自定义厂商入口 + 读配置失败可见化）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LlmEngineCard } from '../LlmEngineCard.tsx';
import { clearStoredSessionId, storeSessionId } from '../../Home/crossTabAuth.ts';

const realFetch = globalThis.fetch;

function engine(over: Record<string, unknown>) {
  return {
    name: '引擎', enabled: true, baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b',
    needsKey: false, keySet: false, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null,
    ...over,
  };
}

const SNAPSHOT = {
  ok: true,
  usable: true,
  engines: [
    engine({ id: 'ollama', name: 'Ollama（本机）', lastLatencyMs: 28000, lastProbeAt: 1, lastProbeOk: true }),
    engine({ id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', needsKey: true, keySet: false, lastLatencyMs: 900, lastProbeAt: 2, lastProbeOk: true }),
    engine({ id: 'kimi', name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', needsKey: true, keySet: false, enabled: false }),
  ],
  presets: [
    { preset: 'ollama', name: 'Ollama（本机）', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', needsKey: false },
    { preset: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', needsKey: true },
    { preset: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', needsKey: true },
  ],
};

function setHost(opts: {
  config?: () => Promise<unknown>;
  setConfig?: (patch: unknown) => Promise<unknown>;
  test?: (id: string) => Promise<unknown>;
} = {}) {
  (window as unknown as { __ELECTRON__: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = {
    llm: {
      config: opts.config ?? (async () => SNAPSHOT),
      setConfig: opts.setConfig ?? (async (patch: unknown) => ({ ...SNAPSHOT, ok: true, patch })),
      test: opts.test ?? (async () => ({ ok: true, latencyMs: 123, model: 'm' })),
    },
    log: { write: () => undefined },
  };
}

function clearHost() {
  delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
  delete (window as unknown as { api?: unknown }).api;
}

function mockRole(role: 'admin' | 'member') {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ context: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', role } }),
  }));
}

beforeEach(() => {
  localStorage.clear();
  storeSessionId('sid_test');
});

afterEach(() => {
  clearHost();
  clearStoredSessionId();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('LlmEngineCard 批次33-B（自定义厂商 + 读配置失败可见化）', () => {
  test('浏览器模式：如实说明网关不可用，不渲染配置入口', () => {
    render(<LlmEngineCard />);
    expect(screen.getByTestId('llm-engine-card')).toBeInTheDocument();
    expect(screen.getByText(/LLM 网关仅在桌面壳/)).toBeInTheDocument();
    expect(screen.queryByTestId('llm-add-custom')).toBeNull();
  });

  test('读配置被拒：把主进程原因原样显示并给出「重新加载」，不假装没有厂商可加', async () => {
    mockRole('admin');
    setHost({ config: async () => ({ ok: false, error: '需要登录会话' }) });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-load-failed').textContent).toContain('主进程未返回引擎列表'));
    expect(screen.getByTestId('llm-reload')).toBeInTheDocument();
    // 失败态没有引擎列表，也没有添加入口（避免用户对着空列表以为「不能加厂商」）
    expect(screen.queryByTestId('llm-add-section')).toBeNull();
    expect(screen.queryByTestId('llm-engine-ollama')).toBeNull();
  });

  test('读配置抛错（IPC 拒绝）：显示内核原因；点「重新加载」成功后列出引擎与添加区', async () => {
    mockRole('admin');
    let calls = 0;
    setHost({ config: async () => { calls++; if (calls === 1) throw new Error('宿主能力缺失: window.api.llm.config'); return SNAPSHOT; } });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-load-failed').textContent).toContain('window.api.llm.config'));
    await userEvent.click(screen.getByTestId('llm-reload'));
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama')).toBeInTheDocument());
    expect(screen.queryByTestId('llm-load-failed')).toBeNull();
    expect(screen.getByTestId('llm-add-section')).toBeInTheDocument();
  });

  test('自定义 OpenAI 兼容厂商：名称 + 服务地址 + 模型名 → add 补丁原样交主进程；缺名称/地址时按钮禁用', async () => {
    mockRole('admin');
    const patches: unknown[] = [];
    setHost({ setConfig: async (patch) => { patches.push(patch); return { ...SNAPSHOT, ok: true }; } });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama')).toBeInTheDocument());

    const addBtn = screen.getByTestId('llm-add-custom') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);

    await userEvent.type(screen.getByTestId('llm-add-custom-name'), '内部网关');
    await userEvent.type(screen.getByTestId('llm-add-custom-baseurl'), 'https://llm.corp.example/v1');
    await userEvent.type(screen.getByTestId('llm-add-custom-model'), 'corp-chat');
    await waitFor(() => expect(addBtn.disabled).toBe(false));
    await userEvent.click(addBtn);

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ add: { name: '内部网关', baseURL: 'https://llm.corp.example/v1', model: 'corp-chat' } });
    // 添加后清空输入，避免重复提交同一家
    expect((screen.getByTestId('llm-add-custom-name') as HTMLInputElement).value).toBe('');
  });

  test('只填名称不填地址 → 仍禁用（主进程需要 baseURL 才能拨测/调用）', async () => {
    mockRole('admin');
    setHost();
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama')).toBeInTheDocument());
    await userEvent.type(screen.getByTestId('llm-add-custom-name'), '内部网关');
    expect((screen.getByTestId('llm-add-custom') as HTMLButtonElement).disabled).toBe(true);
  });

  test('预设快选：已在列表里的厂商不再重复出现在下拉（zhipu 可加，ollama/deepseek 已加）', async () => {
    mockRole('admin');
    setHost();
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama')).toBeInTheDocument());
    const select = screen.getByTestId('llm-add-preset') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['', 'zhipu']);
    await userEvent.selectOptions(select, 'zhipu');
    await userEvent.click(screen.getByTestId('llm-add-preset-btn'));
    await waitFor(() => expect((screen.getByTestId('llm-add-preset') as HTMLSelectElement).value).toBe(''));
  });

  test('空引擎列表：诚实空态文案指向「添加其他厂商 API」入口', async () => {
    mockRole('admin');
    setHost({ config: async () => ({ ...SNAPSHOT, usable: false, engines: [] }) });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-no-engine').textContent).toContain('添加其他厂商 API'));
    expect(screen.getByTestId('llm-add-section')).toBeInTheDocument();
  });

  test('普通成员：只读——添加/保存/拨测/移除一律禁用并说明需管理员', async () => {
    mockRole('member');
    setHost();
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-admin-required')).toBeInTheDocument());
    expect((screen.getByTestId('llm-add-custom') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('llm-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('llm-engine-ollama-test') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('llm-engine-ollama-remove') as HTMLButtonElement).disabled).toBe(true);
  });

  test('移除引擎 → remove 补丁；顺序徽标按最近拨测延时（快的在前）', async () => {
    mockRole('admin');
    const patches: unknown[] = [];
    setHost({ setConfig: async (patch) => { patches.push(patch); return { ...SNAPSHOT, ok: true }; } });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama')).toBeInTheDocument());
    // 可调用口径：启用 且 有模型 且（本机引擎 或 已设密钥）。ollama 本机可调用（28,000ms）；
    // deepseek 虽 900ms 更快但缺密钥 → 不进队列；kimi 已停用 → 不进队列。
    expect(screen.getByTestId('llm-engine-ollama-rank').textContent).toContain('调用顺序 1');
    expect(screen.queryByTestId('llm-engine-deepseek-rank')).toBeNull();
    expect(screen.queryByTestId('llm-engine-kimi-rank')).toBeNull();

    await userEvent.click(screen.getByTestId('llm-engine-kimi-remove'));
    await waitFor(() => expect(patches).toContainEqual({ remove: 'kimi' }));
  });
});

// 批次34：用户「配了 Key 点测试连通全显示连不通」——旧实现要求先勾选启用，未启用时不发请求就返回失败。
describe('LlmEngineCard 批次34（拨测与启用解耦）', () => {
  test('未启用的引擎「测试连通」按钮仍可点；拨测不先保存草稿（没改动时）', async () => {
    mockRole('admin');
    const patches: unknown[] = [];
    const tests: string[] = [];
    setHost({
      setConfig: async (patch) => { patches.push(patch); return { ...SNAPSHOT, ok: true }; },
      test: async (id) => { tests.push(id); return { ok: true, latencyMs: 88, model: 'moonshot-v1-8k', enabled: false }; },
    });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-kimi')).toBeInTheDocument());
    const btn = screen.getByTestId('llm-engine-kimi-test') as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // kimi 在快照里 enabled:false，仍允许拨测
    await userEvent.click(btn);
    await waitFor(() => expect(tests).toEqual(['kimi']));
    expect(patches).toHaveLength(0); // 该行无编辑 → 不多写一次配置
    expect(screen.getByText(/不要求先勾选「启用」/)).toBeInTheDocument();
  });

  test('拨测成功但该引擎尚未启用：显式提示「勾选启用后才参与精炼排队」', async () => {
    mockRole('admin');
    setHost({ test: async () => ({ ok: true, latencyMs: 88, model: 'moonshot-v1-8k', enabled: false }) });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-kimi')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('llm-engine-kimi-test'));
    await waitFor(() => expect(screen.getByTestId('llm-engine-kimi-test-result').textContent)
      .toContain('尚未勾选「启用」'));
    expect(screen.getByTestId('llm-engine-kimi-test-result').textContent).toContain('88ms');
  });

  test('已启用的引擎拨测成功：只报连通，不加多余提示', async () => {
    mockRole('admin');
    setHost({ test: async () => ({ ok: true, latencyMs: 512, model: 'qwen2.5:7b', enabled: true }) });
    render(<LlmEngineCard />);
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('llm-engine-ollama-test'));
    await waitFor(() => expect(screen.getByTestId('llm-engine-ollama-test-result').textContent).toContain('✅ 连通（512ms）'));
    expect(screen.getByTestId('llm-engine-ollama-test-result').textContent).not.toContain('尚未勾选');
  });
});
