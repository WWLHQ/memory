/**
 * fold_card_check.mjs 单元测试（2026-11-23，2026-11-24 补硬阻断）
 * 判据：召回卡必须由 show_widget 渲染；有召回且命中>0 必须出卡；零命中可不出；
 *       卡片后不得再有 assistant 正文（2026-11-23 新增，防「卡片在中间+结论重复」）；
 *       该项 2026-11-24 升级为 exit 2 硬阻断（只提醒已经连续 12 次拦不住）。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('fold_card_check 硬阻断（2026-11-24：只提醒拦不住，升级 exit 2）', () => {
  const hook = join(process.cwd(), 'src/electron/host-hooks/fold_card_check.mjs');
  const assistant = (text: string) => JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  const card = JSON.stringify({ type: 'function_call', name: 'show_widget', arguments: { widget_code: '💠 Memory' } });
  const recall = JSON.stringify({
    type: 'function_call_result', name: 'DeferExecuteTool',
    output: { text: JSON.stringify({ request_id: 'req_TEST', hits: [{ mem_id: 'm1' }] }) },
  });

  function runHook(lines: string[], stopHookActive = false) {
    const dir = mkdtempSync(join(tmpdir(), 'fold-card-check-'));
    return runHookAt(dir, lines, stopHookActive);
  }

  /** 复用同一份转录（同一 dir）——用于验证「同一转录只阻断一次」 */
  function runHookAt(dir: string, lines: string[], stopHookActive = false) {
    const tp = join(dir, 'transcript.jsonl');
    writeFileSync(tp, lines.join('\n'), 'utf8');
    const r = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ transcript_path: tp, stop_hook_active: stopHookActive }),
      encoding: 'utf8',
      env: { ...process.env, APPDATA: dir, LOCALAPPDATA: dir },
    });
    let audit = '';
    // dataRoot() → legacyBase() = <APPDATA>/MultiAgent Memory，审计落在其 logs/ 下
    try { audit = readFileSync(join(dir, 'MultiAgent Memory', 'logs', 'fold-card-check-audit.jsonl'), 'utf8'); } catch { /* no audit */ }
    return { ...r, audit, dir };
  }

  it('真脚本：卡后有正文 → exit 2 且 stderr 要求删卡后文字（不是重做整条）', () => {
    const r = runHook([recall, assistant('正文 🔎 本轮召回：req_TEST'), card, assistant('卡后又多说了一句')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('删掉');
    expect(r.stderr).toContain('不要重新调 show_widget');
    expect(r.stdout).toContain('"continue":false');
  });

  it('真脚本·死循环回归：卡后补「卡片已输出」确认话 → 仍 exit 2，但不误报「缺凭证/缺复盘」', () => {
    // 2026-11-24 真因：出卡后又补一句确认话 → extractLastAssistantText 取到那句（无凭证）
    // → 误报缺凭证 → 重做又补话 → 无限循环。修复后：校验取卡前主体正文，只报卡后正文一项。
    const r = runHook([
      recall,
      assistant('正文+复盘+沉淀\n\n🔎 本轮召回：req_TEST'),
      card,
      assistant('（卡片已作为本次回答绝对最后一条内容输出，卡后零文字。）'),
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain('缺 🔎');
    expect(r.stderr).not.toContain('缺凭证');
    expect(r.stderr).toContain('把「最后一张召回卡之后」的 assistant 文字整段删掉');
  });

  it('真脚本：正文→出卡、卡后无正文 → exit 0', () => {
    const r = runHook([recall, assistant('正文 🔎 本轮召回：req_TEST'), card]);
    expect(r.status).toBe(0);
  });

  it('真脚本：仅缺凭证（软违规）不阻断，仍 exit 0 并注入提醒', () => {
    const r = runHook([recall, assistant('正文无凭证'), card]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('凭证行');
  });

  it('真脚本：stop_hook_active 时直接放行，阻断重试不循环', () => {
    const r = runHook([recall, assistant('正文 🔎 本轮召回：req_TEST'), card, assistant('卡后正文')], true);
    expect(r.status).toBe(0);
  });

  // ── 2026-11-24 根治 30 次死循环的两个回归 ──────────────────────────────
  const user = (text: string) => JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'text', text }] });

  it('真脚本·互搏回归：Stop 回灌轮一律放行（不再逼补复盘→又成卡后正文）', () => {
    // 场景：上一轮已出卡+卡后确认话被 block，Stop feedback 注入为新 user 消息，
    // 本轮 assistant 只重写了复盘文字。旧实现会拿上一轮的卡判"卡后正文"再 block → 循环 30 次。
    const feedback = user('Stop hook feedback:\n本轮回答尚未输出「本次会话复盘」…');
    const r = runHook([
      user('真实提问'), assistant('正文+复盘+沉淀 🔎 本轮召回：req_TEST'), card,
      assistant('（卡片已输出，卡后零文字。）'),
      feedback,
      assistant('### 本次会话复盘\n**① …**\n沉淀：跳过\n🔎 本轮召回：req_TEST'),
    ]);
    expect(r.status).toBe(0);
    expect(r.audit).toContain('pass:feedback-turn');
  });

  it('真脚本·跨轮回归：上一轮的卡 + 本轮新提问的正文，不再误判卡后正文', () => {
    // 无 feedback 注入，但用户在上一轮出卡后又发了真实新问题 → 本轮正文不该被旧卡连累
    const r = runHook([
      assistant('上一轮正文 🔎 本轮召回：req_TEST'), card,
      user('用户的下一个真实问题'),
      assistant('本轮正文 🔎 本轮召回：req_TEST2'),
    ]);
    expect(r.status).toBe(0);
  });

  it('真脚本·本轮内违规仍拦：同轮回灌前若有卡后正文，仍 exit 2（防放行过度）', () => {
    // 没有 feedback 注入，卡后正文在同一真实提问轮内 → 必须仍被拦
    const r = runHook([
      user('真实提问'),
      assistant('正文 🔎 本轮召回：req_TEST'), card, assistant('卡后又多说了'),
    ]);
    expect(r.status).toBe(2);
  });

  // ── 2026-11-28 根治「重复卡片 + 重复复盘」───────────────────────────────
  it('真脚本·折叠卡回灌轮禁止输出：写了正文 → exit 2，且要求「一个字都不要写」', () => {
    const fb = user('Stop hook feedback:\n【折叠卡违规·只做一件事】把「最后一张召回卡之后」的 assistant 文字整段删掉即可');
    const r = runHook([
      user('真实提问'), assistant('正文+复盘 🔎 本轮召回：req_TEST'), card,
      assistant('卡后一句'), fb,
      // 旧行为：回灌轮放行 → 模型重写整条 → 第二张卡 + 第二份复盘
      assistant('正文又写一遍+复盘 🔎 本轮召回：req_TEST'), card,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('一个字都不要写');
  });

  it('真脚本·回灌轮零输出 → 放行（合规结束）', () => {
    const fb = user('Stop hook feedback:\n【折叠卡违规·只做一件事】把最后一张召回卡之后的文字删掉');
    const r = runHook([
      user('真实提问'), assistant('正文 🔎 本轮召回：req_TEST'), card,
      assistant('卡后一句'), fb,
    ]);
    expect(r.status).toBe(0);
    expect(r.audit).toContain('pass:feedback-silent');
  });

  it('真脚本·同一转录只阻断一次：第二次违规改提醒放行（阻断不再制造重复重写）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fold-card-check-once-'));
    const bad = [user('真实提问'), assistant('正文 🔎 本轮召回：req_TEST'), card, assistant('卡后正文')];
    const first = runHookAt(dir, bad);
    // 宿主若没传 stop_hook_active 就会连续回灌，旧实现每次都 exit 2 → 无限重写
    const second = runHookAt(dir, bad);
    expect(first.status).toBe(2);
    expect(second.status).toBe(0);
    expect(second.audit).toContain('block-once-skip');
  });

  it('blockedRecently 纯函数：同转录 10 分钟内算已阻断，超时/换转录/空状态都不算', async () => {
    // @ts-expect-error 钩子脚本是 .mjs 产物、无类型声明，这里只取纯函数做单测
    const mod = await import('../../../electron/host-hooks/fold_card_check.mjs') as any;
    const blockedRecently = mod.blockedRecently as (prev: any, tp: string, now: number) => boolean;
    const now = 1_700_000_000_000;
    expect(blockedRecently({ tp: 'a', at: now - 1000 }, 'a', now)).toBe(true);
    expect(blockedRecently({ tp: 'a', at: now - 11 * 60 * 1000 }, 'a', now)).toBe(false);
    expect(blockedRecently({ tp: 'b', at: now - 1000 }, 'a', now)).toBe(false);
    expect(blockedRecently(null, 'a', now)).toBe(false);
  });
});
