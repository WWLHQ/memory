// C 方案：MCP 内核「严格首步召回门禁」回归（HTTP 8204）。
// 三道闸门 A：默认关闭时与批次47 逐字一致（读类只软提醒、写类硬拦、无会话头不硬拦）；
// B：严格开启后断言「读类工具真的被拦 + 召回后真的放行」，以及 initialize/tools/list 真的同步声明；
// C：变异验证见任务收尾（把 strictGate 判定改坏 → 指定用例红灯 → 还原复绿）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMcpHttpServer, type McpHttpHandle } from '../mcpHttp.ts';
import { InMemoryStorage } from '../storage.ts';
import { createTestVault } from './l0Kit.ts';
import { RECALL_GATE_STRICT_TOOL_NOTE } from '../mcpSchema.ts';

const TOKEN = 'strict-gate-test-token-0123456789';

async function makeServer(strictRecallGate: boolean) {
  const storage = new InMemoryStorage();
  const { vault } = await createTestVault();
  const handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault, strictRecallGate });
  const url = `http://127.0.0.1:${await handle.ready}/mcp`;
  return { handle, url, storage };
}

interface RpcResult {
  result: {
    isError?: boolean;
    content: Array<{ text: string }>;
    instructions?: string;
    tools?: Array<{ name: string; description: string }>;
    structuredContent?: Record<string, unknown>;
  };
}

async function rpc(url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...payload }),
  });
  const sid = res.headers.get('mcp-session-id') || '';
  return { body: (await res.json()) as RpcResult, sid };
}

const INIT = { method: 'initialize', params: { clientInfo: { name: 'strict-test', version: '1.0' } } };
const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ method: 'tools/call', params: { name, arguments: args } });

describe('C：严格门禁默认关闭 → 批次47 既有行为逐字不变', () => {
  let handle: McpHttpHandle;
  let url = '';

  beforeAll(async () => {
    const s = await makeServer(false);
    handle = s.handle; url = s.url;
    await rpc(url, call('create_project', { project_id: 'P1', kind: 'general', display_name: '严格门禁测试项目' }));
  });
  afterAll(() => { handle?.stop(); });

  it('未召回：读类工具不拦截，只追加软提醒', async () => {
    const { sid } = await rpc(url, INIT);
    const { body } = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(body.result.isError).toBe(false);
    expect(body.result.content.map((c) => c.text).join('\n')).toContain('⚠️ 本会话尚未调用 recall_memory');
    expect(body.result.content.map((c) => c.text).join('\n')).not.toContain('⛔');
  });

  it('未召回：写入类工具仍按批次47 硬拦，且文案是旧文案', async () => {
    const { sid } = await rpc(url, INIT);
    const { body } = await rpc(url, call('write_memory', { content: '默认关闭时不该落库', project_id: 'P1', category: 'fact', source_agent: 'test' }), { 'Mcp-Session-Id': sid });
    expect(body.result.isError).toBe(true);
    const text = body.result.content[0].text;
    expect(text).toContain('⛔');
    expect(text).toContain('写入与治理类工具');
    expect(text).not.toContain('所有工具均已锁定');
  });

  it('无会话头（不可靠会话）：不硬拦，防跨客户端串号误杀', async () => {
    const { body } = await rpc(url, call('list_projects'));
    expect(body.result.isError).toBe(false);
  });

  it('initialize.instructions 与 tools/list 不含严格门禁声明', async () => {
    const init = await rpc(url, INIT);
    expect(init.body.result.instructions).not.toContain('严格首步召回门禁');
    const list = await rpc(url, { method: 'tools/list' });
    expect(list.body.result.tools!.every((t) => !t.description.includes(RECALL_GATE_STRICT_TOOL_NOTE))).toBe(true);
  });
});

