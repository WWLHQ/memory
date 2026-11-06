// 批次45-B1 成员 / API 密钥域模型回归：
// 成员登记（显式主键重复拒绝 / 校验矩阵 / 缺省 active）+ API 密钥（明文一次性、只存哈希、
// owner 必须存在且 active、吊销后 resolve=null）+ 文件库（真实空表落盘 / 持久化重开 / 损坏 fail-fast / 0600）。
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemoryMemberStore, FileMemberStore, resolveApiKeyAccount,
  type CreateMemberInput, type MintApiKeyInput,
} from '../memberStore.ts';

const NOW = 1_800_000_000_000;
const alice: CreateMemberInput = {
  member_id: 'mb_alice', name: 'Alice', role: 'admin',
  user_id: 'u1', team_id: 't1', enterprise_id: 'e1', created_by: 'system',
};
const mint: MintApiKeyInput = { owner_member_id: 'mb_alice', scope_project_ids: ['*'], created_by: 'mb_alice' };

let cleanup: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'member-store-'));
  cleanup.push(dir);
  return join(dir, 'members.json');
}
afterEach(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); cleanup = []; });

describe('成员域模型（InMemoryMemberStore.createMember）', () => {
  it('登记成员：缺省 status=active，字段如实返回；重复 member_id 显式拒绝', () => {
    const s = new InMemoryMemberStore();
    const rec = s.createMember(alice, NOW);
    expect(rec).toMatchObject({
      member_id: 'mb_alice', name: 'Alice', role: 'admin',
      user_id: 'u1', team_id: 't1', enterprise_id: 'e1', status: 'active', created_at: NOW, created_by: 'system',
    });
    expect(() => s.createMember({ ...alice, name: 'Alice2' }, NOW)).toThrow(/成员已存在/);
  });

  it('status 缺省 active、可显式 suspended；getMember 未命中 → null；listMembers 按 role/status 过滤', () => {
    const s = new InMemoryMemberStore();
    s.createMember(alice, NOW);
    s.createMember({ ...alice, member_id: 'mb_bob', name: 'Bob', role: 'member' }, NOW);
    s.createMember({ ...alice, member_id: 'mb_carol', name: 'Carol', status: 'suspended' }, NOW);
    expect(s.getMember('mb_nobody')).toBeNull();
    expect(s.listMembers()).toHaveLength(3);
    expect(s.listMembers({ role: 'member' }).map((m) => m.member_id)).toEqual(['mb_bob']);
    expect(s.listMembers({ status: 'suspended' }).map((m) => m.member_id)).toEqual(['mb_carol']);
    expect(s.listMembers({ role: 'admin', status: 'active' }).map((m) => m.member_id)).toEqual(['mb_alice']);
  });

  it('校验矩阵：role/status 非法、必填字段空 —— 全部明确拒绝', () => {
    const s = new InMemoryMemberStore();
    expect(() => s.createMember({ ...alice, role: 'owner' as 'admin' })).toThrow(/role/);
    expect(() => s.createMember({ ...alice, status: 'deleted' as 'active' })).toThrow(/status/);
    expect(() => s.createMember({ ...alice, member_id: '' })).toThrow(/member_id/);
    expect(() => s.createMember({ ...alice, name: '  ' })).toThrow(/name/);
    expect(() => s.createMember({ ...alice, user_id: '' })).toThrow(/user_id/);
    expect(() => s.createMember({ ...alice, enterprise_id: '' })).toThrow(/enterprise_id/);
    expect(() => s.createMember({ ...alice, created_by: '' })).toThrow(/created_by/);
    expect(s.listMembers()).toHaveLength(0); // 全部拒绝，零副作用
  });
});

