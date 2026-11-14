// 会话自动采集器单测：Claude JSONL / workbuddy Markdown 解析 + 增量 + 幂等 + 周期对账（§5.1）
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { zstdCompressSync } from 'node:zlib';
import {
  parseClaudeJsonl,
  parseWorkbuddyMd,
  scanSessionLogs,
  createReconciler,
  applyScanToStore,
  defaultAgentSources,
  type CollectorCursor,
  type SessionLogSource,
  type ReconcileOptions,
  stripPluginInjection,
  isPluginInjected,
} from '../sessionCollector.ts';
import { MemAgentError } from '../errors.ts';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── Claude JSONL 解析器 ───────────────────────────────────────────────────────

describe('parseClaudeJsonl', () => {
  it('user 纯文本 → 1 条 user 消息', () => {
    const line = JSON.stringify({
      type: 'user', message: { role: 'user', content: '帮我装个技能' },
      sessionId: 's1', timestamp: '2026-09-25T13:54:37.721Z',
    });
    const out = parseClaudeJsonl(line);
    expect(out).toEqual([
      { role: 'user', content: '帮我装个技能', ts: Date.parse('2026-09-25T13:54:37.721Z'), session_id: 's1', seq: undefined },
    ]);
  });

  it('assistant 取 text 块，跳过 thinking/tool_result', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '内部推理' },
          { type: 'text', text: '我先看一下目录' },
          { type: 'tool_result', content: 'x' },
        ],
      },
      sessionId: 's2', apiBlockIndex: 3,
    });
    const out = parseClaudeJsonl(line)!;
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('assistant');
    expect(out[0].content).toBe('我先看一下目录');
    expect(out[0].seq).toBe(3);
  });

  it('queue-operation / attachment / 坏行 → null', () => {
    expect(parseClaudeJsonl(JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'x' }))).toBeNull();
    expect(parseClaudeJsonl('{bad json')).toBeNull();
    expect(parseClaudeJsonl('')).toBeNull();
  });

  it('isMeta:true（斜杠命令回显/系统注入提醒）→ null（批次35：那不是用户说的话）', () => {
    const line = JSON.stringify({
      type: 'user', isMeta: true,
      message: { role: 'user', content: '<local-command-stdout>Done</local-command-stdout>' },
      sessionId: 's9',
    });
    expect(parseClaudeJsonl(line)).toBeNull();
  });

  it('assistant 无 text 块（纯 thinking）→ null（不采空）', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '想' }] },
    });
    expect(parseClaudeJsonl(line)).toBeNull();
  });
});

// ── workbuddy Markdown 解析器 ─────────────────────────────────────────────────

describe('parseWorkbuddyMd', () => {
  it('按 ## 分块，每块 = 标题 + 正文', () => {
    const md = [
      '# 2026-10-23 工作日志',
      '',
      '## 模型全量映射',
      '- 用户要求全量映射',
      '- config.mjs 改透传',
      '',
      '## 注意点（给用户）',
      '- 必须重开 Codex 才生效',
    ].join('\n');
    const out = parseWorkbuddyMd(md);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('assistant');
    expect(out[0].content).toContain('## 模型全量映射');
    expect(out[0].content).toContain('用户要求全量映射');
    expect(out[1].content).toContain('## 注意点（给用户）');
    expect(out[0].seq).toBe(0);
    expect(out[1].seq).toBe(1);
  });

  it('空文件 / 无 ## 块 → 空数组', () => {
    expect(parseWorkbuddyMd('')).toEqual([]);
    // 只有 # 一级标题，无 ## 块 → 不产事件（保守：避免把整个文件当一条）
    expect(parseWorkbuddyMd('# 单一级标题\n- 内容')).toEqual([]);
  });
});

// ── 增量扫描 + 幂等 ──────────────────────────────────────────────────────────

