// MCP streamable-http 契约测试（批次2 信任边界）：token 鉴权 / 拒绝浏览器 Origin / 体积上限 / 租户闭包
// 批次33-C 追加：一次性召回明细页（GET /recall/<id>）的可点、失效与 Origin/Host 闸门。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'node:http';
import {
  clientFromExplicitHeader, runMcpHttpServer, isIdentifiableUserAgent, isTrustedClientSelfName,
  recallEchoNote, clientDeclaresFold, MCP_RENDER_HEADER, type McpHttpHandle,
} from '../mcpHttp.ts';
import { MCP_INSTRUCTIONS, MCP_TOOLS } from '../mcpSchema.ts';
import { buildRecallCompactMarkdown, buildRecallHint, buildRecallMarkdown, rollupRecalls } from '../recallInsight.ts';
import { InMemoryStorage } from '../storage.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault, TEST_ADMIN_PW, TEST_ADMIN_ID } from './l0Kit.ts';
import { MemoryPendingStore } from '../pendingWrites.ts';
import { InMemoryTokenStore } from '../tokenStore.ts';
import type { Memory, RecallResult } from '../types.ts';

const TOKEN = 'mcp-http-token-0123456789abcdef0123456789abcdef';

/** 裸 HTTP GET：用于发出客户端 fetch 会规范化/丢弃的头（如伪造 Host，测 DNS rebinding 闸门） */
function rawGetStatus(port: number, path: string, hostHeader: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: hostHeader } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('MCP HTTP（批次2 信任边界）', () => {
  let handle: McpHttpHandle;
  let url = '';
  /** 批次33-C：明细页 GET 需要「127.0.0.1:实际端口」拼 URL 与 Host 头（port:0 时端口由系统分配） */
  let port = 0;
  let hostHeader = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, maxBodyBytes: 512, l0: vault });
    port = await handle.ready;
    hostHeader = `127.0.0.1:${port}`;
    url = `http://${hostHeader}/mcp`;
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
      'recall_memory', 'write_memory', 'list_projects', 'get_preferences', 'get_write_status',
      'list_memories', 'get_memory', 'feedback', 'manage_memory', 'gc_report',
      'create_project', 'mint_token',
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
        params: { name: 'get_preferences', arguments: { user_id: 'u2' } },
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
        params: { name: 'write_memory', arguments: { content: 'MCP HTTP 写入测试', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain('mem_');
  });

  it('tools/call 缺 source_agent → isError=true（禁止依赖默认 mcp）', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 92, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: '缺来源写入', project_id: 'P1', category: 'fact' } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('source_agent');
  });

  it('tools/call 扩展打分旋钮 → 落库（A4）', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 921, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: 'HTTP A4 旋钮测试：PGlite 17 单库上限 4GB', project_id: 'P1', category: 'decision', source_agent: 'workbuddy', importance: 0.9, confidence: 0.7, half_life_days: 30, tags: ['存储'] } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(false);
    const mems = await storage.listMemories({});
    const m = mems.find((x) => x.content_l1?.includes('PGlite 17 单库上限'))!;
    expect(m).toBeDefined();
    expect(m.importance).toBe(0.9);
    expect(m.confidence).toBe(0.7);
    expect(m.half_life_days).toBe(30);
    expect(m.tags).toEqual(['存储']);
  });

  it('tools/call importance 越界 → isError=true（A4）', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 922, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: '越界', project_id: 'P1', category: 'fact', source_agent: 'workbuddy', importance: 2 } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('importance');
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
          display: { line: string; markdown: string; money: unknown; mode: string; detail_url: string | null };
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
    expect(body.result.content).toHaveLength(4); // 提示行 + 完整 JSON + 明细 + 展示要求
    expect(body.result.content[0].text).toBe(body.result.structuredContent.display.line);
    expect(body.result.content[1].text).toContain('"saved_tokens"');
    // 批次32-C/33-C：无会话（非 Qoder）→ 默认档「两行摘要 + 可点明细链接」，四段明细不在聊天里铺开
    expect(body.result.structuredContent.display.mode).toBe('markdown-compact');
    expect(body.result.content[2].text).toBe(body.result.structuredContent.display.markdown);
    expect(body.result.content[2].text).not.toContain('<details>');
    expect(body.result.content[2].text).not.toContain('**📎 项目背景');
    expect(body.result.content[2].text).toContain('▶ [展开本次召回明细');
    expect(body.result.content[2].text).toContain('/recall/');
    expect(body.result.content[2].text).not.toContain('detail=true');
    expect(body.result.structuredContent.display.detail_url).toContain('/recall/');
    expect(body.result.content[3].text).toContain('默认收起 + 点击展开');
    expect(body.result.content[3].text).toContain('URL 必须逐字保留');
    expect(body.result.content[3].text).toContain('禁止自行补写');
    // 批次 RAG / C 组：compact 档展示要求必须带就地引用口径，且与实际下发的段名一致
    expect(body.result.content[3].text).toContain('就地标注 [n]');
    expect(body.result.content[3].text).toContain('依据 [n]');
    expect(body.result.content[3].text).toContain('统计汇总 / 命中依据 / Token / 费用');
    expect(body.result.content[2].text).toContain('📊 汇总：');
    expect(body.result.content[3].text).not.toContain('<details>');
  });

  it('批次33-C：摘要里的明细链接可点 → GET /recall/<id> 返回真折叠页面（无需令牌）', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 94, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: 'MCP HTTP 写入测试' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { structuredContent: { display: { markdown: string } } } };
    const m = body.result.structuredContent.display.markdown.match(/\/recall\/([A-Za-z0-9_-]{16,32})/);
    expect(m, '摘要里应带一条一次性明细页链接').not.toBeNull();
    const page = await fetch(`http://${hostHeader}${m![0]}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await page.text();
    // 页面 = 四段真折叠（客户端不渲染 HTML 也能点的那一份）：依据段默认展开，其余三段 data-fold 收起
    expect(html).toContain('📎 项目背景');
    expect(html).toContain('🧠 命中记忆');
    expect(html).toContain('⚡ Token 用量');
    expect(html).toContain('💰 省钱与费用');
    expect((html.match(/<details\b/g) ?? []).length).toBe(4);
    expect(html).toContain('30 分钟内有效');
    // 批次 RAG T4：真页面上就有可直视的编号锚点与统计汇总，不需要再解析 Markdown
    expect(html).toContain('📊 本次召回统计汇总');
    expect((html.match(/id="hit-\d+"/g) ?? []).length).toBeGreaterThan(0);
    expect(html).toContain('全部展开');
    // 令牌绝不出现在页面与 URL
    expect(html).not.toContain(TOKEN);

    // 同一个链接可重复打开（有效期内），但不是任意 id
    const again = await fetch(`http://${hostHeader}${m![0]}`);
    expect(again.status).toBe(200);
    const ghost = await fetch(`http://${hostHeader}/recall/${'z'.repeat(22)}`);
    expect(ghost.status).toBe(404);
    const ghostHtml = await ghost.text();
    expect(ghostHtml).toContain('链接已失效');
    expect(ghostHtml).toContain('detail=true');
  });

  it('批次33-C：明细页仍受 Origin/Host 闸门约束（浏览器跨源与 DNS rebinding 一律拒绝）', async () => {
    const r = await call(
      { jsonrpc: '2.0', id: 95, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: 'MCP HTTP 写入测试' } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as { result: { structuredContent: { display: { markdown: string } } } };
    const path = body.result.structuredContent.display.markdown.match(/(\/recall\/[A-Za-z0-9_-]{16,32})/)?.[1] ?? '';
    expect(path).not.toBe('');

    const withOrigin = await fetch(`http://${hostHeader}${path}`, { headers: { Origin: 'http://evil.example' } });
    expect(withOrigin.status).toBe(403);

    // 伪造 Host（DNS rebinding 形态）：走裸 http 请求，确保 Host 头不被客户端改写
    const code = await rawGetStatus(port, path, 'evil.example');
    expect(code).toBe(403);
  });

  it('recall 置 detail=true → 纯 Markdown 四小节明细（零 HTML 标签，数字与摘要同源）', async () => {
    const r = await call(
      {
        jsonrpc: '2.0', id: 922, method: 'tools/call',
        params: { name: 'recall_memory', arguments: { query: 'MCP HTTP 写入测试', detail: true } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const body = (await r.json()) as {
      result: { structuredContent: { display: { mode: string; markdown: string; line: string } }; content: Array<{ text: string }> };
    };
    expect(body.result.structuredContent.display.mode).toBe('markdown-full');
    expect(body.result.structuredContent.display.markdown).toContain('**📎 项目背景');
    expect(body.result.structuredContent.display.markdown).toContain('**💰 省钱与费用');
    expect(body.result.structuredContent.display.markdown).not.toContain('<details>');
    expect(body.result.content[3].text).toContain('detail=true 的明细返回');
    // 批次 RAG / C 组：full 档展示要求的段名逐字出现在真实 markdown 里
    expect(body.result.content[3].text).toContain('📊 本次召回统计汇总');
    expect(body.result.content[3].text).toContain('🎯 本次用上的依据');
    expect(body.result.structuredContent.display.markdown).toContain('**📊 本次召回统计汇总**');
    expect(body.result.structuredContent.display.markdown).toContain('**🎯 本次用上的依据**');
    expect(body.result.content[3].text).toContain('就地标注 [n]');
  });

  it('配置单价后 recall → 金额可核算（¥/百万预算单位 t · 估算）', async () => {
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
    // 批次32-C：默认档只铺摘要行 → 金额核算（本次/今日/全部）仍在，明细里的「单价」需 detail=true
    expect(body.result.structuredContent.display.markdown).toContain('今日');
    expect(body.result.structuredContent.display.markdown).toContain('全部');
    const full = await call(
      { jsonrpc: '2.0', id: 931, method: 'tools/call', params: { name: 'recall_memory', arguments: { query: 'MCP HTTP 写入测试', detail: true } } },
      { Authorization: `Bearer ${TOKEN}` },
    );
    const fullBody = (await full.json()) as { result: { structuredContent: { display: { markdown: string } } } };
    expect(fullBody.result.structuredContent.display.markdown).toContain('单价：¥10/百万预算单位 t（用户在全局参数页设置，非厂商账单）');
    expect(fullBody.result.structuredContent.display.markdown).toContain('金额口径：本地预算单位 t');
    expect(fullBody.result.structuredContent.display.markdown).toContain('今日');
    expect(fullBody.result.structuredContent.display.markdown).toContain('全部');
  });

  it('多项目且未指定 project_id → isError 引导 list_projects（不猜项目）', async () => {
    const w = await call(
      {
        jsonrpc: '2.0', id: 94, method: 'tools/call',
        params: { name: 'write_memory', arguments: { content: '项目 P2 决策：本地持久化使用 PGlite 17，禁止放进漫游目录', project_id: 'P2', category: 'decision', source_agent: 'workbuddy' } },
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
    // 批次 RAG / C 组：折叠档展示要求不再声称「四段」，段名与实际 markdown 逐字一致
    expect(recallBody.result.content[3].text).toContain('📊 本次召回统计汇总');
    expect(recallBody.result.content[3].text).toContain('🎯 本次用上的依据');
    expect(recallBody.result.content[3].text).toContain('就地标注 [n]');
    expect(recallBody.result.structuredContent.display.markdown).toContain('**📊 本次召回统计汇总**');
    expect(recallBody.result.structuredContent.display.markdown).toContain('**🎯 本次用上的依据**');
    expect(recallBody.result.content[3].text).not.toContain('<details> 四段');

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

  it('批次41-S：通用 UA（node）不做跨请求身份归并——甲客户端 initialize 不污染乙客户端的审计归属', async () => {
    // ① 甲客户端：以 UA `node` 做 initialize 并自报 verify-contam；因 UA 无辨识度，不得进 clientByUa
    const init = await call(
      { jsonrpc: '2.0', id: 120, method: 'initialize', params: { clientInfo: { name: 'verify-contam', version: '0.0.1' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'node' },
    );
    expect(init.status).toBe(200);
    // 甲自己的会话头仍可信（clientBySession 不受本修法影响）
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();

    // ② 乙客户端：同样 UA `node`，不带会话头调 recall——修复前会读到 clientByUa['node']=verify-contam（串号）
    await call(
      { jsonrpc: '2.0', id: 121, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-S 串号-乙' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'node' },
    );
    const byVictim = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-S 串号-乙');
    expect(byVictim).toHaveLength(1);
    // 修复后：通用 UA 一律 unknown，绝不借用甲的自报名
    expect((byVictim[0].detail as { client?: string }).client).toBe('unknown');

    // ③ 有辨识度的 UA 仍走「同 UA 最近一次 initialize」归并（不回归批次15 能力）
    const identInit = await call(
      { jsonrpc: '2.0', id: 122, method: 'initialize', params: { clientInfo: { name: 'Cursor', version: '1.2.3' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'cursor-desktop/2.0' },
    );
    expect(identInit.status).toBe(200);
    await call(
      { jsonrpc: '2.0', id: 123, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-S 归并-有辨识度' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'cursor-desktop/2.0' },
    );
    const byIdentifiable = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-S 归并-有辨识度');
    expect(byIdentifiable).toHaveLength(1);
    // clientByUa['cursor-desktop/2.0'] = 'Cursor/1.2.3'（initialize 自报），不带会话头也归并对
    expect((byIdentifiable[0].detail as { client?: string }).client).toBe('Cursor/1.2.3');
  });

  it('批次41-S（方案 B）：已知产品自报名即便走通用 UA、不带会话头也保住身份 → 气泡折叠档回归', async () => {
    // 用 okhttp/ 前缀（通用、无辨识度）复现「Electron 宿主发 node 类 UA」的同一条代码路径，
    // 且不与上一条用例的 clientByUa['node'] 键相互污染。
    const GENERIC_UA = 'okhttp/4.9.0';
    // ① Qoder 宿主：initialize 自报 qoder-desktop-mcp-host（已知产品）→ 通用 UA 也登记
    const init = await call(
      { jsonrpc: '2.0', id: 130, method: 'initialize', params: { clientInfo: { name: 'qoder-desktop-mcp-host', version: '1.0.0' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA },
    );
    expect(init.status).toBe(200);
    // ② 后续 recall 不带会话头、同通用 UA → 归并回 qoder-desktop-mcp-host（方案 A 会降 unknown）
    const r = await call(
      { jsonrpc: '2.0', id: 131, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-S-B 保档' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA },
    );
    const body = (await r.json()) as { result: { structuredContent: { display: { mode: string } } } };
    // 关键：命中白名单 → 拿到气泡内联折叠档（用户口径「能内联就内联」）
    expect(body.result.structuredContent.display.mode).toBe('html-details');
    const byQoder = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-S-B 保档');
    expect((byQoder[0].detail as { client?: string }).client).toBe('qoder-desktop-mcp-host/1.0.0');

    // ③ 残留（方案 B 的既定取舍，钉成用例）：同一条通用 UA 上已登记已知产品后，
    //    一个「不带会话头、同通用 UA」的任意客户端调用会被归并成那个产品。
    //    彻底消除需客户端回传 Mcp-Session-Id（方案 C）；本机通用 UA 主要就是 Qoder 宿主一家。
    await call(
      { jsonrpc: '2.0', id: 132, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-S-B 残留归并' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA },
    );
    const byResidual = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-S-B 残留归并');
    expect((byResidual[0].detail as { client?: string }).client).toBe('qoder-desktop-mcp-host/1.0.0');
  });

  it('批次41-S（方案 B）：任意/探测自报名在通用 UA 下既不登记、也不被归并出来 → 仍 unknown', async () => {
    const GENERIC_UA = 'java/17';
    // 甲：非已知产品名（probe-x）在通用 UA 下 initialize → 不得写进 clientByUa
    await call(
      { jsonrpc: '2.0', id: 140, method: 'initialize', params: { clientInfo: { name: 'probe-x', version: '0.0.1' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA },
    );
    // 乙：同通用 UA、不带会话头调 recall → 该 UA 键上没有已知产品 → 落 unknown
    await call(
      { jsonrpc: '2.0', id: 141, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-S-B 非已知名' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA },
    );
    const byProbe = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-S-B 非已知名');
    expect((byProbe[0].detail as { client?: string }).client).toBe('unknown');
  });

  // ── 批次41-X（方案 C）：显式身份头 X-Memagent-Client ─────────────────────────
  it('批次41-X：显式身份头优先于 UA 归并——同一条通用 UA 上两家各记各的，不再串号', async () => {
    const GENERIC_UA = 'node';
    // 甲：带身份头 initialize（一键接入写入的配置就是这种：UA 是运行时串，身份在头里）
    const initA = await call(
      { jsonrpc: '2.0', id: 150, method: 'initialize', params: { clientInfo: { name: 'claude-code', version: '1.2.3' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA, 'X-Memagent-Client': 'claude-code' },
    );
    expect(initA.status).toBe(200);
    // 乙：同 UA、同一服务端进程，带**自己的**身份头直接调 recall（不做 initialize、不带会话头）
    const rB = await call(
      { jsonrpc: '2.0', id: 151, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-X 乙客户端' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA, 'X-Memagent-Client': 'qoder-cn' },
    );
    const bodyB = (await rB.json()) as { result: { structuredContent: { display: { mode: string } } } };
    // 配方 id `qoder-cn` 命中白名单 → 气泡内联折叠档（41-X 不能把已实机证实的折叠档打回去）
    expect(bodyB.result.structuredContent.display.mode).toBe('html-details');
    const auditB = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-X 乙客户端');
    expect(auditB).toHaveLength(1);
    // 关键：记的是乙自己声明的身份，而不是「同 UA 最近一次 initialize 的甲」
    expect((auditB[0].detail as { client?: string }).client).toBe('qoder-cn');

    // 甲随后不带会话头再调一次：仍按自己的头记账
    await call(
      { jsonrpc: '2.0', id: 152, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-X 甲客户端' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA, 'X-Memagent-Client': 'claude-code' },
    );
    const auditA = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-X 甲客户端');
    expect((auditA[0].detail as { client?: string }).client).toBe('claude-code');
  });

  it('批次41-X：带身份头的客户端不占用通用 UA 那条键——随后无头同 UA 的调用不会被算成它', async () => {
    const GENERIC_UA = 'okhttp/4.10.0';
    // 带显式头做 initialize → 服务端不需要再用 UA 归并，故不写 clientByUa
    await call(
      { jsonrpc: '2.0', id: 160, method: 'initialize', params: { clientInfo: { name: 'qoder-desktop-mcp-host', version: '1.0.0' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA, 'X-Memagent-Client': 'qoder-cn' },
    );
    // 随后一个「同 UA、不带身份头、不带会话头」的调用（脚本/未知客户端）
    await call(
      { jsonrpc: '2.0', id: 161, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-X 无头同UA' } } },
      { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA },
    );
    const rows = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-X 无头同UA');
    // 41-S 方案 B 的残留（被归并成 qoder-desktop-mcp-host）在 41-X 下不再发生：该 UA 键是空的
    expect((rows[0].detail as { client?: string }).client).toBe('unknown');
  });

  it('批次41-X：非法身份头值（超长/空白/charset 外）一律不采信，回退原有 会话头 → UA → UA 识别 链', async () => {
    const GENERIC_UA = 'python-urllib/3.11';
    const bad = `x${'y'.repeat(80)}`;
    for (const value of [bad, '   ']) {
      const r = await call(
        { jsonrpc: '2.0', id: 170, method: 'tools/call', params: { name: 'recall_memory', arguments: { project_id: 'P1', query: '批次41-X 非法头' } } },
        { Authorization: `Bearer ${TOKEN}`, 'User-Agent': GENERIC_UA, 'X-Memagent-Client': value },
      );
      expect(r.status).toBe(200);
    }
    const rows = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === '批次41-X 非法头');
    expect(rows).toHaveLength(2);
    // 每一次都落到链尾的 unknown（通用 UA、无会话、无合法声明），绝不被当成某个已知客户端
    for (const a of rows) expect((a.detail as { client?: string }).client).toBe('unknown');
  });

  it('批次41-X：纯函数 clientFromExplicitHeader 只认规范值，其余给 undefined', () => {
    expect(clientFromExplicitHeader('qoder-cn')).toBe('qoder-cn');
    expect(clientFromExplicitHeader(['codex', 'other'])).toBe('codex');
    expect(clientFromExplicitHeader('Trae CN')).toBe('Trae CN');
    expect(clientFromExplicitHeader(undefined)).toBeUndefined();
    expect(clientFromExplicitHeader('   ')).toBeUndefined();
    // 控制字符在 normalizeClientLabel 里塌成空格（绝不原样进审计），仍算合法声明
    expect(clientFromExplicitHeader('a\r\nb')).toBe('a b');
    expect(clientFromExplicitHeader('x'.repeat(81))).toBeUndefined();
    expect(clientFromExplicitHeader('emoji😀')).toBeUndefined();
  });

  // ── 2026-11-12（T8）：能力声明头 X-Memagent-Render: fold ────────────────────
  it('T8：不在白名单的客户端声明 X-Memagent-Render: fold 就拿到折叠档；不声明仍是 compact', async () => {
    const base = { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'node', 'X-Memagent-Client': 'claude-code' };
    const recall = (id: number) => ({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'recall_memory', arguments: { project_id: 'P1', query: 'T8 能力声明折叠' } },
    });
    const withFold = await call(recall(180), { ...base, [MCP_RENDER_HEADER]: 'fold' });
    const bf = (await withFold.json()) as { result: { structuredContent: { display: { mode: string } } } };
    // claude-code 本身不在白名单 → 唯一让它是 html-details 的原因就是那个头
    expect(bf.result.structuredContent.display.mode).toBe('html-details');

    const plain = await call(recall(181), base);
    const bp = (await plain.json()) as { result: { structuredContent: { display: { mode: string } } } };
    expect(bp.result.structuredContent.display.mode).toBe('markdown-compact');

    // 能力头只管档位，不改身份审计：两次都记在 claude-code 名下
    const rows = (await storage.queryAudit({ action: 'recall' }))
      .filter((a) => (a.detail as { query?: string }).query === 'T8 能力声明折叠');
    expect(rows).toHaveLength(2);
    for (const a of rows) expect((a.detail as { client?: string }).client).toBe('claude-code');
  });

  it('T8：clientDeclaresFold 只认 fold/html/details/1/true（逗号多值任一命中），其余与缺省一律 false', () => {
    for (const v of ['fold', 'HTML', ' details ', '1', 'true', 'markdown,fold']) {
      expect(clientDeclaresFold(v)).toBe(true);
    }
    for (const v of [undefined, '', '  ', 'compact', 'markdown', '0', 'false', 'bubble']) {
      expect(clientDeclaresFold(v)).toBe(false);
    }
    expect(clientDeclaresFold(['fold', 'x'])).toBe(true);
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

// 批次41-R：明细页「有没有被点开」此前只写 main.log，日志页（读 actions.log）看不到。
// 这里锁住回调本体：主进程接的是 mlog + actionLog 双写（接线级），判据与值形态由本用例钉住。
describe('批次41-R：明细页查看回调 onViewDetail 只回 outcome', () => {
  let handle: McpHttpHandle;
  let hostHeader = '';
  const seen: Array<'ok' | 'miss'> = [];

  beforeAll(async () => {
    const vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({
      port: 0, token: TOKEN, storage: new InMemoryStorage(), l0: vault,
      onViewDetail: (outcome) => { seen.push(outcome); },
    });
    hostHeader = `127.0.0.1:${await handle.ready}`;
  });

  afterAll(() => { handle?.stop(); });

  it('点开有效链接 = ok，点开不存在/已失效的 id = miss（回调里没有 id、没有正文）', async () => {
    const r = await fetch(`http://${hostHeader}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'recall_memory', arguments: { query: '批次41-R 观测缺口', project_id: 'P1' } },
      }),
    });
    const body = (await r.json()) as { result: { structuredContent: { display: { detail_url: string | null } } } };
    const link = body.result.structuredContent.display.detail_url;
    expect(link, '摘要档应带一条一次性明细链接').toMatch(/^http:\/\/127\.0\.0\.1:\d+\/recall\/[A-Za-z0-9_-]{16,32}$/);

    const opened = await fetch(link!);
    expect(opened.status).toBe(200);
    const ghost = await fetch(`http://${hostHeader}/recall/${'q'.repeat(22)}`);
    expect(ghost.status).toBe(404);

    expect(seen).toEqual(['ok', 'miss']);
    // 回调值域只有这两个字面量——一次性 id 与页面正文都不出这道口
    expect(seen.every((s) => s === 'ok' || s === 'miss')).toBe(true);
  });
});

// 批次41-S（方案 A）：通用运行时 UA 不作跨请求身份归并依据。串号的源头是 clientByUa 被
// 一次 initialize 抢注；这里钉住「哪些 UA 有辨识度」这条判据本身。
describe('isIdentifiableUserAgent（批次41-S 串号闸门）', () => {
  it('通用 UA 判否：node / curl / python-urllib / 空 / 未知都不借用别人的自报名', () => {
    expect(isIdentifiableUserAgent('node')).toBe(false);
    expect(isIdentifiableUserAgent('Node')).toBe(false);
    expect(isIdentifiableUserAgent('  node  ')).toBe(false);
    expect(isIdentifiableUserAgent('curl/8.4.0')).toBe(false);
    expect(isIdentifiableUserAgent('python-urllib/3.12')).toBe(false);
    expect(isIdentifiableUserAgent('')).toBe(false);
    expect(isIdentifiableUserAgent(undefined)).toBe(false);
    // 认不出具体客户端的未知 UA 一律 fail-safe（不识别 = 不归并）
    expect(isIdentifiableUserAgent('MyInternalAgent/1.0')).toBe(false);
  });
  it('有辨识度的 UA 判是：含可识别厂商词，仍可据同 UA 最近一次 initialize 归并', () => {
    expect(isIdentifiableUserAgent('cursor-desktop/2.0')).toBe(true);
    expect(isIdentifiableUserAgent('claude-code/1.2')).toBe(true);
    expect(isIdentifiableUserAgent('qoder-cn/9.9.9')).toBe(true);
  });
});

// 批次41-S（方案 B）：自报名是否「已知客户端产品」——通用 UA 下靠这条保住合法客户端的气泡折叠档。
describe('isTrustedClientSelfName（批次41-S 方案 B 已知产品闸门）', () => {
  it('已知产品自报名判是（含大小写、带/不带版本）', () => {
    expect(isTrustedClientSelfName('qoder-desktop-mcp-host/1.0.0')).toBe(true);
    expect(isTrustedClientSelfName('Qoder-Desktop-MCP-Host')).toBe(true);
    expect(isTrustedClientSelfName('qoder/9.9.9')).toBe(true);
    expect(isTrustedClientSelfName('Cursor/1.2.3')).toBe(true);
    expect(isTrustedClientSelfName('dsh-mcp-client')).toBe(true);
  });
  it('任意/探测名与空值判否：不进 clientByUa、也不会被归并出来', () => {
    expect(isTrustedClientSelfName('verify-contam/0.0.1')).toBe(false);
    expect(isTrustedClientSelfName('verify-41r/0.0.1')).toBe(false);
    expect(isTrustedClientSelfName('probe-x')).toBe(false);
    expect(isTrustedClientSelfName('unknown')).toBe(false);
    expect(isTrustedClientSelfName('')).toBe(false);
    expect(isTrustedClientSelfName(undefined)).toBe(false);
  });
});

// 批次44-D4：HTTP 端 L0 锁定写入落盘兜底（pending/flush 与 TCP 同口径）
describe('批次44-D4：HTTP L0 锁定写入落盘兜底', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({
      port: 0, token: TOKEN, storage, l0: vault, pending: new MemoryPendingStore(),
    });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });

  afterAll(() => { handle?.stop(); });

  type ToolBody = {
    result: { isError: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
  };
  async function tool(id: number, name: string, args: Record<string, unknown> = {}): Promise<ToolBody> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json()) as ToolBody;
  }

  it('get_write_status：解锁态 → l0_unlocked=true / pending_count=0', async () => {
    const b = await tool(950, 'get_write_status');
    expect(b.result.isError).toBe(false);
    expect(b.result.structuredContent).toEqual({ l0_unlocked: true, writeDek_present: true, pending_count: 0 });
  });

  it('锁定后 write_memory → status=pending（isError=false 但明确未落库，不伪造 mem_id）', async () => {
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    const b = await tool(951, 'write_memory', {
      content: 'D4 HTTP 锁定写入不丢', project_id: 'P1', category: 'fact', source_agent: 'mcp-test',
    });
    expect(b.result.isError).toBe(false);
    const out = b.result.structuredContent!;
    expect(out.status).toBe('pending');
    expect(out.reason).toBe('E_L0_LOCKED');
    expect(String(out.pending_id)).toMatch(/^pend_/);
    expect(out.mem_id).toBeUndefined();

    const st = await tool(952, 'get_write_status');
    expect(st.result.structuredContent).toEqual({ l0_unlocked: false, writeDek_present: false, pending_count: 1 });
    expect((await storage.listMemories({})).length).toBe(0);
  });

  it('解锁后 write_memory → 自动重放 pending（replayed_pending=1）', async () => {
    await vault.unlockWrite({ password: TEST_ADMIN_PW, admin_user_id: TEST_ADMIN_ID });
    const b = await tool(953, 'write_memory', {
      content: 'D4 HTTP 解锁后新写入', project_id: 'P1', category: 'decision', source_agent: 'mcp-test',
    });
    expect(b.result.isError).toBe(false);
    const out = b.result.structuredContent!;
    expect(String(out.mem_id)).toMatch(/^mem_/);
    expect(out.replayed_pending).toBe(1);
    expect(out.status).toBeUndefined();

    const contents = (await storage.listMemories({})).map((m) => m.content);
    expect(contents).toContain('D4 HTTP 锁定写入不丢');
    expect(contents).toContain('D4 HTTP 解锁后新写入');
    expect((await tool(954, 'get_write_status')).result.structuredContent).toEqual({ l0_unlocked: true, writeDek_present: true, pending_count: 0 });
  });
});

// 批次44-D5-1：list_memories / get_memory（HTTP 端到端，与 TCP 共用 mcpReadTools）
describe('批次44-D5-1：list_memories / get_memory（HTTP）', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();
  const LONG_A = '项目 P1 决策：本地持久化 pending 队列按 created_at 升序逐条重放，锁定态不落明文';

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });
  afterAll(() => { handle?.stop(); });

  type ToolBody = {
    result: { isError: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
  };
  async function tool(id: number, name: string, args: Record<string, unknown> = {}): Promise<ToolBody> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json()) as ToolBody;
  }

  it('写入一条 → list_memories 盘点 + get_memory 精确读，均不泄 L0', async () => {
    const w = await tool(960, 'write_memory', {
      content: LONG_A, project_id: 'P1', category: 'fact', source_agent: 'mcp-test', tags: ['d5'],
    });
    expect(w.result.isError).toBe(false);
    const id1 = (w.result.structuredContent as { mem_id: string }).mem_id;
    expect(id1).toMatch(/^mem_/);

    const list = await tool(961, 'list_memories', { project_id: 'P1' });
    expect(list.result.isError).toBe(false);
    const out = list.result.structuredContent as { ok: boolean; total: number; items: Array<Record<string, unknown>> };
    expect(out.ok).toBe(true);
    expect(out.total).toBe(1);
    expect(out.items[0].mem_id).toBe(id1);
    expect(out.items[0]).not.toHaveProperty('content_l0_enc');
    expect(out.items[0]).not.toHaveProperty('content_orig');

    const one = await tool(962, 'get_memory', { mem_id: id1 });
    expect(one.result.isError).toBe(false);
    expect(one.result.structuredContent).toMatchObject({ ok: true, item: { mem_id: id1 } });
  });

  it('不存在 → ok:false（工具调用本身不报错）；非法参数 → isError:true', async () => {
    const missing = await tool(963, 'get_memory', { mem_id: 'mem_not_exist' });
    expect(missing.result.isError).toBe(false);
    expect(missing.result.structuredContent).toEqual({ ok: false, item: null, reason: '记忆不存在' });

    const bad = await tool(964, 'list_memories', { project_id: 'P1', limit: 0 });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain('limit');
  });

  it('tag 过滤生效；默认 scope=* 下未写入项目返回空清单', async () => {
    const byTag = await tool(965, 'list_memories', { project_id: 'P1', tag: 'd5' });
    expect((byTag.result.structuredContent as { total: number }).total).toBe(1);
    const noTag = await tool(966, 'list_memories', { project_id: 'P1', tag: 'none' });
    expect((noTag.result.structuredContent as { total: number }).total).toBe(0);
    const bad = await tool(967, 'list_memories', { project_id: 'P2' });
    // 默认 account scope='*' → P2 允许但无记忆，返回空清单；越界拒绝由共用模块单测覆盖
    expect((bad.result.structuredContent as { total: number }).total).toBe(0);
  });
});

// 批次44-D5-2：feedback / manage_memory（HTTP 端到端，与 TCP 共用 mcpManageTools）
describe('批次44-D5-2：feedback / manage_memory（HTTP）', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();
  const LONG_A = '运维手册补充：MCP 治理工具反馈与生命周期变更统一转发内核，写审计、推进版本且不回传 L0 密文';

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault, allowDelete: true });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });
  afterAll(() => { handle?.stop(); });

  type ToolBody = {
    result: { isError: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
  };
  async function tool(id: number, name: string, args: Record<string, unknown> = {}, base = url): Promise<ToolBody> {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json()) as ToolBody;
  }

  it('写入一条 → feedback 三档 trust_delta；回执不泄 L0', async () => {
    const w = await tool(980, 'write_memory', {
      content: LONG_A, project_id: 'P1', category: 'fact', source_agent: 'mcp-test',
    });
    expect(w.result.isError).toBe(false);
    const id1 = (w.result.structuredContent as { mem_id: string }).mem_id;

    const c = await tool(981, 'feedback', { mem_id: id1, verdict: 'confirm' });
    expect(c.result.isError).toBe(false);
    const cr = c.result.structuredContent as { ok: boolean; trust_delta: number; mem: Record<string, unknown> };
    expect(cr.ok).toBe(true);
    expect(cr.trust_delta).toBe(0.1);
    expect(cr.mem.confidence).toBeCloseTo(0.6);
    expect(cr.mem.reinforce_count).toBe(1);
    expect(cr.mem).not.toHaveProperty('content_l0_enc');
    expect(cr.mem).not.toHaveProperty('content_orig');

    expect((await tool(982, 'feedback', { mem_id: id1, verdict: 'reject' })).result.structuredContent)
      .toMatchObject({ trust_delta: -0.05 });
    const dp = await tool(983, 'feedback', { mem_id: id1, verdict: 'disputed' });
    expect(dp.result.structuredContent).toMatchObject({ trust_delta: 0 });
    expect((dp.result.structuredContent as { mem: { conflict_id: string } }).mem.conflict_id).toMatch(/^cf_/);
  });

  it('manage_memory pin / archive 生效；非法 action 与 patch 误用 → isError:true', async () => {
    const list = await tool(984, 'list_memories', { project_id: 'P1' });
    const id1 = (list.result.structuredContent as { items: Array<{ mem_id: string }> }).items[0].mem_id;

    const pin = await tool(985, 'manage_memory', { mem_id: id1, action: 'pin' });
    expect(pin.result.isError).toBe(false);
    expect((pin.result.structuredContent as { mem: { pinned: boolean } }).mem.pinned).toBe(true);
    expect((pin.result.structuredContent as { mem: Record<string, unknown> }).mem).not.toHaveProperty('content_l0_enc');

    const arc = await tool(986, 'manage_memory', { mem_id: id1, action: 'archive' });
    expect((arc.result.structuredContent as { mem: { decay_class: string } }).mem.decay_class).toBe('archived');

    const bad = await tool(987, 'manage_memory', { mem_id: id1, action: 'bogus' });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain('action');
  });

  it('G4 locked 仅 unlock 放行；delete 默认拒绝、显式放行才落墓碑', async () => {
    const w = await tool(988, 'write_memory', {
      content: LONG_A + '（第二条用于锁定与删除门禁）', project_id: 'P1', category: 'fact', source_agent: 'mcp-test',
    });
    const id2 = (w.result.structuredContent as { mem_id: string }).mem_id;

    await tool(989, 'manage_memory', { mem_id: id2, action: 'lock' });
    const blocked = await tool(990, 'manage_memory', { mem_id: id2, action: 'archive' });
    expect(blocked.result.structuredContent).toMatchObject({ ok: false, blocked_locked: true });
    await tool(991, 'manage_memory', { mem_id: id2, action: 'unlock' });

    // 默认配置（allowDelete:false）→ 明确拒绝
    const deniedHandle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault, allowDelete: false });
    const deniedUrl = `http://127.0.0.1:${await deniedHandle.ready}/mcp`;
    try {
      const denied = await tool(992, 'manage_memory', { mem_id: id2, action: 'delete' }, deniedUrl);
      expect(denied.result.isError).toBe(true);
      expect(denied.result.content[0].text).toContain('MCP_ALLOW_DELETE');
    } finally {
      deniedHandle.stop();
    }

    const ok = await tool(993, 'manage_memory', { mem_id: id2, action: 'delete' });
    expect(ok.result.isError).toBe(false);
    expect(ok.result.structuredContent).toMatchObject({ ok: true, mem: null });
    const after = await tool(994, 'get_memory', { mem_id: id2 });
    expect(after.result.structuredContent).toEqual({ ok: false, item: null, reason: '记忆不存在' });
  });
});

// 批次44-D5-3：gc_report（HTTP 端到端，与 TCP 共用 mcpGcTools）
describe('批次44-D5-3：gc_report（HTTP）', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();
  const DAY = 24 * 3600 * 1000;

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    await storage.putMemory({
      mem_id: 'mem_gc_http', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'context', layer: 'L1', content: '待衰减的旧上下文', decay_class: 'hot',
      pinned: false, locked: false, version: 1, half_life_days: 30,
      created_at: Date.now() - 4 * DAY,
    });
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });
  afterAll(() => { handle?.stop(); });

  type ToolBody = {
    result: { isError: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
  };
  async function tool(id: number, name: string, args: Record<string, unknown> = {}): Promise<ToolBody> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json()) as ToolBody;
  }

  it('缺省 dry_run=true → 只演算；显式 false → 真实降档 + audit_written=true', async () => {
    const dry = await tool(1010, 'gc_report', { project_id: 'P1' });
    expect(dry.result.isError).toBe(false);
    const d = dry.result.structuredContent as {
      dry_run: boolean; report: { decayed: number }; audit_written: boolean;
    };
    expect(d.dry_run).toBe(true);
    expect(d.report.decayed).toBe(1);
    expect(d.audit_written).toBe(false);
    expect((await storage.getMemory('mem_gc_http'))?.decay_class).toBe('hot');
    expect(await storage.queryAudit({ action: 'gc' })).toHaveLength(0);

    const real = await tool(1011, 'gc_report', { project_id: 'P1', dry_run: false });
    expect(real.result.isError).toBe(false);
    const r = real.result.structuredContent as { dry_run: boolean; report: { decayed: number }; audit_written: boolean };
    expect(r.dry_run).toBe(false);
    expect(r.report.decayed).toBe(1);
    expect(r.audit_written).toBe(true);
    expect((await storage.getMemory('mem_gc_http'))?.decay_class).toBe('warm');
    expect(await storage.queryAudit({ action: 'gc' })).toHaveLength(1);
  });

  it('46-4 报告字段对齐 + note 分层说明，不伪造摘要类统计', async () => {
    const out = await tool(1012, 'gc_report', { project_id: 'P1' });
    const body = out.result.structuredContent as { report: Record<string, unknown>; note: string };
    expect(Object.keys(body.report)).toEqual([
      'decayed', 'merged', 'conflicts_resolved',
      'freshness_updated', 'scanned', 'migrated',
      'summaries_created', 'summaries_filtered', 'merged_originals', 'compressed',
    ]);
    expect(body.report.scanned).toBe(body.report.freshness_updated);
    expect(body.report.decayed).toBe(body.report.migrated);
    expect(body.report.conflicts_resolved).toBe(0);
    expect(body.note).toContain('真实字段');
    expect(body.note).not.toContain('没有对应统计量');
  });

  it('缺 project_id / dry_run 非布尔 / 裁决参数不完整 → isError:true', async () => {
    for (const args of [
      {}, { project_id: '' }, { project_id: 'P1', dry_run: 'true' },
      { project_id: 'P1', resolve_conflicts: true },
    ]) {
      const out = await tool(1013, 'gc_report', args);
      expect(out.result.isError).toBe(true);
    }
    expect((await storage.getMemory('mem_gc_http'))?.decay_class).toBe('warm');
    expect(await storage.queryAudit({ action: 'gc' })).toHaveLength(1); // 失败请求未写 gc 审计（此处 1 = 上一用例真实 gc 的留存）
  });

  // 批次46-4：HTTP 端到端完整链路（tools/call gc_report → 内核裁决 → 存储/审计）
  it('46-4 端到端：resolve_conflicts+verdict 真实落定，旧行归档 + 成对审计', async () => {
    const now = Date.now();
    const base = {
      project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'context', layer: 'L1', decay_class: 'hot',
      pinned: false, locked: false, version: 1, conflict_id: 'cf_http',
    } as const;
    await storage.putMemory({
      ...base, mem_id: 'cf_http_old', content: '灰度发布必须先看 QPS',
      confidence: 0.5, created_at: now - 2 * DAY,
    });
    await storage.putMemory({
      ...base, mem_id: 'cf_http_new', content: '灰度发布必须先看错误率',
      confidence: 0.6, created_at: now - DAY,
    });
    const beforeAudits = (await storage.queryAudit({ action: 'conflict_resolve' })).length;

    const out = await tool(1014, 'gc_report', {
      project_id: 'P1', dry_run: false, resolve_conflicts: true, verdict: 'auto_override',
    });
    expect(out.result.isError).toBe(false);
    const body = out.result.structuredContent as {
      report: { conflicts_resolved: number };
      conflict_resolution: { requested: boolean; verdict: string; resolved: number };
      audit_written: boolean;
    };
    expect(body.report.conflicts_resolved).toBe(1);
    expect(body.conflict_resolution).toEqual({ requested: true, verdict: 'auto_override', resolved: 1 });
    expect(body.audit_written).toBe(true);
    expect((await storage.getMemory('cf_http_old'))?.decay_class).toBe('archived');
    expect((await storage.getMemory('cf_http_new'))?.confidence).toBeCloseTo(0.7, 5);
    const audits = await storage.queryAudit({ action: 'conflict_resolve' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      old_id: 'cf_http_old', new_id: 'cf_http_new', verdict: 'auto_override', pending: false,
    });
    expect((await storage.queryAudit({ action: 'conflict_resolve' })).length).toBeGreaterThan(beforeAudits);
  });

  it('46-4 端到端：dry_run=true 带裁决 → 零写入、零审计、resolved=0', async () => {
    const now = Date.now();
    const base = {
      project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'context', layer: 'L1', decay_class: 'hot',
      pinned: false, locked: false, version: 1, conflict_id: 'cf_http_dry',
    } as const;
    await storage.putMemory({ ...base, mem_id: 'cf_http_dry_old', content: '另一条冲突旧文', created_at: now - 2 * DAY });
    await storage.putMemory({ ...base, mem_id: 'cf_http_dry_new', content: '另一条冲突新文', created_at: now - DAY });
    const before = (await storage.listMemories({})).map((m) => ({ ...m }));
    const beforeAudits = (await storage.queryAudit({ action: 'conflict_resolve' })).length;

    const out = await tool(1015, 'gc_report', {
      project_id: 'P1', resolve_conflicts: true, verdict: 'auto_override',
    });
    expect(out.result.isError).toBe(false);
    const body = out.result.structuredContent as {
      dry_run: boolean; audit_written: boolean; report: { conflicts_resolved: number };
      conflict_resolution: { requested: boolean; verdict: string; resolved: number };
    };
    expect(body.dry_run).toBe(true);
    expect(body.report.conflicts_resolved).toBe(0);
    expect(body.conflict_resolution).toEqual({ requested: true, verdict: 'auto_override', resolved: 0 });
    expect(body.audit_written).toBe(false);
    expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
    expect(await storage.queryAudit({ action: 'conflict_resolve' })).toHaveLength(beforeAudits);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('批次44-D5-4：recall_memory(scope=session)（HTTP 8204 端到端）', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();

  function seedMem(over: Partial<Memory> & Pick<Memory, 'mem_id' | 'content'>): Memory {
    return {
      project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'fact', layer: 'L1', decay_class: 'hot',
      pinned: false, locked: false, version: 1, created_at: 0,
      ...over,
    };
  }

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    await storage.putMemory(seedMem({ mem_id: 'h_old', session_id: 'S-HTTP', created_at: 100, content: '会话纪要一：确认会话视图按会话标识精确过滤' }));
    await storage.putMemory(seedMem({ mem_id: 'h_new', session_id: 'S-HTTP', created_at: 300, content: '会话纪要二：按时间倒序取最近若干条' }));
    await storage.putMemory(seedMem({ mem_id: 'h_mid', session_id: 'S-HTTP', created_at: 200, content: '会话纪要三：不注入项目背景，避免别会话借道回灌' }));
    await storage.putMemory(seedMem({ mem_id: 'h_other', session_id: 'S-ELSE', created_at: 400, content: '别的会话：不可出现在本次会话工作记忆视图' }));
    await storage.putMemory(seedMem({ mem_id: 'h_legacy', created_at: 500, content: '历史行无会话标识：不进会话视图，也不拿创建时间冒充' }));
    await storage.putMemory(seedMem({ mem_id: 'h_bg', decay_class: 'cold', created_at: 600, content: '冷背景候选：项目召回背景通道仍然生效' }));
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });
  afterAll(() => { handle?.stop(); });

  type ToolBody = {
    result: {
      isError: boolean;
      structuredContent?: Record<string, unknown>;
      content?: Array<{ text: string }>;
    };
  };
  async function tool(id: number, name: string, args: Record<string, unknown> = {}): Promise<ToolBody> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json()) as ToolBody;
  }
  async function rpc(method: 'tools/list' | 'initialize'): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1200, method }),
    });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  }

  it('tools/list 仍是 10 个工具；recall/write schema 含 session_id；instructions 点名会话视图', async () => {
    const list = await rpc('tools/list');
    const tools = list.tools as Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>;
    expect(tools.map((t) => t.name)).toHaveLength(12); // D6-5 起 12 个工具
    const props = tools.find((t) => t.name === 'recall_memory')!.inputSchema.properties;
    expect(props).toHaveProperty('scope');
    expect(props).toHaveProperty('session_id');
    expect(tools.find((t) => t.name === 'write_memory')!.inputSchema.properties).toHaveProperty('session_id');
    expect(String((await rpc('initialize')).instructions)).toContain("scope='session'");
  });

  it('B 效果验证：tools/call write_memory 带 session_id → 落库 → 会话视图取回（查询词无关也照回）', async () => {
    const w = await tool(1201, 'write_memory', {
      project_id: 'P1', category: 'decision', source_agent: 'workbuddy', session_id: 'S-WRITE-HTTP',
      content: 'HTTP 端到端写入验证：会话工作记忆由写入接口的会话标识落库，随后用同一个标识从会话视图取回，这条内容足够长以通过质量门',
    });
    expect(w.result.isError).toBe(false);
    const memId = (w.result.structuredContent as { mem_id: string }).mem_id;
    expect(memId).toBeTruthy();
    expect((await storage.getMemory(memId))?.session_id).toBe('S-WRITE-HTTP');

    const out = await tool(1202, 'recall_memory', {
      project_id: 'P1', query: 'zzzz 完全无关', scope: 'session', session_id: 'S-WRITE-HTTP', top_k: 5,
    });
    expect(out.result.isError).toBe(false);
    const sc = out.result.structuredContent as {
      hits: Array<{ mem_id: string; score: number }>; background: { items: unknown[] };
      display: { line: string; markdown: string };
    };
    expect(sc.hits.map((h) => h.mem_id)).toEqual([memId]);
    expect(sc.hits[0].score).toBe(0);
    expect(sc.background.items).toHaveLength(0);
    expect(out.result.content![0].text).toBe(sc.display.line); // 回显档位仍按既有口径组装
    expect(sc.display.markdown).toBeTruthy();
  });

  it('B 效果验证：倒序 + top_k 截断；别会话 / 历史行不混入；写入 recall 审计', async () => {
    const before = (await storage.queryAudit({ action: 'recall' })).length;
    const out = await tool(1203, 'recall_memory', {
      project_id: 'P1', query: '刚才', scope: 'session', session_id: 'S-HTTP', top_k: 2,
    });
    expect(out.result.isError).toBe(false);
    const sc = out.result.structuredContent as {
      hits: Array<{ mem_id: string }>; scanned_memories: number; background: { candidates: number };
    };
    expect(sc.hits.map((h) => h.mem_id)).toEqual(['h_new', 'h_mid']);
    expect(sc.scanned_memories).toBe(3);
    expect(sc.background.candidates).toBe(0);
    const audits = await storage.queryAudit({ request_id: (out.result.structuredContent as { request_id: string }).request_id });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ scope: 'session', session_id: 'S-HTTP', hits: 2 });
    expect((await storage.queryAudit({ action: 'recall' })).length).toBe(before + 1);
  });

  it('A 回归：scope=project 与不带 scope 命中一致（项目语义路径一行未改）', async () => {
    const plain = await tool(1204, 'recall_memory', { project_id: 'P1', query: '会话纪要', top_k: 10 });
    const explicit = await tool(1205, 'recall_memory', {
      project_id: 'P1', query: '会话纪要', top_k: 10, scope: 'project', session_id: 'S-HTTP',
    });
    expect(plain.result.isError).toBe(false);
    expect(explicit.result.isError).toBe(false);
    const ids = (b: ToolBody) =>
      ((b.result.structuredContent as { hits: Array<{ mem_id: string }> }).hits).map((h) => h.mem_id);
    expect(ids(explicit)).toEqual(ids(plain));
    expect(ids(plain)).toContain('h_legacy'); // 项目视图仍可见无 session_id 的历史行
    const bg = (plain.result.structuredContent as { background: { candidates: number } }).background;
    expect(bg.candidates).toBeGreaterThan(0);
  });

  it('C2 输入变异：非法参数 → isError:true，且不写 recall 审计', async () => {
    const before = (await storage.queryAudit({ action: 'recall' })).length;
    for (const args of [
      { project_id: 'P1', query: 'q', scope: 'session' },
      { project_id: 'P1', query: 'q', scope: 'session', session_id: '' },
      { project_id: 'P1', query: 'q', scope: 'bogus', session_id: 'S-HTTP' },
      { project_id: 'P1', query: 'q', scope: 'session', session_id: 'S-HTTP', top_k: 11 },
    ]) {
      const out = await tool(1206, 'recall_memory', args);
      expect(out.result.isError).toBe(true);
    }
    expect((await storage.queryAudit({ action: 'recall' })).length).toBe(before);
  });

  it('受限令牌：会话视图不绕过项目作用域 → isError:true', async () => {
    const scoped = runMcpHttpServer({
      port: 0, token: TOKEN, storage, l0: vault,
      account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', scope_project_ids: ['P1'] },
    });
    const scopedUrl = `http://127.0.0.1:${await scoped.ready}/mcp`;
    try {
      const res = await fetch(scopedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1207, method: 'tools/call',
          params: {
            name: 'recall_memory',
            arguments: { project_id: 'P2', query: 'q', scope: 'session', session_id: 'S-HTTP' },
          },
        }),
      });
      const body = (await res.json()) as ToolBody;
      expect(body.result.isError).toBe(true);
    } finally {
      scoped.stop();
    }
  });
});

