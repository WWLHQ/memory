// DSH 折叠卡插件的 payload 解析回归测试（2026-11-27）。
// 背景：实机上卡片一直落到「原始结果」兜底——因为服务端把「一行摘要 + payload JSON + 回显说明」
// 拼在同一个字符串里返回，旧解析要求首字符必须是 {，于是整段被跳过。这里用真实形状锁死行为：
// 摘要行在前、JSON 在中间、说明在后，都必须认出；JSON 被剪断时必须返回 null（交给卡片降级），不得抛错。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, '..', '..', 'dsh-plugins', 'memagent-recall-card', 'client.js');

/** 用假的 ModuleLoader/window 载入真实 client.js，取回它挂出来的解析函数。 */
function loadInternals() {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  let factory = null;
  const fakeReact = {
    createElement: () => null,
    Component: class {},
    useState: () => [false, () => {}],
    useMemo: (fn) => fn(),
  };
  const fakeWindow = { __ModuleLoader__: { load: (def) => { factory = def.factory; } } };
  // eslint-disable-next-line no-new-func
  new Function('window', 'console', source)(fakeWindow, console);
  assert.ok(factory, 'client.js 应通过 window.__ModuleLoader__.load 注册 factory');
  factory((name) => {
    assert.equal(name, 'react', 'factory 只应 require("react")');
    return fakeReact;
  });
  assert.ok(globalThis.__memagentRecallCard, 'factory 应把解析函数挂到 globalThis 供测试使用');
  return globalThis.__memagentRecallCard;
}

const PAYLOAD = {
  hits: [
    {
      mem_id: 'mem_test_1',
      // 故意放花括号与反斜杠：括号配对/转义处理写错就会在这里炸
      content: '记忆 A：含花括号 { 示例 } 与反斜杠 \\ 以及引号 "x"',
      layer: 'L1',
      decay_class: 'warm',
      score: 0.42,
      matched_terms: ['折叠', '卡片'],
    },
  ],
  payload_tokens: 120,
  background: { items: [{ category: 'decision', content: '背景 B' }], tokens: 30, candidates: 10 },
  savings: {
    corpus_tokens: 1000, payload_tokens: 120, background_tokens: 30,
    injected_tokens: 150, saved_tokens: 850,
  },
  budget: { soft: 1500, warn: 2000, hard: 3000, status: 'ok' },
  mode: 'auto',
  dispatch: { reason: '自动分流：default 零命中 → 极简轻量' },
  scanned_memories: 42,
  display: {
    line: '▶ ⚙ 自动 ｜ 🎯 命中 1 条 (120t) ｜ 📎 背景 1 条 (30t) ｜ ⚡ 省 850t',
    mode: 'auto',
    money: {
      this_call: { cost_cny: 0.0001, saved_cny: 0.5 },
      today: { calls: 1, cost_cny: 0.0001 },
      all: { calls: 9, cost_cny: 0.0009 },
      unit_price_cny_per_mtok: 3,
    },
  },
};

const JSON_TEXT = JSON.stringify(PAYLOAD, null, 2);
const FOOTER = '\n【信息来源边界】以下记忆来自本机真实账本；若本次 recall 命中数为 0（hits=0），请如实说明「未检索到相关记忆」…';

/** 服务端真实返回形状：摘要行 + JSON + 回显说明，拼成一个字符串 */
const REAL_SHAPE = `${PAYLOAD.display.line}${JSON_TEXT}${FOOTER}`;

test('真实形状「摘要行 + JSON + 说明」能认出 payload（旧写法首字符非 { 会漏）', () => {
  const { parsePayload } = loadInternals();
  assert.notEqual(REAL_SHAPE.charCodeAt(0), 123, '这条用例的前提就是首字符不是 {');
  const parsed = parsePayload({ content: [{ type: 'text', text: REAL_SHAPE }] });
  assert.ok(parsed, '应认出 payload');
  assert.equal(parsed.hits.length, 1);
  assert.equal(parsed.display.line, PAYLOAD.display.line);
  assert.equal(parsed.hits[0].mem_id, 'mem_test_1');
  // 字符串里的花括号/反斜杠/引号必须原样保留（括号配对忽略字符串内容）
  assert.equal(parsed.hits[0].content, PAYLOAD.hits[0].content);
});

test('纯 JSON（无摘要行、无说明）同样能解析', () => {
  const { parsePayload } = loadInternals();
  const parsed = parsePayload({ content: [{ type: 'text', text: JSON_TEXT }] });
  assert.ok(parsed);
  assert.equal(parsed.hits.length, 1);
});