describe('scanSessionLogs（增量 + 幂等）', () => {
  it('首次全量采 Claude jsonl：批次35 起只采用户消息，助手消息在采集口挡下', async () => {
    const dir = tmpDir('col-claude-');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'a.jsonl'),
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'msg-1' }, sessionId: 's' }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'msg-2' }] }, sessionId: 's' }),
      ].join('\n') + '\n',
    );
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const scan1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(scan1.collected).toBe(1);
    expect(scan1.items.map((i) => i.content)).toEqual(['msg-1']);
    expect(scan1.items[0].role).toBe('user');
    expect(scan1.roleSkipped).toBe(1); // 助手正文没进库，是被采集口径挡掉的（不是丢失）

    // 显式放开角色白名单 → 两条都采（口径可回退，不是硬编码丢弃）
    const both = await scanSessionLogs({
      sources: [{ ...src, roles: ['user', 'assistant'] }], cursor: {}, seenHashes: new Set(),
    });
    expect(both.collected).toBe(2);

    // 第二次（无新内容 + seenHashes 兜底）→ 0 条
    const scan2 = await scanSessionLogs({ sources: [src], cursor: scan1.cursors, seenHashes: seen });
    expect(scan2.collected).toBe(0);
  });

  it('增量：追加新行只采新增（cursor offset 生效）', async () => {
    const dir = tmpDir('col-claude-inc-');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'b.jsonl');
    fs.writeFileSync(
      f,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'old-1' }, sessionId: 's' }),
      ].join('\n') + '\n',
    );
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(1); // old-1

    // 追加一条新消息
    fs.appendFileSync(f, JSON.stringify({ type: 'user', message: { role: 'user', content: 'new-2' }, sessionId: 's' }) + '\n');
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.collected).toBe(1);
    expect(s2.items[0].content).toBe('new-2');
  });

  it('幂等：同内容不同 cursor 也靠 seenHashes 去重', async () => {
    const dir = tmpDir('col-claude-dedup-');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'c.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'dup-msg' }, sessionId: 's' }) + '\n',
    );
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(1);
    // 模拟 cursor 丢失（全量重扫）但 seenHashes 保留 → dedup
    const s2 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s2.collected).toBe(0);
    expect(s2.deduped).toBe(1);
  });

  it('workbuddy md 文件指纹不变 → 不重复采', async () => {
    const dir = tmpDir('col-wb-');
    fs.mkdirSync(path.join(dir, 'proj', '.workbuddy', 'memory'), { recursive: true });
    const mf = path.join(dir, 'proj', '.workbuddy', 'memory', '2026-10-23.md');
    fs.writeFileSync(mf, '## 任务A\n- 内容甲\n');
    const src: SessionLogSource = { name: 'workbuddy', parser: 'workbuddy-md', dir, recursive: true, filePattern: /\.md$/, roles: ['assistant'] };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(1);
    // 文件无变化 → 第二次 0 条
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.collected).toBe(0);
  });

  it('目录不存在 → 诚实 skip（不造假）', async () => {
    const src: SessionLogSource = { name: 'ghost-agent', parser: 'claude-jsonl', dir: '/nonexistent/path/xyz' };
    const scan = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(scan.collected).toBe(0);
    expect(scan.skipped.some((s) => s.includes('目录不存在'))).toBe(true);
  });

  it('单文件超过上限 → 截断停在块边界，下轮续采不重不漏', async () => {
    const dir = tmpDir('col-wb-cap-');
    fs.mkdirSync(dir, { recursive: true });
    let md = '';
    for (let i = 0; i < 10; i++) md += `## 块${i}\n- 内容${i}\n`;
    fs.writeFileSync(path.join(dir, 'many.md'), md);
    const src: SessionLogSource = {
      name: 'workbuddy', parser: 'workbuddy-md', dir, recursive: true,
      filePattern: /\.md$/, maxMessagesPerFile: 5, roles: ['assistant'],
    };
    const seen = new Set<string>();
    const scan = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(scan.collected).toBe(5);
    expect(scan.skipped.some((s) => s.includes('超过单文件上限'))).toBe(true);
    // D4：游标记 msgIndex，下轮从第 6 块续采（不是重采前 5 块靠去重过滤）
    const scan2 = await scanSessionLogs({ sources: [src], cursor: scan.cursors, seenHashes: seen });
    expect(scan2.collected).toBe(5);
    expect(scan2.deduped).toBe(0);
    expect(scan2.items[0].content).toContain('内容5');
    const scan3 = await scanSessionLogs({ sources: [src], cursor: scan2.cursors, seenHashes: seen });
    expect(scan3.collected).toBe(0);
  });

  it('maxItemsPerRun 限流：游标停在行边界，下轮直接续采（无重复）', async () => {
    const dir = tmpDir('col-cap-run-');
    fs.mkdirSync(dir, { recursive: true });
    let jsonl = '';
    for (let i = 0; i < 30; i++) {
      jsonl += JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: `msg-${i}` } }) + '\n';
    }
    fs.writeFileSync(path.join(dir, 'cap.jsonl'), jsonl);
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();

    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen, maxItemsPerRun: 5 });
    expect(s1.items.length).toBe(5);
    expect(s1.collected).toBe(5);
    expect(s1.skipped.some((s) => s.includes('限流'))).toBe(true);

    // 第二轮：游标停在第 5 行行首 → 直接采 msg-5..msg-9，无 dedup 重读
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen, maxItemsPerRun: 5 });
    expect(s2.items.map((i) => i.content)).toEqual(['msg-5', 'msg-6', 'msg-7', 'msg-8', 'msg-9']);
    expect(s2.deduped).toBe(0);
  });
});

