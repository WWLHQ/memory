// D6-4 令牌代理契约测试：TokenStore（内存/文件）mint→resolve、明文不落库、过期、
// 输入校验、持久化、损坏 fail-fast、resolveAccountFor 引导令牌兼容矩阵。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MCP_ACCOUNT } from '../mcpAuth.ts';
import { InMemoryTokenStore, FileTokenStore, resolveAccountFor } from '../tokenStore.ts';

const SERVER_TOKEN = 'bootstrap-token-0123456789abcdef0123456789abcdef';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('InMemoryTokenStore', () => {
  it('mint → resolve 命中：scope/is_admin/user_id 与签发记录一致', () => {
    const store = new InMemoryTokenStore();
    const { token, record } = store.mint({
      user_id: 'alice', scope_project_ids: ['P1', 'P-shared'], is_admin: false,
      label: 'cli', created_by: 'u1',
    });
    expect(token.startsWith('mtk_')).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(32); // 强度满足 assertMcpToken 口径
    const acct = store.resolve(token);
    expect(acct).not.toBeNull();
    expect(acct!.user_id).toBe('alice');
    expect(acct!.scope_project_ids).toEqual(['P1', 'P-shared']);
    expect(acct!.is_admin).toBe(false);
    expect(record.token_hash).not.toBe(token); // 库里只有哈希
  });

  it('admin 令牌 resolve → is_admin:true；未知令牌 → null；空令牌 → null', () => {
    const store = new InMemoryTokenStore();
    const { token } = store.mint({ user_id: 'root', scope_project_ids: ['*'], is_admin: true, created_by: 'u1' });
    expect(store.resolve(token)!.is_admin).toBe(true);
    expect(store.resolve('mtk_ffffffff')).toBeNull();
    expect(store.resolve(undefined)).toBeNull();
    expect(store.resolve('')).toBeNull();
  });

  it('过期令牌等同不存在（不泄露曾存在）；expires_at 在过去/当前 → mint 明确拒绝', () => {
    const store = new InMemoryTokenStore();
    const future = Date.now() + 30;
    const { token } = store.mint({
      user_id: 'bob', scope_project_ids: ['P1'], created_by: 'u1',
      expires_at: future,
    });
    expect(store.resolve(token, future - 1)).not.toBeNull(); // 注入时钟：过期前命中
    expect(store.resolve(token, future)).toBeNull(); // 注入时钟：到点即失效（等同不存在，无 sleep）
    expect(store.resolve(token, future + 1000)).toBeNull();
    expect(() => store.mint({ user_id: 'b', scope_project_ids: ['P1'], created_by: 'u1', expires_at: Date.now() - 1 }))
      .toThrow(/晚于当前时间/);
    expect(() => store.mint({ user_id: 'b', scope_project_ids: ['P1'], created_by: 'u1', expires_at: Date.now() }))
      .toThrow(/晚于当前时间/);
  });

  it('输入校验：空 user_id / 空 scope / 空 created_by 明确拒绝', () => {
    const store = new InMemoryTokenStore();
    expect(() => store.mint({ user_id: '', scope_project_ids: ['P1'], created_by: 'u1' })).toThrow(/user_id/);
    expect(() => store.mint({ user_id: 'a', scope_project_ids: [], created_by: 'u1' })).toThrow(/scope_project_ids/);
    expect(() => store.mint({ user_id: 'a', scope_project_ids: [''], created_by: 'u1' })).toThrow(/scope_project_ids/);
    expect(() => store.mint({ user_id: 'a', scope_project_ids: ['P1'], created_by: '' })).toThrow(/created_by/);
  });

  it('list() 只含哈希：明文绝不再现', () => {
    const store = new InMemoryTokenStore();
    const { token } = store.mint({ user_id: 'a', scope_project_ids: ['P1'], created_by: 'u1' });
    const dumped = JSON.stringify(store.list());
    expect(dumped).not.toContain(token);
  });
});

