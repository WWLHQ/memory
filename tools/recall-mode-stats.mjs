#!/usr/bin/env node
// tools/recall-mode-stats.mjs
// 只读统计 mode_dispatch 审计：动态定位数据根，按 source / mode→applied / weights_source 分组。
// 参考 tools/recall-stats.mjs；不改库、不写审计。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const APP = process.env.APPDATA || process.env.LOCALAPPDATA;
const legacy = APP ? join(APP, 'MultiAgent Memory') : join(homedir(), '.config', 'multiagent-memory');

function dataRootConfig() {
  try { return JSON.parse(readFileSync(join(legacy, 'data-root.json'), 'utf8')); }
  catch { return {}; }
}
const cfg = dataRootConfig();
const root = (typeof cfg.root === 'string' && cfg.root.trim()) ? cfg.root.trim() : legacy;
const ledgerDir = (typeof cfg.ledgerDir === 'string' && cfg.ledgerDir.trim())
  ? cfg.ledgerDir.trim() : join(root, 'data');

const sinceIdx = process.argv.indexOf('--since');
const sinceRaw = sinceIdx >= 0 ? process.argv[sinceIdx + 1] : null;
const since = sinceRaw ? Date.parse(sinceRaw) : NaN;

function* auditFiles() {
  const main = join(ledgerDir, 'audit.jsonl');
  if (existsSync(main)) yield main;
  const arc = join(ledgerDir, 'audit-archive');
  if (existsSync(arc)) {
    for (const f of readdirSync(arc).filter((f) => f.endsWith('.jsonl')).sort()) yield join(arc, f);
  }
}

const rows = [];
for (const f of auditFiles()) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line || !line.includes('mode_dispatch')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.action !== 'mode_dispatch') continue;
    if (!Number.isNaN(since) && !(o.ts >= since)) continue;
    rows.push(o);
  }
}

function group(keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || '(空)';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}
function table(title, entries) {
  console.log(`\n## ${title}（共 ${rows.length} 条）`);
  console.log('| 分组 | 条数 |');
  console.log('|---|---:|');
  for (const [k, v] of entries) console.log(`| ${k} | ${v} |`);
}

console.log(`# mode_dispatch 分布（数据根 ${root} / 账本 ${ledgerDir}${Number.isNaN(since) ? '' : ` / since ${sinceRaw}`}）`);
table('按 source', group((r) => String(r.detail?.source)));
table('按 mode→applied', group((r) => `${String(r.detail?.mode)}→${String(r.detail?.applied_mode)}`));
table('按 weights_source', group((r) => String(r.detail?.weights_source)));

if (rows.length) {
  const ts = rows.map((r) => r.ts).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (ts.length) console.log(`\n首条 ${new Date(ts[0]).toISOString()} ｜ 末条 ${new Date(ts[ts.length - 1]).toISOString()}`);
}
