// MCP 工具服务契约测试（§19.5）：三工具 schema + 参数校验 + 阶梯精炼管道 + 批次2 信任边界
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createConnection } from 'node:net';
import { runMcpServer, type McpServerHandle } from '../mcp.ts';
import { InMemoryStorage } from '../storage.ts';
import { scoreMemory } from '../forgetting.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault, TEST_ADMIN_PW, TEST_ADMIN_ID } from './l0Kit.ts';
import { MemoryPendingStore } from '../pendingWrites.ts';

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

  it('tools/list 返回五个工具且 schema 正确', async () => {
    const r = await rpcCall(PORT, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { token: TOKEN } });
    const tools = (r.result as { tools: Array<{ name: string; inputSchema?: { required?: string[] } }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'recall_memory', 'write_memory', 'list_projects', 'get_preferences', 'get_write_status',
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
