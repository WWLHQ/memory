// 批次26-B P1-3：租户三元组主进程下发（syncTenantFromHost）——渲染层不再自报。
// 覆盖：桌面壳会话真值覆盖本地身份 + 持久化；纯浏览器显式降级（本地身份保留，不冒充服务端身份）；调用失败不动租户。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { getTenant, syncTenantFromHost, resetKernelForTests } from '../kernel.ts';
import { DEFAULT_TENANT } from '../../shared/tenantDefaults.ts';

vi.mock('../../desktop/hostBridge.ts', () => ({
  hostCapability: vi.fn(() => 'none' as const),
  hostCall: vi.fn(),
  installHostBridge: vi.fn(),
  isEmbedded: vi.fn(() => false),
  hostLog: vi.fn(),
}));

function mockHost(capability: 'native' | 'bridge' | 'none', result?: unknown): void {
  vi.mocked(hostCapability).mockReturnValue(capability);
  vi.mocked(hostCall).mockResolvedValue(result);
}

describe('批次26-B P1-3 租户主进程下发（kernel.syncTenantFromHost）', () => {
  beforeEach(() => {
    localStorage.clear();
    resetKernelForTests();
    mockHost('none');
  });

  it('纯浏览器（无宿主能力）：显式降级，租户保持本地身份且不发起 hostCall', async () => {
    const before = getTenant();
    const ok = await syncTenantFromHost();
    expect(ok).toBe(false);
    expect(getTenant()).toEqual(before);
    expect(hostCall).not.toHaveBeenCalled();
  });

  it('批次45-A1 浏览器降级：首次 getTenant 用规范缺省三元组（u1/t1/e1），不再现造 u_<ulid> 本机身份', () => {
    const t = getTenant();
    expect(t).toEqual({ user_id: 'u1', team_id: 't1', enterprise_id: 'e1' });
    // 与采集器/webhook/MCP 同源：直接断言与共享常量相等，防止三写者漂移
    expect(t).toEqual(DEFAULT_TENANT);
    // 降级值也持久化（跨页面/跨重启稳定）
    expect(JSON.parse(localStorage.getItem('mam.tenant.v1') ?? '{}')).toEqual(DEFAULT_TENANT);
  });

  it('桌面壳 + 有效会话：服务端真值覆盖本地身份并持久化', async () => {
    const local = getTenant(); // 先生成本地身份
    expect(local.user_id).not.toBe('u_admin');
    mockHost('bridge', { ok: true, tenant: { user_id: 'u_admin', team_id: 'team_a', enterprise_id: 'ent_a' } });

    const ok = await syncTenantFromHost();
    expect(ok).toBe(true);
    expect(getTenant()).toEqual({ user_id: 'u_admin', team_id: 'team_a', enterprise_id: 'ent_a' });
    expect(JSON.parse(localStorage.getItem('mam.tenant.v1') ?? '{}')).toEqual({
      user_id: 'u_admin', team_id: 'team_a', enterprise_id: 'ent_a',
    });
  });

  it('会话无效（ok:false）：不覆盖租户', async () => {
    getTenant();
    const before = getTenant();
    mockHost('bridge', { ok: false, error: '需要登录后操作（会话已过期或未登录）' });
    expect(await syncTenantFromHost()).toBe(false);
    expect(getTenant()).toEqual(before);
  });

  it('hostCall 抛错（宿主桥不可达）：不覆盖租户', async () => {
    getTenant();
    const before = getTenant();
    vi.mocked(hostCapability).mockReturnValue('bridge');
    vi.mocked(hostCall).mockRejectedValue(new Error('宿主桥不可达（父窗口未安装桥或非同源）'));
    expect(await syncTenantFromHost()).toBe(false);
    expect(getTenant()).toEqual(before);
  });
});
