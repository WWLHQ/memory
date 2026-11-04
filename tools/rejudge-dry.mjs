// 只读回放器（批次36-B）：把真实记忆账本逐条重过当前的 L0→L1 质量门，只出报告，绝不写盘。
// 为什么需要它：规则改了（批次35 收紧、以后还会收紧），存量行不会自己变干净；
//   在动任何一刀之前，先要能回答「按现在的口径，库里有多少条属于该拦未拦、分别是什么码」。
// 设计约束（诚实、可复核）：
//   · 只读：全程 readFileSync，没有任何写操作；报告末尾原样声明这一点。
//   · 判定用的就是生产代码（import qualityGate.ts），不复制规则，避免回放口径与入库口径漂移。
//   · 只喂 content_l1（缺失才退回 content）：判定层不猜、不解密；L0 密文原文不参与回放。
//   · 正文一律截断后才打印；账本里的 L1 已是脱敏产物，但仍不当它是安全的原文外泄。
//   · pinned/locked 单独计数：这两类行在存量重判里受保护，报告里的「可删数」不含它们。
// 用法：
//   npm run rejudge                                   # 回放当前数据根的真实账本
//   npm run rejudge -- --file <path>                  # 指定某个 db.json（如备份文件）
//   npm run rejudge -- --root <数据根目录>             # 指定数据根
//   npm run rejudge -- --code narration --limit 30    # 只看某个拦截码的样本
//   npm run rejudge -- --json                         # 机器可读输出（供脚本对账）
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_FILE_NAME = 'memories.db.json';
const ROOT_DIR_NAME = 'MultiAgent Memory';
const POINTER_NAME = 'data-root.json';

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

/** 数据根解析优先级：--file > --root > 引导指针 > 默认数据根 */
function resolveDbPath(args) {
  if (args.file) return resolve(args.file);
  if (args.root) return join(resolve(args.root), DB_FILE_NAME);
  const fallbackRoot = join(appDataDir(), ROOT_DIR_NAME);
  try {
    const ptr = JSON.parse(readFileSync(join(fallbackRoot, POINTER_NAME), 'utf8'));
    if (typeof ptr?.root === 'string' && ptr.root.trim()) return join(ptr.root.trim(), DB_FILE_NAME);
  } catch {
    // 指针缺失/不可读 → 回落默认数据根，不报错也不猜别的目录
  }
  return join(fallbackRoot, DB_FILE_NAME);
}

function parseArgs(argv) {
  const out = { limit: 10, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--code') out.code = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]) || 10;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function localTime() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' (UTC+08:00)';
}

const clip = (s, n = 46) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('只读回放器：把真实账本逐条重过当前 L0→L1 质量门，只出报告、绝不写盘。\n' +
    '选项：--file <db.json> | --root <数据根> | --code <拦截码> | --limit <N> | --json');
  process.exit(0);
}

const dbPath = resolveDbPath(args);
if (!existsSync(dbPath)) {
  console.error(`账本不存在：${dbPath}\n（--file / --root 可指向真实文件；本工具不会创建或修改任何文件）`);
  process.exit(1);
}

// 生产口径：直接 import 内核的质量门，回放与入库共用同一份规则
const gate = await import(pathToFileURL(resolve('src/core/memagent/qualityGate.ts')).href);
const { checkL0ToL1Quality, QUALITY_GATE_VERSION } = gate;

let doc;
try {
  doc = JSON.parse(readFileSync(dbPath, 'utf8'));
} catch (e) {
  console.error(`账本读不出/解不开：${dbPath}\n原因：${e?.message ?? e}\n（本工具不改文件；请修好后重跑）`);
  process.exit(1);
}
const rows = Object.values(doc?.memories ?? {});

const report = {
  run_at: localTime(),
  db_path: dbPath,
  gate_version: QUALITY_GATE_VERSION,
  total_rows: rows.length,
  tombstones: 0,
  missing_l1: 0,
  passed: 0,
  would_block: 0,
  protected_block: 0,   // 拦下但 pinned/locked 受保护
  deletable: 0,         // 拦下且未受保护 = 存量重判真正会动的行
  by_block_code: {},
  by_block_layer: {},
  by_row_gate_version: {},
  samples: [],
};

for (const m of rows) {
  if (m?.deleted) { report.tombstones++; continue; }
  const v = m?.quality_gate_v ?? 1; // 历史行没这个字段 → 按 v1，绝不猜最新
  report.by_row_gate_version[`v${v}`] = (report.by_row_gate_version[`v${v}`] ?? 0) + 1;

  const text = typeof m?.content_l1 === 'string' && m.content_l1.trim()
    ? m.content_l1
    : (typeof m?.content === 'string' ? m.content : '');
  if (!text.trim()) {
    report.missing_l1++;
    report.would_block++;
    report.by_block_code['no_l1'] = (report.by_block_code['no_l1'] ?? 0) + 1;
    if (m?.pinned || m?.locked) report.protected_block++; else report.deletable++;
    continue;
  }
  const r = checkL0ToL1Quality(text);
  if (r.ok) { report.passed++; continue; }
  report.would_block++;
  const code = r.code ?? 'unspecified';
  report.by_block_code[code] = (report.by_block_code[code] ?? 0) + 1;
  report.by_block_layer[m.layer ?? '?'] = (report.by_block_layer[m.layer ?? '?'] ?? 0) + 1;
  if (m.pinned || m.locked) report.protected_block++;
  else report.deletable++;
  if (!args.code || args.code === code) {
    if (report.samples.length < args.limit) {
      report.samples.push({
        mem_id: m.mem_id, code, reason: r.reason ?? '', layer: m.layer ?? '?',
        row_gate_v: v, protected: Boolean(m.pinned || m.locked), preview: clip(text),
      });
    }
  }
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const line = (k, v) => console.log(`${String(k).padEnd(14)}${v}`);
console.log(`只读回放器 · 质量门 v${QUALITY_GATE_VERSION} · ${report.run_at}`);
console.log(`账本：${report.db_path}\n`);
line('总行数', report.total_rows);
line('墓碑行', `${report.tombstones}（已删除，不重判）`);
line('缺 L1 正文', `${report.missing_l1}`);
line('按行版本戳', Object.entries(report.by_row_gate_version).map(([k, v]) => `${k}:${v}`).join('  ') || '—');
line('重判后放行', report.passed);
line('重判后拦下', report.would_block);
line('其中受保护', `${report.protected_block}（pinned/locked，存量重判不碰）`);
line('本次可删', report.deletable);
console.log('\n拦截码分布：');
const codes = Object.entries(report.by_block_code).sort((a, b) => b[1] - a[1]);
if (codes.length === 0) console.log('  （无）');
for (const [c, n] of codes) console.log(`  ${c.padEnd(16)}${n}`);
console.log('\n按原 layer：');
for (const [l, n] of Object.entries(report.by_block_layer)) console.log(`  ${l.padEnd(6)}${n}`);
console.log(`\n样本${args.code ? `（码=${args.code}）` : ''}：`);
if (report.samples.length === 0) console.log('  （无 / 未命中该码）');
for (const s of report.samples) {
  console.log(`  ${s.mem_id}  [${s.code} · ${s.layer} · 行戳v${s.row_gate_v}${s.protected ? ' · 受保护' : ''}] ${s.preview}`);
}
console.log('\n本次只读，未写任何文件。要按新口径清理存量，请用安全页「规则重判存量」卡（需管理员 + 强制备份）。');
