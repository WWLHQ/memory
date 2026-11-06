// 批次48 A30：inline 演示页入口必须在首屏渲染演示标识（不依赖登录态/账本加载）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('no backend in jsdom');
  }));
});

describe('inlineAttributionEntry 演示标识', () => {
  it('入口首屏渲染演示标识（登录门禁之外，不随数据加载隐藏）', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../inlineAttributionEntry.tsx');
    await waitFor(() => expect(screen.getByTestId('demo-badge')).toBeInTheDocument());
    expect(screen.getByTestId('demo-badge')).toHaveTextContent('演示页（DEMO）');
  });

  it('#root 容器缺失 → 显式抛错（不静默吞掉）', async () => {
    document.body.innerHTML = '';
    await expect(import('../inlineAttributionEntry.tsx')).rejects.toThrow('#root 容器缺失');
  });
});
