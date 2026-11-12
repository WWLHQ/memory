// P0 止血：WorkBuddy 新版会话日志（~/.workbuddy/projects/**/*.jsonl）采集回归
//
// 背景：11-06 起 WorkBuddy 客户端把会话正文从 ~/workbuddy/**/*.md 换到
// .workbuddy/projects/**/*.jsonl，采集器仍只配了旧目录 → 11-06~11-10 连续
// 5 天 0 入库且无任何报错（静默失效）。本套件钉死新源的解析与采集口径。
//
// 真实格式（2026-11-12 只读实测本机 121 个 jsonl）：
//   {"id":"…","timestamp":1793845543273,"type":"message","role":"user",
//    "content":[{"type":"input_text","text":"<system-reminder …>…</system-reminder><user_query>真实输入</user_query>"}],
//    "sessionId":"…","cwd":"…","providerData":{…},"__codebuddyLocal":true}
//   · timestamp 是 epoch 毫秒数字（不是 ISO 字符串）
//   · role / content 在顶层（不是 Claude 那种嵌在 message 对象里）
//   · 宿主注入占比极高：system-reminder / task-notification / cb_summary /
//     conversation_history_summary / 续接模板 —— 这些都不是「用户说的话」。
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseWorkbuddyJsonl,
  scanSessionLogs,
  defaultAgentSources,
  type ParsedMessage,
  type SessionLogSource,
} from '../sessionCollector.ts';

const TS = 1793845543273; // 2026-11-06 附近的 epoch ms

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 造一行真实形态的 WorkBuddy message */
function wbLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    id: '01a1a987-0732-75d7-91cd-d9c5ae6387c0',
    timestamp: TS,
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: '占位' }],
    sessionId: 'sess-1',
    cwd: 'D:/proj',
    providerData: {},
    ...fields,
  });
}

function userLine(text: string, extra: Record<string, unknown> = {}): string {
  return wbLine({ role: 'user', content: [{ type: 'input_text', text }], ...extra });
}

const SYS_REMINDER = '<system-reminder data-role="user-context">\n<user_info>OS Version: win32</user_info>\n</system-reminder>\n';

// ── 解析器：只采「用户真正说的话」 ────────────────────────────────────────────

