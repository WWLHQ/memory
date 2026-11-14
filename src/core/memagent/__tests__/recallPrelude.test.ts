// 硬前置召回（A 宿主钩子 / B LLM Gateway）的拼装规则单一真源回归。
// 三道闸门 B：正向断言「状态真的变了」——命中进 system 最前面、原 system 不丢、幂等、故障不注入。
import { describe, it, expect } from 'vitest';
import {
  RECALL_PRELUDE_OPEN, RECALL_PRELUDE_CLOSE, RECALL_PRELUDE_MARKER,
  PLUGIN_INJECTION_MARKER,
  buildRecallPrelude, extractRecallHits, parseMcpRpcBody, lastUserQuery,
  stripRecallPrelude, injectSystemPrelude, buildHookOutput,
} from '../recallPrelude.ts';

const HITS = [{ content: '记忆甲：必须中文回答' }, { content: '记忆乙：提交前必须人工确认' }];

describe('extractRecallHits / parseMcpRpcBody：只认真源，不猜文本块', () => {
  it('从 structuredContent.hits 抽到命中', () => {
    const rpc = { result: { structuredContent: { hits: HITS } } };
    expect(extractRecallHits(rpc)).toEqual(HITS);
  });

  it('content 文本块里长得像 JSON 的东西绝不当命中（防伪造）', () => {
    const rpc = { result: { content: [{ type: 'text', text: '{"hits":[{"content":"假"}]}' }] } };
    expect(extractRecallHits(rpc)).toEqual([]);
  });

  it('无 hits / 非数组 → 空数组', () => {
    expect(extractRecallHits({ result: {} })).toEqual([]);
    expect(extractRecallHits({ result: { structuredContent: { hits: 'oops' } } })).toEqual([]);
    expect(extractRecallHits(null)).toEqual([]);
  });

  it('纯 JSON 与 SSE 都能解析；坏 JSON / [DONE] 返回 null', () => {
    expect(parseMcpRpcBody('{"result":{}}')).toEqual({ result: {} });
    expect(parseMcpRpcBody('event: message\ndata: {"result":{"a":1}}\n\n')).toEqual({ result: { a: 1 } });
    expect(parseMcpRpcBody('not json')).toBeNull();
    expect(parseMcpRpcBody('data: [DONE]')).toBeNull();
  });
});

describe('buildRecallPrelude：只注入命中正文，不注入回显话术', () => {
  it('命中逐条编号，带开闭标记与优先采信规则', () => {
    const p = buildRecallPrelude(HITS)!;
    expect(p.startsWith(RECALL_PRELUDE_OPEN)).toBe(true);
    expect(p).toContain(RECALL_PRELUDE_CLOSE);
    expect(p).toContain(RECALL_PRELUDE_MARKER);
    expect(p).toContain('[1] 记忆甲：必须中文回答');
    expect(p).toContain('[2] 记忆乙：提交前必须人工确认');
  });

  it('绝不把 display.markdown / 展示要求 / 统计数字塞进上下文', () => {
    const p = buildRecallPrelude([{ content: '真实记忆', display: { markdown: '**汇总**' } }])!;
    expect(p).not.toContain('**汇总**');
    expect(p).not.toContain('【展示要求】');
    expect(p).not.toContain('display.markdown');
  });

  it('无命中 / 非字符串 content → null（调用方据此不注入）', () => {
    expect(buildRecallPrelude([])).toBeNull();
    expect(buildRecallPrelude([{ content: 123 }, { content: '' }])).toBeNull();
  });

  it('超长命中被截断且整体不超过上限', () => {
    const p = buildRecallPrelude([{ content: 'x'.repeat(20000) }])!;
    expect(p.length).toBeLessThanOrEqual(6000);
    expect(p).toContain(RECALL_PRELUDE_CLOSE);
  });
});