describe('FileTokenStore（0600 文件化）', () => {
  it('mint 落盘 → 新实例 resolve 仍命中（持久化）；文件存在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-tokens-'));
    dirs.push(dir);
    const path = join(dir, 'mcp-tokens.json');
    const store = new FileTokenStore(path);
    const { token } = store.mint({ user_id: 'alice', scope_project_ids: ['P1'], is_admin: false, created_by: 'u1' });
    expect(existsSync(path)).toBe(true);

    const reopened = new FileTokenStore(path);
    const acct = reopened.resolve(token);
    expect(acct).not.toBeNull();
    expect(acct!.user_id).toBe('alice');
    expect(acct!.is_admin).toBe(false);
  });

  it('库缺失（ENOENT）→ 空库：resolve null（引导令牌兜底由 resolveAccountFor 负责）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-tokens-'));
    dirs.push(dir);
    const store = new FileTokenStore(join(dir, 'absent.json'));
    expect(store.resolve('mtk_whatever')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('库损坏 → fail-fast 抛错（绝不静默清空既有授权）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-tokens-'));
    dirs.push(dir);
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ not-json', 'utf8');
    expect(() => new FileTokenStore(path)).toThrow(/令牌库损坏/);

    writeFileSync(path, JSON.stringify({ schema: 'wrong', tokens: [] }), 'utf8');
    expect(() => new FileTokenStore(path)).toThrow(/令牌库损坏/);
  });

  it('连续 mint 多个令牌各自独立可解析、互不串号', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-tokens-'));
    dirs.push(dir);
    const store = new FileTokenStore(join(dir, 'mcp-tokens.json'));
    const t1 = store.mint({ user_id: 'a', scope_project_ids: ['P1'], created_by: 'u1' }).token;
    const t2 = store.mint({ user_id: 'b', scope_project_ids: ['P2'], is_admin: true, created_by: 'u1' }).token;
    expect(store.resolve(t1)!.user_id).toBe('a');
    expect(store.resolve(t2)!.user_id).toBe('b');
    expect(store.resolve(t2)!.is_admin).toBe(true);
    expect(store.list().length).toBe(2);
  });
});

describe('resolveAccountFor（引导令牌兼容矩阵）', () => {
  const store = new InMemoryTokenStore();
  const minted = store.mint({ user_id: 'alice', scope_project_ids: ['P1'], is_admin: false, created_by: 'u1' });

  it('引导令牌 → 引导账户（DEFAULT_MCP_ACCOUNT，admin），库存在时仍优先', () => {
    const acct = resolveAccountFor(SERVER_TOKEN, { serverToken: SERVER_TOKEN, store });
    expect(acct).toEqual(DEFAULT_MCP_ACCOUNT);
    expect(acct!.is_admin).toBe(true);
  });

  it('库令牌 → 库账户；未知令牌（有库）→ null；未知令牌（无库）→ null', () => {
    const hit = resolveAccountFor(minted.token, { serverToken: SERVER_TOKEN, store });
    expect(hit!.user_id).toBe('alice');

    expect(resolveAccountFor('mtk_unknown', { serverToken: SERVER_TOKEN, store })).toBeNull();
    expect(resolveAccountFor('mtk_unknown', { serverToken: SERVER_TOKEN })).toBeNull();
  });

  it('无库时仅引导令牌可用（现状行为不变）；未携带令牌 → null', () => {
    expect(resolveAccountFor(SERVER_TOKEN, { serverToken: SERVER_TOKEN })).toEqual(DEFAULT_MCP_ACCOUNT);
    expect(resolveAccountFor(undefined, { serverToken: SERVER_TOKEN, store })).toBeNull();
  });
});

describe('批次45-A3："*" 仅属本机属主引导账户', () => {
  it('mint 非 admin + scope 含 "*" → 库层拒签（与 mint_token 编排层双保险）', () => {
    const store = new InMemoryTokenStore();
    expect(() => store.mint({ user_id: 'bob', scope_project_ids: ['*'], created_by: 'u1' }))
      .toThrow(/'\*' 仅限 is_admin=true/);
    expect(() => store.mint({ user_id: 'bob', scope_project_ids: ['*', 'P1'], created_by: 'u1' }))
      .toThrow(/45-A3/);
    expect(() => store.mint({ user_id: 'bob', scope_project_ids: ['*'], is_admin: false, created_by: 'u1' }))
      .toThrow(/45-A3/);
    expect(store.list()).toHaveLength(0); // 零副作用
    // admin 签 '*' 仍放行（本机属主委托）
    const { token } = store.mint({ user_id: 'root', scope_project_ids: ['*'], is_admin: true, created_by: 'u1' });
    expect(store.resolve(token)!.scope_project_ids).toEqual(['*']);
  });

  it('resolve 防御纵深：存量「非 admin 持 "*"」记录 fail-closed（等同不存在）', () => {
    const file = join(tmpdir(), `tokens-a3-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    dirs.push(file);
    const plain = `mtk_${'a'.repeat(64)}`;
    // 手工构造一条绕过 mint 校验的存量记录（模拟 D6-4 时代遗留 / 文件被篡改）
    writeFileSync(file, JSON.stringify({
      schema: 'mcp-tokens/1',
      tokens: [{
        token_hash: createHash('sha256').update(plain, 'utf8').digest('hex'),
        user_id: 'bob', scope_project_ids: ['*'], is_admin: false,
        created_at: 1, created_by: 'legacy',
      }],
    }));
    const store = new FileTokenStore(file);
    expect(store.resolve(plain)).toBeNull(); // fail-closed，绝不放行
    expect(store.list()).toHaveLength(1);     // 记录还在（可审计），只是解析即拒
  });
});