// D6-5 端到端：create_project / mint_token（管理员门禁 + mint 后新令牌回连 scope 生效）
describe('D6-5 管理工具端到端（HTTP）', () => {  let handle: McpHttpHandle;
  let url = '';
  const storage = new InMemoryStorage();

  beforeAll(async () => {
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, tokenStore: new InMemoryTokenStore() });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });
  afterAll(() => { handle?.stop(); });

  function callTool(name: string, args: Record<string, unknown>, token: string): Promise<{ isError: boolean; text: string; structured: Record<string, unknown> }> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }).then((r) => r.json() as Promise<{ result: { isError: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown> } }>)
      .then((b) => ({ isError: b.result.isError, text: b.result.content[0]?.text ?? '', structured: b.result.structuredContent }));
  }

  it('admin create_project（general slug）→ 落注册表且 list_projects 可见', async () => {
    const created = await callTool('create_project', { project_id: 'httpapp', kind: 'general', display_name: 'HTTP 应用' }, TOKEN);
    expect(created.isError).toBe(false);
    expect((created.structured as { ok: boolean; project: { project_id: string } }).project.project_id).toBe('httpapp');
    const list = await callTool('list_projects', {}, TOKEN);
    expect((list.structured as { projects: Array<{ project_id: string }> }).projects.map((p) => p.project_id)).toContain('httpapp');
  });

  it('非 admin 令牌调 create_project → 明确拒绝且不落库；调 mint_token → 拒绝', async () => {
    const minted = await callTool('mint_token', { user_id: 'bob', scope_project_ids: ['httpapp'] }, TOKEN);
    const bobToken = (minted.structured as { token: string }).token;

    const denied = await callTool('create_project', { project_id: 'bobproj', kind: 'general' }, bobToken);
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('仅管理员');
    expect(await storage.getProject('bobproj')).toBeNull();

    const mintDenied = await callTool('mint_token', { user_id: 'x', scope_project_ids: ['*'] }, bobToken);
    expect(mintDenied.isError).toBe(true);
    expect(mintDenied.text).toContain('仅管理员');
  });

  it('mint 受限令牌 → 新令牌回连：list_projects 只见 scope 内项目（不含 registry 其它项目）；write 到 scope 外被拒', async () => {
    await callTool('create_project', { project_id: 'otherproj', kind: 'general' }, TOKEN);
    const minted = await callTool('mint_token', { user_id: 'carol', scope_project_ids: ['httpapp'] }, TOKEN);
    expect(minted.isError).toBe(false);
    const carolToken = (minted.structured as { token: string }).token;

    const list = await callTool('list_projects', {}, carolToken);
    const ids = (list.structured as { projects: Array<{ project_id: string }> }).projects.map((p) => p.project_id);
    expect(ids).toContain('httpapp');
    expect(ids).not.toContain('otherproj');

    const writeOut = await callTool('write_memory', { content: '越界写入', project_id: 'otherproj', category: 'fact', source_agent: 'workbuddy' }, carolToken);
    expect(writeOut.isError).toBe(true);
    const writeIn = await callTool('write_memory', { content: '范围内写入', project_id: 'httpapp', category: 'fact', source_agent: 'workbuddy' }, carolToken);
    expect(writeIn.isError).toBe(false);
  });
});