describe('parseWorkbuddyJsonl（P0 止血 · 真实输入提取）', () => {
  it('标准 user 消息：剥掉 system-reminder，只采 user_query 内容', () => {
    const out = parseWorkbuddyJsonl(userLine(`${SYS_REMINDER}<user_query>先执行P0止血</user_query>`));
    expect(out).toEqual([
      { role: 'user', content: '先执行P0止血', ts: TS, session_id: 'sess-1', seq: undefined },
    ]);
  });

  it('保留 ts(epoch ms) 与 sessionId；缺字段时诚实留 undefined', () => {
    const full = parseWorkbuddyJsonl(userLine('<user_query>带会话信息</user_query>'))!;
    expect(full[0].ts).toBe(TS);
    expect(full[0].session_id).toBe('sess-1');
    const bare = parseWorkbuddyJsonl(JSON.stringify({
      type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_query>无时间</user_query>' }],
    }))!;
    expect(bare[0].ts).toBeUndefined();
    expect(bare[0].session_id).toBeUndefined();
  });

  it('assistant output_text 也解析出来（交给采集口角色白名单挡下，口径与 claude-jsonl 一致）', () => {
    const out = parseWorkbuddyJsonl(wbLine({
      role: 'assistant', content: [{ type: 'output_text', text: '我先看一下目录结构' }],
    }));
    expect(out?.[0].role).toBe('assistant');
    expect(out?.[0].content).toBe('我先看一下目录结构');
  });

  it('cb_summary 压缩摘要里重放的 user_query 不得采（先剥注入块再提取）', () => {
    const injected = `<cb_summary>\nSummary of the conversation so far.\n<previous_user_message><user_query>这是上个月的历史提问</user_query></previous_user_message>\n</cb_summary>\n${SYS_REMINDER}<user_query>今天真正问的问题</user_query>`;
    const out = parseWorkbuddyJsonl(userLine(injected))!;
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('今天真正问的问题');
    expect(out[0].content).not.toContain('上个月');
  });

  it('整条都是宿主注入（cb_summary / conversation_history_summary / task-notification）→ null', () => {
    const cases = [
      '<cb_summary>\nSummary of the conversation so far: <user_query>历史提问</user_query>\n</cb_summary>',
      '<conversation_history_summary>此前对话摘要</conversation_history_summary>',
      '<task-notification><task-id>t1</task-id><status>completed</status><summary>跑完了</summary></task-notification>',
      `${SYS_REMINDER}Please continue with the conversation based on the summarized context above. Maintain the same level of detail and helpfulness as before the summarization.`,
    ];
    for (const text of cases) {
      expect(parseWorkbuddyJsonl(userLine(text)), text.slice(0, 40)).toBeNull();
    }
  });

  it('非 message 类型（session-meta / reasoning / function_call / function_call_result / file-history-snapshot）→ null', () => {
    for (const type of ['session-meta', 'reasoning', 'function_call', 'function_call_result', 'file-history-snapshot', 'ai-title', 'model-usage']) {
      expect(parseWorkbuddyJsonl(wbLine({ type, content: [{ type: 'input_text', text: '<user_query>伪装</user_query>' }] }))).toBeNull();
    }
  });

  it('未知 role / 纯图片块 / 空文本 / 坏行 → null', () => {
    expect(parseWorkbuddyJsonl(wbLine({ role: 'system', content: [{ type: 'input_text', text: '系统' }] }))).toBeNull();
    expect(parseWorkbuddyJsonl(wbLine({ content: [{ type: 'image_blob_ref', ref: 'img-1' }] }))).toBeNull();
    expect(parseWorkbuddyJsonl(userLine(`${SYS_REMINDER}<user_query>   </user_query>`))).toBeNull();
    expect(parseWorkbuddyJsonl('{bad json')).toBeNull();
    expect(parseWorkbuddyJsonl('')).toBeNull();
  });

  it('超长注入（> 上限）→ null，不把 16 万字符摘要灌进记忆库', () => {
    const huge = `<cb_summary>${'x'.repeat(20_000)}</cb_summary><user_query>${'y'.repeat(20_001)}</user_query>`;
    expect(parseWorkbuddyJsonl(userLine(huge))).toBeNull();
  });

  it('早期格式无 user_query 包裹的纯文本也能采（向后兼容，不误杀老会话）', () => {
    const out = parseWorkbuddyJsonl(userLine('请把采集源配置补上'))!;
    expect(out[0].content).toBe('请把采集源配置补上');
  });

  it('多个 user_query 块按序拼接', () => {
    const out = parseWorkbuddyJsonl(userLine('<user_query>甲</user_query><user_query>乙</user_query>'))!;
    expect(out.map((m) => m.content)).toEqual(['甲', '乙']);
  });
});

// ── 内置源：新增 workbuddy-projects，且不得与既有 workbuddy md 源游标冲突 ──────

describe('defaultAgentSources（P0 止血 · 新源注册）', () => {
  it('新增 .workbuddy/projects 源：独立名字 / 独立 parser / 递归 / 缺省只采 user', () => {
    const home = tmpDir('wb-src-');
    const srcs = defaultAgentSources({ home });
    const src = srcs.find((s) => s.name === 'workbuddy-projects');
    expect(src).toBeDefined();
    expect(src!.parser).toBe('workbuddy-jsonl');
    expect(src!.dir).toBe(path.join(home, '.workbuddy', 'projects'));
    expect(src!.recursive).toBe(true);
    expect(src!.filePattern?.test('session.jsonl')).toBe(true);
    expect(src!.roles).toBeUndefined(); // 批次35：缺省只采 user
    // 与既有 workbuddy md 源名字必须不同，否则 ${name}:${rel} 游标键冲突
    expect(srcs.find((s) => s.name === 'workbuddy')?.parser).toBe('workbuddy-md');
    expect(new Set(srcs.map((s) => s.name)).size).toBe(srcs.length);
  });

  it('agents 白名单只过滤扩展源，不影响三主源 + 新 P0 源', () => {
    const home = tmpDir('wb-src-wl-');
    const srcs = defaultAgentSources({ home, agents: ['Qoder CN'] });
    expect(srcs.find((s) => s.name === 'workbuddy-projects')).toBeDefined();
    expect(srcs.find((s) => s.name === 'claude-code')).toBeDefined();
    expect(srcs.find((s) => s.name === 'deepseek-harness')).toBeDefined();
    expect(srcs.some((s) => s.name === 'trae-code-cn')).toBe(false);
  });
});