// ── 批次35：内置源的角色口径（缺省只采用户消息；workbuddy 是唯一显式例外） ──────

describe('defaultAgentSources 角色白名单（批次35）', () => {
  it('claude-code / deepseek-harness 不写 roles → 走缺省「只采 user」', async () => {
    const home = tmpDir('col-roles-');
    const srcs = defaultAgentSources({ home });
    expect(srcs.find((s) => s.name === 'claude-code')?.roles).toBeUndefined();
    expect(srcs.find((s) => s.name === 'deepseek-harness')?.roles).toBeUndefined();
    // 扩展 agent（Qoder CN / Cursor 等）同样是 claude-jsonl 形态 → 不声明 roles
    for (const s of srcs.filter((x) => x.parser === 'claude-jsonl')) {
      expect(s.roles, s.name).toBeUndefined();
    }
    // 缺省口径落到采集口：同一份日志只采到 user 行
    const dir = tmpDir('col-roles-scan-');
    fs.writeFileSync(path.join(dir, 'x.jsonl'), [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '用户提问' }, sessionId: 's' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '我先看一下目录' }] }, sessionId: 's' }),
    ].join('\n') + '\n');
    const scan = await scanSessionLogs({
      sources: [{ name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true }], cursor: {}, seenHashes: new Set(),
    });
    expect(scan.items.map((i) => i.content)).toEqual(['用户提问']);
    expect(scan.roleSkipped).toBe(1);
  });

  it('workbuddy 显式 roles:[assistant]（源里没有用户消息，按缺省口径会整体清零）', async () => {
    const home = tmpDir('col-roles-wb-');
    const wb = defaultAgentSources({ home }).find((s) => s.name === 'workbuddy');
    expect(wb?.roles).toEqual(['assistant']);
    // 反证：同一条源若不声明 roles，工作日志块一条也采不到
    const dir = tmpDir('col-roles-wb2-');
    fs.writeFileSync(path.join(dir, '2026-10-23.md'), '## 任务A\n- 内容甲\n');
    const base: SessionLogSource = { name: 'workbuddy', parser: 'workbuddy-md', dir, recursive: true, filePattern: /\.md$/ };
    expect((await scanSessionLogs({ sources: [base], cursor: {}, seenHashes: new Set() })).collected).toBe(0);
    expect((await scanSessionLogs({
      sources: [{ ...base, roles: ['assistant'] }], cursor: {}, seenHashes: new Set(),
    })).collected).toBe(1);
  });
});

// ── D4 字节游标回归：多字节内容 / 半行 / 截断重写 / zstd 尾帧 / 单文件限流续采 ──

