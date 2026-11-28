/**
 * session_review.mjs「Stop 回灌轮放行」回归测试（2026-11-24 根治 30 次死循环）
 * 真因：fold_card_check 要求「删卡后文字」，session_review 要求「补复盘」，
 *   两个 Stop 钩子对同一条违规末条同时触发 → 指令矛盾 → 补复盘又成卡后正文 → 循环。
 * 修法：isFeedbackTurn() 识别最后一条 user 是 Stop hook 反馈注入 → 本钩子放行。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = join(process.cwd(), 'src/electron/host-hooks/session_review.mjs');

function runHook(lines: string[], stopHookActive = false) {
  const dir = mkdtempSync(join(tmpdir(), 'session-review-'));
  const tp = join(dir, 'transcript.jsonl');
  writeFileSync(tp, lines.join('\n'), 'utf8');
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ transcript_path: tp, stop_hook_active: stopHookActive }),
    encoding: 'utf8',
    env: { ...process.env, APPDATA: dir, LOCALAPPDATA: dir, MEMAGENT_MCP_URL: 'http://127.0.0.1:1/mcp' },
  });
  // 审计落 <dir>/MultiAgent Memory/logs/session-review-audit.jsonl（pick('logs',...) 回落）
  let audit = '';
  for (const p of [
    join(dir, 'MultiAgent Memory', 'session-review-audit.jsonl'), // pick('logs',...) 回落：<root>/<file>
    join(dir, 'MultiAgent Memory', 'logs', 'session-review-audit.jsonl'),
    join(dir, 'logs', 'session-review-audit.jsonl'),
  ]) {
    try { audit = readFileSync(p, 'utf8'); break; } catch { /* try next */ }
  }
  return { ...r, audit };
}

const user = (text: string) => JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'text', text }] });
const assistant = (text: string) => JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const widget = () => JSON.stringify({ type: 'function_call', name: 'show_widget', arguments: { title: '本轮召回统计与明细' } });

describe('session_review.mjs 回灌轮放行（30 次死循环根治）', () => {
  it('Stop feedback 注入轮：即使末条无复盘标题，也放行（不再逼补复盘）', () => {
    const r = runHook([
      user('真实提问'),
      assistant('正文\n\n沉淀：本轮无新耐久知识，跳过'),
      user('Stop hook feedback:\n本轮回答尚未输出「本次会话复盘」…'),
      assistant('已按纠偏删除卡后文字。'), // 无复盘标题、无沉淀行
    ]);
    expect(r.status).toBe(0);
    expect(r.audit).toContain('feedback-turn');
  });

  it('真实提问轮：缺复盘仍阻断（防放行过度）', () => {
    const r = runHook([user('真实提问'), assistant('只有正文，没有复盘和沉淀')]);
    expect(r.status).toBe(0); // session_review 用 block(continue:false) 而非 exit 2
    const out = JSON.parse(r.stdout || '{}');
    expect(out.continue).toBe(false);
    expect(out.reason).toContain('本次会话复盘');
  });

  it('真实提问轮：有复盘+沉淀 → 放行', () => {
    const r = runHook([
      user('真实提问'),
      assistant('正文\n\n### 本次会话复盘\n**① …**\n\n沉淀：本轮无新耐久知识，跳过'),
    ]);
    const out = JSON.parse(r.stdout || '{}');
    expect(out.continue).toBe(true);
  });

  it('stop_hook_active 直接放行', () => {
    const r = runHook([user('真实提问'), assistant('无复盘')], true);
    const out = JSON.parse(r.stdout || '{}');
    expect(out.continue).toBe(true);
  });

  // 2026-11-26 复盘重复根因：取文口径与 fold_card_check 不一致。
  it('卡前已有复盘 + 卡后一句确认话 → 放行（不再逼补第二段）', () => {
    const r = runHook([
      user('真实提问'),
      assistant('正文\n\n### 本次会话复盘\n**① …**\n**② …**\n**③ …**\n**④ …**\n\n沉淀：本轮无新耐久知识，跳过\n\n🔎 本轮召回：req_01M8BXBS150DG84W6FDB8D2TJ1'),
      widget(),
      assistant('（召回卡已输出，卡后无文字）'), // 卡后确认话：不应覆盖卡前复盘
    ]);
    const out = JSON.parse(r.stdout || '{}');
    expect(out.continue).toBe(true);
    expect(r.audit).not.toContain('block:no-review');
  });

  it('卡后确认话含假复盘、卡前无复盘 → 仍阻断（取文口径不被反向骗过）', () => {
    const r = runHook([
      user('真实提问'),
      assistant('只有正文，没有复盘'),
      widget(),
      assistant('### 本次会话复盘\n**① …**\n\n沉淀：本轮无新耐久知识，跳过'),
    ]);
    const out = JSON.parse(r.stdout || '{}');
    expect(out.continue).toBe(false);
    expect(r.audit).toContain('block:no-review');
  });
});