describe('C：严格门禁开启 → 未召回时所有非 recall 工具都硬拦', () => {
  let handle: McpHttpHandle;
  let url = '';

  beforeAll(async () => {
    const s = await makeServer(true);
    handle = s.handle; url = s.url;
    await rpc(url, call('create_project', { project_id: 'P1', kind: 'general', display_name: '严格门禁测试项目' }));
  });
  afterAll(() => { handle?.stop(); });

  it('未召回：读类工具真的被硬拦（这是相对批次47 的实质变化）', async () => {
    const { sid } = await rpc(url, INIT);
    const { body } = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(body.result.isError).toBe(true);
    const text = body.result.content[0].text;
    expect(text).toContain('⛔');
    expect(text).toContain('所有工具均已锁定');
    expect(text).toContain('尚未调用 recall_memory');
  });

  it('未召回：写入类工具也被拦，且用严格文案', async () => {
    const { sid } = await rpc(url, INIT);
    const { body } = await rpc(url, call('write_memory', { content: '严格门禁前应被拒', project_id: 'P1', category: 'fact', source_agent: 'test' }), { 'Mcp-Session-Id': sid });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('所有工具均已锁定');
  });

  it('recall_memory 自身永远放行：否则会话永远无法解锁（防死锁）', async () => {
    const { sid } = await rpc(url, INIT);
    const { body } = await rpc(url, call('recall_memory', { project_id: 'P1', query: '任意关键词' }), { 'Mcp-Session-Id': sid });
    expect(body.result.isError).toBe(false);
  });

  it('先召回 → 同一会话读类与写入类都放行，软提醒消失', async () => {
    const { sid } = await rpc(url, INIT);
    await rpc(url, call('recall_memory', { project_id: 'P1', query: '任意关键词' }), { 'Mcp-Session-Id': sid });
    const ls = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(ls.body.result.isError).toBe(false);
    expect(ls.body.result.content.map((c) => c.text).join('\n')).not.toContain('⚠️ 本会话尚未调用 recall_memory');
    const w = await rpc(url, call('write_memory', { content: '严格门禁验证：先召回后写入一条足够长的记忆，确认放行路径真实落库且软提醒消失', project_id: 'P1', category: 'fact', source_agent: 'test' }), { 'Mcp-Session-Id': sid });
    expect(w.body.result.isError).toBe(false);
    expect((w.body.result.structuredContent as { mem_id: string }).mem_id).toMatch(/^mem_/);
  });

  it('门禁按会话隔离：A 会话没召回不影响 B 会话已召回', async () => {
    const a = await rpc(url, INIT);
    const b = await rpc(url, INIT);
    await rpc(url, call('recall_memory', { project_id: 'P1', query: '任意关键词' }), { 'Mcp-Session-Id': b.sid });
    const blocked = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': a.sid });
    expect(blocked.body.result.isError).toBe(true);
    const allowed = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': b.sid });
    expect(allowed.body.result.isError).toBe(false);
  });

  it('无会话头（不可靠会话）仍不硬拦，严格模式也不误杀', async () => {
    const { body } = await rpc(url, call('list_projects'));
    expect(body.result.isError).toBe(false);
    expect(body.result.content.map((c) => c.text).join('\n')).not.toContain('所有工具均已锁定');
  });

  it('initialize.instructions 与 tools/list 同步声明严格门禁', async () => {
    const init = await rpc(url, INIT);
    expect(init.body.result.instructions).toContain('严格首步召回门禁');
    expect(init.body.result.instructions).toContain('所有');
    const list = await rpc(url, { method: 'tools/list' });
    const tools = list.body.result.tools!;
    expect(tools.find((t) => t.name === 'list_projects')!.description).toContain(RECALL_GATE_STRICT_TOOL_NOTE);
    // recall 自身不加「会被硬拦」后缀（它是解锁入口，不是被拦对象）
    expect(tools.find((t) => t.name === 'recall_memory')!.description).not.toContain(RECALL_GATE_STRICT_TOOL_NOTE);
  });
});

