// 悬浮覆盖层入口冒烟（批次27 P3-11）：floatattribution.html 是 vite 入口但此前零测试。
// floatEntry.tsx 在模块加载时自渲染到 #root，测试先挂载容器再动态 import，断言真实挂载产物：
// ① 无 preload 桥 → 如实显示 initErr，不伪造悬浮层；② 有桥 → 首次 detectClaude 命中并 setPosition 贴合；
// ③ 跟随开关关闭后拖拽条状态切换；④ ✕ 调用 api.close。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

function makeFloatApi() {
  return {
    detectClaude: vi.fn(async () => ({ x: 100, y: 200, width: 1200, height: 800 })),
    setPosition: vi.fn(),
    close: vi.fn(),
    log: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  localStorage.clear();
  delete (window as unknown as { api?: unknown }).api;
});

describe('floatEntry 悬浮覆盖层入口（P3-11 冒烟）', () => {
  it('无 preload 桥：如实显示 initErr，不伪造悬浮层能力', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../floatEntry.tsx');
    await waitFor(() => expect(screen.getByText(/preload 桥缺失/)).toBeInTheDocument());
    expect(screen.getByText('◦ 记忆标识层')).toBeInTheDocument();
    // 批次48 A30：浮层强制演示标识
    expect(screen.getByTestId('demo-badge')).toHaveTextContent('演示（DEMO）');
  });

  it('有桥：detectClaude 命中 → setPosition 贴到 Claude 右侧（x = right + 8）', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const floatApi = makeFloatApi();
    (window as unknown as { api?: unknown }).api = { floatAttribution: floatApi };
    await import('../floatEntry.tsx');
    await waitFor(() => expect(floatApi.setPosition).toHaveBeenCalled());
    // jsdom screen 尺寸为 0 → 回退 1920：100+1200+8=1308 放得下，贴右侧；y = 200 + 40 标题高
    expect(floatApi.setPosition).toHaveBeenCalledWith(1308, 240);
    expect(screen.getByText('◦ 记忆标识层')).toBeInTheDocument();
  });

  it('跟随开关关闭 → 状态切换为「手动」；✕ 调用 api.close', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const floatApi = makeFloatApi();
    (window as unknown as { api?: unknown }).api = { floatAttribution: floatApi };
    await import('../floatEntry.tsx');
    await waitFor(() => expect(screen.getByText('◦ 记忆标识层')).toBeInTheDocument());
    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    fireEvent.click(screen.getByText('✕'));
    expect(floatApi.close).toHaveBeenCalledTimes(1);
  });

  it('#root 容器缺失 → 模块加载显式抛错（不静默吞掉）', async () => {
    document.body.innerHTML = '';
    await expect(import('../floatEntry.tsx')).rejects.toThrow('#root 容器缺失');
  });
});