// 批次47（L1+L2）：工具描述首步召回 + 服务端会话门禁（仅 HTTP 8204）
// L1：tools/list 下发的 12 个工具描述统一带「首步召回」前缀（recall 用 🔴、其余 ⚠️）。
// L2：可靠会话（带 Mcp-Session-Id，服务端 initialize 签发并关联）尚未召回即调写入/治理类工具 → 硬拦；
//     读类未召回只软提醒（不拦截）；无会话头（UA 兜底）客户端一律只软提醒、不硬拦（防 §9 串号误杀）。
describe('批次47：L1 工具描述首步召回 + L2 会话门禁（HTTP 8204）', () => {
  let handle: McpHttpHandle;
  let url = '';
  let vault: L0Vault;
  const storage = new InMemoryStorage();

  async function init(name = 'TestAgent'): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name, version: '1.0' } } }),
    });
    const sid = res.headers.get('mcp-session-id');
    expect(sid, 'initialize 必须签发 Mcp-Session-Id').toBeTruthy();
    return sid!;
  }
  async function tool(
    name: string,
    args: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<{ result: { isError: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> } }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> } };
  }

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
    // 准备一个真实项目 P1 供 recall 定位（无会话头 = 不可靠会话，门禁不硬拦，admin 令牌放行 create_project）。
    await tool('create_project', { project_id: 'P1', kind: 'general', display_name: '测试项目' });
  });
  afterAll(() => { handle?.stop(); });

  it('L1：tools/list 全部 12 工具描述带「首步召回」前缀（recall=🔴、其余=⚠️，且保留原描述）', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const tools = ((await res.json()) as { result: { tools: Array<{ name: string; description: string }> } }).result.tools;
    expect(tools).toHaveLength(12);
    const recall = tools.find((t) => t.name === 'recall_memory')!;
    expect(recall.description).toContain('🔴【本会话第一步】');
    expect(recall.description).toContain('优先使用本工具'); // 原描述保留
    const other = tools.find((t) => t.name === 'write_memory')!;
    expect(other.description).toContain('⚠️ 调用本工具前，本会话必须已先调用过 recall_memory');
    expect(other.description).toContain('写入一条记忆'); // 原描述保留
  });

  it('L2：可靠会话未召回即写 → 硬拦（isError + ⛔ 门禁文案，且不执行写）', async () => {
    const sid = await init();
    const before = await storage.listMemories({});
    const w = await tool('write_memory', { content: '门禁前应被拒', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' }, { 'Mcp-Session-Id': sid });
    expect(w.result.isError).toBe(true);
    expect(w.result.content[0].text).toContain('⛔');
    expect(w.result.content[0].text).toContain('尚未调用 recall_memory');
    // 门禁在 callTool 之前返回，绝不应落库
    expect(await storage.listMemories({})).toHaveLength(before.length);
  });

  it('L2：可靠会话先召回 → 写与治理类工具放行；召回后读类不再追加软提醒', async () => {
    const sid = await init();
    const rec = await tool('recall_memory', { project_id: 'P1', query: '任意关键词' }, { 'Mcp-Session-Id': sid });
    expect(rec.result.isError).toBe(false);

    const w = await tool('write_memory', { content: '批次47 门禁验证：可靠会话先调用 recall_memory 检索记忆库，随后写入一条足够长的记忆以确认写入与治理类工具在召回后正常放行且真实落库落审计', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' }, { 'Mcp-Session-Id': sid });
    expect(w.result.isError).toBe(false);
    const memId = (w.result.structuredContent as { mem_id: string }).mem_id;
    expect(memId).toMatch(/^mem_/); // 真实落库

    const ls = await tool('list_projects', {}, { 'Mcp-Session-Id': sid });
    expect(ls.result.isError).toBe(false);
    const joined = ls.result.content.map((c) => c.text).join('\n');
    expect(joined).not.toContain('⚠️ 本会话尚未调用 recall_memory'); // 已召回 → 无软提醒
  });

  it('L2：可靠会话未召回即读类 → 不拦截，只追加软提醒（保体验）', async () => {
    const sid = await init();
    const ls = await tool('list_projects', {}, { 'Mcp-Session-Id': sid });
    expect(ls.result.isError).toBe(false);
    const joined = ls.result.content.map((c) => c.text).join('\n');
    expect(joined).toContain('⚠️ 本会话尚未调用 recall_memory');
  });

  it('L2：无会话头（UA 兜底）写 → 不硬拦（只软提醒），防 §9 跨客户端串号误杀', async () => {
    const w = await tool('write_memory', { content: 'UA 兜底写入：无会话头不硬拦且会软提醒', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' });
    expect(w.result.isError).toBe(false); // 不可靠会话不硬拦
    const joined = w.result.content.map((c) => c.text).join('\n');
    expect(joined).not.toContain('⛔'); // 没有硬门禁文案
    expect(joined).toContain('⚠️ 本会话尚未调用 recall_memory'); // 但会软提醒
  });

  it('L2：无会话头（UA 兜底）治理类工具（manage_memory）也不硬拦，只软提醒', async () => {
    // 先以不可靠会话写一条（无会话头不硬拦），拿到真实 mem_id
    const w = await tool('write_memory', { content: '批次47 门禁验证：以不带 Mcp-Session-Id 的不可靠会话方式写入一条足够长的记忆，随后调用 manage_memory 做 pin 操作，确认治理类工具在 UA 兜底路径下不会被硬拦、只会软提醒', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' });
    expect(w.result.isError).toBe(false);
    const memId = (w.result.structuredContent as { mem_id: string }).mem_id;
    expect(memId).toMatch(/^mem_/);
    const m = await tool('manage_memory', { mem_id: memId, action: 'pin' });
    expect(m.result.isError).toBe(false); // 不可靠会话不硬拦治理类
    const joined = m.result.content.map((c) => c.text).join('\n');
    expect(joined).not.toContain('⛔');
  });

  it('L3-a：recall 结果末块（展示要求）追加刚性「信息来源边界」', async () => {
    const sid = await init();
    const rec = await tool('recall_memory', { project_id: 'P1', query: '任意关键词' }, { 'Mcp-Session-Id': sid });
    expect(rec.result.isError).toBe(false);
    const echoNote = rec.result.content[rec.result.content.length - 1].text;
    expect(echoNote).toContain('【信息来源边界】');
    expect(echoNote).toContain('不要编造记忆内容或省量');
  });

  it('L3-b：每次 tools/call 写 mcp_call 审计，含首调合规字段（first_call / tool / reliable）', async () => {
    const sid = await init();
    // 首个调用即 recall → 合规
    await tool('recall_memory', { project_id: 'P1', query: '合规' }, { 'Mcp-Session-Id': sid });
    const afterRecall = (await storage.queryAudit({ action: 'mcp_call' })).filter(
      (a) => (a.detail as { session_id?: string }).session_id === sid,
    );
    const first = afterRecall.find((a) => (a.detail as { first_call?: boolean }).first_call === true);
    expect(first, '应有一条 first_call=true 的 mcp_call 审计').toBeTruthy();
    const d = first!.detail as { session_id: string; reliable: boolean; tool: string; recalled_before: boolean };
    expect(d.session_id).toBe(sid);
    expect(d.reliable).toBe(true);
    expect(d.tool).toBe('recall_memory');
    expect(d.recalled_before).toBe(false); // 首个调用前确实未召回
  });

  it('L3-b：可靠会话首个调用是写（被门禁拦截）→ mcp_call 审计 first_call=true 且 tool=write_memory、recalled_before=false', async () => {
    const sid = await init();
    await tool('write_memory', { content: '批次47 合规审计：首个调用即写，门禁拦截但审计仍记录', project_id: 'P1', category: 'fact', source_agent: 'workbuddy' }, { 'Mcp-Session-Id': sid });
    const rows = (await storage.queryAudit({ action: 'mcp_call' })).filter(
      (a) => (a.detail as { session_id?: string }).session_id === sid,
    );
    const first = rows.find((a) => (a.detail as { first_call?: boolean }).first_call === true);
    expect(first).toBeTruthy();
    expect((first!.detail as { tool: string }).tool).toBe('write_memory');
    expect((first!.detail as { recalled_before: boolean }).recalled_before).toBe(false);
  });
});

describe('批次 RAG · C 组：展示要求三处与实际 display.markdown 逐字一致', () => {
  /** 与 T2 同源的真实最小样本：两命中（带 [n] 依据词）、无背景、未设单价 */
  function fixtures() {
    const r: RecallResult = {
      hits: [
        {
          mem_id: 'm1', content: '回显格式与折叠气泡的口径', layer: 'L1', decay_class: 'hot',
          pinned: false, locked: false, score: 0.9, evidence_ref: 'l0:m1',
          matched_terms: ['回显', '折叠'],
        },
        {
          mem_id: 'm2', content: 'ui 原型与白名单判档', layer: 'L1', decay_class: 'warm',
          pinned: false, locked: false, score: 0.6, evidence_ref: 'l0:m2', matched_terms: ['ui'],
        },
      ],
      payload_tokens: 100, pipeline_llm_tokens: 0,
      budget: { soft: 1500, warn: 2000, hard: 3000, status: 'ok' },
      mode: 'auto', hit_keywords: [], secondary_mode_hint: null, dispatch: null,
      request_id: 'req_c_group', scanned_memories: 20, evidence_thin: false,
      background: { items: [], tokens: 0, candidates: 0 },
      savings: {
        corpus_tokens: 10000, payload_tokens: 100, background_tokens: 0, injected_tokens: 100,
        budget_trimmed_tokens: 0, saved_tokens: 9900,
      },
    };
    const hint = buildRecallHint(r, rollupRecalls([], Date.now()), null);
    return {
      html: buildRecallMarkdown(r, hint, null),
      full: buildRecallMarkdown(r, hint, null, { htmlDetails: false }),
      compact: buildRecallCompactMarkdown(hint, 'http://127.0.0.1:8204/recall/abcdefghij0123456789AB'),
    };
  }

  it('C1-a html-details：note 段名逐字出现在真实 markdown，旧「四段」措辞已清除', () => {
    const { html } = fixtures();
    const note = recallEchoNote('html-details');
    for (const s of ['📊 本次召回统计汇总', '🎯 本次用上的依据', '▶ 展开本次召回汇总']) {
      expect(note, `展示要求缺 ${s}`).toContain(s);
      expect(html, `真实 markdown 缺 ${s}`).toContain(s);
    }
    expect(note).toContain('就地标注 [n]');
    expect(note).toContain('不得编造编号');
    expect(note).toContain('【信息来源边界】');
    expect(note).not.toContain('<details> 四段');
    expect(note).not.toContain('四段明细');
  });

  it('C1-b markdown-full：段名与纯 Markdown 正文逐字一致、零 HTML 标签', () => {
    const { full } = fixtures();
    const note = recallEchoNote('markdown-full');
    expect(note).toContain('detail=true 的明细返回');
    for (const s of ['📊 本次召回统计汇总', '🎯 本次用上的依据']) {
      expect(note).toContain(s);
      expect(full).toContain(s);
    }
    expect(note).toContain('就地标注 [n]');
    expect(note).toContain('不得编造编号');
    expect(note).toContain('不要给回答添加任何 HTML 标签');
    expect(note).toContain('【信息来源边界】');
    expect(note).not.toContain('<details>');
    expect(note).not.toContain('四段明细');
  });

  it('C1-c markdown-compact：note 与两行短摘要/链接文案逐字一致，且不含 <details>', () => {
    const { compact } = fixtures();
    const note = recallEchoNote('markdown-compact');
    expect(note).toContain('默认收起 + 点击展开');
    expect(note).toContain('依据 [n]');
    expect(note).toContain('📊 汇总：');
    expect(note).toContain('统计汇总 / 命中依据 / Token / 费用');
    expect(note).toContain('URL 必须逐字保留');
    expect(note).toContain('就地标注 [n]');
    expect(compact).toContain('[1]「回显」');
    expect(compact).toContain('[2]「ui」');
    expect(compact).toContain('📊 汇总：');
    expect(compact).toContain('▶ [展开本次召回明细（统计汇总 / 命中依据 / Token / 费用）]');
    expect(note).not.toContain('<details>');
    expect(note).not.toContain('四段明细');
  });

  it('C2 instructions / 工具描述 / detail 参数三处同步 RAG 就地引用与新段名', () => {
    expect(MCP_INSTRUCTIONS).toContain('就地标注 [n]');
    expect(MCP_INSTRUCTIONS).toContain('不得编造编号');
    expect(MCP_INSTRUCTIONS).toContain('📊 本次召回统计汇总');
    expect(MCP_INSTRUCTIONS).toContain('🎯 本次用上的依据');
    expect(MCP_INSTRUCTIONS).toContain('URL 必须逐字保留');
    const tool = MCP_TOOLS.find((t) => t.name === 'recall_memory');
    expect(tool).toBeTruthy();
    expect(tool!.description).toContain('就地标注 [n]');
    expect(tool!.description).toContain('不得编造');
    expect(tool!.description).toContain('📊 本次召回统计汇总');
    expect(tool!.description).toContain('🎯 本次用上的依据');
    const props = tool!.inputSchema.properties as unknown as Record<string, { description?: string }>;
    expect(props.detail.description).toContain('统计汇总');
    expect(props.detail.description).toContain('[n]');
  });

  it('C3 三档 note 互不串档：仅 html 档提 <details>、仅 compact 档提链接，三档均带来源边界', () => {
    const html = recallEchoNote('html-details');
    const full = recallEchoNote('markdown-full');
    const compact = recallEchoNote('markdown-compact');
    expect(html).toContain('<details>');
    expect(full).not.toContain('<details>');
    expect(compact).not.toContain('<details>');
    expect(html).not.toContain('URL 必须逐字保留');
    expect(compact).toContain('URL 必须逐字保留');
    for (const note of [html, full, compact]) {
      expect(note).toContain('【信息来源边界】');
      expect(note).toContain('不得编造编号');
      expect(note).toContain('数字与金额不得改写、省略或补全。');
    }
  });

  it('C4 富媒体客户端（WorkBuddy）禁用 HTML：折叠只走气泡内折叠卡，且仅 compact 档授权', () => {
    const compact = recallEchoNote('markdown-compact');
    expect(compact).toContain('气泡折叠档');
    expect(compact).toContain('折叠卡');
    expect(compact).toContain('默认收起');
    expect(compact).toContain('不要输出任何 HTML 标签');
    expect(compact).toContain('URL 逐字保留');
    // 2026-11-12 用户验收该形态 → 从「能做就做」升级为「有卡片能力必须做」，并标注已验收
    expect(compact).toContain('**必须**为本次召回输出一张');
    expect(compact).toContain('已验收');
    // 展开后要能查到「汇总 + 明细」，不只是汇总
    expect(compact).toContain('展开后必须能同时查到汇总与明细');
    expect(compact).toContain('正文片段');
    // 2026-11-12 用户拍板：明细固定顺序 背景 → 命中 → 依据 → 证据不足（最后）
    expect(compact).toMatch(/📎 项目背景[\s\S]*🧠 命中记忆[\s\S]*🎯 本次用上的依据[\s\S]*⚠ 证据不足/);
    // 背景必须逐条独立成行，不得压成一整段
    expect(compact).toContain('逐条独立成行');
    // 反向：折叠档 / 明细档不得出现这条增强通道（它们本身就是 HTML / 四小节载体）
    expect(recallEchoNote('html-details')).not.toContain('气泡折叠档');
    expect(recallEchoNote('markdown-full')).not.toContain('气泡折叠档');
    // 三处指令同步：WorkBuddy 恒定两行摘要档，折叠交给客户端气泡卡片，文本零 HTML
    expect(MCP_INSTRUCTIONS).toContain('气泡内折叠卡片');
    expect(MCP_INSTRUCTIONS).toContain('WorkBuddy');
    const tool = MCP_TOOLS.find((t) => t.name === 'recall_memory');
    expect(tool!.description).toContain('气泡内折叠卡片');
    expect(tool!.description).toContain('不要在文本里写 HTML 标签');
  });
});