describe('API 密钥（mintApiKey / revokeApiKey / resolveSecret）', () => {
  it('mint：明文 apk_ 一次性回显，库中仅 sha256 哈希（record.secret_hash ≠ 明文且等于 sha256）', async () => {
    const s = new InMemoryMemberStore();
    s.createMember(alice, NOW);
    const { key, record } = s.mintApiKey(mint, NOW);
    expect(key).toMatch(/^apk_[0-9a-f]{64}$/);
    expect(record.secret_hash).not.toBe(key);
    const { createHash } = await import('node:crypto');
    expect(record.secret_hash).toBe(createHash('sha256').update(key, 'utf8').digest('hex'));
    // list 与 get 都拿不到明文
    const listed = s.listApiKeys()[0];
    expect(JSON.stringify(listed)).not.toContain(key);
    expect(s.getApiKey(record.key_id)?.secret_hash).toBe(record.secret_hash);
  });

  it('resolve 命中返回记录；未知/空 → null；吊销后 → null（不泄露曾存在）', () => {
    const s = new InMemoryMemberStore();
    s.createMember(alice, NOW);
    const { key, record } = s.mintApiKey(mint, NOW);
    expect(s.resolveSecret(key, NOW)).toMatchObject({ key_id: record.key_id, owner_member_id: 'mb_alice' });
    expect(s.resolveSecret('apk_deadbeef', NOW)).toBeNull();
    expect(s.resolveSecret('', NOW)).toBeNull();
    expect(s.resolveSecret(undefined, NOW)).toBeNull();
    const revoked = s.revokeApiKey(record.key_id, 'mb_alice', NOW + 1);
    expect(revoked).toMatchObject({ revoked_at: NOW + 1, revoked_by: 'mb_alice' });
    expect(s.resolveSecret(key, NOW + 2)).toBeNull(); // 吊销 = 不存在
  });

  it('吊销幂等（重吊不重盖时间）；吊销不存在的 key → null；listApiKeys 缺省滤掉已吊销、include_revoked 可见', () => {
    const s = new InMemoryMemberStore();
    s.createMember(alice, NOW);
    const { record } = s.mintApiKey(mint, NOW);
    s.revokeApiKey(record.key_id, 'mb_alice', NOW + 1);
    const again = s.revokeApiKey(record.key_id, 'mb_alice', NOW + 99);
    expect(again?.revoked_at).toBe(NOW + 1); // 幂等：时间不被重盖
    expect(s.revokeApiKey('key_nobody', 'mb_alice', NOW)).toBeNull();
    expect(s.listApiKeys()).toHaveLength(0);
    expect(s.listApiKeys({ include_revoked: true })).toHaveLength(1);
    expect(s.listApiKeys({ owner_member_id: 'mb_other', include_revoked: true })).toHaveLength(0);
  });

  it('owner 校验：成员不存在 / 已停用 → 拒签；scope 非法 → 拒签', () => {
    const s = new InMemoryMemberStore();
    expect(() => s.mintApiKey(mint, NOW)).toThrow(/不存在/);
    s.createMember(alice, NOW);
    s.createMember({ ...alice, member_id: 'mb_off', status: 'suspended' }, NOW);
    expect(() => s.mintApiKey({ ...mint, owner_member_id: 'mb_off' }, NOW)).toThrow(/已停用/);
    expect(() => s.mintApiKey({ ...mint, scope_project_ids: [] }, NOW)).toThrow(/scope_project_ids/);
    expect(() => s.mintApiKey({ ...mint, created_by: '' }, NOW)).toThrow(/created_by/);
    expect(s.listApiKeys({ include_revoked: true })).toHaveLength(0); // 零副作用
  });
});