describe('C：请求头可单独声明严格门禁（服务端全局关闭时）', () => {
  let handle: McpHttpHandle;
  let url = '';

  beforeAll(async () => {
    const s = await makeServer(false);
    handle = s.handle; url = s.url;
  });
  afterAll(() => { handle?.stop(); });

  it('x-memagent-recall-gate: strict → 该次调用读类被硬拦', async () => {
    const { sid } = await rpc(url, INIT);
    const { body } = await rpc(url, call('list_projects'), {
      'Mcp-Session-Id': sid, 'x-memagent-recall-gate': 'strict',
    });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('所有工具均已锁定');
  });

  it('不带该头 / 值非法 → 保持旧行为（只软提醒）', async () => {
    const { sid } = await rpc(url, INIT);
    const plain = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(plain.body.result.isError).toBe(false);
    const bad = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid, 'x-memagent-recall-gate': 'off' });
    expect(bad.body.result.isError).toBe(false);
  });
});

// 批次62 UI 开关：全局门禁从「启动常量」改成「每请求求值函数」，
// 界面切换必须即时生效（不需要重启进程）。这条用例就是那个承诺的可执行版本。
describe('C：全局门禁支持运行时 getter（UI 开关切换即时生效）', () => {
  let handle: McpHttpHandle | null = null;
  let url = '';
  let gate = false;

  beforeAll(async () => {
    const storage = new InMemoryStorage();
    const { vault } = await createTestVault();
    handle = runMcpHttpServer({ port: 0, token: TOKEN, storage, l0: vault, strictRecallGate: () => gate });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
  });
  afterAll(() => { handle?.stop(); });

  it('同一进程内关→开→关：每次 tools/call 都按当时的值判定', async () => {
    gate = false;
    const off1 = await rpc(url, INIT);
    const r1 = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': off1.sid });
    expect(r1.body.result.isError).toBe(false);

    gate = true;
    const on = await rpc(url, INIT);
    const r2 = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': on.sid });
    expect(r2.body.result.isError).toBe(true);
    expect(r2.body.result.content[0].text).toContain('所有工具均已锁定');

    gate = false;
    const off2 = await rpc(url, INIT);
    const r3 = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': off2.sid });
    expect(r3.body.result.isError).toBe(false);
  });

  it('getter 为真时 initialize.instructions 也同步声明严格口径', async () => {
    gate = true;
    const { body } = await rpc(url, INIT);
    expect(body.result.instructions).toContain('严格首步召回门禁');
  });
});