describe('D4 字节游标与边界', () => {
  const jsonlMsg = (content: string): string =>
    JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content } }) + '\n';

  it('中文 JSONL：字节偏移正确，追加后只采新增（不错位/不丢）', async () => {
    const dir = tmpDir('col-d4-utf8-');
    const f = path.join(dir, 'zh.jsonl');
    fs.writeFileSync(f, jsonlMsg('第0条中文消息：多字节内容') + jsonlMsg('第1条中文消息：多字节内容'));
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(2);
    fs.appendFileSync(f, jsonlMsg('第2条中文消息：多字节内容'));
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.collected).toBe(1);
    expect(s2.deduped).toBe(0);
    expect(s2.items[0].content).toBe('第2条中文消息：多字节内容');
    expect(s2.cursors['claude-code:zh.jsonl'].offset).toBe(fs.statSync(f).size); // 字节口径
  });

  it('未写完的半行不采；补全后只采一次', async () => {
    const dir = tmpDir('col-d4-partial-');
    const f = path.join(dir, 'partial.jsonl');
    const full = jsonlMsg('完整行');
    const partial = JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: '半行补全' } });
    fs.writeFileSync(f, full + partial.slice(0, 15));
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.items.map((i) => i.content)).toEqual(['完整行']);
    fs.writeFileSync(f, full + partial + '\n');
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.items.map((i) => i.content)).toEqual(['半行补全']);
    const s3 = await scanSessionLogs({ sources: [src], cursor: s2.cursors, seenHashes: seen });
    expect(s3.collected).toBe(0);
  });

  it('同长度重写 → 前缀指纹不一致 → 重置并重采', async () => {
    const dir = tmpDir('col-d4-rewrite-');
    const f = path.join(dir, 'rw.jsonl');
    fs.writeFileSync(f, jsonlMsg('AAAA'));
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(1);
    fs.writeFileSync(f, jsonlMsg('BBBB')); // 长度相同、内容不同
    expect(fs.statSync(f).size).toBe(s1.cursors['claude-code:rw.jsonl'].offset);
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.skipped.some((s) => s.includes('重写'))).toBe(true);
    expect(s2.items.map((i) => i.content)).toEqual(['BBBB']);
  });

  it('截断 → 重置游标并重采', async () => {
    const dir = tmpDir('col-d4-trunc-');
    const f = path.join(dir, 't.jsonl');
    fs.writeFileSync(f, jsonlMsg('c0') + jsonlMsg('c1') + jsonlMsg('c2'));
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(3);
    fs.writeFileSync(f, jsonlMsg('short'));
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.skipped.some((s) => s.includes('截断'))).toBe(true);
    expect(s2.items.map((i) => i.content)).toEqual(['short']);
  });

  it('zstd 尾部不完整 frame → 游标停在帧首，补全后只采该帧', async () => {
    const dir = tmpDir('col-d4-zstd-');
    const f = path.join(dir, 's.jsonl.zstd');
    const frame = (c: string) => zstdCompressSync(Buffer.from(jsonlMsg(c)));
    const f1 = frame('帧一');
    const f2 = frame('帧二');
    fs.writeFileSync(f, Buffer.concat([f1, f2.subarray(0, f2.length - 4)]));
    const src: SessionLogSource = { name: 'dsh', parser: 'dsh-zstd-jsonl', dir };
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(s1.items.map((i) => i.content)).toEqual(['帧一']);
    expect(s1.skipped.some((s) => s.includes('尾部 zstd frame 不完整'))).toBe(true);
    expect(s1.cursors['dsh:s.jsonl.zstd'].offset).toBe(f1.length); // 帧边界
    fs.writeFileSync(f, Buffer.concat([f1, f2]));
    const s2 = await scanSessionLogs({ sources: [src], cursor: s1.cursors, seenHashes: seen });
    expect(s2.items.map((i) => i.content)).toEqual(['帧二']);
  });

  it('旧版字符游标（无 v）→ 重置全量，避免多字节错位', async () => {
    const dir = tmpDir('col-d4-v1-');
    const f = path.join(dir, 'v1.jsonl');
    fs.writeFileSync(f, jsonlMsg('旧游标'));
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true };
    const s = await scanSessionLogs({
      sources: [src],
      cursor: { 'claude-code:v1.jsonl': { offset: 3, contentSha: '', lastRun: 0 } },
      seenHashes: new Set(),
    });
    expect(s.skipped.some((x) => x.includes('旧版字符偏移'))).toBe(true);
    expect(s.items.map((i) => i.content)).toEqual(['旧游标']);
  });

  it('JSONL 单文件限额：分批续采，最终恰好采满不重不漏', async () => {
    const dir = tmpDir('col-d4-fileCap-');
    const f = path.join(dir, 'cap.jsonl');
    let text = '';
    for (let i = 0; i < 10; i++) text += jsonlMsg(`c${i}`);
    fs.writeFileSync(f, text);
    const src: SessionLogSource = { name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true, maxMessagesPerFile: 3 };
    const seen = new Set<string>();
    const got: string[] = [];
    let cursor: CollectorCursor = {};
    for (let round = 0; round < 5; round++) {
      const s = await scanSessionLogs({ sources: [src], cursor, seenHashes: seen });
      got.push(...s.items.map((i) => i.content));
      cursor = s.cursors;
    }
    expect(got).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  });
});

