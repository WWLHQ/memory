// 网页对话导出完整性审计：纯逻辑回归。
//
// 这套口径回答的是用户 2026-11-17 的原话：
//   「请判断一下导出文档和原对话有无差异，是不是全部导出有无遗漏，正确率如何统计」
//
// 钉死的口径（改任何一条都要同步改这里的断言）：
//   · 「完全一致」= 角色对得上 **且** 正文一字不差
//   · 正确率分母 = 原对话条数（原话是基准，不是导出条数）
//   · 角色判错与正文不一致是**两回事**，分开报，不混成一个数
//   · 拿不到原对话快照时只报「无法比对」，绝不估数
import { describe, it, expect } from 'vitest';
import {
  auditCoverage,
  auditExport,
  normalizeText,
  parseExportMarkdown,
  summarizeAudit,
  type AuditMessage,
} from '../webchatAudit.ts';

const md = (msgs: { role: 'user' | 'assistant'; text: string }[]): string => {
  const lines = ['# 网页对话导出', '', '- 站点：DeepSeek', '- 来源：https://chat.deepseek.com/a/chat/s/x', '- 导出时间：2026-11-17T10:00:00.000Z', '', '---', ''];
  for (const m of msgs) lines.push(m.role === 'user' ? '## 用户' : '## 助手', '', m.text, '');
  return lines.join('\n');
};

describe('导出文档解析', () => {
  it('认得插件固定格式（## 用户 / ## 助手）', () => {
    const out = parseExportMarkdown(md([
      { role: 'user', text: '第一问' },
      { role: 'assistant', text: '第一答' },
    ]));
    expect(out).toEqual([
      { role: 'user', text: '第一问' },
      { role: 'assistant', text: '第一答' },
    ]);
  });

  it('AI 回答里自己写的 markdown 标题与分隔线必须保留（2026-11-17 修的真 bug）', () => {
    // 旧实现对每一行都判 startsWith('# ')/'---' → 正文里的 '# 结论' 被当头部丢掉
    // → 审计误报「被截断」，正确率被算低。
    const src: AuditMessage[] = [{ role: 'assistant', text: '# 结论\n\n---\n\n三段都在' }];
    const out = auditExport(src, md(src));
    expect(out.textExact).toBe(1);
    expect(out.truncated).toBe(0);
    expect(out.rewritten).toBe(0);
    expect(out.accuracy).toBe(1);
  });

  it('正文里的空行与缩进按归一化口径比对，不算差异', () => {
    expect(normalizeText('  a\r\n\r\n  b  ')).toBe('a\n\nb');
    const src: AuditMessage[] = [{ role: 'user', text: '问题一' }];
    const out = auditExport(src, md([{ role: 'user', text: '  问题一  ' }]));
    expect(out.accuracy).toBe(1);
  });
});

describe('导出 vs 原对话：差异分类', () => {
  it('完全一致 → 正确率 100%', () => {
    const src: AuditMessage[] = [
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '答案' },
    ];
    const out = auditExport(src, md(src));
    expect(out.sourceCount).toBe(2);
    expect(out.exportedCount).toBe(2);
    expect(out.matched).toBe(2);
    expect(out.missing).toBe(0);
    expect(out.extra).toBe(0);
    expect(out.accuracy).toBe(1);
  });

  it('导出少了最后一条 → 记「遗漏」，正确率按原话条数算', () => {
    const src: AuditMessage[] = [
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '答案' },
      { role: 'user', text: '追问' },
    ];
    const out = auditExport(src, md(src.slice(0, 2)));
    expect(out.missing).toBe(1);
    expect(out.matched).toBe(2);
    expect(out.accuracy).toBeCloseTo(2 / 3, 5);
    expect(out.issues.join(' ')).toContain('遗漏第 3 条');
  });

  it('导出多了一条 → 记「多余」，且不拉高正确率', () => {
    const src: AuditMessage[] = [{ role: 'user', text: '问题' }];
    const out = auditExport(src, md([
      { role: 'user', text: '问题' },
      { role: 'assistant', text: '多出来的' },
    ]));
    expect(out.extra).toBe(1);
    expect(out.accuracy).toBe(1); // 分母是原话条数，不是导出条数
  });

  it('正文被截断（导出是原话前缀）→ 记「截断」，不算完全一致', () => {
    const src: AuditMessage[] = [{ role: 'assistant', text: '这是一段很长的回答，完整内容在这里' }];
    const out = auditExport(src, md([{ role: 'assistant', text: '这是一段很长的回答' }]));
    expect(out.truncated).toBe(1);
    expect(out.matched).toBe(0);
    expect(out.accuracy).toBe(0);
  });

  it('正文被改写（既不相同也不是前缀）→ 记「改写」', () => {
    const src: AuditMessage[] = [{ role: 'assistant', text: '原始回答' }];
    const out = auditExport(src, md([{ role: 'assistant', text: '完全不同的另一段' }]));
    expect(out.rewritten).toBe(1);
    expect(out.truncated).toBe(0);
  });

  it('角色判错 → 角色错判 +1、正文逐字一致 +1、但「完全一致」不 +1（严格口径）', () => {
    const src: AuditMessage[] = [{ role: 'assistant', text: '我是回答' }];
    const out = auditExport(src, md([{ role: 'user', text: '我是回答' }]));
    expect(out.roleMismatch).toBe(1);
    expect(out.textExact).toBe(1);
    expect(out.matched).toBe(0);
    expect(out.accuracy).toBe(0);
  });

  it('拿不到原对话快照 → 只报「无法比对」，绝不估数', () => {
    const out = auditExport(null, md([{ role: 'user', text: '问题' }]));
    expect(out.sourceCount).toBeNull();
    expect(out.accuracy).toBeNull();
    expect(out.issues.join(' ')).toContain('没有原对话快照');
  });
});

