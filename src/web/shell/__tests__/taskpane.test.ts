// S5：任务窗待重放队列读取口径（浏览器/未登录如实不可用，结构化校验后才展示）
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostCall, hostCapability } from '../../../desktop/hostBridge.ts';
import { currentSessionId } from '../../shared/session.ts';
import { loadPendingWrites } from '../taskpane.ts';
import type { PendingWritesView } from '../../../shared/pendingWritesView.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({
  hostCapability: vi.fn(),
  hostCall: vi.fn(),
}));
vi.mock('../../shared/session.ts', () => ({
  currentSessionId: vi.fn(),
}));

const view: PendingWritesView = {
  ok: true,
  count: 2,
  items: [
    { id: 'pend_2', created_at: 2000, project_id: 'P-1', source_agent: 'claude-code', category: 'fact', user_id: 'u1', session_id: null, content_chars: 12, tags: 1, importance: 0.6, confidence: null, half_life_days: null },
    { id: 'pend_1', created_at: 1000, project_id: 'P-1', source_agent: null, category: 'fact', user_id: null, session_id: null, content_chars: 8, tags: 0, importance: null, confidence: null, half_life_days: null },
  ],
  truncated: false,
  source: 'MCP 写入兜底队列（主进程内存 · 与 8202/8204 MCP 共用）',
  note: '说明',
  captured_at: '2026-11-08T00:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(hostCapability).mockReset();
  vi.mocked(hostCall).mockReset();
  vi.mocked(currentSessionId).mockReset();
});

describe('loadPendingWrites', () => {
  it('浏览器模式：如实不可用，且不试探宿主通道', async () => {
    vi.mocked(hostCapability).mockReturnValue('none');
    const r = await loadPendingWrites();
    expect(r).toEqual({ status: 'unavailable', detail: expect.stringContaining('浏览器模式') });
    expect(hostCall).not.toHaveBeenCalled();
  });

  it('未登录：如实不可用，不读队列', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(currentSessionId).mockReturnValue(null);
    const r = await loadPendingWrites();
    expect(r.status).toBe('unavailable');
    expect(hostCall).not.toHaveBeenCalled();
  });

  it('主进程返回完整视图 → status ok 且原样保留计数与摘要', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(currentSessionId).mockReturnValue('sid_1');
    vi.mocked(hostCall).mockResolvedValue(view);
    const r = await loadPendingWrites();
    expect(r).toEqual({ status: 'ok', view });
    expect(hostCall).toHaveBeenCalledWith('l0:pendingWrites', ['sid_1']);
  });

  it('主进程返回 ok=false → error 带上主进程原因', async () => {
    vi.mocked(hostCapability).mockReturnValue('bridge');
    vi.mocked(currentSessionId).mockReturnValue('sid_1');
    vi.mocked(hostCall).mockResolvedValue({ ok: false, error: '未登录会话' });
    const r = await loadPendingWrites();
    expect(r).toEqual({ status: 'error', detail: '未登录会话' });
  });

  it('主进程返回结构不完整 → error，不渲染半截数据', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(currentSessionId).mockReturnValue('sid_1');
    vi.mocked(hostCall).mockResolvedValue({ ok: true, count: 3 } as unknown as PendingWritesView);
    const r = await loadPendingWrites();
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.detail).toContain('结构不完整');
  });

  it('宿主调用抛错 → error 保留原始原因', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(currentSessionId).mockReturnValue('sid_1');
    vi.mocked(hostCall).mockRejectedValue(new Error('宿主能力缺失: window.api.l0.pendingWrites'));
    const r = await loadPendingWrites();
    expect(r).toEqual({ status: 'error', detail: '宿主能力缺失: window.api.l0.pendingWrites' });
  });
});