// ── 周期对账器 ────────────────────────────────────────────────────────────────

describe('createReconciler（周期对账，预设 5min）', () => {
  it('默认周期 = 300000ms（§5.1 预设 5min）', () => {
    const r = createReconciler({
      source: { sources: [] },
      onScan: () => {},
      runOnStart: false,
    });
    expect(r.intervalMs).toBe(300_000);
    r.stop();
  });

  it('runOnce 手动触发一次 + 结果回传', async () => {
    const dir = tmpDir('col-recon-');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'x.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'recon-msg' }, sessionId: 's' }) + '\n',
    );
    let onScanCalls = 0;
    const seen = new Set<string>();
    const r = createReconciler({
      source: { sources: [{ name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true }], cursor: {}, seenHashes: seen },
      onScan: (scan) => { onScanCalls++; for (const i of scan.items) seen.add(i.hash); },
      runOnStart: false,
      intervalMs: 60_000,
    });
    const out = await r.runOnce();
    expect(out.collected).toBe(1);
    expect(onScanCalls).toBe(1);
    r.stop();
  });

  it('注入 fake timer：到周期才自动跑', async () => {
    const dir = tmpDir('col-recon-timer-');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'y.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 't-msg' }, sessionId: 's' }) + '\n',
    );
    let fired = 0;
    const timers: { fn: () => void; ms: number }[] = [];
    const fakeTimer = {
      setInterval: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length - 1; },
      clearInterval: () => {},
    };
    const r = createReconciler({
      source: { sources: [{ name: 'claude-code', parser: 'claude-jsonl', dir, recursive: true }], cursor: {}, seenHashes: new Set() },
      onScan: () => { fired++; },
      runOnStart: true,
      intervalMs: 1000,
      timer: fakeTimer,
    });
    // runOnStart 立即跑一次
    await r.runOnce();
    expect(fired).toBe(1);
    // 手动触发 timer（fire-and-forget）→ 等在途对账完成
    timers[0].fn();
    await r.runOnce();
    expect(fired).toBe(2);
    r.stop();
  });

  it('到周期才自动跑：默认 5min 定时器注册', () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const fakeTimer = {
      setInterval: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length - 1; },
      clearInterval: () => {},
    };
    const r = createReconciler({ source: { sources: [] }, onScan: () => {}, runOnStart: false, timer: fakeTimer });
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(300_000);
    r.stop();
  });
});

