// MCP 工具服务契约测试（§19.5）：三工具 schema + 参数校验 + 阶梯精炼管道 + 批次2 信任边界
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createConnection } from 'node:net';
import { runMcpServer, type McpServerHandle } from '../mcp.ts';
import { InMemoryStorage } from '../storage.ts';
import { scoreMemory } from '../forgetting.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault, TEST_ADMIN_PW, TEST_ADMIN_ID } from './l0Kit.ts';
import { MemoryPendingStore } from '../pendingWrites.ts';
import type { Memory } from '../types.ts';

const TOKEN = 'mcp-test-token-0123456789abcdef0123456789abcdef';

interface RpcResult {
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function rpcCall(port: number, obj: Record<string, unknown>): Promise<RpcResult> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(port, '127.0.0.1');
    let buf = '';
    socket.on('data', (c: Buffer) => {
      buf += c.toString();
      const line = buf.trim();
      if (line.startsWith('{') && line.endsWith('}')) {
        socket.end();
        try { resolve(JSON.parse(line)); } catch { reject(new Error(`bad JSON: ${line}`)); }
      }
    });
    socket.on('error', reject);
    socket.write(JSON.stringify(obj) + '\n');
  });
}

describe('MCP Server（§19.5）', () => {
  let handle: McpServerHandle;
  let PORT = 0;
  const storage = new InMemoryStorage();
  let vault: L0Vault;

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpServer({ port: 0, storage, token: TOKEN, l0: vault });
    PORT = await handle.ready;
  });

  afterAll(() => {
    handle?.stop();
  });

  it('无 token → -32001（MCP 端口不再对任意本机进程开放）', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 0, method: 'tools/list' });
    expect(r.error?.code).toBe(-32001);
    expect(r.error?.message).toContain('token');
  });

  it('错误 token → -32001，且不会返回工具清单', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 0, method: 'tools/list', params: { token: 'wrong-token'.repeat(4) } });
    expect(r.error?.code).toBe(-32001);
    expect(r.result).toBeUndefined();
  });

  it('tools/list 返回十个工具且 schema 正确', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { token: TOKEN } });
    const tools = (r.result as { tools: Array<{ name: string; inputSchema?: { required?: string[] } }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'recall_memory', 'write_memory', 'list_projects', 'get_preferences', 'get_write_status',
      'list_memories', 'get_memory', 'feedback', 'manage_memory', 'gc_report',
    ]);
    const recallTool = tools.find((t) => t.name === 'recall_memory')!;
    expect(recallTool.inputSchema!.required).toEqual(['query']); // project_id 可省略（批次11）
    const writeTool = tools.find((t) => t.name === 'write_memory')!;
    const schema = writeTool.inputSchema!;
    expect(schema.required).toContain('content');
    expect(schema.required).toContain('project_id');
  });

  it('空账本 recall 省略 project_id → -32602 明示 project_id（不猜项目）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 11, method: 'recall_memory', params: { query: '任意关键词', token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('project_id');
  });

  it('write_memory：缺 project_id → -32602', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 2, method: 'write_memory', params: { content: 'test', token: TOKEN } });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('project_id');
  });

  it('write_memory：缺 content → -32602', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 3, method: 'write_memory', params: { project_id: 'P1', token: TOKEN } });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('content');
  });

  it('write_memory：非法 category → -32602（不静默落 pitfall）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 32,
      method: 'write_memory',
      params: { content: '非法类别测试', project_id: 'P1', category: 'bug', token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('category');
  });

  it('write_memory：冒用其它 user_id → -32602（租户闭包）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 31,
      method: 'write_memory',
      params: { content: '跨租户写入', project_id: 'P1', user_id: 'u2', token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('租户');
  });

  it('write_memory：缺 source_agent → -32602（禁止依赖默认 mcp）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 33,
      method: 'write_memory',
      params: { content: '缺来源写入', project_id: 'P1', category: 'pitfall', token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('source_agent');
  });

  it('write_memory：source_agent 为默认 mcp → -32602', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 34,
      method: 'write_memory',
      params: { content: '默认mcp', project_id: 'P1', category: 'pitfall', source_agent: 'mcp', token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('mcp');
  });

  it('write_memory：合法入参 → 成功 + L0 阶梯管道 + 审计落库', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 4,
      method: 'write_memory',
      params: {
        content: 'MCP 写入测试：联系人 张三，电话 13900001111',
        project_id: 'P1',
        category: 'pitfall',
        session_id: 'sess-mcp-001',
        source_agent: 'mcp-test',
        token: TOKEN,
      },
    });
    expect(r.error).toBeUndefined();
    const result = r.result as { mem_id: string; dedup: { action: string } };
    expect(result.dedup.action).toBe('new');
    expect(result.mem_id).toMatch(/^mem_/);

    // 验证 L0 已加密入库（非明文）
    const mems = await storage.listMemories({});
    const mcpMem = mems.find((m) => m.mem_id === result.mem_id)!;
    expect(mcpMem).toBeDefined();
    expect(mcpMem.content_l0_enc).not.toContain('张三');
    expect(mcpMem.content_l0_enc).toContain('AES-256-GCM');

    // 验证 L1 已脱敏
    expect(mcpMem.content_l1).not.toContain('13900001111');
    expect(mcpMem.content_l1).toContain('[电话]');

    // 未接入真实 LLM → 只落 L1，不伪造 L2-L6
    expect(mcpMem.layer).toBe('L1');
    expect(mcpMem.refined_by).toBe('stub');
    expect(mcpMem.content_l1).toBeDefined();
    expect(mcpMem.content).toBe(mcpMem.content_l1);
    expect(mcpMem.content_l2).toBeUndefined();
    expect(mcpMem.content_l3).toBeUndefined();
    expect(mcpMem.content_l4).toBeUndefined();
    expect(mcpMem.content_l5).toBeUndefined();
    expect(mcpMem.content_l6).toBeUndefined();

    // 验证 source_agent 已记录
    expect(mcpMem.created_by_agent).toBe('mcp-test');
    // A4：未传打分旋钮 → 记录不带该字段（scoreMemory 兼容默认 0.5）
    expect(mcpMem.importance).toBeUndefined();
    expect(mcpMem.confidence).toBeUndefined();
    expect(mcpMem.half_life_days).toBeUndefined();
    expect(mcpMem.tags).toBeUndefined();
  });

  it('write_memory：扩展打分旋钮落库并生效于 scoreMemory（A4）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 35,
      method: 'write_memory',
      params: {
        content: 'A4 旋钮测试：连接池上限 20，超出直接拒绝',
        project_id: 'P1',
        category: 'decision',
        source_agent: 'mcp-test',
        importance: 0.9,
        confidence: 0.8,
        half_life_days: 60,
        tags: ['支付', ' 回归 '],
        token: TOKEN,
      },
    });
    expect(r.error).toBeUndefined();
    const result = r.result as { mem_id: string };
    const mems = await storage.listMemories({});
    const m = mems.find((x) => x.mem_id === result.mem_id)!;
    expect(m.importance).toBe(0.9);
    expect(m.confidence).toBe(0.8);
    expect(m.half_life_days).toBe(60);
    expect(m.tags).toEqual(['支付', '回归']); // tags 去首尾空白
    // 旋钮生效：同 relevance/时刻下，带 0.9/0.8 的打分 > 抹掉旋钮后的默认 0.5 打分
    const now = m.created_at;
    const { importance: _i, confidence: _c, ...rest } = m;
    expect(scoreMemory(m, 1, now)).toBeGreaterThan(scoreMemory(rest, 1, now));
  });

  it('write_memory：importance 越界（1.5）→ -32602', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 36,
      method: 'write_memory',
      params: { content: '越界', project_id: 'P1', category: 'fact', source_agent: 'mcp-test', importance: 1.5, token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('importance');
  });

  it('write_memory：half_life_days=0 → -32602', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 37,
      method: 'write_memory',
      params: { content: '半衰期非法', project_id: 'P1', category: 'fact', source_agent: 'mcp-test', half_life_days: 0, token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('half_life_days');
  });

  it('write_memory：tags 非字符串数组 → -32602', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 38,
      method: 'write_memory',
      params: { content: 'tags 非法', project_id: 'P1', category: 'fact', source_agent: 'mcp-test', tags: '支付', token: TOKEN },
    });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('tags');
  });

  it('get_preferences：缺 user_id → -32602', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 5, method: 'get_preferences', params: { token: TOKEN } });
    expect(r.error?.code).toBe(-32602);
  });

  it('get_preferences：读取其它租户 → -32602（租户闭包）', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 51, method: 'get_preferences', params: { user_id: 'u2', token: TOKEN } });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toContain('租户');
  });

  it('旧名 get_user_preferences → -32601（重命名后无别名）', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 52, method: 'get_user_preferences', params: { user_id: 'u1', token: TOKEN } });
    expect(r.error?.code).toBe(-32601);
  });

  it('tools/call 代理：经 tools/call 调 write_memory 同样成功', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 6,
      method: 'tools/call',
      params: {
        name: 'write_memory',
        arguments: {
          content: 'tools/call 路径测试',
          project_id: 'P1',
          category: 'fact',
          source_agent: 'mcp-test',
        },
        token: TOKEN,
      },
    });
    expect(r.error).toBeUndefined();
    const result = r.result as { mem_id: string };
    expect(result.mem_id).toMatch(/^mem_/);
  });

  it('未知方法 → -32601', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 7, method: 'no_such_tool', params: { token: TOKEN } });
    expect(r.error?.code).toBe(-32601);
  });

  it('initialize 握手返回 serverInfo + instructions（批次11）', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 8, method: 'initialize', params: { token: TOKEN } });
    expect(r.result).toBeDefined();
    const init = r.result as { serverInfo: { name: string; version: string }; instructions: string };
    expect(init.serverInfo.name).toBe('memagent-mcp');
    expect(init.instructions).toContain('recall_memory');
    expect(init.instructions).toContain('display.markdown');
    expect(init.instructions).toContain('display.line');
    expect(init.instructions).toContain('优先调用');
  });

  it('recall 省略 project_id → 唯一项目自动定位 + 提示行（金额未设单价 → null）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 81, method: 'recall_memory', params: { query: 'MCP 写入测试', token: TOKEN },
    });
    expect(r.error).toBeUndefined();
    const result = r.result as {
      project_id: string; resolved_from: string; hits: unknown[];
      savings: { saved_tokens: number; injected_tokens: number };
      background: { items: unknown[] };
      display: { line: string; markdown: string; money: unknown; mode: string };
    };
    expect(result.project_id).toBe('P1');
    expect(result.resolved_from).toBe('single_project');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.savings.injected_tokens).toBeGreaterThan(0);
    expect(result.savings.saved_tokens).toBeGreaterThanOrEqual(0);
    expect(result.display.money).toBeNull();
    expect(result.display.line).toContain('🧠 Memory');
    // 批次32-C：TCP 无 clientInfo（非实测支持 HTML 的客户端）→ 默认紧凑档，明细不铺满聊天窗口
    expect(result.display.mode).toBe('markdown-compact');
    expect(result.display.markdown).not.toContain('<details>');
    expect(result.display.markdown).not.toContain('**📎 项目背景');
    expect(result.display.markdown).toContain('detail=true');
  });

  it('recall detail=true → 纯 Markdown 四小节明细（数字与摘要行同源）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 84, method: 'recall_memory', params: { query: 'MCP 写入测试', detail: true, token: TOKEN },
    });
    const result = r.result as { display: { mode: string; markdown: string; line: string } };
    expect(result.display.mode).toBe('markdown-full');
    expect(result.display.markdown).toContain('**📎 项目背景');
    expect(result.display.markdown).toContain('**🧠 命中记忆');
    expect(result.display.markdown).toContain('**⚡ Token 用量');
    expect(result.display.markdown).toContain('**💰 省钱与费用');
    expect(result.display.markdown.startsWith(`**${result.display.line}**`)).toBe(true);
  });

  it('recall detail 传非布尔 → 明确报参数错误（不静默按摘要处理）', async () => {
    const r = await rpcCall(PORT, {
      jsonrpc: '2.0', id: 85, method: 'recall_memory', params: { query: 'MCP 写入测试', detail: 'yes', token: TOKEN },
    });
    expect(String(r.error?.message ?? '')).toContain('detail 必须是布尔值');
  });

  it('list_projects → 真实项目 P1', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 82, method: 'list_projects', params: { token: TOKEN } });
    const result = r.result as { total: number; projects: Array<{ project_id: string; memories: number }> };
    expect(result.total).toBe(1);
    expect(result.projects[0].project_id).toBe('P1');
    expect(result.projects[0].memories).toBeGreaterThan(0);
  });

  it('单行超过上限 → -32600 并断开连接（防止大包吃满内存）', async () => {
    const tiny = runMcpServer({ port: 0, storage: new InMemoryStorage(), token: TOKEN, maxLineBytes: 128 });
    const port = await tiny.ready;
    const out = await new Promise<string>((resolve) => {
      const s = createConnection(port, '127.0.0.1');
      let buf = '';
      s.on('data', (c: Buffer) => { buf += c.toString(); });
      s.on('close', () => resolve(buf));
      s.on('error', () => resolve(buf));
      s.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize', params: { token: TOKEN, pad: 'x'.repeat(500) } }) + '\n');
    });
    expect(out).toContain('-32600');
    tiny.stop();
  });
});