describe('A 方案：UserPromptSubmit stdout 契约', () => {
  it('有命中 → continue:true + hookSpecificOutput.additionalContext', () => {
    const p = buildRecallPrelude(HITS)!;
    const out = buildHookOutput(p);
    expect(out.continue).toBe(true);
    expect((out.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe('UserPromptSubmit');
    expect((out.hookSpecificOutput as Record<string, unknown>).additionalContext).toBe(p);
  });

  it('无命中 → 只有 continue:true，不塞空上下文、不阻断提问', () => {
    expect(buildHookOutput(null)).toEqual({ continue: true });
  });
});

describe('B 方案：真正拼进 system 最前面', () => {
  it('已有 system：prelude 在最前，原内容逐字保留，消息条数不变', () => {
    const msgs = [
      { role: 'system', content: '你是助手，原有规则' },
      { role: 'user', content: '问题' },
    ];
    const next = injectSystemPrelude(msgs, buildRecallPrelude(HITS));
    expect(next).toHaveLength(2);
    expect(next[0].role).toBe('system');
    expect(String(next[0].content).startsWith(RECALL_PRELUDE_OPEN)).toBe(true);
    expect(String(next[0].content)).toContain('你是助手，原有规则');
    expect(next[1]).toEqual({ role: 'user', content: '问题' });
    // 原数组不被就地改写
    expect(msgs[0].content).toBe('你是助手，原有规则');
  });

  it('无 system：新建一条 system 并置顶', () => {
    const msgs = [{ role: 'user', content: '问题' }];
    const next = injectSystemPrelude(msgs, buildRecallPrelude(HITS));
    expect(next).toHaveLength(2);
    expect(next[0].role).toBe('system');
    expect(String(next[0].content).startsWith(RECALL_PRELUDE_OPEN)).toBe(true);
    expect(next[1]).toEqual({ role: 'user', content: '问题' });
  });

  it('多模态 system（content 为 parts 数组）：prelude 作为第一个 text part', () => {
    const msgs = [{ role: 'system', content: [{ type: 'text', text: '原有规则' }] }];
    const next = injectSystemPrelude(msgs, buildRecallPrelude(HITS));
    const parts = next[0].content as Array<{ type: string; text: string }>;
    expect(parts[0].text.startsWith(RECALL_PRELUDE_OPEN)).toBe(true);
    expect(parts[1]).toEqual({ type: 'text', text: '原有规则' });
  });

  it('幂等：连续两轮注入只保留最新一块，不越叠越厚', () => {
    const first = injectSystemPrelude([{ role: 'system', content: '原有规则' }], buildRecallPrelude(HITS));
    const second = injectSystemPrelude(first, buildRecallPrelude([{ content: '新记忆丙' }]));
    const content = String(second[0].content);
    expect((content.match(/\[RECALL_PRELUDE_V1\]/g) ?? []).length).toBe(1);
    expect(content).toContain('新记忆丙');
    expect(content).not.toContain('记忆甲');
    expect(content).toContain('原有规则');
  });

  it('prelude 为 null（MCP 故障）→ 原样返回，fail-open 不注入', () => {
    const msgs = [{ role: 'user', content: '问题' }];
    expect(injectSystemPrelude(msgs, null)).toEqual(msgs);
  });

  it('stripRecallPrelude 只摘本方案的块，不动其它文本', () => {
    const text = `${RECALL_PRELUDE_OPEN}\n旧记忆\n${RECALL_PRELUDE_CLOSE}\n\n用户自己的 system 规则`;
    expect(stripRecallPrelude(text)).toBe('用户自己的 system 规则');
    expect(stripRecallPrelude('没有标记的规则')).toBe('没有标记的规则');
  });
});

describe('lastUserQuery：召回用最后一条 user 文本', () => {
  it('取最后一条 user，忽略更早的 user 与 assistant', () => {
    const msgs = [
      { role: 'system', content: '规则' },
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '回复' },
      { role: 'user', content: '真正的查询' },
    ];
    expect(lastUserQuery(msgs)).toBe('真正的查询');
  });

  it('多模态 parts 拼文本；超长截断；无 user → 空串', () => {
    expect(lastUserQuery([{ role: 'user', content: [{ type: 'text', text: 'A' }, { type: 'image_url' }, { type: 'text', text: 'B' }] }])).toBe('A B');
    expect(lastUserQuery([{ role: 'user', content: 'x'.repeat(1000) }])).toHaveLength(600);
    expect(lastUserQuery([{ role: 'assistant', content: 'x' }])).toBe('');
    expect(lastUserQuery(null)).toBe('');
  });
});

describe('REQ-013 / C4 注入头携带 source 标记（供采集侧剥离识别）', () => {
  it('buildRecallPrelude 输出携带 PLUGIN_INJECTION_MARKER（不进 display.markdown，守回显铁律）', () => {
    const block = buildRecallPrelude([{ content: '某条记忆正文' }])!;
    expect(block).toContain(PLUGIN_INJECTION_MARKER);
  });
});