// ── createReconciler 失败退避（批次41-D / P1-12）：指数退避 + 封顶 + 连续失败停自动重试 ──
describe('createReconciler 失败退避（批次41-D）', () => {
  /** 可控时钟 + 假定时器 + 可切换 onScan 成败 + 记录退避回调 */
  function harness(opts: Pick<ReconcileOptions, 'backoffCapMs' | 'maxConsecutiveFails'> = {}) {
    let t = 0;
    let attempts = 0;
    let shouldFail = false;
    let handleSeq = 0;
    const timers: { fn: () => void; ms: number; handle: number; cleared: boolean }[] = [];
    const fakeTimer = {
      setInterval: (fn: () => void, ms: number) => {
        const handle = handleSeq++;
        timers.push({ fn, ms, handle, cleared: false });
        return handle;
      },
      clearInterval: (h: unknown) => {
        const item = timers.find((x) => x.handle === h);
        if (item) item.cleared = true;
      },
    };
    const fails: Array<{ fails: number; delayMs: number; reason: string }> = [];
    const stops: Array<{ fails: number; reason: string }> = [];
    const recovers: Array<{ prevFails: number }> = [];
    const r = createReconciler({
      source: { sources: [] },
      onScan: () => {
        attempts++;
        if (shouldFail) throw new Error('L0 write key locked');
      },
      runOnStart: false,
      intervalMs: 300_000,
      timer: fakeTimer,
      now: () => t,
      onRoundFail: (i) => fails.push(i),
      onAutoRetryStopped: (i) => stops.push(i),
      onRecover: (i) => recovers.push(i),
      ...opts,
    });
    return {
      r,
      timers,
      fails,
      stops,
      recovers,
      getAttempts: () => attempts,
      fail: () => { shouldFail = true; },
      ok: () => { shouldFail = false; },
      advance: (ms: number) => { t += ms; },
      // tick 触发一次心跳（退避窗口内会跳过）；flush 让 fire-and-forget 的 runOnce 跑完
      tick: () => { timers[0].fn(); },
      flush: () => new Promise<void>((res) => setTimeout(res, 0)),
    };
  }

  it('失败→指数退避；下一次心跳在窗口内被门控，跨窗后才再跑', async () => {
    const h = harness();
    h.fail();
    await h.r.runOnce(); // 手动首跑失败
    expect(h.fails).toHaveLength(1);
    expect(Math.abs(h.fails[0].delayMs - 600_000)).toBeLessThanOrEqual(600_000 * 0.2); // 含 ±20% 抖动
    expect(h.r.consecutiveFails).toBe(1);

    h.tick();
    await h.flush();
    expect(h.getAttempts()).toBe(1); // 窗口内没再跑

    h.advance(600_000 - 1);
    h.tick();
    await h.flush();
    expect(h.getAttempts()).toBe(1); // 还差 1ms 没跨窗口

    h.advance(2);
    h.tick();
    await h.flush();
    expect(h.getAttempts()).toBe(2);
    expect(h.r.consecutiveFails).toBe(2);
    expect(Math.abs(h.fails[1].delayMs - 1_200_000)).toBeLessThanOrEqual(1_200_000 * 0.2); // 含 ±20% 抖动
    h.r.stop();
  });

  it('退避间隔封顶到 backoffCapMs（不上无限涨）', async () => {
    const h = harness({ backoffCapMs: 1_200_000 });
    h.fail();
    for (let i = 0; i < 5; i++) {
      await h.r.runOnce();
      h.advance(h.fails[i].delayMs + 1);
    }
    // 第 1/2/3/4 次依次 600k/1.2M/2.4M→1.2M/4.8M→1.2M，第 5 次也 1.2M（封顶）；±20% 抖动容差
    const expected = [600_000, 1_200_000, 1_200_000, 1_200_000, 1_200_000];
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(h.fails[i].delayMs - expected[i])).toBeLessThanOrEqual(expected[i] * 0.2);
    }
    expect(h.r.consecutiveFails).toBe(5);
    h.r.stop();
  });

  it('连续失败达 maxConsecutiveFails → 停自动重试（清心跳），UI 只留手动重跑', async () => {
    const h = harness({ maxConsecutiveFails: 3 });
    h.fail();
    for (let i = 0; i < 3; i++) {
      await h.r.runOnce();
      h.advance(2_000_000_000); // 直接跨过任何窗口
    }
    expect(h.stops).toHaveLength(1);
    expect(h.stops[0].fails).toBe(3);
    expect(h.r.autoRetryStopped).toBe(true);
    expect(h.timers[0].cleared).toBe(true); // 心跳被清

    // 停后即使时钟跨过、心跳 tick 也不再跑（且心跳已清）
    h.tick();
    await h.flush();
    expect(h.getAttempts()).toBe(3);
    h.r.stop();
  });

  it('失败后成功恢复 → 退避归零 + 重启心跳', async () => {
    const h = harness({ maxConsecutiveFails: 2 });
    h.fail();
    await h.r.runOnce();
    await h.r.runOnce(); // 第 2 次失败 → 停自动重试
    expect(h.r.autoRetryStopped).toBe(true);
    expect(h.getAttempts()).toBe(2);

    h.ok();
    await h.r.runOnce(); // 手动重跑成功
    expect(h.r.consecutiveFails).toBe(0);
    expect(h.r.autoRetryStopped).toBe(false);
    expect(h.recovers).toEqual([{ prevFails: 2 }]);
    expect(h.timers).toHaveLength(2); // 成功后重启了一份新心跳
    h.r.stop();
  });

  it('成功轮直接归零退避（不累计失败）', async () => {
    const h = harness();
    h.fail();
    await h.r.runOnce();
    expect(h.r.consecutiveFails).toBe(1);
    h.ok();
    await h.r.runOnce(); // 成功
    expect(h.r.consecutiveFails).toBe(0);
    expect(h.recovers).toEqual([{ prevFails: 1 }]);
    h.r.stop();
  });
});