// 批次44-D4：L0 写密钥锁定期间 write_memory 落盘兜底（pending/flush）端到端验证。
// 用真实 L0Vault 的 lockWrite/unlockWrite 制造锁态；pending 队列显式共享（跨 socket 也一致）。
describe('批次44-D4：L0 锁定写入落盘兜底（pending/flush）', () => {
  let handle: McpServerHandle;
  let port = 0;
  let vault: L0Vault;
  const storage = new InMemoryStorage();

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpServer({
      port: 0, storage, token: TOKEN, l0: vault, pending: new MemoryPendingStore(),
    });
    port = await handle.ready;
  });

  afterAll(() => { handle?.stop(); });

  const status = async (id: number) => rpcCall(port, {
    jsonrpc: '2.0', id, method: 'get_write_status', params: { token: TOKEN },
  });

  it('get_write_status：解锁态 → l0_unlocked=true / pending_count=0', async () => {
    const r = await status(900);
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual({ l0_unlocked: true, writeDek_present: true, pending_count: 0 });
  });

  it('锁定后 write_memory → status=pending（不丢、不伪造 mem_id、不落库）', async () => {
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID });
    const r = await rpcCall(port, {
      jsonrpc: '2.0', id: 901, method: 'write_memory',
      params: {
        token: TOKEN, content: '项目 P1 决策：本地持久化 pending 队列按 created_at 升序逐条重放，锁定态不落明文', project_id: 'P1',
        category: 'fact', source_agent: 'mcp-test',
      },
    });
    expect(r.error).toBeUndefined();
    const out = r.result as { status: string; pending_id: string; reason: string; mem_id?: string };
    expect(out.status).toBe('pending');
    expect(out.reason).toBe('E_L0_LOCKED');
    expect(out.pending_id).toMatch(/^pend_/);
    expect(out.mem_id).toBeUndefined(); // 诚实降级：绝不伪造写入回执

    const st = await status(902);
    expect(st.result).toEqual({ l0_unlocked: false, writeDek_present: false, pending_count: 1 });
    expect((await storage.listMemories({})).length).toBe(0); // 锁定态不落明文
  });

  it('锁定态再写一条 → 逐条累积（不覆盖、不丢）', async () => {
    const r = await rpcCall(port, {
      jsonrpc: '2.0', id: 903, method: 'write_memory',
      params: {
        token: TOKEN, content: '运维手册补充：PostgreSQL 17 的 WAL 归档窗口设为 15 分钟，超过即清理旧日志', project_id: 'P1',
        category: 'decision', source_agent: 'mcp-test',
      },
    });
    expect((r.result as { status: string }).status).toBe('pending');
    const st = await status(904);
    expect((st.result as { pending_count: number }).pending_count).toBe(2);
  });

  it('解锁后 write_memory → 自动重放全部 pending，两条历史 + 本次都落库', async () => {
    await vault.unlockWrite({ password: TEST_ADMIN_PW, admin_user_id: TEST_ADMIN_ID });
    const r = await rpcCall(port, {
      jsonrpc: '2.0', id: 905, method: 'write_memory',
      params: {
        token: TOKEN, content: '前端约定：所有入口 HTML 文件名一律小写，避免 Linux CI 上大小写错位导致 404', project_id: 'P1',
        category: 'insight', source_agent: 'mcp-test',
      },
    });
    expect(r.error).toBeUndefined();
    const out = r.result as { mem_id: string; replayed_pending?: number; status?: string };
    expect(out.status).toBeUndefined();
    expect(out.mem_id).toMatch(/^mem_/);
    expect(out.replayed_pending).toBe(2);

    const mems = await storage.listMemories({});
    const contents = mems.map((m) => m.content);
    expect(contents).toContain('项目 P1 决策：本地持久化 pending 队列按 created_at 升序逐条重放，锁定态不落明文');
    expect(contents).toContain('运维手册补充：PostgreSQL 17 的 WAL 归档窗口设为 15 分钟，超过即清理旧日志');
    expect(contents).toContain('前端约定：所有入口 HTML 文件名一律小写，避免 Linux CI 上大小写错位导致 404');
    expect((await status(906)).result).toEqual({ l0_unlocked: true, writeDek_present: true, pending_count: 0 });
  });
});

