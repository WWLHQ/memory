// §4.4.4-B 成员写解锁口令：内核/Agent 级端到端回归（T5）。
// 覆盖「BUG③ 成员登录后写密钥不可用」的真实用户路径：
//   成员写入被挡 → 管理员发放自己的口令 → 成员自解锁 → 写入落库（v2 密文）→ 撤销后再次被挡。
// 全部用真 L0Vault + 真 coreWrite（无 mock），只换存储与 LLM 为内存实现。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { parseL0EnvelopeV2 } from '../crypto.ts';
import type { L0Vault } from '../l0vault.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';
import type { StorageBackend } from '../types.ts';
import { createTestVault, TEST_ADMIN_ID, TEST_ADMIN_PW } from './l0Kit.ts';

const MEMBER = 'mem_1';
const MEMBER_PW = 'memberkeypass-1';

/** 同一份 vault + storage，两个账号各自一个内核实例（模拟管理员端与成员端） */
function makeAgent(user_id: string, vault: L0Vault, storage: StorageBackend) {
  return createMemAgent({
    form: 'desktop',
    account: { user_id, team_id: 't1', enterprise_id: 'e1' },
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage,
    l0: vault,
    l0Admin: vault,
  });
}

const req = (content: string) => ({ content, category: 'fact' as const, project_id: 'P1' });
// 内容必须过硬事实质量门（L0→L1 有效内容 <30 字且无技术信息会被 filtered），
// 否则写入在 seal 之前就被拦，E_L0_LOCKED 断言会因「被过滤」而假通过。
const BLOCKED = 'member write probe: prod-db 连接串 tcp://prod-db:5432/app，重试上限 5 次';
const WRITTEN = 'member granted write: redis maxmemory-policy allkeys-lru，ttl 3600s，副本 2 个';

