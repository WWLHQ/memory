/**
 * fold_card_check.mjs 单元测试（2026-11-23）
 * 判据：召回卡必须由 show_widget 渲染；有召回且命中>0 必须出卡；零命中可不出；
 *       卡片后不得再有 assistant 正文（2026-11-23 新增，防「卡片在中间+结论重复」）。
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

/** 与钩子 findTextAfterCard 逐字同逻辑：定位最后一张卡与最后一段正文的行号 */
function findTextAfterCard(lines: string[]) {
  let lastCardLine = -1;
  let lastTextLine = -1;
  let lastText = '';
  for (let i = 0; i < lines.length; i += 1) {
    let obj: any;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if ((obj.type === 'function_call' || obj.type === 'tool_use') && obj.name === 'show_widget') lastCardLine = i;
    if (obj.type === 'message' && obj.role === 'assistant' && Array.isArray(obj.content)) {
      const t = obj.content.filter((c: any) => c?.type === 'output_text' || c?.type === 'text').map((c: any) => c.text || '').join('');
      if (t.trim()) { lastTextLine = i; lastText = t; }
    }
  }
  return { lastCardLine, lastTextLine, textAfterCard: lastCardLine >= 0 && lastTextLine > lastCardLine, lastText };
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

describe('findTextAfterCard 卡片后零正文（2026-11-23 新增判据）', () => {
  const card = JSON.stringify({ type: 'function_call', name: 'show_widget' });
  const cardResult = JSON.stringify({ type: 'function_call_result', name: 'show_widget' });
  const assistant = (text: string) => JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

  it('合规：正文→出卡，卡后只有工具结果无正文', () => {
    const r = findTextAfterCard([assistant('正文+复盘+沉淀+🔎'), card, cardResult]);
    expect(r.textAfterCard).toBe(false);
  });

  it('违规（真因复现）：出卡后又输出一版结论 → 卡片夹在中间', () => {
    const r = findTextAfterCard([assistant('第一版评估结论+🔎'), card, cardResult, assistant('第二版：评估已完成并落盘。核心结论…')]);
    expect(r.textAfterCard).toBe(true);
    expect(r.lastText).toContain('第二版');
  });

  it('合规：卡后的空 assistant 消息不算正文', () => {
    const r = findTextAfterCard([assistant('正文+🔎'), card, cardResult, assistant('   ')]);
    expect(r.textAfterCard).toBe(false);
  });

  it('无卡片时不误报', () => {
    const r = findTextAfterCard([assistant('正文'), cardResult]);
    expect(r.textAfterCard).toBe(false);
  });
});