// 批次44-D5-1：list_memories / get_memory（TCP 端到端，与 HTTP 共用 mcpReadTools）
describe('批次44-D5-1：list_memories / get_memory（TCP）', () => {
  let handle: McpServerHandle;
  let port = 0;
  let vault: L0Vault;
  const storage = new InMemoryStorage();
  const LONG_A = '项目 P1 决策：本地持久化 pending 队列按 created_at 升序逐条重放，锁定态不落明文';
  const LONG_B = '运维手册补充：PostgreSQL 17 的 WAL 归档窗口设为 15 分钟，超过即清理旧日志';

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpServer({ port: 0, storage, token: TOKEN, l0: vault });
    port = await handle.ready;
  });
  afterAll(() => { handle?.stop(); });

  const call = (id: number, method: string, params: Record<string, unknown> = {}) =>
    rpcCall(port, { jsonrpc: '2.0', id, method, params: { token: TOKEN, ...params } });

  it('tools/list 暴露 D5-1 新增的两个读工具（总数由主套件断言钉住）', async () => {
    const r = await call(950, 'tools/list');
    const names = (r.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_memories', 'get_memory']));
  });

  it('写入两条 → list_memories 盘点不泄 L0，get_memory 精确读', async () => {
    const w1 = await call(951, 'write_memory', {
      content: LONG_A, project_id: 'P1', category: 'fact', source_agent: 'mcp-test', tags: ['d5'],
    });
    const w2 = await call(952, 'write_memory', {
      content: LONG_B, project_id: 'P1', category: 'decision', source_agent: 'mcp-test',
    });
    const id1 = (w1.result as { mem_id: string }).mem_id;
    const id2 = (w2.result as { mem_id: string }).mem_id;
    expect(id1).toMatch(/^mem_/);
    expect(id2).toMatch(/^mem_/);

    const list = await call(953, 'list_memories', { project_id: 'P1' });
    const out = list.result as { ok: boolean; total: number; items: Array<Record<string, unknown>> };
    expect(out.ok).toBe(true);
    expect(out.total).toBe(2);
    expect(out.items.map((i) => i.mem_id)).toEqual(expect.arrayContaining([id1, id2]));
    for (const item of out.items) {
      expect(item).not.toHaveProperty('content_l0_enc');
      expect(item).not.toHaveProperty('content_orig');
    }

    const one = await call(954, 'get_memory', { mem_id: id1 });
    const got = one.result as { ok: boolean; item: Record<string, unknown> };
    expect(got.ok).toBe(true);
    expect(got.item.mem_id).toBe(id1);
    expect(got.item).not.toHaveProperty('content_l0_enc');
  });

  it('category 过滤 / 不存在回执 / 非法参数', async () => {
    const byCat = await call(955, 'list_memories', { project_id: 'P1', category: 'decision' });
    expect((byCat.result as { total: number }).total).toBe(1);
    const missing = await call(956, 'get_memory', { mem_id: 'mem_not_exist' });
    expect(missing.result).toEqual({ ok: false, item: null, reason: '记忆不存在' });
    const bad = await call(957, 'list_memories', { project_id: 'P1', limit: 0 });
    expect(bad.error?.code).toBe(-32602);
  });

  it('受限令牌：显式越界项目 → -32602（不回显不可见项目）', async () => {
    const scoped = runMcpServer({
      port: 0, storage, token: TOKEN, l0: vault,
      account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', scope_project_ids: ['P1'] },
    });
    const p = await scoped.ready;
    try {
      const r = await rpcCall(p, {
        jsonrpc: '2.0', id: 958, method: 'list_memories',
        params: { token: TOKEN, project_id: 'P2' },
      });
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toContain('作用域');
    } finally {
      scoped.stop();
    }
  });
});