// ── applyScanToStore（入库桥接 + 审计） ──────────────────────────────────────

describe('applyScanToStore', () => {
  it('逐条写入 + dedup=new 计数 + 审计留痕', async () => {
    const items = [
      { key: 'a:f1', agent: 'claude-code', role: 'user', content: 'c1', hash: 'h1', seq: 0 },
      { key: 'a:f1', agent: 'claude-code', role: 'assistant', content: 'c2', hash: 'h2', seq: 1 },
    ];
    const writes: string[] = [];
    const audits: string[] = [];
    const r = await applyScanToStore(
      { collected: 2, deduped: 0, roleSkipped: 0, skipped: [], items, cursors: {}, ts: 0 },
      {
        write: async (input) => { writes.push(input.content); return { mem_id: `m${writes.length}`, dedup: { action: 'new' } }; },
        audit: async (rec) => { audits.push(rec.detail?.source as string); },
      },
    );
    expect(r).toEqual({ written: 2, filtered: 0, failed: 0, failed_l0_locked: 0 });
    expect(writes).toEqual(['c1', 'c2']);
    expect(audits.filter((a) => a === 'collector')).toHaveLength(2);
  });

  it('dedup=duplicate 不计入 written；dedup=filtered 单独计数（批次35 质量门拦下 ≠ 丢失）', async () => {
    const audits: Array<Record<string, unknown> | undefined> = [];
    const r = await applyScanToStore(
      { collected: 3, deduped: 0, roleSkipped: 0, skipped: [], items: [
        { key: 'k', agent: 'a', role: 'user', content: 'x', hash: 'h1', seq: 0 },
        { key: 'k', agent: 'a', role: 'user', content: 'y', hash: 'h2', seq: 1 },
        { key: 'k', agent: 'a', role: 'user', content: '我先看一下', hash: 'h3', seq: 2 },
      ], cursors: {}, ts: 0 },
      {
        write: async (input) => ({
          mem_id: 'm1',
          dedup: input.content === 'x' ? { action: 'duplicate' }
            : input.content === 'y' ? { action: 'new' }
              : { action: 'filtered' as const, sim: -1 },
        }),
        audit: async (rec) => { audits.push(rec.detail); },
      },
    );
    expect(r).toEqual({ written: 1, filtered: 1, failed: 0, failed_l0_locked: 0 });
    expect(audits).toHaveLength(3); // 三类都留审计，绝不静默吞掉
  });

  it('单条 write 失败不阻塞整批 + error 审计', async () => {
    const audits: string[] = [];
    const r = await applyScanToStore(
      {
        collected: 2, deduped: 0, roleSkipped: 0, skipped: [],
        items: [
          { key: 'k1', agent: 'a', role: 'user', content: 'ok', hash: 'h1', seq: 0 },
          { key: 'k2', agent: 'a', role: 'user', content: 'bad', hash: 'h2', seq: 1 },
        ],
        cursors: {}, ts: 0,
      },
      {
        write: async (input) => {
          if (input.content === 'bad') throw new Error('boom');
          return { mem_id: 'm1', dedup: { action: 'new' } };
        },
        audit: async (rec) => { audits.push(rec.detail?.source === 'collector' ? `ok:${rec.request_id}` : 'err'); },
      },
    );
    expect(r).toEqual({ written: 1, filtered: 0, failed: 1, failed_l0_locked: 0 }); // 只有 ok 入库；failed 供调用方保留旧游标
  });
});

