/**
 * fold_card_check.mjs 单元测试（2026-11-23 最终版）
 * 判据：召回卡必须由 show_widget 渲染；有召回且命中>0 必须出卡；零命中可不出。
 */
import { describe, it, expect } from 'vitest';

const RECALL_CREDENTIAL = /🔎\s*本轮召回[：:]\s*req_[0-9A-Z]+/;
const RECALL_ZERO_CRED = /⚠\s*本轮召回零命中/;
const HAND_DRAWN_TRIANGLE = /[▶▸▾◄]/;

function validateEcho({ hadRecall, assistantText, hasOutputCard }: { hadRecall: boolean; assistantText: string; hasOutputCard: boolean }) {
  const issues: string[] = [];
  if (hadRecall && !RECALL_CREDENTIAL.test(assistantText) && !RECALL_ZERO_CRED.test(assistantText)) {
    issues.push('本轮已召回但正文缺 🔎 本轮召回：req_xxx 凭证行');
  }
  const isZeroHit = RECALL_ZERO_CRED.test(assistantText);
  if (hadRecall && !isZeroHit && !hasOutputCard) {
    issues.push('本轮召回命中但缺 show_widget 折叠卡');
  }
  if (HAND_DRAWN_TRIANGLE.test(assistantText)) {
    issues.push('正文含手画三角符号');
  }
  const credMatch = RECALL_CREDENTIAL.exec(assistantText);
  if (credMatch) {
    const after = assistantText.slice(credMatch.index + credMatch[0].length).trim();
    if (after.length > 0 && after.length < 120 && /卡片|已输出|已作为|会话最后/.test(after)) {
      issues.push('凭证行后仍有卡片说明文字');
    }
  }
  return issues;
}

describe('fold_card_check 判据（最终版：必须出卡）', () => {
  it('合规：有召回 + 凭证 + 出卡 + 无三角', () => {
    const text = '正文\n\n沉淀：跳过\n\n🔎 本轮召回：req_01M83JADRKQ36ZP01RZY7XV2PH';
    expect(validateEcho({ hadRecall: true, assistantText: text, hasOutputCard: true })).toEqual([]);
  });

  it('零命中合规：有凭证但无卡', () => {
    const text = '正文\n\n⚠ 本轮召回零命中，已回退现查';
    expect(validateEcho({ hadRecall: true, assistantText: text, hasOutputCard: false })).toEqual([]);
  });

  it('无召回：不要求凭证与卡', () => {
    expect(validateEcho({ hadRecall: false, assistantText: '纯问答正文', hasOutputCard: false })).toEqual([]);
  });

  it('漏凭证：有召回有卡但缺 🔎 行', () => {
    const issues = validateEcho({ hadRecall: true, assistantText: '正文\n\n沉淀：跳过', hasOutputCard: true });
    expect(issues.some(i => i.includes('凭证行'))).toBe(true);
  });

  it('漏卡违规：有召回有凭证但没出卡（核心新增判据）', () => {
    const text = '正文\n\n🔎 本轮召回：req_01M83JADRKQ36ZP01RZY7XV2PH';
    const issues = validateEcho({ hadRecall: true, assistantText: text, hasOutputCard: false });
    expect(issues.some(i => i.includes('缺 show_widget'))).toBe(true);
  });

  it('正文手画黑三角：违规', () => {
    const text = '▶ ⚙ 事实优先\n\n🔎 本轮召回：req_01M83JADRKQ36ZP01RZY7XV2PH';
    const issues = validateEcho({ hadRecall: true, assistantText: text, hasOutputCard: true });
    expect(issues.some(i => i.includes('三角'))).toBe(true);
  });

  it('凭证行后有卡片说明文字：违规', () => {
    const text = '正文\n\n🔎 本轮召回：req_01M83JADRKQ36ZP01RZY7XV2PH\n\n卡片已作为会话最后一条内容输出';
    const issues = validateEcho({ hadRecall: true, assistantText: text, hasOutputCard: true });
    expect(issues.some(i => i.includes('说明文字'))).toBe(true);
  });

  it('多问题叠加', () => {
    const issues = validateEcho({ hadRecall: true, assistantText: '▶ 三角\n正文', hasOutputCard: false });
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});
