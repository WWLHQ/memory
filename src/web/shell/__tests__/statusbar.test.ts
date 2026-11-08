// S7 状态栏读数口径：不可用给原因、失败只影响自身单元格、短文案可追溯到完整路径。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostCall, hostCapability } from '../../../desktop/hostBridge.ts';
import { getKernel } from '../../kernel.ts';
import { storageLocation } from '../../memory/coreMemoryOps.ts';
import { loadCollectorStatus, loadL0Status, loadStatusbar, shortLocation } from '../statusbar.ts';

vi.mock('../../../desktop/hostBridge.ts', () => ({ hostCapability: vi.fn(), hostCall: vi.fn() }));
vi.mock('../../kernel.ts', () => ({ getKernel: vi.fn() }));
vi.mock('../../memory/coreMemoryOps.ts', () => ({ storageLocation: vi.fn() }));

const L0 = { has_admin_wrap: true, write_unlocked: false, active_sessions: 2, active_grants: 1 };

beforeEach(() => {
  vi.mocked(hostCapability).mockReset();
  vi.mocked(hostCall).mockReset();
  vi.mocked(getKernel).mockReset();
  vi.mocked(storageLocation).mockReset();
});

describe('loadL0Status', () => {
  it('浏览器模式：如实不可用，不试探内核', async () => {
    vi.mocked(hostCapability).mockReturnValue('none');
    const r = await loadL0Status();
    expect(r).toEqual({ status: 'unavailable', detail: expect.stringContaining('L0Vault') });
    expect(getKernel).not.toHaveBeenCalled();
  });

  it('桌面壳：读真实保险库计数', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(getKernel).mockReturnValue({ l0Status: vi.fn(async () => L0) } as unknown as ReturnType<typeof getKernel>);
    const r = await loadL0Status();
    expect(r).toEqual({ status: 'ok', view: L0 });
  });

  it('内核抛错 → error 带原始原因', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(getKernel).mockReturnValue({ l0Status: vi.fn(async () => { throw new Error('需要管理员会话'); }) } as unknown as ReturnType<typeof getKernel>);
    const r = await loadL0Status();
    expect(r).toEqual({ status: 'error', detail: '需要管理员会话' });
  });
});

describe('loadCollectorStatus', () => {
  it('浏览器模式：如实不可用，不试探宿主', async () => {
    vi.mocked(hostCapability).mockReturnValue('none');
    const r = await loadCollectorStatus();
    expect(r.status).toBe('unavailable');
    expect(hostCall).not.toHaveBeenCalled();
  });

  it('主进程 ok=false → error，不返回「空闲」', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(hostCall).mockResolvedValue({ ok: false });
    const r = await loadCollectorStatus();
    expect(r).toEqual({ status: 'error', detail: expect.stringContaining('未返回 ok') });
  });

  it('真实字段原样映射（含自动重试已停与连续失败）', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(hostCall).mockResolvedValue({
      ok: true, running: false, intervalMs: 60000,
      last: { collected: 12, ts: 1_790_000_000_000 },
      autoRetryStopped: true, consecutiveFails: 3,
    });
    const r = await loadCollectorStatus();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view).toEqual({
      running: false, intervalMs: 60000, lastAt: 1_790_000_000_000,
      lastCollected: 12, autoRetryStopped: true, consecutiveFails: 3,
    });
  });
});

describe('loadStatusbar', () => {
  it('部分失败只影响自身单元格，其它单元格照常真实', async () => {
    vi.mocked(hostCapability).mockReturnValue('native');
    vi.mocked(storageLocation).mockResolvedValue({ kind: 'file', path: 'C:\\data\\memories.db.json', source: 'ipc' });
    vi.mocked(getKernel).mockReturnValue({ l0Status: vi.fn(async () => { throw new Error('E_L0_ADMIN_ONLY'); }) } as unknown as ReturnType<typeof getKernel>);
    vi.mocked(hostCall).mockResolvedValue({ ok: true, running: true, intervalMs: 30000, last: null });
    const s = await loadStatusbar();
    expect(s.location.status).toBe('ok');
    expect(s.l0.status).toBe('error');
    expect(s.collector.status).toBe('ok');
  });
});

describe('shortLocation', () => {
  it('Windows 路径取文件名，title 保留完整路径与来源', () => {
    const v = shortLocation({ kind: 'file', path: 'C:\\Users\\x\\data\\memories.db.json', source: 'ipc' });
    expect(v.text).toBe('memories.db.json');
    expect(v.title).toContain('C:\\Users\\x\\data\\memories.db.json');
    expect(v.title).toContain('ipc');
  });

  it('内存态如实说无磁盘账本', () => {
    const v = shortLocation({ kind: 'memory', source: 'browser-memory' });
    expect(v.text).toBe('内存态');
    expect(v.title).toContain('无磁盘账本');
  });
});
