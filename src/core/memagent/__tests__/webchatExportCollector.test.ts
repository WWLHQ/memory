// 网页版 Agent 对话导出采集（chat-exports）回归
//
// 场景：DeepSeek / 豆包 / Kimi / 智谱 / ChatGPT 等网页版本身无批量导出，靠浏览器插件
// 定时把对话写成 Markdown 到 userData/chat-exports/，本采集器递归扫描、完整对话入库。
// 本套件钉死三件事：
//   1. 各家导出 Markdown 角色标记（标题/加粗/行前缀）都能解析，元信息/H1/frontmatter 不入库
//   2. webchat-export 源配置：独立名字与游标键、roles 完整对话、递归
//   3. 端到端采 user + assistant（角色不同同内容不误去重）、增量、幂等、缺目录诚实 skip
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  agentFor,
  parseWebchatMd,
  webchatExportSource,
  webchatSiteOf,
  scanSessionLogs,
  type SessionLogSource,
} from '../sessionCollector.ts';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── 解析器：各家导出格式 ──────────────────────────────────────────────────────

describe('parseWebchatMd（网页导出 Markdown 解析）', () => {
  it('标题式：## User / ### Assistant 分块，正文一字不漏', () => {
    const md = `# 一次关于连接泵的讨论\n\n## User\n\n为什么支付接口会超时？\n\n## Assistant\n\n因为连接池 pool_size=5 太小了。\n`;
    const out = parseWebchatMd(md, 'deepseek');
    expect(out).toHaveLength(2);
    expect(out.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:为什么支付接口会超时？',
      'assistant:因为连接池 pool_size=5 太小了。',
    ]);
    expect(out[0].session_id).toBe('deepseek');
    expect(out.every((m) => m.ts === undefined)).toBe(true); // 无逐条时间戳，诚实留空
  });

  it('加粗式 + 行前缀式混用：**用户：** / **助手：** / User: / 我：', () => {
    const md = [
      '**用户：** 第一条提问',
      '',
      '**助手：** 第一条回答',
      '',
      'User: second question',
      '我：中文行前缀提问',
      'Assistant: second answer',
    ].join('\n');
    const out = parseWebchatMd(md);
    expect(out.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:第一条提问',
      'assistant:第一条回答',
      'user:second question',
      'user:中文行前缀提问',
      'assistant:second answer',
    ]);
  });

  it('中文站点角色名（豆包/Kimi/智谱/元宝）归一为 user/assistant', () => {
    const md = ['## 用户', '帮我总结这段话', '## 豆包', '好的，这是摘要', '## 我', '再问一个', '## Kimi', ' answered'].join('\n');
    const out = parseWebchatMd(md);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('剥离 YAML frontmatter / H1 文档标题 / 水平线 / 导出元信息', () => {
    const md = [
      '---',
      'platform: deepseek',
      'title: 事故复盘',
      'created: 2026-11-16',
      '---',
      '',
      '# 事故复盘',
      '',
      '**导出时间：** 2026-11-16 09:00',
      '- 来源: chat.deepseek.com',
      '模型：deepseek-chat',
      '链接：https://chat.deepseek.com/share/abc',
      '',
      '## User',
      '正文提问一',
      '',
      '---',
      '',
      '## Assistant',
      '正文回答一',
    ].join('\n');
    const out = parseWebchatMd(md);
    expect(out.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:正文提问一',
      'assistant:正文回答一',
    ]);
    const all = JSON.stringify(out);
    for (const noise of ['platform', 'deepseek-chat', '导出时间', '来源', 'share/abc', '事故复盘']) {
      expect(all).not.toContain(noise);
    }
  });

  it('无角色标记 / 空文本 / 纯元信息 → 空数组（诚实不造假）', () => {
    expect(parseWebchatMd('这是一段没有任何角色标记的自由文本')).toEqual([]);
    expect(parseWebchatMd('')).toEqual([]);
    expect(parseWebchatMd('# 只有标题\n\n导出时间：2026-11-16')).toEqual([]);
    expect(parseWebchatMd(null as unknown as string)).toEqual([]);
  });

  it('角色行后无正文 → 不产出空记忆', () => {
    const md = ['## User', '', '## Assistant', '', '## User', '有正文的提问'].join('\n');
    const out = parseWebchatMd(md);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('有正文的提问');
  });

  it('助手回答里的代码块与多行结构保留', () => {
    const md = ['## User', '看看这段代码', '## Assistant', '```ts', 'const a = 1;', '```', '以上是示例。'].join('\n');
    const out = parseWebchatMd(md);
    expect(out[1].content).toContain('```ts');
    expect(out[1].content).toContain('const a = 1;');
  });
});

