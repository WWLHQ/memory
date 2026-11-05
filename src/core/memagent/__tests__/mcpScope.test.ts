// MCP 令牌项目作用域契约测试（批次26-B P1-10）：recall/write/list_projects 三工具统一按
// account.scope_project_ids 校验；'*'（默认）全放行，作用域外项目一律拒绝（不静默放行）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMcpHttpServer, type McpHttpHandle } from '../mcpHttp.ts';
import { runRecallTool, runListProjectsTool } from '../mcpRecall.ts';
import { projectInScope, DEFAULT_MCP_ACCOUNT } from '../mcpAuth.ts';
import { createMemAgent } from '../agent.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { FakeLlmProvider } from '../llm.ts';
import { McpToolError } from '../mcpRecall.ts';

const TOKEN = 'mcp-scope-token-0123456789abcdef0123456789abcdef';

const SCOPED_ACCOUNT = { ...DEFAULT_MCP_ACCOUNT, scope_project_ids: ['P1'] };

describe('projectInScope（纯函数）', () => {
  it("undefined / 空 / 含 '*' → 全放行", () => {
    expect(projectInScope(undefined, 'P2')).toBe(true);
    expect(projectInScope([], 'P2')).toBe(true);
    expect(projectInScope(['*'], 'P2')).toBe(true);
  });
  it('显式列表：命中放行、未命中拒绝', () => {
    expect(projectInScope(['P1'], 'P1')).toBe(true);
    expect(projectInScope(['P1'], 'P2')).toBe(false);
  });
});

describe('MCP 令牌项目作用域（批次26-B P1-10，HTTP 传输全链路）', () => {
  let handle: McpHttpHandle;
  let url = '';
  const storage = new InMemoryStorage();
  const now = Date.now();

  beforeAll(async () => {
    for (const pid of ['P1', 'P2']) {
      await storage.putMemory({
        mem_id: `mem_scope_${pid}`, project_id: pid, user_id: 'u1',
        enterprise_id: 'e1', team_id: 't1', category: 'fact', layer: 'L1',
        content: `项目 ${pid} 作用域测试记忆`, decay_class: 'hot', pinned: false,
        locked: false, version: 1, created_at: now, updated_at: now,
      });
    }
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, account: SCOPED_ACCOUNT });
    url = `http://127.0.0.1:${(await handle.ready)}/mcp`;
  });

  afterAll(() => { handle?.stop(); });

  function callTool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }).then((r) => r.json() as Promise<{ result: { isError: boolean; content: Array<{ text: string }> } }>)
      .then((b) => ({ isError: b.result.isError, text: b.result.content[0]?.text ?? '' }));
  }

  it('recall 作用域内项目 → 正常返回；作用域外项目 → isError 拒绝', async () => {
    const inScope = await callTool('recall_memory', { project_id: 'P1', query: '作用域测试记忆' });
    expect(inScope.isError).toBe(false);

    const outOfScope = await callTool('recall_memory', { project_id: 'P2', query: '作用域测试记忆' });
    expect(outOfScope.isError).toBe(true);
    expect(outOfScope.text).toContain('作用域');
    expect(outOfScope.text).toContain('P2');
  });

  it('write 作用域外项目 → isError 拒绝（不落库）', async () => {
    const out = await callTool('write_memory', { content: '作用域外写入', project_id: 'P2', category: 'fact' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('作用域');
    const mems = await storage.listMemories({});
    expect(mems.some((m) => m.project_id === 'P2' && m.content === '作用域外写入')).toBe(false);
  });

  it('write 作用域内项目 → 正常落库', async () => {
    const inScope = await callTool('write_memory', { content: '作用域内写入', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' });
    expect(inScope.isError).toBe(false);
  });

  it('list_projects 只返回作用域内项目（P2 不出现）', async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }),
    });
    const b = (await r.json()) as { result: { structuredContent: { total: number; projects: Array<{ project_id: string }> } } };
    expect(b.result.structuredContent.total).toBe(1);
    expect(b.result.structuredContent.projects[0].project_id).toBe('P1');
  });
});

describe('MCP 令牌项目作用域（runRecallTool 直调）', () => {
  it("默认 '*' 账本 recall/list 不受影响；作用域列表直调同样生效", async () => {
    const storage = new InMemoryStorage();
    const now = Date.now();
    await storage.putMemory({
      mem_id: 'mem_scope_direct', project_id: 'P9', user_id: 'u1',
      enterprise_id: 'e1', team_id: 't1', category: 'fact', layer: 'L1',
      content: '直调作用域记忆', decay_class: 'hot', pinned: false,
      locked: false, version: 1, created_at: now, updated_at: now,
    });
    const ma = createMemAgent({
      form: 'desktop', account: DEFAULT_MCP_ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });

    const full = await runRecallTool(ma, storage, { query: '直调作用域记忆', project_id: 'P9' });
    expect(full.payload.project_id).toBe('P9');

    await expect(
      runRecallTool(ma, storage, { query: '直调作用域记忆', project_id: 'P9' }, undefined, undefined, ['P1']),
    ).rejects.toMatchObject({ code: -32602 } as Partial<McpToolError>);

    const list = await runListProjectsTool(storage, ['P1']);
    expect(list.total).toBe(0);
    const listAll = await runListProjectsTool(storage);
    expect(listAll.total).toBe(1);
  });
});