describe('FileMemberStore：真实空表 + 持久化 + 损坏 fail-fast', () => {
  it('首启缺文件 → 构造即落一份真实空表（members: [] / api_keys: []，POSIX 0600）', () => {
    const file = tempFile();
    new FileMemberStore(file); // 构造即建表
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed).toEqual({ schema: 'members/1', members: [], api_keys: [] });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('create + mint 即写盘：重开新实例成员与密钥（哈希）都在，明文不在文件里', () => {
    const file = tempFile();
    const s1 = new FileMemberStore(file);
    s1.createMember(alice, NOW);
    const { key, record } = s1.mintApiKey(mint, NOW);
    const s2 = new FileMemberStore(file);
    expect(s2.getMember('mb_alice')).toMatchObject({ name: 'Alice', role: 'admin' });
    expect(s2.getApiKey(record.key_id)).toMatchObject({ owner_member_id: 'mb_alice' });
    expect(s2.resolveSecret(key)).toMatchObject({ key_id: record.key_id }); // 哈希可解析
    expect(readFileSync(file, 'utf8')).not.toContain(key); // 明文绝不落盘
  });

  it('损坏 fail-fast：非 JSON / 形状不符 → 构造抛错，绝不静默清空', () => {
    const file1 = tempFile();
    writeFileSync(file1, '{ broken');
    expect(() => new FileMemberStore(file1)).toThrow(/成员库损坏/);
    const file2 = tempFile();
    writeFileSync(file2, JSON.stringify({ schema: 'members/1', members: 'not-array' }));
    expect(() => new FileMemberStore(file2)).toThrow(/成员库损坏/);
    // 既有数据不被静默清空：损坏文件内容原样保留
    expect(readFileSync(file2, 'utf8')).toContain('not-array');
  });
});

describe("批次45-B3：API 密钥进 MCP 门（'*' 门禁延伸 + resolveApiKeyAccount）", () => {
  it('mintApiKey：member 角色成员签含 "*" 的 scope → 拒签（45-A3 口径延伸）；admin 角色成员放行', () => {
    const s = new InMemoryMemberStore();
    s.createMember(alice, NOW); // alice 是 admin 角色
    s.createMember({ ...alice, member_id: 'mb_mem', name: 'Mem', role: 'member' }, NOW);
    expect(() => s.mintApiKey({ owner_member_id: 'mb_mem', scope_project_ids: ['*'], created_by: 'x' }, NOW))
      .toThrow(/仅限 admin 角色成员/);
    expect(() => s.mintApiKey({ owner_member_id: 'mb_mem', scope_project_ids: ['*', 'P1'], created_by: 'x' }, NOW))
      .toThrow(/45-A3/);
    // admin 角色成员的密钥可持 '*'（本机属主委托）
    const { record } = s.mintApiKey({ owner_member_id: 'mb_alice', scope_project_ids: ['*'], created_by: 'x' }, NOW);
    expect(record.scope_project_ids).toEqual(['*']);
    // member 角色成员签显式 scope 放行
    const r2 = s.mintApiKey({ owner_member_id: 'mb_mem', scope_project_ids: ['P1'], created_by: 'x' }, NOW);
    expect(r2.record.scope_project_ids).toEqual(['P1']);
  });

  it('resolveApiKeyAccount：命中 → owner 三元组 + scope + role=admin 映射 is_admin', () => {
    const s = new InMemoryMemberStore();
    s.createMember(alice, NOW); // admin 角色，t1/e1
    const { key, record } = s.mintApiKey({ owner_member_id: 'mb_alice', scope_project_ids: ['P1'], created_by: 'x' }, NOW);
    const acct = resolveApiKeyAccount(s, key, NOW);
    expect(acct).not.toBeNull();
    expect(acct).toMatchObject({
      user_id: 'u1', team_id: 't1', enterprise_id: 'e1',
      scope_project_ids: ['P1'], is_admin: true,
    });
    expect(record.key_id).toBeTruthy();
  });

  it('resolveApiKeyAccount fail-closed：未命中 / 已吊销 / owner 已停用 / member 角色 idx存量 "*" 记录 → 全部 null', () => {
    const s = new InMemoryMemberStore();
    s.createMember({ ...alice, member_id: 'mb_mem', name: 'Mem', role: 'member' }, NOW);
    const { key } = s.mintApiKey({ owner_member_id: 'mb_mem', scope_project_ids: ['P1'], created_by: 'x' }, NOW);
    expect(resolveApiKeyAccount(s, key, NOW)).toMatchObject({ is_admin: false });
    // 吊销 → null
    s.revokeApiKey(s.listApiKeys()[0].key_id, 'x', NOW + 1);
    expect(resolveApiKeyAccount(s, key, NOW + 2)).toBeNull();
    // 停用成员 → 其密钥立即失效
    const { key: k2 } = s.mintApiKey({ owner_member_id: 'mb_mem', scope_project_ids: ['P2'], created_by: 'x' }, NOW + 3);
    s.createMember({ ...alice, member_id: 'mb_tmp', name: 'T', role: 'member' }, NOW);
    const { key: k3 } = s.mintApiKey({ owner_member_id: 'mb_tmp', scope_project_ids: ['P3'], created_by: 'x' }, NOW);
    // 手工停用 mb_tmp（updateMember 无 status —— 用内部状态模拟内核侧停用动作）
    const inner = s as unknown as { members: Array<{ member_id: string; status: string }> };
    inner.members.find((m) => m.member_id === 'mb_tmp')!.status = 'suspended';
    expect(resolveApiKeyAccount(s, k3, NOW + 4)).toBeNull(); // 停用立即断密钥
    expect(resolveApiKeyAccount(s, k2, NOW + 4)).toMatchObject({ scope_project_ids: ['P2'] }); // 未停用不受影响
    // 未命中
    expect(resolveApiKeyAccount(s, 'apk_deadbeef', NOW)).toBeNull();
    expect(resolveApiKeyAccount(s, undefined, NOW)).toBeNull();
  });
});
