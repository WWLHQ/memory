// REQ-014 / T3（C6-B）：source_excerpt 原文摘录（写入侧填充 + prelude 双保真拼装）。
// 硬约束：摘录只来自明文正文的脱敏结果，**L0 密文永不进入**；无摘录时不写空串、不伪造保真。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { SOURCE_EXCERPT_MAX_CHARS, buildSourceExcerpt } from '../memories.ts';
import { MAX_EXCERPT_CHARS, buildRecallPrelude } from '../recallPrelude.ts';
import { createTestVault } from './l0Kit.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

describe('REQ-014 T3 · buildSourceExcerpt（脱敏 + 截断 + 不伪造）', () => {
  it('复用 sanitizeL1：URL 与 Authorization 被脱敏，其余原文保留', () => {
    const raw = '部署地址是 http://10.0.0.5:8204/api ，Authorization: Bearer abcdefghijklmnopqrst 已失效';
    const out = buildSourceExcerpt(raw);
    expect(out).toBeTruthy();
    expect(out).not.toContain('10.0.0.5');
    expect(out).not.toContain('abcdefghijklmnopqrst');
    // 采用既有脱敏规则（认证头会连值一起吃掉，属预期保守行为），这里只断言非敏感主体保留
    expect(out).toContain('部署地址是');
  });

  it(`超长截断到 ${SOURCE_EXCERPT_MAX_CHARS} 字以内并以省略号收尾`, () => {
    const out = buildSourceExcerpt('会'.repeat(500))!;
    expect(out.length).toBeLessThanOrEqual(SOURCE_EXCERPT_MAX_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('stub 档摘录与摘要同文时仍保留（去重责任在拼装侧，不在这里丢数据）', () => {
    // 无 LLM 时 L1 = 清洗后的原文；若此处丢弃，将来补上 L2 摘要就没有原文可配了
    expect(buildSourceExcerpt('同一段文字')).toBe('同一段文字');
  });

  it('空内容 / 纯空白 → undefined', () => {
    expect(buildSourceExcerpt('')).toBeUndefined();
    expect(buildSourceExcerpt('   \n\t ')).toBeUndefined();
  });

  it('prelude 侧摘录上限与写入侧同口径（两处常量必须相等）', () => {
    expect(MAX_EXCERPT_CHARS).toBe(SOURCE_EXCERPT_MAX_CHARS);
  });
});

describe('REQ-014 T3 · 写入侧落库（coreWrite）', () => {
  async function makeAgent() {
    const storage = new InMemoryStorage();
    // write() 必须先过 L0 写密钥（§4.4.4），因此注入真 L0Vault 而不是伪造端口
    const { vault } = await createTestVault();
    const ma = createMemAgent({
      form: 'desktop', account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      l0: vault, l0Admin: vault,
    });
    return { ma, storage };
  }

  it('写入 → 落库带脱敏摘录；正文里没有出现的密钥不会被带进摘录', async () => {
    const { ma, storage } = await makeAgent();
    const raw = '网关基址 https://gw.internal:8443/v1 ，Authorization: Bearer sk-abcdefghijklmnop 由运维轮换';
    const r = await ma.write({ content: raw, category: 'fact', project_id: 'P1', source_agent: 'test-harness' } as never);
    const m = await storage.getMemory(r.mem_id);
    expect(m).toBeTruthy();
    expect(m!.source_excerpt).toBeTruthy();
    expect(m!.source_excerpt).not.toContain('sk-abcdefghijklmnop');
    expect(m!.source_excerpt).not.toContain('gw.internal');
    expect(m!.source_excerpt).toContain('网关基址');
  });

  it('source_excerpt 与 content 是两份内容（摘要 ≠ 原文摘录时才有意义）', async () => {
    const { ma, storage } = await makeAgent();
    const raw = '连接池 maxWait 调到 5000ms 之后，慢查询从 12 秒降到 800 毫秒，索引也补了 user_id';
    const r = await ma.write({ content: raw, category: 'insight', project_id: 'P1', source_agent: 'test-harness' } as never);
    const m = await storage.getMemory(r.mem_id);
    expect(m!.source_excerpt).toBeTruthy();
    expect(m!.source_excerpt!.length).toBeLessThanOrEqual(SOURCE_EXCERPT_MAX_CHARS);
    // 摘录只允许是脱敏后的原文（允许等长或更短），不得比原文更长
    expect(m!.source_excerpt!.length).toBeLessThanOrEqual(raw.length);
  });
});

describe('REQ-014 T3 · prelude 双保真拼装', () => {
  it('带摘录 → 正文下一行追加「原文摘录：」，编号不变', () => {
    const block = buildRecallPrelude([
      { content: '摘要：连接池超时已调整', source_excerpt: '原文：maxWait=5000，慢查询降 93%' },
    ])!;
    expect(block).toContain('[1] 摘要：连接池超时已调整');
    expect(block).toContain('原文摘录：原文：maxWait=5000，慢查询降 93%');
  });

  it('无摘录 → 与改造前逐字一致（守恒：只有 [n] 正文 一行）', () => {
    const block = buildRecallPrelude([{ content: '只有摘要' }])!;
    expect(block).toContain('\n[1] 只有摘要\n');
    expect(block).not.toContain('原文摘录');
  });

  it('摘录与正文逐字相同 → 不重复打印同一段话', () => {
    const block = buildRecallPrelude([{ content: '同一段', source_excerpt: '同一段' }])!;
    expect(block).not.toContain('原文摘录');
  });

  it('摘录超长 → 按 MAX_EXCERPT_CHARS 截断（不靠总长度熔断兜底）', () => {
    const block = buildRecallPrelude([{ content: '摘要', source_excerpt: '摘'.repeat(500) }])!;
    const line = block.split('\n').find((l) => l.includes('原文摘录：'))!;
    expect(line.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 20);
  });

  it('多命中时编号连续，摘录不串行', () => {
    const block = buildRecallPrelude([
      { content: 'A', source_excerpt: 'a-raw' },
      { content: 'B' },
      { content: 'C', source_excerpt: 'c-raw' },
    ])!;
    expect(block).toContain('[1] A\n    原文摘录：a-raw');
    expect(block).toContain('[2] B');
    expect(block).toContain('[3] C\n    原文摘录：c-raw');
  });
});