// ── 批次41-W：L0 写密钥锁定单独计数 ──────────────────────────────────────────

describe('applyScanToStore · 批次41-W L0 写密钥锁定', () => {
  const items = [
    { key: 'k1', agent: 'a', role: 'user', content: 'locked', hash: 'h1', seq: 0 },
    { key: 'k2', agent: 'a', role: 'user', content: 'other', hash: 'h2', seq: 1 },
  ];
  const base = { collected: 2, deduped: 0, roleSkipped: 0, skipped: [], items, cursors: {}, ts: 0 };

  it('E_L0_LOCKED 计入 failed_l0_locked 且在审计里打标；普通失败只计 failed', async () => {
    const audits: Array<Record<string, unknown> | undefined> = [];
    const r = await applyScanToStore(base, {
      write: async (input) => {
        if (input.content === 'locked') throw new MemAgentError('E_L0_LOCKED', 'L0 写密钥未解锁');
        throw new Error('boom');
      },
      audit: async (rec) => { audits.push(rec.detail); },
    });
    expect(r).toEqual({ written: 0, filtered: 0, failed: 2, failed_l0_locked: 1 });
    const errAudits = audits.filter((d) => d?.source === 'collector' && d?.error !== undefined);
    expect(errAudits).toHaveLength(2);
    expect(errAudits.find((d) => String(d?.error ?? '').includes('E_L0_LOCKED'))?.l0_locked).toBe(true);
    expect(errAudits.find((d) => String(d?.error ?? '') === 'boom')?.l0_locked).toBeUndefined();
  });

  it('只剩字符串的错误（跨 IPC 后没有 code）仍判成锁定——与首页异常派生同一判据', async () => {
    const r = await applyScanToStore(base, {
      write: async () => { throw new Error('[E_L0_LOCKED] L0 写密钥未解锁：请输入管理密码'); },
    });
    expect(r.failed_l0_locked).toBe(2);
  });

  it('没有锁定失败时 failed_l0_locked 恒为 0（不误报）', async () => {
    const r = await applyScanToStore(base, {
      write: async () => ({ mem_id: 'm1', dedup: { action: 'new' as const } }),
    });
    expect(r.failed_l0_locked).toBe(0);
  });
});

describe('REQ-013 / C4 采集侧剥离插件回灌注入', () => {
  it('stripPluginInjection 剥离 <memory-context> 块', () => {
    const raw = '普通内容\n<memory-context>旧注入</memory-context>\n更多内容';
    expect(stripPluginInjection(raw)).toBe('普通内容\n\n更多内容');
  });

  it('stripPluginInjection 剥离注入标记行', () => {
    const raw = `一行\nsource.kind=plugin:memagent\n另一行`;
    expect(stripPluginInjection(raw)).toBe('一行\n另一行');
  });

  it('isPluginInjected 判毒', () => {
    expect(isPluginInjected('x <memory-context> y')).toBe(true);
    expect(isPluginInjected('source.kind=plugin:memagent')).toBe(true);
    expect(isPluginInjected('正常文本')).toBe(false);
  });
});