describe('跨会话汇总（正确率总账）', () => {
  it('分母只算带快照的会话，不把没快照的混进来', () => {
    const a: AuditMessage[] = [{ role: 'user', text: 'A' }];
    const b: AuditMessage[] = [{ role: 'user', text: 'B' }, { role: 'assistant', text: 'B2' }];
    const sum = summarizeAudit([
      auditExport(a, md(a)),      // 全对
      auditExport(b, md(b.slice(0, 1))), // 漏一条
      auditExport(null, md(a)),   // 没快照：只计 exportedMessages，不进分母
    ]);
    expect(sum.sessions).toBe(3);
    expect(sum.sessionsWithSnapshot).toBe(2);
    expect(sum.sourceMessages).toBe(3);
    expect(sum.matched).toBe(2);
    expect(sum.missing).toBe(1);
    expect(sum.accuracy).toBeCloseTo(2 / 3, 5);
  });

  it('全部会话都没快照 → 正确率为 null（不是 0，也不是 100%）', () => {
    const sum = summarizeAudit([auditExport(null, md([{ role: 'user', text: 'A' }]))]);
    expect(sum.accuracy).toBeNull();
  });
});

describe('会话覆盖率（有没有漏掉整段会话）', () => {
  const exported = [
    { title: '会话一', url: 'https://chat.deepseek.com/a/chat/s/1', messages: 4 },
    { title: '会话二', url: 'https://chat.deepseek.com/a/chat/s/2', messages: 0 },
  ];

  it('站点 74 条 / 已导 2 条 → 覆盖率与缺口如实报出', () => {
    const c = auditCoverage('deepseek', 74, exported);
    expect(c.totalSessions).toBe(74);
    expect(c.exportedSessions).toBe(2);
    expect(c.emptySessions).toBe(1); // 正文为空：导了等于没导
    expect(c.missingCount).toBe(72);
    expect(c.coverage).toBeCloseTo(2 / 74, 5);
  });

  it('拿到站点会话清单 → 能点名「漏了哪几条」', () => {
    const c = auditCoverage('deepseek', 3, exported, [
      { title: '会话一', url: 'https://chat.deepseek.com/a/chat/s/1' },
      { title: '会话二', url: 'https://chat.deepseek.com/a/chat/s/2' },
      { title: '会话三', url: 'https://chat.deepseek.com/a/chat/s/3' },
    ]);
    expect(c.missingTitles).toEqual(['会话三']);
  });

  it('拿不到基准 → 覆盖率与缺口都是 null（不猜）', () => {
    const c = auditCoverage('deepseek', null, exported);
    expect(c.coverage).toBeNull();
    expect(c.missingCount).toBeNull();
  });

  it('同一 URL 只算一次（重复导出不虚增覆盖率）', () => {
    const c = auditCoverage('deepseek', 10, [
      { title: '会话一', url: 'https://x/1', messages: 2 },
      { title: '会话一', url: 'https://x/1', messages: 2 },
    ]);
    expect(c.exportedSessions).toBe(1);
  });
});