// ── 端到端扫描：回填 11-06~11-10 的硬指标 ────────────────────────────────────

describe('scanSessionLogs（P0 止血 · 回填链路）', () => {
  /** 造一个 .workbuddy/projects 形态的临时会话目录 */
  function makeProjectsDir(): string {
    const home = tmpDir('wb-proj-');
    const dir = path.join(home, '.workbuddy', 'projects', 'proj-A');
    fs.mkdirSync(dir, { recursive: true });
    return home;
  }
  const sourceOf = (home: string): SessionLogSource => {
    const s = defaultAgentSources({ home }).find((x) => x.name === 'workbuddy-projects')!;
    return s;
  };
  const append = (home: string, file: string, ...lines: string[]): void => {
    fs.appendFileSync(path.join(home, '.workbuddy', 'projects', 'proj-A', file), lines.join('\n') + '\n');
  };

  it('【回填硬指标】11-06~11-10 的五条真实提问全部采出，宿主注入一条不入库', async () => {
    const home = makeProjectsDir();
    append(home, 's1.jsonl',
      userLine(`${SYS_REMINDER}<user_query>11-06：查一下为什么没有信息入库</user_query>`),
      wbLine({ type: 'reasoning', content: [{ type: 'input_text', text: '<user_query>推理不算</user_query>' }] }),
      wbLine({ type: 'function_call_result', output: '<user_query>工具结果不算</user_query>' }),
      userLine(`${SYS_REMINDER}<user_query>11-07：把六个 Agent 都排查一遍</user_query>`),
      userLine('<task-notification><task-id>t1</task-id><status>completed</status></task-notification>'),
      userLine(`${SYS_REMINDER}<user_query>11-09：能不能加握手</user_query>`),
      userLine(`<cb_summary><previous_user_message><user_query>摘要里的历史提问</user_query></previous_user_message></cb_summary>${SYS_REMINDER}<user_query>11-10：先落盘避免遗忘</user_query>`),
      wbLine({ role: 'assistant', content: [{ type: 'output_text', text: '助手旁白不该入库' }] }),
      userLine(`${SYS_REMINDER}<user_query>11-11：先执行P0止血</user_query>`),
    );
    const scan = await scanSessionLogs({ sources: [sourceOf(home)], cursor: {}, seenHashes: new Set() });
    expect(scan.collected).toBe(5);
    expect(scan.items.map((i) => i.content)).toEqual([
      '11-06：查一下为什么没有信息入库',
      '11-07：把六个 Agent 都排查一遍',
      '11-09：能不能加握手',
      '11-10：先落盘避免遗忘',
      '11-11：先执行P0止血',
    ]);
    expect(scan.items.every((i) => i.agent === 'workbuddy-projects')).toBe(true);
    expect(scan.items.every((i) => i.role === 'user')).toBe(true);
    // 注入与旁白都不得出现在 items
    expect(JSON.stringify(scan.items.map((i) => i.content))).not.toContain('system-reminder');
    expect(JSON.stringify(scan.items.map((i) => i.content))).not.toContain('摘要里的历史提问');
    expect(JSON.stringify(scan.items.map((i) => i.content))).not.toContain('助手旁白');
    expect(scan.roleSkipped).toBe(1); // assistant 被采集口挡下，诚实计数
  });

  it('增量：追加新行只采新增，游标停在新行行首', async () => {
    const home = makeProjectsDir();
    append(home, 's2.jsonl', userLine('<user_query>第一条</user_query>'));
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [sourceOf(home)], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(1);
    append(home, 's2.jsonl', userLine('<user_query>第二条</user_query>'));
    const s2 = await scanSessionLogs({ sources: [sourceOf(home)], cursor: s1.cursors, seenHashes: seen });
    expect(s2.collected).toBe(1);
    expect(s2.items[0].content).toBe('第二条');
    expect(s2.deduped).toBe(0);
  });

  it('幂等：无新内容 → 0 条；游标丢失重扫也靠 seenHashes 去重', async () => {
    const home = makeProjectsDir();
    append(home, 's3.jsonl', userLine('<user_query>同一条</user_query>'));
    const seen = new Set<string>();
    const s1 = await scanSessionLogs({ sources: [sourceOf(home)], cursor: {}, seenHashes: seen });
    expect(s1.collected).toBe(1);
    const s2 = await scanSessionLogs({ sources: [sourceOf(home)], cursor: s1.cursors, seenHashes: seen });
    expect(s2.collected).toBe(0);
    const s3 = await scanSessionLogs({ sources: [sourceOf(home)], cursor: {}, seenHashes: seen });
    expect(s3.collected).toBe(0);
    expect(s3.deduped).toBe(1);
  });

  it('递归子目录（subagents/*.jsonl）也能采到', async () => {
    const home = makeProjectsDir();
    const sub = path.join(home, '.workbuddy', 'projects', 'proj-A', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.appendFileSync(path.join(sub, 'agent-1.jsonl'), userLine('<user_query>子代理里的用户指令</user_query>') + '\n');
    const scan = await scanSessionLogs({ sources: [sourceOf(home)], cursor: {}, seenHashes: new Set() });
    expect(scan.items.map((i) => i.content)).toContain('子代理里的用户指令');
  });

  it('目录不存在 → 诚实 skip，不造假数据（旧采集器的静默失效不能重演）', async () => {
    const home = tmpDir('wb-ghost-');
    const scan = await scanSessionLogs({ sources: [sourceOf(home)], cursor: {}, seenHashes: new Set() });
    expect(scan.collected).toBe(0);
    expect(scan.skipped.some((s) => s.includes('目录不存在'))).toBe(true);
  });
});

// ── C2 输入/状态变异矩阵 ──────────────────────────────────────────────────────

describe('parseWorkbuddyJsonl（C2 输入变异：全部如实拒绝）', () => {
  const rejects: Array<[string, string]> = [
    ['无 content', JSON.stringify({ type: 'message', role: 'user' })],
    ['content 非数组', JSON.stringify({ type: 'message', role: 'user', content: '字符串' })],
    ['role 缺失', JSON.stringify({ type: 'message', content: [{ type: 'input_text', text: '正文' }] })],
    ['嵌套 message 对象（Claude 格式误入）', JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } })],
    ['未闭合 system-reminder 后无真实输入', JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<system-reminder data-role="compact-summary">一大段提示词' }] })],
    ['纯续接模板', userLine('Please continue with the conversation based on the summarized context above. Maintain the same level of detail and helpfulness as before the summarization.')],
  ];
  for (const [name, line] of rejects) {
    it(`${name} → null / 不产出`, () => {
      const out = parseWorkbuddyJsonl(line);
      expect(out === null || (Array.isArray(out) && out.length === 0)).toBe(true);
    });
  }
  it('合法输入仍产出（变异矩阵的反面，防止过滤过头）', () => {
    const out: ParsedMessage[] | null = parseWorkbuddyJsonl(userLine('<user_query>这条必须采到</user_query>'));
    expect(out?.[0].content).toBe('这条必须采到');
  });

  it('timestamp 格式漂移（ISO 字符串）→ 内容仍采但 ts 诚实留 undefined，不伪造时间', () => {
    const out = parseWorkbuddyJsonl(JSON.stringify({
      type: 'message', role: 'user', timestamp: '2026-11-06T00:00:00Z',
      content: [{ type: 'input_text', text: '<user_query>时间格式变了</user_query>' }],
    }))!;
    expect(out[0].content).toBe('时间格式变了');
    expect(out[0].ts).toBeUndefined();
  });
});