// 批次44-D5-2：feedback / manage_memory（TCP 端到端，与 HTTP 共用 mcpManageTools）
describe('批次44-D5-2：feedback / manage_memory（TCP）', () => {
  let handle: McpServerHandle;
  let port = 0;
  let vault: L0Vault;
  const storage = new InMemoryStorage();
  const LONG_A = '项目 P1 决策：MCP 反馈与生命周期治理统一转发内核 coreFeedback 与 coreMemoryOp，写审计并推进版本';

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    handle = runMcpServer({ port: 0, storage, token: TOKEN, l0: vault, allowDelete: true });
    port = await handle.ready;
  });
  afterAll(() => { handle?.stop(); });

  const call = (id: number, method: string, params: Record<string, unknown> = {}) =>
    rpcCall(port, { jsonrpc: '2.0', id, method, params: { token: TOKEN, ...params } });

  it('tools/list 暴露 D5-2 新增的两个治理工具（总数由主套件断言钉住）', async () => {
    const r = await call(970, 'tools/list');
    const names = (r.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['feedback', 'manage_memory']));
  });

  it('写入一条 → feedback confirm / reject / disputed 三档 trust_delta，回执不泄 L0', async () => {
    const w = await call(971, 'write_memory', {
      content: LONG_A, project_id: 'P1', category: 'fact', source_agent: 'mcp-test',
    });
    const id1 = (w.result as { mem_id: string }).mem_id;
    expect(id1).toMatch(/^mem_/);

    const c = await call(972, 'feedback', { mem_id: id1, verdict: 'confirm' });
    const cr = c.result as { ok: boolean; trust_delta: number; mem: Record<string, unknown> };
    expect(cr.ok).toBe(true);
    expect(cr.trust_delta).toBe(0.1);
    expect(cr.mem.confidence).toBeCloseTo(0.6);
    expect(cr.mem.reinforce_count).toBe(1);
    expect(cr.mem).not.toHaveProperty('content_l0_enc');
    expect(cr.mem).not.toHaveProperty('content_orig');

    const rj = await call(973, 'feedback', { mem_id: id1, verdict: 'reject' });
    expect((rj.result as { trust_delta: number }).trust_delta).toBe(-0.05);

    const dp = await call(974, 'feedback', { mem_id: id1, verdict: 'disputed' });
    const dr = dp.result as { trust_delta: number; mem: Record<string, unknown> };
    expect(dr.trust_delta).toBe(0);
    expect(dr.mem.conflict_id).toMatch(/^cf_/);
  });

  it('manage_memory pin / archive / param 生效；非法 action 与 patch 误用 → -32602', async () => {
    const list = await call(975, 'list_memories', { project_id: 'P1' });
    const id1 = (list.result as { items: Array<{ mem_id: string }> }).items[0].mem_id;

    const pin = await call(976, 'manage_memory', { mem_id: id1, action: 'pin' });
    expect((pin.result as { ok: boolean; mem: { pinned: boolean } }).mem.pinned).toBe(true);
    expect((pin.result as { mem: Record<string, unknown> }).mem).not.toHaveProperty('content_l0_enc');

    const arc = await call(977, 'manage_memory', { mem_id: id1, action: 'archive' });
    expect((arc.result as { mem: { decay_class: string } }).mem.decay_class).toBe('archived');

    const prm = await call(978, 'manage_memory', {
      mem_id: id1, action: 'param', patch: { importance: 0.8 },
    });
    expect((prm.result as { mem: { importance: number } }).mem.importance).toBe(0.8);

    expect((await call(979, 'manage_memory', { mem_id: id1, action: 'bogus' })).error?.code).toBe(-32602);
    expect((await call(980, 'manage_memory', { mem_id: id1, action: 'pin', patch: { importance: 0.8 } })).error?.code).toBe(-32602);
    expect((await call(981, 'feedback', { mem_id: id1, verdict: 'bogus' })).error?.code).toBe(-32602);
  });

  it('G4：locked 仅 unlock 放行；不存在如实 ok:false', async () => {
    const w = await call(982, 'write_memory', {
      content: LONG_A + '（第二条用于锁定态校验）', project_id: 'P1', category: 'fact', source_agent: 'mcp-test',
    });
    const id2 = (w.result as { mem_id: string }).mem_id;
    expect((await call(983, 'manage_memory', { mem_id: id2, action: 'lock' })).result).toMatchObject({ ok: true });

    const blocked = await call(984, 'manage_memory', { mem_id: id2, action: 'archive' });
    expect(blocked.result).toMatchObject({ ok: false, blocked_locked: true });
    expect((blocked.result as { mem: { decay_class: string } }).mem.decay_class).not.toBe('archived');

    const unlocked = await call(985, 'manage_memory', { mem_id: id2, action: 'unlock' });
    expect((unlocked.result as { mem: { locked: boolean } }).mem.locked).toBe(false);

    const missing = await call(986, 'manage_memory', { mem_id: 'mem_not_exist', action: 'pin' });
    expect(missing.result).toMatchObject({ ok: false, mem: null });
  });

  it('delete 门禁：显式 allowDelete=true 才落墓碑；默认配置明确拒绝', async () => {
    const w = await call(987, 'write_memory', {
      content: LONG_A + '（第三条用于删除门禁校验）', project_id: 'P1', category: 'fact', source_agent: 'mcp-test',
    });
    const id3 = (w.result as { mem_id: string }).mem_id;

    const denied = runMcpServer({ port: 0, storage, token: TOKEN, l0: vault, allowDelete: false });
    const dp = await denied.ready;
    try {
      const r = await rpcCall(dp, {
        jsonrpc: '2.0', id: 988, method: 'manage_memory',
        params: { token: TOKEN, mem_id: id3, action: 'delete' },
      });
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toContain('MCP_ALLOW_DELETE');
    } finally {
      denied.stop();
    }

    const ok = await call(989, 'manage_memory', { mem_id: id3, action: 'delete' });
    expect(ok.result).toMatchObject({ ok: true, mem: null });
    const after = await call(990, 'get_memory', { mem_id: id3 });
    expect(after.result).toEqual({ ok: false, item: null, reason: '记忆不存在' });
  });

  it('受限令牌：按 mem_id 越界操作被拒，且不回显不可见项目 ID', async () => {
    await storage.putMemory({
      mem_id: 'mem_p2_d5_2', project_id: 'P2', enterprise_id: 'e1', team_id: 't1',
      category: 'fact', layer: 'L1', content: 'P2 正文', decay_class: 'hot',
      pinned: false, locked: false, version: 1, created_at: Date.now(),
    });
    const scoped = runMcpServer({
      port: 0, storage, token: TOKEN, l0: vault,
      account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', scope_project_ids: ['P1'] },
    });
    const p = await scoped.ready;
    try {
      for (const [method, params] of [
        ['feedback', { mem_id: 'mem_p2_d5_2', verdict: 'confirm' }],
        ['manage_memory', { mem_id: 'mem_p2_d5_2', action: 'pin' }],
      ] as Array<[string, Record<string, unknown>]>) {
        const r = await rpcCall(p, { jsonrpc: '2.0', id: 991, method, params: { token: TOKEN, ...params } });
        expect(r.error?.code).toBe(-32602);
        expect(r.error?.message).toContain('作用域');
        expect(r.error?.message).not.toContain('P2');
      }
      expect((await storage.getMemory('mem_p2_d5_2'))?.pinned).toBe(false);
    } finally {
      scoped.stop();
    }
  });
});