// ── 源配置 ────────────────────────────────────────────────────────────────────

describe('webchatExportSource（源注册）', () => {
  it('独立名字/游标键、webchat-md parser、递归、完整对话两角色、独立 category', () => {
    const dir = tmpDir('webchat-src-');
    const src = webchatExportSource(dir);
    expect(src.name).toBe('webchat-export');
    expect(src.parser).toBe('webchat-md');
    expect(src.dir).toBe(dir);
    expect(src.recursive).toBe(true);
    expect(src.roles).toEqual(['user', 'assistant']); // 用户选完整对话，覆盖缺省只采 user
    expect(src.category).toBe('context');
    expect(src.filePattern?.test('对话-1.md')).toBe(true);
    expect(src.filePattern?.test('x.json')).toBe(false);
  });
});

// ── 端到端扫描 ────────────────────────────────────────────────────────────────

describe('scanSessionLogs（chat-exports 端到端）', () => {
  function makeSource(): { dir: string; src: SessionLogSource } {
    const dir = tmpDir('webchat-e2e-');
    return { dir, src: webchatExportSource(dir) };
  }

  it('完整对话：user + assistant 都入库，assistant 是最终答案不是过程旁白', async () => {
    const { dir, src } = makeSource();
    fs.writeFileSync(path.join(dir, 'deepseek-复盘.md'), [
      '# 支付超时复盘',
      '## User',
      '支付接口为什么超时？',
      '## Assistant',
      '根因是连接池 pool_size=5 过小，已调至 50。',
    ].join('\n'));
    const r = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(r.collected).toBe(2);
    expect(r.roleSkipped).toBe(0); // 两角色都在白名单
    expect(r.items.map((i) => `${i.role}:${i.content}`)).toEqual([
      'user:支付接口为什么超时？',
      'assistant:根因是连接池 pool_size=5 过小，已调至 50。',
    ]);
    expect(r.items.every((i) => i.agent === 'webchat-export')).toBe(true);
  });

  it('同名 content 的 user / assistant 不互相误去重（hash 含 role）', async () => {
    const { dir, src } = makeSource();
    fs.writeFileSync(path.join(dir, 'same.md'), [
      '## User', '同样的一句话', '## Assistant', '同样的一句话',
    ].join('\n'));
    const r = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(r.collected).toBe(2);
    expect(r.items.map((i) => i.role)).toEqual(['user', 'assistant']);
  });

  it('增量：插件重写同一文件追加新对话 → 只采新增，旧的靠 seenHashes 挡下', async () => {
    const { dir, src } = makeSource();
    const file = path.join(dir, 'rolling.md');
    fs.writeFileSync(file, ['## User', '第一轮提问', '## Assistant', '第一轮回答'].join('\n'));
    const seen = new Set<string>();
    const r1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(r1.collected).toBe(2);
    fs.writeFileSync(file, [
      '## User', '第一轮提问', '## Assistant', '第一轮回答',
      '## User', '第二轮提问', '## Assistant', '第二轮回答',
    ].join('\n'));
    const r2 = await scanSessionLogs({ sources: [src], cursor: r1.cursors, seenHashes: seen });
    expect(r2.collected).toBe(2);
    expect(r2.items.map((i) => i.content)).toEqual(['第二轮提问', '第二轮回答']);
  });

  it('幂等：文件无变化 → 0 条新采；seenHashes 丢失重扫也不重复入库', async () => {
    const { dir, src } = makeSource();
    fs.writeFileSync(path.join(dir, 'idem.md'), ['## User', '同一条', '## Assistant', '同一答'].join('\n'));
    const seen = new Set<string>();
    const r1 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(r1.collected).toBe(2);
    const r2 = await scanSessionLogs({ sources: [src], cursor: r1.cursors, seenHashes: seen });
    expect(r2.collected).toBe(0);
    const r3 = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: seen });
    expect(r3.collected).toBe(0);
    expect(r3.deduped).toBe(2);
  });

  it('递归子目录（按平台/账号分目录导出）也能采到', async () => {
    const { dir, src } = makeSource();
    const sub = path.join(dir, 'deepseek', '账号A');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, '会话1.md'), ['## User', '子目录里的提问', '## Assistant', '子目录里的回答'].join('\n'));
    const r = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(r.items.map((i) => i.content)).toContain('子目录里的提问');
    expect(r.items.map((i) => i.content)).toContain('子目录里的回答');
  });

  it('目录不存在 → 诚实 skip，不造假数据', async () => {
    const ghost = webchatExportSource(tmpDir('webchat-ghost-') + '/not-created');
    const r = await scanSessionLogs({ sources: [ghost], cursor: {}, seenHashes: new Set() });
    expect(r.collected).toBe(0);
    expect(r.skipped.some((s) => s.includes('目录不存在'))).toBe(true);
  });

  it('无角色标记的空导出文件 → 0 条，不把整篇灌进记忆库', async () => {
    const { dir, src } = makeSource();
    fs.writeFileSync(path.join(dir, 'garbage.md'), '一段没有任何角色标记的自由文本\n没有结构\n');
    const r = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(r.collected).toBe(0);
  });
});

