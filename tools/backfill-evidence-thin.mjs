// #46 可选固化工具：把历史审计行的 evidence_thin 按权威 relevance 口径回填为
// evidence_thin_corrected 新字段（不覆盖原 evidence_thin，审计原貌不动）。
//
// 背景：evidence_thin 口径 18a404c 由 hits.score<0.3 改为 relevance<0.3，字段名不变、
// 历史行无版本标记。resolveEvidenceThin 已能带 mems_detail 时实时重算（recomputed），
// 本脚本把重算结果固化成 corrected 字段，让消费侧零成本拿到权威真值、也便于离线核对。
//
// 安全设计：
//  · 默认 dry-run，只统计不落盘；必须显式 --write 才改账本；
//  · 只新增 evidence_thin_corrected，绝不动原 evidence_thin 及其它字段；
//  · 落盘前在同目录备份 audit.jsonl.bak-<时间戳>；
//  · 原子替换（写 .tmp → rename），句柄占用失败时如实报错、不绕过；
//  · 重算复用内核唯一真源 evidenceThin.ts 的 recomputeFromDetail，不在工具侧重算口径。
//
// 用法：
//   node tools/backfill-evidence-thin.mjs --file <audit.jsonl>            # dry-run 预览
//   node tools/backfill-evidence-thin.mjs --file <audit.jsonl> --write    # 备份后落盘
//   node tools/backfill-evidence-thin.mjs --json                          # 机器可读统计
//   node tools/backfill-evidence-thin.mjs --self-test                     # 变异自测
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// 复用内核唯一真源：recomputeFromDetail 的 every(rel<0.3) 判据，避免工具侧复制口径。
const { recomputeFromDetail } = await import(
  pathToFileURL(resolve('src/core/memagent/evidenceThin.ts')).href
);

const CORRECTED_KEY = 'evidence_thin_corrected';