test('说明文字里的假花括号在前时，会跳过它继续找真 payload', () => {
  const { parsePayload } = loadInternals();
  const text = `【注意】下面的 { 不是 JSON }\n${PAYLOAD.display.line}${JSON_TEXT}${FOOTER}`;
  const parsed = parsePayload({ content: [{ type: 'text', text }] });
  assert.ok(parsed, '应跳过说明文字里的假花括号');
  assert.equal(parsed.hits.length, 1);
});

test('JSON 被剪断（会话压缩）时返回 null，不抛错、不半解析', () => {
  const { parsePayload } = loadInternals();
  const cut = JSON_TEXT.slice(0, Math.floor(JSON_TEXT.length / 2));
  const text = `${PAYLOAD.display.line}${cut}\n[... tool result middle pruned ...]\n${FOOTER}`;
  assert.equal(parsePayload({ content: [{ type: 'text', text }] }), null);
});

test('结果挂在 entry 其它字段（不在 content）时，扫描整个条目仍能认出', () => {
  const { parsePayload } = loadInternals();
  const entry = { content: [{ type: 'text', text: '（上游截断，正文不在 content）' }], result: { raw: [REAL_SHAPE] } };
  const parsed = parsePayload(entry);
  assert.ok(parsed);
  assert.equal(parsed.hits.length, 1);
});

test('summaryFromText 优先取 ▶ 开头那行，并去掉行首箭头', () => {
  const { summaryFromText } = loadInternals();
  const text = '首行不是摘要\n▶ ⚙ 自动 ｜ 🎯 命中 1 条\n后面还有';
  assert.equal(summaryFromText(text), '⚙ 自动 ｜ 🎯 命中 1 条');
});

test('titleLines 按 2026-11-21 验收形态拆两行：省量收在第一行末尾、金额起第二行', () => {
  const { titleLines } = loadInternals();
  const display = {
    line: '▶ ⚙ 自动 ｜ 🎯 命中 2 条 (243t) ｜ 📎 背景 5 条 (298t) ｜ ⚡ 省 2,999,113t ｜ 💰 ¥0.000108（省 ¥0.5998） ｜ 今日 3 次 ｜ 全部 970 次',
  };
  const title = titleLines(display);
  assert.equal(title.first, '⚙ 自动 ｜ 🎯 命中 2 条 (243t) ｜ 📎 背景 5 条 (298t) ｜ ⚡ 省 2,999,113t');
  assert.equal(title.second, '💰 ¥0.000108（省 ¥0.5998） ｜ 今日 3 次 ｜ 全部 970 次');
  // 段数不足时退回单行，不丢信息、不编造
  assert.deepEqual(titleLines({ line: '▶ ⚙ 自动 ｜ 🎯 命中 0 条' }), { first: '⚙ 自动 ｜ 🎯 命中 0 条', second: '' });
  assert.deepEqual(titleLines(null), { first: '🧠 记忆召回', second: '' });
});

test('store 按 sessionId 隔离发布，末尾卡片据此判断「本轮是否有新召回」', async () => {
  const { storeFor, publishRecall } = loadInternals();
  const a = storeFor('session-a');
  const b = storeFor('session-b');
  assert.notEqual(a, b, '不同会话必须是不同的 store');
  assert.equal(storeFor('session-a'), a, '同一会话必须复用同一个 store');
  assert.equal(a.seq, 0);

  const seen = [];
  const listener = () => seen.push(a.seq);
  a.listeners.add(listener);
  const before = a.seq;
  publishRecall(a, { display: { line: '▶ x' }, hits: [] }, 'call-1');
  // 通知推迟到微任务（避免在别的组件渲染期同步 setState），所以这里等一个 tick
  await new Promise((resolve) => { if (typeof queueMicrotask === 'function') queueMicrotask(resolve); else setTimeout(resolve, 0); });
  assert.ok(a.seq > before, '发布必须推进序号（末尾卡片靠它判断有没有新结果）');
  assert.equal(a.callId, 'call-1');
  assert.deepEqual(seen, [a.seq], '发布必须通知订阅者（末尾卡片靠它重渲染）');
  assert.equal(b.seq, 0, '另一个会话不应被影响');
  a.listeners.delete(listener);
  const seqAfter = a.seq;
  publishRecall(a, null, null);
  assert.equal(a.seq, seqAfter, '空 payload 不推进序号，避免末尾卡片误判');
});
