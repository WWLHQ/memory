// MCP streamable-http 契约测试（批次2 信任边界）：token 鉴权 / 拒绝浏览器 Origin / 体积上限 / 租户闭包
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMcpHttpServer, type McpHttpHandle } from '../mcpHttp.ts';
import { InMemoryStorage } from '../storage.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault } from './l0Kit.ts';

const TOKEN = 'mcp-http-token-0123456789abcdef0123456789abcdef';

describe('MCP HTTP（批次2 信任边界）', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, maxBodyBytes: 512, l0: vault });
    const port = await handle.ready;
    url = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(() => {
    handle?.stop();
  });

  function call(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('无 token → 401（WWW-Authenticate: Bearer）', async () => {
    const r = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('Bearer');
    const body = (await r.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32001);
  });

  it('错误 token → 401；x-mcp-token 与 Authorization 均可携带正确 token', async () => {
    const bad = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer wrong-token'.repeat(2) });
    expect(bad.status).toBe(401);

    const bearer = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { Authorization: `Bearer ${TOKEN}` });
    expect(bearer.status).toBe(200);

    const header = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'x-mcp-token': TOKEN });
    expect(header.status).toBe(200);
    const body = (await header.json()) as { result: { tools: Array<{ name: string; description?: string }> } };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      'recall_memory', 'write_memory', 'list_projects', 'get_user_preferences',
    ]);
    // 批次14：措辞为「优先使用本工具 + 未命中/不可用再回退」，不是硬禁用
    const recallDesc = body.result.tools.find((t) => t.name === 'recall_memory')?.description ?? '';
    expect(recallDesc).toContain('优先使用本工具');
    expect(recallDesc).toContain('回退');
  });

  it('带 Origin 的浏览器请求一律 403（即使 token 正确）', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      { Authorization: `Bearer ${TOKEN}`, Origin: 'http://evil.example' },
    );
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: { message: string } };
    expect(body.error.message).toBe('origin_not_allowed');
  });

  it('精确匹配 POST /mcp：/mcpanything 与 GET 均 404', async () => {
    const suffix = await fetch(`${url}anything`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' }),
    });
    expect(suffix.status).toBe(404);

    const get = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(get.status).toBe(404);
  });

  it('请求体超过上限 → 413（不无限累积内存）', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 6, method: 'ping', pad: 'x'.repeat(2000) },
      { Authorization: `Bearer ${TOKEN}` },
    );
    expect(r.status).toBe(413);
    const body = (await r.json()) as { error: { message: string } };
    expect(body.error.message).toBe('payload_too_large');
  });

  it('initialize → 200 + serverInfo + instructions（批次11 指令下发）', async () => {
    const r = await call({ jsonrpc: '2.0', id: 7, method: 'initialize' }, { Authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(body.result.serverInfo.name).toBe('memagent-mcp');
    expect(body.result.instructions).toContain('recall_memory');
    expect(body.result.instructions).toContain('display.line');
    expect(body.result.instructions).toContain('优先调用');
    expect(body.result.instructions).toContain('回退');
  });

  it('空账本：recall 省略 project_id → isError 明示 project_id；空 query → isError', async () => {
    const noProject = await call(
      { jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: '任意关键词' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const b1 = (await noProject.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(b1.result.isError).toBe(true);
    expect(b1.result.content[0].text).toContain('project_id');

    const emptyQuery = await call(
      { jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '  ' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const b2 = (await emptyQuery.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(b2.result.isError).toBe(true);
    expect(b2.result.content[0].text).toContain('query');

    // 非字符串 project_id：显式报错，不做数字/对象隐式转换
    const badProject = await call(
      { jsonrpc: '2.0', id: 74, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 123, query: 'x' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const b3 = (await badProject.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(b3.result.isError).toBe(true);
    expect(b3.result.content[0].text).toContain('必须是字符串');
  });

  it('空账本 list_projects → 0 个（诚实空态）', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 73, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; structuredContent: { projects: unknown[]; total: number } } };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.total).toBe(0);
    expect(body.result.structuredContent.projects).toEqual([]);
  });

  it('tools/call 跨租户 user_id → isError（租户闭包）', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 8, method: 'tools/call',
        params: { name: 'get_user_preferences', arguments: { user_id: 'u2' } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('租户');
  });

  it('tools/call 合法写入 → isError=false 且落库', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: 'MCP HTTP 写入测试', project_id: 'P1', category: 'fact' } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain('mem_');
  });

  it('list_projects 返回真实项目（P1 + 条数）', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as {
      result: { isError: boolean; structuredContent: { total: number; projects: Array<{ project_id: string; memories: number }> } };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.total).toBe(1);
    expect(body.result.structuredContent.projects[0].project_id).toBe('P1');
    expect(body.result.structuredContent.projects[0].memories).toBeGreaterThan(0);
  });

  it('recall 省略 project_id → 唯一项目自动定位；首块文本 = 提示行；未设单价 → money=null', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 92, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: 'MCP HTTP 写入测试' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
        structuredContent: {
          project_id: string;
          resolved_from: string;
          hits: unknown[];
          background: unknown;
          savings: { saved_tokens: number; injected_tokens: number };
          display: { line: string; markdown: string; money: unknown };
        };
      };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.project_id).toBe('P1');
    expect(body.result.structuredContent.resolved_from).toBe('single_project');
    expect(body.result.structuredContent.hits.length).toBeGreaterThan(0);
    expect(body.result.structuredContent.display.money).toBeNull();
    expect(body.result.structuredContent.display.line).toContain('🧠 Memory');
    expect(body.result.structuredContent.display.line).toContain('未设置单价');
    expect(body.result.content).toHaveLength(4); // 提示行 + 完整 JSON + 折叠明细 + 展示要求
    expect(body.result.content[0].text).toBe(body.result.structuredContent.display.line);
    expect(body.result.content[1].text).toContain('"saved_tokens"');
    // 批次29：无会话（非 Qoder）→ 纯 Markdown 四小节，零 HTML 标签（DSH 实测只渲染 Markdown）
    expect(body.result.content[2].text).toBe(body.result.structuredContent.display.markdown);
    expect(body.result.content[2].text).not.toContain('<details>');
    expect(body.result.content[2].text).toContain('**📎 项目背景');
    expect(body.result.content[2].text).toContain('**🧠 命中记忆');
    expect(body.result.content[2].text).toContain('**⚡ Token 用量');
    expect(body.result.content[2].text).toContain('**💰 省钱与费用');
    expect(body.result.content[3].text).toContain('display.markdown');
    expect(body.result.content[3].text).toContain('display.line');
    expect(body.result.content[3].text).not.toContain('<details>');
  });

  it('配置单价后 recall → 金额可核算（¥/百万 token）', async () => {
    const now = Date.now();
    await storage.putMemory({
      mem_id: 'mem_params_price', project_id: 'P_SYSTEM', user_id: 'system',
      enterprise_id: 'e1', team_id: 't1', category: 'preference', layer: 'L2',
      content: 'params:v1:' + JSON.stringify({ cfg: { auto_organize: true, cost_cny_per_mtok: 10 }, kbs: [], dev: {} }),
      decay_class: 'hot', pinned: true, locked: false, version: 1, created_at: now, updated_at: now,
    });
    const r = await call(
      { jsonrpc: '2.0', id: 93, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: 'MCP HTTP 写入测试' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as {
      result: {
        structuredContent: {
          display: {
            line: string;
            markdown: string;
            money: {
              unit_price_cny_per_mtok: number;
              this_call: { cost_cny: number; saved_cny: number };
              today: { calls: number };
              all: { calls: number };
            } | null;
          };
        };
      };
    };
    const money = body.result.structuredContent.display.money;
    expect(money).not.toBeNull();
    expect(money!.unit_price_cny_per_mtok).toBe(10);
    expect(money!.this_call.cost_cny).toBeGreaterThanOrEqual(0);
    expect(money!.this_call.saved_cny).toBeGreaterThanOrEqual(0);
    expect(money!.today.calls).toBeGreaterThanOrEqual(1);
    expect(money!.all.calls).toBeGreaterThanOrEqual(2);
    expect(body.result.structuredContent.display.line).toContain('¥');
    expect(body.result.structuredContent.display.line).toContain('今日');
    expect(body.result.structuredContent.display.line).toContain('全部');
    // 批次13：折叠明细同步出现单价与今日/全部核算（与提示行同源）
    expect(body.result.structuredContent.display.markdown).toContain('单价');
    expect(body.result.structuredContent.display.markdown).toContain('今日');
    expect(body.result.structuredContent.display.markdown).toContain('全部');
  });

  it('多项目且未指定 project_id → isError 引导 list_projects（不猜项目）', async () => {
    const w = await call(
      {
        jsonrpc: '2.0', id: 94, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: '项目 P2 决策：本地持久化使用 PGlite 17，禁止放进漫游目录', project_id: 'P2', category: 'decision' } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const wb = (await w.json()) as { result: { isError: boolean } };
    expect(wb.result.isError).toBe(false);

    const r = await call(
      { jsonrpc: '2.0', id: 95, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: '本地持久化' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('list_projects');
    expect(body.result.content[0].text).toContain('P1');
    expect(body.result.content[0].text).toContain('P2');
  });

  it('批次15：initialize.clientInfo 经 Mcp-Session-Id 关联到 recall 审计；无会话时用 UA 兜底', async () => {
    // ① 标准路径：initialize 自报 + 后续请求带会话头
    const init = await call(
      { jsonrpc: '2.0', id: 96, method: 'initialize', params: { clientInfo: { name: 'Qoder', version: '9.9.9' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'Qoder-Test' },
    );
    expect(init.status).toBe(200);
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();

    const recall = await call(
      { jsonrpc: '2.0', id: 97, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次15 归属测试-会话' } } },
      { Authorization: `Bearer ${TOKEN}`, 'Mcp-Session-Id': sid! },
    );
    expect(recall.status).toBe(200);

    const recallBody = (await recall.json()) as {
      result: { structuredContent: { display: { markdown: string } }; content: Array<{ text: string }> };
    };
    // 批次29：Qoder 会话 → 仍发 <details> 折叠版（白名单内唯一实测客户端）
    expect(recallBody.result.structuredContent.display.markdown).toContain('<details>');
    expect(recallBody.result.content[3].text).toContain('<details> 四段');

    const bySession = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次15 归属测试-会话');
    expect(bySession).toHaveLength(1);
    expect((bySession[0].detail as { client?: string }).client).toBe('Qoder/9.9.9');

    // ② 无会话头 + 不同 UA：退化为 UA 识别（仍可区分调用方）
    await call(
      { jsonrpc: '2.0', id: 98, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次15 归属测试-UA' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'cursor/1.2.3' },
    );
    const byUa = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次15 归属测试-UA');
    expect(byUa).toHaveLength(1);
    expect((byUa[0].detail as { client?: string }).client).toBe('Cursor (UA)');
  });

  it('tools/call 非法 category → isError（不静默落 pitfall）', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 10, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: '非法类别', project_id: 'P1', category: 'bug' } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('category');
  });
});