// ── 导出来源按站点细分（用户要求：入库后能看出是 DeepSeek / 豆包 / 千问）────────

describe('导出来源按站点细分', () => {
  it('webchatSiteOf：从 chat-exports/<站点>/x.md 取出站点目录名', () => {
    expect(webchatSiteOf('deepseek/20261116-213000.md')).toBe('deepseek');
    expect(webchatSiteOf('doubao\\20261116-213000.md')).toBe('doubao'); // Windows 分隔符
    expect(webchatSiteOf('DeepSeek/账号A/x.md')).toBe('deepseek');       // 大小写归一
    expect(webchatSiteOf('x.md')).toBeNull();                            // 直接丢在根目录 → 不猜
    expect(webchatSiteOf('')).toBeNull();
    expect(webchatSiteOf('中文目录/x.md')).toBeNull();                   // 不是插件写的站点目录
  });

  it('agentFor：只有 webchat-md 源加站点后缀，其它源自样', () => {
    expect(agentFor({ name: 'webchat-export', parser: 'webchat-md' }, 'qianwen/a.md')).toBe('webchat-export:qianwen');
    expect(agentFor({ name: 'webchat-export', parser: 'webchat-md' }, 'a.md')).toBe('webchat-export');
    expect(agentFor({ name: 'claude-code', parser: 'claude-jsonl' }, 'deepseek/a.jsonl')).toBe('claude-code');
  });

  it('端到端：不同站点目录 → agent 带各自站点，且互不去重（同内容不同来源视为两条）', async () => {
    const dir = tmpDir('webchat-site-');
    const src = webchatExportSource(dir);
    const body = ['## User', '同一个提问', '## Assistant', '同一个回答'].join('\n');
    fs.mkdirSync(path.join(dir, 'deepseek'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'doubao'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'deepseek', 'a.md'), body);
    fs.writeFileSync(path.join(dir, 'doubao', 'a.md'), body);

    const r = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(r.collected).toBe(4);
    expect(r.items.map((i) => i.agent)).toEqual([
      'webchat-export:deepseek', 'webchat-export:deepseek',
      'webchat-export:doubao', 'webchat-export:doubao',
    ]);
  });
});

// ── C2 变异矩阵：回灌注入块不得因完整对话口径而漏过 ──────────────────────────

describe('scanSessionLogs（C2 输入变异：memory-context 回灌块由采集口剥离）', () => {
  it('正文里混入 <memory-context> 回灌块 → 采集口剥离，只留真实提问（防回灌循环）', async () => {
    const dir = tmpDir('webchat-inject-');
    const src = webchatExportSource(dir);
    fs.writeFileSync(path.join(dir, 'inject.md'), [
      '## User',
      '<memory-context>回灌的旧记忆不该重新入库</memory-context>真实提问',
      '## Assistant',
      '回答',
    ].join('\n'));
    const r = await scanSessionLogs({ sources: [src], cursor: {}, seenHashes: new Set() });
    expect(r.items[0].content).toBe('真实提问');
    expect(JSON.stringify(r.items)).not.toContain('回灌的旧记忆不该重新入库');
  });
});