// ── 第四层（2026-11-17 用户明确）：轮级放行 ──────────────────────────────
// 真问题：`recalledBySession` 是**会话级**——一次召回把整个会话解锁，之后每一轮都放行，
// 硬拦截形同虚设。改判「轮」：召回时间必须晚于「钩子账本里最近一轮」的起点。
// 这里注入 latestRoundAt 桩（不读真实用户账本，否则用例会随本机钩子跑动而飘）。
describe('第四层：轮级放行（按钩子账本最近一轮判定）', () => {
  let handle: McpHttpHandle | null = null;
  let url = '';
  let storage: InMemoryStorage;
  let roundAt: number | null = null;
  const tick = () => new Promise<void>((ok) => setTimeout(ok, 5));

  beforeAll(async () => {
    storage = new InMemoryStorage();
    const { vault } = await createTestVault();
    handle = runMcpHttpServer({
      port: 0, token: TOKEN, storage, l0: vault,
      strictRecallGate: true,
      roundScopedRecall: true,
      latestRoundAt: async () => roundAt,
    });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
    // 无会话头 → 不可靠会话不硬拦，用来准备项目数据
    await rpc(url, call('create_project', { project_id: 'P1', kind: 'general', display_name: '轮级测试项目' }));
  });
  afterAll(() => { handle?.stop(); });

  it('同一轮内召回后放行；账本出现新的一轮后，同一会话照样被拦回', async () => {
    const { sid } = await rpc(url, INIT);
    roundAt = Date.now() - 60_000;             // 上一轮是一分钟前
    await rpc(url, call('recall_memory', { project_id: 'P1', query: '关键词甲' }), { 'Mcp-Session-Id': sid });
    const allowed = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(allowed.body.result.isError).toBe(false);

    // 用户又提了新问题：钩子追加一行 → 账本最近一轮比刚才那次召回更晚
    await tick();
    roundAt = Date.now();
    const blocked = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(blocked.body.result.isError).toBe(true);
    const text = blocked.body.result.content[0].text;
    expect(text).toContain('本轮');
    // 关键：不能继续说「本会话尚未调用」（上一轮明明查过）——文案要区分「没查」与「这轮没查」
    expect(text).not.toContain('本会话尚未调用');

    // 本轮再召回 → 放行
    await tick();
    await rpc(url, call('recall_memory', { project_id: 'P1', query: '关键词乙' }), { 'Mcp-Session-Id': sid });
    const again = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(again.body.result.isError).toBe(false);
  });

  it('账本读不到（钩子没装）→ 退回会话级：召回过就放行，不会把工具全锁死', async () => {
    roundAt = null;
    const { sid } = await rpc(url, INIT);
    const before = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(before.body.result.isError).toBe(true);          // 没召回仍然拦（会话级底线还在）
    await rpc(url, call('recall_memory', { project_id: 'P1', query: '关键词丙' }), { 'Mcp-Session-Id': sid });
    const after = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(after.body.result.isError).toBe(false);
  });

  it('审计留下本轮判定依据（round_scoped + round_at），事后能分清按哪套口径判的', async () => {
    roundAt = 1_700_000_000_000;
    const { sid } = await rpc(url, INIT);
    await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    const rows = await storage.queryAudit({ action: 'mcp_call' });
    const hit = rows.filter((r) => {
      const d = r.detail as { session_id?: string; tool?: string; round_scoped?: boolean };
      return d.session_id === sid && d.tool === 'list_projects' && d.round_scoped === true;
    });
    expect(hit.length).toBeGreaterThan(0);
    const detail = hit[hit.length - 1].detail as { round_at?: number; recall_at?: number | null };
    expect(detail.round_at).toBe(1_700_000_000_000);
    expect(detail.recall_at).toBeNull();
  });
});

// 默认关闭时绝对不能有轮级行为：这是「不打破既有客户端」的底线。
describe('第四层：未开启 roundScopedRecall 时仍按会话级判（默认零变化）', () => {
  let handle: McpHttpHandle | null = null;
  let url = '';
  let roundAt: number | null = null;

  beforeAll(async () => {
    const storage = new InMemoryStorage();
    const { vault } = await createTestVault();
    handle = runMcpHttpServer({
      port: 0, token: TOKEN, storage, l0: vault,
      strictRecallGate: true,
      latestRoundAt: async () => roundAt,   // 账本一直在推新，但没开轮级 → 不该影响判定
    });
    url = `http://127.0.0.1:${await handle.ready}/mcp`;
    await rpc(url, call('create_project', { project_id: 'P1', kind: 'general', display_name: '会话级测试项目' }));
  });
  afterAll(() => { handle?.stop(); });

  it('召回过一次之后，即使账本已有更新的一轮，仍然放行', async () => {
    const { sid } = await rpc(url, INIT);
    roundAt = Date.now() - 60_000;
    await rpc(url, call('recall_memory', { project_id: 'P1', query: '关键词丁' }), { 'Mcp-Session-Id': sid });
    roundAt = Date.now() + 60_000;   // 故意把账本推到未来：会话级判定下不应有任何影响
    const ok = await rpc(url, call('list_projects'), { 'Mcp-Session-Id': sid });
    expect(ok.body.result.isError).toBe(false);
  });
});
