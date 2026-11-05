// D6-5 管理工具契约测试：create_project / mint_token 的管理员门禁、命名规则、重名拒绝、
// mint 输入校验与「明文一次性回显（库里只有哈希）」红线。
import { describe, it, expect } from 'vitest';
import { DEFAULT_MCP_ACCOUNT } from '../mcpAuth.ts';
import { InMemoryStorage } from '../storage.ts';
import { InMemoryTokenStore } from '../tokenStore.ts';
import { runCreateProjectTool, runMintTokenTool } from '../mcpProjectTools.ts';
import { McpToolError } from '../mcpRecall.ts';

const ADMIN = DEFAULT_MCP_ACCOUNT; // D6-3：引导账户即管理员
const NON_ADMIN = { ...DEFAULT_MCP_ACCOUNT, is_admin: false, user_id: 'bob' };

describe('D6-5 runCreateProjectTool', () => {
  const storage = new InMemoryStorage();

  it('非 admin 明确拒绝（-32602），不触碰注册表', async () => {
    await expect(runCreateProjectTool(storage, { project_id: 'app1', kind: 'general' }, NON_ADMIN))
      .rejects.toMatchObject({ code: -32602 } as Partial<McpToolError>);
    expect(await storage.getProject('app1')).toBeNull();
  });

  it('admin 创建 general（slug 命名）→ 落注册表、created_by=调用者', async () => {
    const r = await runCreateProjectTool(storage, { project_id: 'app1', kind: 'general', display_name: '应用一' }, ADMIN);
    expect(r.ok).toBe(true);
    expect(r.project.kind).toBe('general');
    expect(r.project.created_by).toBe('u1');
    expect((await storage.getProject('app1'))!.display_name).toBe('应用一');
  });

  it('重名前置拒绝（-32602）', async () => {
    await expect(runCreateProjectTool(storage, { project_id: 'app1', kind: 'general' }, ADMIN))
      .rejects.toThrow(/项目已存在/);
  });

  it('命名规则矩阵：shared/archive 固定名、user 须 P-<owner>、general 禁 P- 前缀、非法 kind 拒绝', async () => {
    await expect(runCreateProjectTool(storage, { project_id: 'wrong', kind: 'shared' }, ADMIN)).rejects.toThrow(/P-shared/);
    await expect(runCreateProjectTool(storage, { project_id: 'other', kind: 'archive' }, ADMIN)).rejects.toThrow(/P-archive/);
    await expect(runCreateProjectTool(storage, { project_id: 'P-carol', kind: 'user' }, ADMIN)).rejects.toThrow(/P-u1/); // 缺省 owner=调用者 u1
    // kind=user 且 owner 显式：project_id 必须等于 P-<owner>
    await expect(runCreateProjectTool(storage, { project_id: 'P-bob', kind: 'user', owner_user_id: 'carol' }, ADMIN))
      .rejects.toThrow(/P-carol/);
    const u = await runCreateProjectTool(storage, { project_id: 'P-carol', kind: 'user', owner_user_id: 'carol' }, ADMIN);
    expect(u.project.owner_user_id).toBe('carol');
    // kind=user 缺省 owner → 调用者身份
    const self = await runCreateProjectTool(storage, { project_id: 'P-u1', kind: 'user' }, ADMIN);
    expect(self.project.owner_user_id).toBe('u1');
    // general 带 P- 前缀 → 与三池门禁冲突，明确拒绝
    await expect(runCreateProjectTool(storage, { project_id: 'P-notuser', kind: 'general' }, ADMIN))
      .rejects.toThrow(/三池门禁/);
    // general 非 slug 命名拒绝
    await expect(runCreateProjectTool(storage, { project_id: 'Bad Name!', kind: 'general' }, ADMIN))
      .rejects.toThrow(/slug/);
    // 非法 kind
    await expect(runCreateProjectTool(storage, { project_id: 'x1', kind: 'bogus' }, ADMIN)).rejects.toThrow(/kind 非法/);
  });
});

describe('D6-5 runMintTokenTool', () => {
  const store = new InMemoryTokenStore();

  it('非 admin 明确拒绝（-32602），不产生任何令牌', async () => {
    await expect(runMintTokenTool(store, { user_id: 'x', scope_project_ids: ['P1'] }, NON_ADMIN))
      .rejects.toMatchObject({ code: -32602 } as Partial<McpToolError>);
    expect(store.list().length).toBe(0);
  });

  it('未装配令牌库 → 明确报错（不静默成功）', async () => {
    await expect(runMintTokenTool(undefined, { user_id: 'x', scope_project_ids: ['P1'] }, ADMIN))
      .rejects.toThrow(/未装配令牌库/);
  });

  it('admin mint → 明文一次性回显；库里只有哈希；resolve 按签发账户生效', async () => {
    const r = await runMintTokenTool(store, {
      user_id: 'alice', scope_project_ids: ['app1'], label: 'cli',
    }, ADMIN);
    expect(r.ok).toBe(true);
    expect(r.token.startsWith('mtk_')).toBe(true);
    expect(r.minted.user_id).toBe('alice');
    expect(r.minted.is_admin).toBe(false);
    expect(r.note).toContain('一次');
    // 库里只有哈希
    expect(JSON.stringify(store.list())).not.toContain(r.token);
    // 新令牌可解析为签发账户
    const acct = store.resolve(r.token);
    expect(acct!.user_id).toBe('alice');
    expect(acct!.scope_project_ids).toEqual(['app1']);
  });

  it('admin 可签发 admin 令牌；is_admin 非布尔拒绝；scope/expires 校验', async () => {
    const r = await runMintTokenTool(store, { user_id: 'root', scope_project_ids: ['*'], is_admin: true }, ADMIN);
    expect(store.resolve(r.token)!.is_admin).toBe(true);
    await expect(runMintTokenTool(store, { user_id: 'x', scope_project_ids: ['P1'], is_admin: 'yes' }, ADMIN))
      .rejects.toThrow(/is_admin 须为布尔/);
    await expect(runMintTokenTool(store, { user_id: 'x', scope_project_ids: [] }, ADMIN))
      .rejects.toThrow(/scope_project_ids/);
    await expect(runMintTokenTool(store, { user_id: 'x', scope_project_ids: ['P1'], expires_at: Date.now() - 1 }, ADMIN))
      .rejects.toThrow(/晚于当前时间/);
    await expect(runMintTokenTool(store, { user_id: '', scope_project_ids: ['P1'] }, ADMIN))
      .rejects.toThrow(/user_id/);
  });
});
