// ① 三处一致：待生效共享信号（localStorage + 事件 + TTL）
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_PENDING_KEY, MCP_PENDING_TTL_MS,
  clearMcpPending, listMcpPending, markMcpPending, subscribeMcpPending,
} from '../mcpPending.ts';

describe('① · mcpPending 共享信号', () => {
  beforeEach(() => { localStorage.clear(); });

  it('mark → list 能读到；clear(id) 只清一个；clear() 清全部', () => {
    markMcpPending('trae-cn', 1000);
    markMcpPending('workbuddy', 2000);
    expect(listMcpPending(2500)).toEqual(['trae-cn', 'workbuddy']); // 按登记时间升序
    clearMcpPending('trae-cn');
    expect(listMcpPending(2500)).toEqual(['workbuddy']);
    clearMcpPending();
    expect(listMcpPending(2500)).toEqual([]);
  });

  it('超过 TTL 自动失效并清除（避免长期误报）', () => {
    markMcpPending('trae-cn', 1000);
    const later = 1000 + MCP_PENDING_TTL_MS + 1;
    expect(listMcpPending(later)).toEqual([]);
    expect(localStorage.getItem(MCP_PENDING_KEY)).toBe('{}');
  });

  it('订阅：mark 时回调被触发（同文档自定义事件）', () => {
    const cb = vi.fn();
    const off = subscribeMcpPending(cb);
    markMcpPending('trae-cn');
    expect(cb).toHaveBeenCalled();
    off();
    cb.mockClear();
    markMcpPending('workbuddy');
    expect(cb).not.toHaveBeenCalled();
  });

  it('损坏的存储内容不崩、按空处理', () => {
    localStorage.setItem(MCP_PENDING_KEY, '{not json');
    expect(listMcpPending()).toEqual([]);
  });
});
