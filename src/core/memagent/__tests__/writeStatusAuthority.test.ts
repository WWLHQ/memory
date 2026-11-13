// 写密钥状态（getWriteStatus）的三条判定来源，以及「成员为什么曾经恒判未解锁」的回归守卫。
//
// 背景（2026-11-12 用户报障）：安全页「本账号写密钥」显示已解锁，写入页 masthead 仍说未解锁。
// 根因不是文案：渲染层 HostL0Port 没有 isWriteUnlocked，内核只好退到 l0Admin.status()，
// 而 `l0:status` 是 requireAdmin —— 成员一调就抛 → catch 成 false。
// 连带后果：getWriteStatus 里 `if (l0_unlocked) await pending.flush()` 永不成立，
// 成员的待重放写入永远不会被重放。
import { describe, expect, it, vi } from 'vitest';
import { createMemAgent } from '../agent.ts';
import type { L0AdminPort, L0Port } from '../types.ts';
import { MemAgentError } from '../errors.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';

const MEMBER = 'mem_1';

function makeAgent(l0: L0Port | undefined, l0Admin: L0AdminPort | undefined) {
  return createMemAgent({
    form: 'desktop',
    account: { user_id: MEMBER, team_id: 't1', enterprise_id: 'e1' },
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage: new InMemoryStorage(),
    l0,
    l0Admin,
  } as Parameters<typeof createMemAgent>[0]);
}

/** 只有 seal/decrypt/sessionInfo 的旧端口形态（等价于渲染层 HostL0Port 没有 isWriteUnlocked） */
const barePort = (): L0Port => ({
  seal: vi.fn(async () => 'v2.envelope'),
  decrypt: vi.fn(async () => 'plain'),
  sessionInfo: vi.fn(async () => ({ user_id: MEMBER, scope_project_ids: [], expires_at: 0 })),
}) as unknown as L0Port;

/** 成员视角的管理端口：status() 直接抛 E_AUTH_ADMIN（主进程 requireAdmin 的真实行为） */
function memberAdmin(over: Partial<L0AdminPort> = {}): L0AdminPort {
  const adminDenied = async () => { throw new MemAgentError('E_AUTH_L0', '需要管理员权限'); };
  return {
    status: vi.fn(adminDenied),
    myWriteWrap: vi.fn(async () => ({ has_wrap: true, write_unlocked: true })),
    ...over,
  } as unknown as L0AdminPort;
}

describe('getWriteStatus · 写密钥状态判定来源（成员不得恒判未解锁）', () => {
  it('端口无 isWriteUnlocked + status() 是 requireAdmin → 用账号级 myWriteWrap 得「已解锁」', async () => {
    const admin = memberAdmin();
    const ma = makeAgent(barePort(), admin);
    const st = await ma.getWriteStatus();
    // 核心回归：旧实现这里恒为 false（status 抛 → catch false）
    expect(st.l0_unlocked).toBe(true);
    expect(st.writeDek_present).toBe(true);
    expect(admin.myWriteWrap).toHaveBeenCalledWith(MEMBER); // member_id 取当前会话账号，不由页面传入
  });

  it('端口同步回 true 时直接采信，不再多问管理员通道（少一次无用 IPC）', async () => {
    const admin = memberAdmin();
    const port = { ...barePort(), isWriteUnlocked: vi.fn(() => true) } as unknown as L0Port;
    const st = await makeAgent(port, admin).getWriteStatus();
    expect(st.l0_unlocked).toBe(true);
    expect(admin.myWriteWrap).not.toHaveBeenCalled();
    expect(admin.status).not.toHaveBeenCalled();
  });

  it('端口异步回 true（渲染层 HostL0Port 形态）也算已解锁', async () => {
    const port = { ...barePort(), isWriteUnlocked: vi.fn(async () => true) } as unknown as L0Port;
    const st = await makeAgent(port, memberAdmin()).getWriteStatus();
    expect(st.l0_unlocked).toBe(true);
  });

  it('端口说未解锁时用账号级窄口子复核（老端口缺实现/缺会话不至于误判）', async () => {
    const port = { ...barePort(), isWriteUnlocked: vi.fn(async () => false) } as unknown as L0Port;
    const st = await makeAgent(port, memberAdmin()).getWriteStatus();
    expect(st.l0_unlocked).toBe(true);
  });

  it('真锁着时如实回未解锁（不因为有两层兜底就乐观）', async () => {
    const admin = memberAdmin({ myWriteWrap: vi.fn(async () => ({ has_wrap: true, write_unlocked: false })) } as Partial<L0AdminPort>);
    const st = await makeAgent(barePort(), admin).getWriteStatus();
    expect(st.l0_unlocked).toBe(false);
    expect(st.writeDek_present).toBe(false);
  });

  it('老主进程（没有 myWriteWrap）→ 退回 status()；status() 抛则如实 false，不猜', async () => {
    const okStatus = memberAdmin({
      myWriteWrap: undefined as unknown as L0AdminPort['myWriteWrap'],
      status: vi.fn(async () => ({
        has_admin_wrap: true, write_unlocked: true, active_sessions: 0, active_grants: 0,
        member_write_wraps: 0, member_wrap_ids: [],
      })),
    } as Partial<L0AdminPort>);
    expect((await makeAgent(barePort(), okStatus).getWriteStatus()).l0_unlocked).toBe(true);

    const noPort = memberAdmin({ myWriteWrap: undefined as unknown as L0AdminPort['myWriteWrap'] } as Partial<L0AdminPort>);
    expect((await makeAgent(barePort(), noPort).getWriteStatus()).l0_unlocked).toBe(false);
  });

  it('完全没有 L0 端口（纯浏览器）→ false，不冒充已解锁', async () => {
    const st = await makeAgent(undefined, undefined).getWriteStatus();
    expect(st.l0_unlocked).toBe(false);
  });
});
