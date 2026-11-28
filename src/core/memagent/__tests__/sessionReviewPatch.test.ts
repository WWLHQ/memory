/**
 * session_review_patch.mjs「取文口径对齐」回归测试（2026-11-26 根治复盘重复）
 * 真因：三个钩子取文口径不一致——patch 与 session_review 取最后一条 assistant 正文，
 *   fold_card_check 早已用 extractBodyBeforeCard 取卡前主体。出卡后一句确认话
 *   同时触发「补复盘」+「删卡后文字」两条矛盾指令 → 无限循环。
 * 修法：patch / session_review 都改为「有卡取卡前最后一条实质正文」，并补 feedback-turn 放行。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = join(process.cwd(), 'src/electron/host-hooks/session_review_patch.mjs');

function runHook(lines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'session-review-patch-'));
  const tp = join(dir, 'transcript.jsonl');
  writeFileSync(tp, lines.join('\n'), 'utf8');
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ transcript_path: tp }),
    encoding: 'utf8',
    env: { ...process.env, APPDATA: dir, LOCALAPPDATA: dir, MEMAGENT_MCP_URL: 'http://127.0.0.1:1/mcp' },
  });
  let audit = '';
  for (const p of [
    join(dir, 'MultiAgent Memory', 'session-review-patch-audit.jsonl'),
    join(dir, 'MultiAgent Memory', 'logs', 'session-review-patch-audit.jsonl'),
    join(dir, 'logs', 'session-review-patch-audit.jsonl'),
  ]) {
    try { audit = readFileSync(p, 'utf8'); break; } catch { /* try next */ }
  }
  return { ...r, audit };
}

const user = (text: string) => JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'text', text }] });
const assistant = (text: string) => JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const widget = () => JSON.stringify({ type: 'function_call', name: 'show_widget', arguments: { title: '本轮召回统计与明细' } });
const REVIEW = '正文\n\n### 本次会话复盘\n**① …**\n**② …**\n**③ …**\n**④ …**\n\n沉淀：本轮无新耐久知识，跳过\n\n🔎 本轮召回：req_01M8BXBS150DG84W6FDB8D2TJ1';

function injected(r: ReturnType<typeof runHook>): string {
  const out = JSON.parse(r.stdout || '{}');
  return out.hookSpecificOutput?.additionalContext || '';
}

describe('session_review_patch.mjs 取文口径对齐（复盘重复根治）', () => {
  it('卡前已有复盘 + 卡后确认话 → 不再注入【复盘补漏】', () => {
    const r = runHook([user('真实提问'), assistant(REVIEW), widget(), assistant('（召回卡已输出，卡后无文字）')]);
    expect(injected(r)).not.toContain('复盘补漏');
    expect(r.audit).toContain('pass');
  });

  it('卡后假复盘、卡前无复盘 → 仍注入补漏（不被反向骗过）', () => {
    const r = runHook([
      user('真实提问'),
      assistant('只有正文，没有复盘'),
      widget(),
      assistant('### 本次会话复盘\n\n沉淀：本轮无新耐久知识，跳过'),
    ]);
    expect(injected(r)).toContain('复盘补漏');
    expect(r.audit).toContain('patch:no-review');
  });

  it('Stop feedback 回灌轮 → 放行，不重复补漏', () => {
    const r = runHook([
      user('真实提问'),
      assistant('只有正文'),
      user('Stop hook feedback:\n本轮回答尚未输出「本次会话复盘」…'),
      assistant('已按纠偏删除卡后文字。'),
    ]);
    expect(injected(r)).toBe('');
    expect(r.audit).toContain('pass:feedback-turn');
  });

  it('无卡真实轮：缺复盘仍补漏（防放行过度）', () => {
    const r = runHook([user('真实提问'), assistant('只有正文，没有复盘和沉淀')]);
    expect(injected(r)).toContain('复盘补漏');
  });
});