describe('§4.4.4-B 成员写解锁口令 · 内核端到端', () => {
  it('未发放口令 → 成员写入 E_L0_LOCKED 且不落库；发放后成员自解锁可写（落 v2 密文、无 content_orig）', async () => {
    const { vault, audits } = await createTestVault();
    const storage = new InMemoryStorage();
    const admin = makeAgent(TEST_ADMIN_ID, vault, storage);
    const member = makeAgent(MEMBER, vault, storage);

    // ① 管理员锁掉写密钥 → 成员写入被挡，且一条都不落（不落明文、不伪造回执）
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await expect(member.write(req(BLOCKED)))
      .rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(await storage.listMemories({})).toHaveLength(0);

    // ② 未发放就自解锁 → E_L0_NO_GRANT（不冒充成功）
    await expect(member.l0UnlockWriteForMember({ password: MEMBER_PW, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });

    // ③ 管理员解锁写密钥并发放成员口令（admin_user_id 取管理员会话账号，不由页面传入）
    await admin.l0UnlockWrite(TEST_ADMIN_PW);
    await admin.l0AddMemberWriteWrap({ member_id: MEMBER, passphrase: MEMBER_PW });
    expect((await admin.l0Status()).member_write_wraps).toBe(1);
    expect(audits.some((a) => a.detail.op === 'l0_member_wrap_add' && a.detail.member_id === MEMBER)).toBe(true);

    // ④ 再次锁掉 → 成员用自己的口令自解锁，无需管理员在线
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    expect((await member.l0Status()).write_unlocked).toBe(false);
    await member.l0UnlockWriteForMember({ password: MEMBER_PW, member_id: MEMBER });
    expect((await member.l0Status()).write_unlocked).toBe(true);

    // ⑤ 成员写入成功落库：v2 密文信封存在，content_orig 永不写入（§4.4.6）
    const r = await member.write(req(WRITTEN));
    expect(r.mem_id).toBeTruthy();
    expect(r.dedup.action).toBe('new');
    const rows = await storage.listMemories({});
    expect(rows).toHaveLength(1);
    const row = rows.find((m) => m.mem_id === r.mem_id);
    expect(row).toBeTruthy();
    expect(row?.content_l0_enc).toBeTruthy();
    expect(parseL0EnvelopeV2(row!.content_l0_enc!)).toBeTruthy();
    expect(row?.content_orig).toBeUndefined();
  });

  it('口令错误 → E_AUTH_L0；管理员密码不能替代成员口令（两把钥匙互不替代）', async () => {
    const { vault } = await createTestVault();
    const storage = new InMemoryStorage();
    const admin = makeAgent(TEST_ADMIN_ID, vault, storage);
    const member = makeAgent(MEMBER, vault, storage);

    await admin.l0AddMemberWriteWrap({ member_id: MEMBER, passphrase: MEMBER_PW });
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });

    await expect(member.l0UnlockWriteForMember({ password: 'wrong-member-pw', member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    // 管理密码 ≠ 成员口令：拿管理密码走成员通道一律失败
    await expect(member.l0UnlockWriteForMember({ password: TEST_ADMIN_PW, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    expect((await member.l0Status()).write_unlocked).toBe(false);
    expect(await storage.listMemories({})).toHaveLength(0);
  });

  it('写密钥锁定态发放成员口令 → E_L0_LOCKED（不给只拿到文件的人免密发口令）', async () => {
    const { vault } = await createTestVault();
    const storage = new InMemoryStorage();
    const admin = makeAgent(TEST_ADMIN_ID, vault, storage);

    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await expect(admin.l0AddMemberWriteWrap({ member_id: MEMBER, passphrase: MEMBER_PW }))
      .rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect((await admin.l0Status()).member_write_wraps).toBe(0);
  });

  it('撤销成员口令 → 计数归零、该成员再解锁 E_L0_NO_GRANT，管理员通道不受影响', async () => {
    const { vault, audits } = await createTestVault();
    const storage = new InMemoryStorage();
    const admin = makeAgent(TEST_ADMIN_ID, vault, storage);
    const member = makeAgent(MEMBER, vault, storage);

    await admin.l0AddMemberWriteWrap({ member_id: MEMBER, passphrase: MEMBER_PW });
    await admin.l0RemoveMemberWriteWrap({ member_id: MEMBER });
    expect((await admin.l0Status()).member_write_wraps).toBe(0);
    expect(audits.some((a) => a.detail.op === 'l0_member_wrap_remove' && a.detail.member_id === MEMBER)).toBe(true);

    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await expect(member.l0UnlockWriteForMember({ password: MEMBER_PW, member_id: MEMBER }))
      .rejects.toMatchObject({ code: 'E_L0_NO_GRANT' });
    // 管理员通道仍可用（撤销只影响该成员）
    await admin.l0UnlockWrite(TEST_ADMIN_PW);
    expect((await admin.l0Status()).write_unlocked).toBe(true);
  });

  it('成员写解锁 ≠ 查阅解锁：自解锁后可写，但拿成员口令查阅仍被拒（§4.4.4 两把锁分治）', async () => {
    const { vault } = await createTestVault();
    const storage = new InMemoryStorage();
    const admin = makeAgent(TEST_ADMIN_ID, vault, storage);
    const member = makeAgent(MEMBER, vault, storage);

    await admin.l0AddMemberWriteWrap({ member_id: MEMBER, passphrase: MEMBER_PW });
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    await member.l0UnlockWriteForMember({ password: MEMBER_PW, member_id: MEMBER });
    const wrote = await member.write(req(WRITTEN));
    expect(wrote.mem_id).toBeTruthy();

    // 写解锁不产生查阅会话；成员口令不是管理密码 → 查阅解锁失败
    await expect(member.l0Unlock({ password: MEMBER_PW })).rejects.toMatchObject({ code: 'E_AUTH_L0' });
    expect((await member.l0Status()).active_sessions).toBe(0);
  });

  it('成员自证 l0MyWriteWrap：发放前 false / 发放后 true，「有没有钥匙」与「是否已解锁」分开回', async () => {
    const { vault } = await createTestVault();
    const storage = new InMemoryStorage();
    const admin = makeAgent(TEST_ADMIN_ID, vault, storage);
    const member = makeAgent(MEMBER, vault, storage);

    // setup 后写密钥在内存 → write_unlocked=true，但该成员还没有钥匙
    expect(await member.l0MyWriteWrap()).toEqual({ has_wrap: false, write_unlocked: true });
    await admin.l0AddMemberWriteWrap({ member_id: MEMBER, passphrase: MEMBER_PW });
    expect(await member.l0MyWriteWrap()).toEqual({ has_wrap: true, write_unlocked: true });
    // 锁定写密钥：钥匙仍在一把（has_wrap），但当前未解锁 —— 页面据此才会出输入框
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    expect(await member.l0MyWriteWrap()).toEqual({ has_wrap: true, write_unlocked: false });
    // 另一个成员不受影响：自证只看自己的账号
    expect(await makeAgent('mem_other', vault, storage).l0MyWriteWrap()).toEqual({ has_wrap: false, write_unlocked: false });
  });
});