function parseArgs(argv) {
  const a = { file: undefined, json: false, write: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${k} 缺参数值`);
      i += 1;
      return v;
    };
    if (k === '--file') a.file = next();
    else if (k === '--json') a.json = true;
    else if (k === '--write') a.write = true;
    else if (k === '--self-test') a.selfTest = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function defaultAuditPath() {
  const root = join(appDataDir(), 'MultiAgent Memory');
  const pointer = join(root, 'data-root.json');
  if (existsSync(pointer)) {
    try {
      const p = JSON.parse(readFileSync(pointer, 'utf8'));
      if (p.ledgerDir) return join(p.ledgerDir, 'audit.jsonl');
      if (p.root) return join(p.root, 'data', 'audit.jsonl');
    } catch { /* 指针损坏 → 回落默认 */ }
  }
  return join(root, 'data', 'audit.jsonl');
}

/**
 * 纯函数：对 JSONL 行做回填，返回 { lines, stats }。
 * 只处理 action='recall' 且带 mems_detail 且尚无 corrected 的行；其余原样保留。
 */
export function backfillLines(rawLines) {
  const out = [];
  const stats = {
    total: 0, recall: 0, corrected: 0, skipped: 0,
    thin: 0, notThin: 0, alreadyCorrected: 0, noDetail: 0, badJson: 0,
  };
  for (const line of rawLines) {
    // 保留末尾换行语义：原行（含可能的空行）先记入，下面只对 recall 行替换。
    if (!line.trim()) { out.push(line); continue; }
    stats.total += 1;
    let rec;
    try { rec = JSON.parse(line); } catch { stats.badJson += 1; out.push(line); continue; }
    if (rec.action !== 'recall') { out.push(line); continue; }
    stats.recall += 1;
    const d = rec.detail || {};
    if (typeof d[CORRECTED_KEY] === 'boolean') {
      stats.alreadyCorrected += 1;
      out.push(line);
      continue;
    }
    const value = recomputeFromDetail(d);
    if (value === null) {
      // 无 mems_detail 或取不到 relevance：不可信口径，跳过，不写 corrected。
      stats.noDetail += 1;
      stats.skipped += 1;
      out.push(line);
      continue;
    }
    rec.detail = { ...d, [CORRECTED_KEY]: value };
    if (value) stats.thin += 1; else stats.notThin += 1;
    stats.corrected += 1;
    out.push(JSON.stringify(rec));
  }
  return { lines: out, stats };
}

function selfTest() {
  const results = [];
  const check = (why, got, expect) => results.push({ why, got, expect, pass: got === expect });
  const mk = (detail, action = 'recall') => JSON.stringify({ ts: 1, action, detail });
  const lowDetail = { evidence_thin: true, mems_detail: [['a', 0.1, 1, 0.5, 0.5, 1], ['b', 0.2, 1, 0.5, 0.5, 1]] };
  const highDetail = { evidence_thin: true, mems_detail: [['a', 0.1, 1, 0.5, 0.5, 1], ['b', 0.8, 1, 0.5, 0.5, 1]] };

  const r = backfillLines([
    mk(lowDetail),                                  // 旧口径 true，relevance 全低 → corrected=true
    mk(highDetail),                                 // 旧口径 true，有一条高 → corrected=false（假象被纠正）
    mk({ evidence_thin: true }),                    // 无明细 → 跳过
    mk({ evidence_thin: false, [CORRECTED_KEY]: true }), // 已有 corrected → 不覆盖
    mk({ hits: 2 }, 'gc'),                          // 非 recall 行 → 原样
    'not a json',                                   // 坏行 → 原样
  ]);
  const parsed = r.lines.filter((l) => { try { JSON.parse(l); return true; } catch { return false; } }).map((l) => JSON.parse(l));
  const recallRows = parsed.filter((x) => x.action === 'recall');
  check('回填数=2（仅带明细且无 corrected）', r.stats.corrected, 2);
  check('thin=1（relevance 全低）', r.stats.thin, 1);
  check('notThin=1（有一条高相关，旧假象被纠正）', r.stats.notThin, 1);
  check('无明细跳过=1', r.stats.noDetail, 1);
  check('已 corrected 不重复回填=1', r.stats.alreadyCorrected, 1);
  check('坏行原样保留', r.stats.badJson, 1);
  check('原 evidence_thin 保留（低相关行仍 true）', recallRows[0].detail.evidence_thin, true);
  check('corrected 写入低相关行=true', recallRows[0].detail[CORRECTED_KEY], true);
  check('corrected 写入高相关行=false', recallRows[1].detail[CORRECTED_KEY], false);
  check('已有 corrected 行保持 true 不被覆盖', recallRows[3].detail[CORRECTED_KEY], true);
  check('非 recall 行不新增字段', ('evidence_thin_corrected' in (parsed.find((x) => x.action === 'gc')?.detail || {})), false);

  const pass = results.filter((x) => x.pass).length;
  for (const x of results) console.log(`[${x.pass ? 'OK' : 'FAIL'}] ${x.why} (got=${x.got}, expect=${x.expect})`);
  console.log(`[backfill-evidence-thin] 变异自测 ${pass}/${results.length}`);
  if (pass !== results.length) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node tools/backfill-evidence-thin.mjs [--file <audit.jsonl>] [--write] [--json] [--self-test]');
    return;
  }
  if (args.selfTest) { selfTest(); return; }

  const auditPath = args.file ? resolve(args.file) : defaultAuditPath();
  if (!existsSync(auditPath)) {
    console.error(`[backfill-evidence-thin] ❌ 账本不存在: ${auditPath}（用 --file 显式指定）`);
    process.exitCode = 1;
    return;
  }
  const raw = readFileSync(auditPath, 'utf8');
  const lines = raw.split('\n');
  const { lines: out, stats } = backfillLines(lines);

  if (args.write && stats.corrected > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = `${auditPath}.bak-${stamp}`;
    writeFileSync(bak, raw, 'utf8');
    const tmp = `${auditPath}.backfill-tmp`;
    writeFileSync(tmp, out.join('\n'), 'utf8');
    try {
      renameSync(tmp, auditPath);
    } catch (e) {
      // 原子替换失败（如桌面端持有句柄）：删临时文件、保留备份、如实报错，不绕过。
      try { writeFileSync(tmp, ''); } catch { /* ignore */ }
      console.error(`[backfill-evidence-thin] ❌ 原子替换失败，账本未改动；备份在 ${bak}；错误: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    stats.backup = bak;
    stats.written = true;
  } else {
    stats.written = false;
    stats.backup = null;
  }

  if (args.json) console.log(JSON.stringify({ auditPath, ...stats }, null, 2));
  else {
    const mode = args.write ? '已落盘' : 'DRY-RUN（未落盘）';
    console.log(`[backfill-evidence-thin] ${mode}: 总行=${stats.total} recall=${stats.recall} 回填=${stats.corrected} (thin=${stats.thin}/非thin=${stats.notThin}) 已有=${stats.alreadyCorrected} 无明细跳过=${stats.noDetail} 坏行=${stats.badJson}`);
    if (stats.backup) console.log(`  原账本备份: ${stats.backup}`);
    if (!args.write) console.log('  预览模式；加 --write 才落盘（自动备份）');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