// 批次44-D5-3：gc_report（TCP 端到端，与 HTTP 共用 mcpGcTools）
describe('批次44-D5-3：gc_report（TCP）', () => {
  let handle: McpServerHandle;
  let port = 0;
  let vault: L0Vault;
  const storage = new InMemoryStorage();
  const DAY = 24 * 3600 * 1000;

  beforeAll(async () => {
    vault = (await createTestVault()).vault;
    // 直接放一条 hot 且超过 3 天的旧记忆（write_memory 的 created_at 是当下，不会触发衰减）
    await storage.putMemory({
      mem_id: 'mem_gc_old', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'context', layer: 'L1', content: '待衰减的旧上下文', decay_class: 'hot',
      pinned: false, locked: false, version: 1, half_life_days: 30,
      created_at: Date.now() - 4 * DAY,
    });
    handle = runMcpServer({ port: 0, storage, token: TOKEN, l0: vault });
    port = await handle.ready;
  });
  afterAll(() => { handle?.stop(); });

  const call = (id: number, method: string, params: Record<string, unknown> = {}) =>
    rpcCall(port, { jsonrpc: '2.0', id, method, params: { token: TOKEN, ...params } });

  it('tools/list 暴露 10 个工具，gc_report schema 要求 project_id', async () => {
    const r = await call(1000, 'tools/list');
    const tools = (r.result as {
      tools: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } }>;
    }).tools;
    expect(tools.map((t) => t.name)).toHaveLength(10); // 46-4 仍是 10 个工具，只改 schema
    const gc = tools.find((t) => t.name === 'gc_report')!;
    expect(gc.inputSchema!.required).toEqual(['project_id']);
    expect(gc.inputSchema!.properties).toHaveProperty('resolve_conflicts');
    expect(gc.inputSchema!.properties).toHaveProperty('verdict');
  });

  it('缺省 dry_run=true → 只演算：报 decayed=1，但记忆未降档、未写审计', async () => {
    const r = await call(1001, 'gc_report', { project_id: 'P1' });
    const out = r.result as {
      ok: boolean; dry_run: boolean; report: Record<string, unknown>;
      audit_written: boolean; note: string;
    };
    expect(out.ok).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(out.report.decayed).toBe(1);
    expect(out.audit_written).toBe(false);
    expect((await storage.getMemory('mem_gc_old'))?.decay_class).toBe('hot');
    expect((await storage.getMemory('mem_gc_old'))?.version).toBe(1);
    expect(await storage.queryAudit({})).toHaveLength(0);
  });

  it('显式 dry_run=false → 真实降档 + audit_written=true；再演算 decayed=0', async () => {
    const r = await call(1002, 'gc_report', { project_id: 'P1', dry_run: false });
    const out = r.result as { dry_run: boolean; report: { decayed: number }; audit_written: boolean };
    expect(out.dry_run).toBe(false);
    expect(out.report.decayed).toBe(1);
    expect(out.audit_written).toBe(true);
    expect((await storage.getMemory('mem_gc_old'))?.decay_class).toBe('warm');
    expect((await storage.getMemory('mem_gc_old'))?.version).toBe(2);
    expect(await storage.queryAudit({})).toHaveLength(1);

    const again = await call(1003, 'gc_report', { project_id: 'P1' });
    expect((again.result as { report: { decayed: number } }).report.decayed).toBe(0);
    expect(await storage.queryAudit({})).toHaveLength(1); // 演算未再写审计
  });

  it('46-4 报告字段对齐 + note 分层说明，不伪造摘要类统计', async () => {
    const r = await call(1004, 'gc_report', { project_id: 'P1' });
    const out = r.result as { report: Record<string, unknown>; note: string };
    expect(Object.keys(out.report)).toEqual([
      'decayed', 'merged', 'conflicts_resolved',
      'freshness_updated', 'scanned', 'migrated',
      'summaries_created', 'summaries_filtered', 'merged_originals', 'compressed',
    ]);
    expect(out.report.scanned).toBe(out.report.freshness_updated);
    expect(out.report.decayed).toBe(out.report.migrated);
    expect(out.report.conflicts_resolved).toBe(0);
    expect(out.note).toContain('真实字段');
    expect(out.note).not.toContain('没有对应统计量');
  });

  it('非法参数 / 越界 / 裁决参数不完整 → -32602，且不改库', async () => {
    const cases: Array<Record<string, unknown>> = [
      {}, { project_id: '' }, { project_id: 'P1', dry_run: 'true' },
      { project_id: 'P1', dry_run: 1 }, { project_id: 'P1', resolve_conflicts: true },
      { project_id: 'P2' },
    ];
    for (const params of cases) {
      const r = await call(1005, 'gc_report', params);
      // 默认 scope='*' 下 P2 合法（只是空项目）；单独用受限令牌另测越界
      if (params.project_id === 'P2') {
        expect(r.error).toBeUndefined();
        expect((r.result as { report: { decayed: number } }).report.decayed).toBe(0);
      } else {
        expect(r.error?.code).toBe(-32602);
      }
    }
    expect((await storage.getMemory('mem_gc_old'))?.decay_class).toBe('warm'); // 未被误改
  });

  it('受限令牌：越界项目 → -32602（不越界演算）', async () => {
    const scoped = runMcpServer({
      port: 0, storage, token: TOKEN, l0: vault,
      account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', scope_project_ids: ['P1'] },
    });
    const p = await scoped.ready;
    try {
      const r = await rpcCall(p, {
        jsonrpc: '2.0', id: 1006, method: 'gc_report',
        params: { token: TOKEN, project_id: 'P2' },
      });
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toContain('作用域');
    } finally {
      scoped.stop();
    }
  });

  // 批次46-4：TCP 端到端完整链路（tools/call gc_report → 内核裁决 → 存储/审计）
  it('46-4 端到端：resolve_conflicts+verdict 真实落定，旧行归档 + 成对审计', async () => {
    const now = Date.now();
    const base = {
      project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'context', layer: 'L1', decay_class: 'hot',
      pinned: false, locked: false, version: 1, conflict_id: 'cf_tcp',
    } as const;
    await storage.putMemory({
      ...base, mem_id: 'cf_tcp_old', content: '部署脚本必须校验 Redis 连接',
      confidence: 0.5, created_at: now - 2 * DAY,
    });
    await storage.putMemory({
      ...base, mem_id: 'cf_tcp_new', content: '部署脚本必须校验 TLS 证书',
      confidence: 0.6, created_at: now - DAY,
    });
    const beforeAudits = (await storage.queryAudit({})).length;

    const r = await call(1007, 'gc_report', {
      project_id: 'P1', dry_run: false, resolve_conflicts: true, verdict: 'auto_override',
    });
    const out = r.result as {
      report: { conflicts_resolved: number };
      conflict_resolution: { requested: boolean; verdict: string; resolved: number };
    };
    expect(out.report.conflicts_resolved).toBe(1);
    expect(out.conflict_resolution).toEqual({ requested: true, verdict: 'auto_override', resolved: 1 });
    expect((await storage.getMemory('cf_tcp_old'))?.decay_class).toBe('archived');
    expect((await storage.getMemory('cf_tcp_new'))?.confidence).toBeCloseTo(0.7, 5);
    const audits = await storage.queryAudit({ action: 'conflict_resolve' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      old_id: 'cf_tcp_old', new_id: 'cf_tcp_new', verdict: 'auto_override', pending: false,
    });
    expect((await storage.queryAudit({})).length).toBeGreaterThan(beforeAudits);
  });

  it('46-4 端到端：dry_run=true 带裁决 → 零写入、零审计、resolved=0', async () => {
    const now = Date.now();
    const base = {
      project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
      category: 'context', layer: 'L1', decay_class: 'hot',
      pinned: false, locked: false, version: 1, conflict_id: 'cf_tcp_dry',
    } as const;
    await storage.putMemory({ ...base, mem_id: 'cf_tcp_dry_old', content: '另一条冲突旧文', created_at: now - 2 * DAY });
    await storage.putMemory({ ...base, mem_id: 'cf_tcp_dry_new', content: '另一条冲突新文', created_at: now - DAY });
    const before = (await storage.listMemories({})).map((m) => ({ ...m }));
    const beforeAudits = (await storage.queryAudit({})).length;

    const r = await call(1008, 'gc_report', {
      project_id: 'P1', resolve_conflicts: true, verdict: 'auto_override',
    });
    const out = r.result as {
      dry_run: boolean; audit_written: boolean; report: { conflicts_resolved: number };
    };
    expect(out.dry_run).toBe(true);
    expect(out.report.conflicts_resolved).toBe(0);
    expect(out.audit_written).toBe(false);
    expect((await storage.listMemories({})).map((m) => ({ ...m }))).toEqual(before);
    expect((await storage.queryAudit({})).length).toBe(beforeAudits);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('批次44-D5-4：recall_memory(scope=session)（TCP 8202 端到端）', () => {
  let handle: McpServerHandle;
  let port = 0;
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
    // 显式 created_at → 倒序结果确定；两条本会话、一条别会话、一条无 session_id 历史行、一条冷背景
    await storage.putMemory(seedMem({ mem_id: 's_old', session_id: 'S-E2E', created_at: 100, content: '会话决策一：把会话工作记忆按会话标识精确过滤' }));
    await storage.putMemory(seedMem({ mem_id: 's_new', session_id: 'S-E2E', created_at: 300, content: '会话决策二：倒序取最近若干条，不做语义相关度计算' }));
    await storage.putMemory(seedMem({ mem_id: 's_mid', session_id: 'S-E2E', created_at: 200, content: '会话决策三：仍受项目作用域与预算硬熔断约束' }));
    await storage.putMemory(seedMem({ mem_id: 's_other', session_id: 'S-OTHER', created_at: 400, content: '别的会话：不应出现在本次会话工作记忆视图里' }));
    await storage.putMemory(seedMem({ mem_id: 's_legacy', created_at: 500, content: '历史行没有会话标识：不进任何会话视图，也不能拿时间冒充' }));
    await storage.putMemory(seedMem({ mem_id: 's_bg', decay_class: 'cold', created_at: 600, content: '冷背景候选：项目召回仍走背景通道，会话视图不注入' }));
    handle = runMcpServer({ port: 0, storage, token: TOKEN, l0: vault });
    port = await handle.ready;
  });
  afterAll(() => { handle?.stop(); });

  const call = (id: number, method: string, params: Record<string, unknown> = {}) =>
    rpcCall(port, { jsonrpc: '2.0', id, method, params: { token: TOKEN, ...params } });

  it('tools/list：recall_memory 增 scope/session_id；initialize 指令点名会话视图', async () => {
    const list = await call(1100, 'tools/list');
    const tools = (list.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> }).tools;
    expect(tools.map((t) => t.name)).toHaveLength(10); // 参数变体，不新增 tools/list 条目
    const props = tools.find((t) => t.name === 'recall_memory')!.inputSchema.properties;
    expect(props).toHaveProperty('scope');
    expect(props).toHaveProperty('session_id');
    expect(tools.find((t) => t.name === 'write_memory')!.inputSchema.properties).toHaveProperty('session_id');
    const init = await call(1101, 'initialize');
    expect((init.result as { instructions: string }).instructions).toContain("scope='session'");
  });

  it('B 效果验证：write_memory 带 session_id → 真落库，且随即能被会话视图召回', async () => {
    const w = await call(1102, 'write_memory', {
      project_id: 'P1', category: 'decision', source_agent: 'workbuddy', session_id: 'S-WRITE',
      content: '端到端写入验证：会话工作记忆由 write_memory 的会话标识落库，随后 recall_memory 用同一标识取回，这条内容足够长以通过质量门',
    });
    expect(w.error).toBeUndefined();
    const memId = (w.result as { mem_id: string }).mem_id;
    expect(memId).toBeTruthy();
    expect((await storage.getMemory(memId))?.session_id).toBe('S-WRITE');

    const r = await call(1103, 'recall_memory', {
      project_id: 'P1', query: '完全无关的检索词', scope: 'session', session_id: 'S-WRITE', top_k: 5,
    });
    expect(r.error).toBeUndefined();
    const out = r.result as { hits: Array<{ mem_id: string; score: number }>; background: { items: unknown[] } };
    expect(out.hits.map((h) => h.mem_id)).toEqual([memId]); // 查询词无关也照回：真不走向量
    expect(out.hits[0].score).toBe(0); // 未计算相关度，0 是诚实值
    expect(out.background.items).toHaveLength(0);
  });

  it('B 效果验证：会话视图按 created_at 倒序 + top_k 截断，别会话/历史行一律不混入', async () => {
    const r = await call(1104, 'recall_memory', {
      project_id: 'P1', query: '任意', scope: 'session', session_id: 'S-E2E', top_k: 2,
    });
    expect(r.error).toBeUndefined();
    const out = r.result as {
      hits: Array<{ mem_id: string }>; scanned_memories: number;
      background: { items: unknown[]; candidates: number }; display: { line: string; markdown: string };
    };
    expect(out.hits.map((h) => h.mem_id)).toEqual(['s_new', 's_mid']);
    expect(out.scanned_memories).toBe(3);
    expect(out.background.candidates).toBe(0); // 会话视图不注入项目背景
    expect(out.display.line).toContain('🧠 Memory'); // 回显档位仍按既有逻辑组装
    expect(out.display.markdown).toBeTruthy();
  });

  it('A 回归：不带 scope 仍走项目语义召回，背景通道与历史行可见性不变', async () => {
    // top_k=10 让全部 hot 候选都进命中（默认 5 时，write_memory 那条带 embedding 会按分数挤掉一条 0 分种子行，
    // 那是既有打分行为，不是会话分支造成的）；冷候选仍留在背景池，可验证背景通道未被改掉。
    const r = await call(1105, 'recall_memory', { project_id: 'P1', query: '会话决策', top_k: 10 });
    expect(r.error).toBeUndefined();
    const out = r.result as {
      hits: Array<{ mem_id: string }>; background: { candidates: number }; mode: string;
    };
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits.some((h) => h.mem_id === 's_legacy')).toBe(true);  // 项目视图可见无 session_id 的历史行
    expect(out.hits.some((h) => h.mem_id === 's_other')).toBe(true);   // 也可见别会话行
    expect(out.background.candidates).toBeGreaterThan(0);
    expect(out.mode).toBe('auto');
  });

  it('C2 输入变异：缺 session_id / 空串 / 非法 scope / top_k 越界 → -32602', async () => {
    const cases: Array<Record<string, unknown>> = [
      { project_id: 'P1', query: 'q', scope: 'session' },
      { project_id: 'P1', query: 'q', scope: 'session', session_id: '' },
      { project_id: 'P1', query: 'q', scope: 'bogus', session_id: 'S-E2E' },
      { project_id: 'P1', query: 'q', scope: 'session', session_id: 'S-E2E', top_k: 0 },
      { project_id: 'P1', query: 'q', scope: 'session', session_id: 'S-E2E', top_k: 11 },
    ];
    for (const params of cases) {
      const r = await call(1106, 'recall_memory', params);
      expect(r.error?.code).toBe(-32602);
    }
  });

  it('受限令牌：会话视图不绕过项目作用域 → -32602', async () => {
    const scoped = runMcpServer({
      port: 0, storage, token: TOKEN, l0: vault,
      account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1', scope_project_ids: ['P1'] },
    });
    const p = await scoped.ready;
    try {
      const r = await rpcCall(p, {
        jsonrpc: '2.0', id: 1107, method: 'recall_memory',
        params: { token: TOKEN, project_id: 'P2', query: 'q', scope: 'session', session_id: 'S-E2E' },
      });
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toContain('作用域');
    } finally {
      scoped.stop();
    }
  });
});
