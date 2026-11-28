// #47 防复发门禁：只读检测「T3-PENDING-E2E-TEST 等测试残留记忆」是否回流真实账本。
// 背景：2026-11-14 一批 E2E 测试记忆经 MCP write 注入（category=insight, refined_by=stub,
// llm_calls=0），同日 forget 只降 importance/confidence 未真删，曾污染真实 query 的 top1
// （见 RECALL-WEEK-1.md §4）。该批已于 11-24 tenant-normalize 清空，当前账本为 0。
// 本门禁不改账本、不删记忆，只做检测 + 白名单豁免 + 变异自测，防止测试残留再次回流。
//
// 用法：
//   node tools/check-test-noise.mjs                       # 扫默认数据根（data-root 指针）
//   node tools/check-test-noise.mjs --file <memories.db.json>
//   node tools/check-test-noise.mjs --json                # 机器可读
//   node tools/check-test-noise.mjs --self-test           # 变异自测：造噪音必须判红
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 测试残留正文特征：E2E 测试注入的固定标记。用严格标记，不做宽泛子串匹配。
const NOISE_PATTERNS = [
  /T3-PENDING-E2E-TEST/i,
];

// 白名单：正文虽含上述字样、但属于真实内容，严禁误删/误报。
// 必须写明具体 mem_id + 理由；不按内容模糊放行，避免把真噪音一起放了。
const ALLOWLIST = new Map([
  ['mem_01M843TB17ZH76NKZ4AD6WTJZP', 'codex 汉化脚本工程笔记，正文引用了 E2E-TEST 字样'],
  ['mem_01M843TB6SSNS3W14TYQDQ9392', 'codex 汉化脚本环境笔记，正文引用了 E2E-TEST 字样'],
  ['mem_01M8ENQSTY1PJZJT4EJYNR0TNB', '本轮 #46/#47 方案判据记忆，正文在描述噪音清理任务'],
]);

function parseArgs(argv) {
  const out = { file: undefined, json: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--file' && argv[i + 1]) out.file = argv[++i];
  }
  return out;
}

function defaultDbPath() {
  const pointer = join(homedir(), 'AppData', 'Roaming', 'MultiAgent Memory', 'data-root.json');
  if (existsSync(pointer)) {
    try {
      const p = JSON.parse(readFileSync(pointer, 'utf8'));
      if (p.ledgerDir) return join(p.ledgerDir, 'memories.db.json');
      if (p.root) return join(p.root, 'data', 'memories.db.json');
    } catch { /* 指针损坏 → 回落默认 */ }
  }
  return join(homedir(), 'AppData', 'Roaming', 'MultiAgent Memory', 'data', 'memories.db.json');
}

/** 判断单条记忆是否测试噪音（白名单优先豁免） */
export function isTestNoise(mem) {
  if (!mem || typeof mem !== 'object') return false;
  if (ALLOWLIST.has(mem.mem_id)) return false;
  const text = `${mem.content_l1 ?? ''} ${mem.content ?? ''}`;
  return NOISE_PATTERNS.some((re) => re.test(text));
}

/** 扫描账本，返回噪音命中清单 */
export function scan(dbPath) {
  const hits = [];
  let scanned = 0;
  if (existsSync(dbPath)) {
    const db = JSON.parse(readFileSync(dbPath, 'utf8'));
    const mems = Object.values(db.memories ?? {});
    scanned = mems.length;
    for (const m of mems) {
      if (isTestNoise(m)) {
        hits.push({
          mem_id: m.mem_id,
          why: '测试残留正文命中 T3-PENDING-E2E-TEST 标记',
          excerpt: String(m.content_l1 ?? m.content ?? '').slice(0, 80).replace(/\n/g, ' '),
        });
      }
    }
  }
  return { dbPath, scanned, allowlist: ALLOWLIST.size, hits };
}

/** 变异自测：造一条白名单外的噪音必须判红；白名单内与真实正文必须判绿 */
export function selfTest() {
  const cases = [
    { mem: { mem_id: 'mem_fake_noise', content_l1: 'T3-PENDING-E2E-TEST 测试残留' }, expect: true, why: '噪音必须判红' },
    { mem: { mem_id: 'mem_01M843TB17ZH76NKZ4AD6WTJZP', content_l1: 'T3-PENDING-E2E-TEST' }, expect: false, why: '白名单必须豁免' },
    { mem: { mem_id: 'mem_real', content_l1: '边界条件：采购件需严格检查件号' }, expect: false, why: '真实正文必须判绿' },
    { mem: { mem_id: 'mem_empty', content_l1: '', content: '' }, expect: false, why: '空正文必须判绿' },
  ];
  const results = cases.map((c) => ({ ...c, got: isTestNoise(c.mem), pass: isTestNoise(c.mem) === c.expect }));
  return { ok: results.every((r) => r.pass), results };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.file ? resolve(args.file) : defaultDbPath();
  if (args.selfTest) {
    const st = selfTest();
    if (args.json) console.log(JSON.stringify(st, null, 2));
    else {
      for (const r of st.results) console.log(`[${r.pass ? 'OK' : 'FAIL'}] ${r.why} (got=${r.got}, expect=${r.expect})`);
      console.log(`[check-test-noise] 变异自测 ${st.results.filter((r) => r.pass).length}/${st.results.length}`);
    }
    if (!st.ok) process.exitCode = 1;
    return;
  }
  const result = scan(dbPath);
  result.ok = result.hits.length === 0;
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) {
    console.log(`[check-test-noise] ✅ 通过：扫描 ${result.scanned} 条记忆，测试残留 0 条（白名单 ${result.allowlist} 条豁免）`);
  } else {
    console.error(`[check-test-noise] ❌ 发现 ${result.hits.length} 条测试残留回流：${result.dbPath}`);
    for (const h of result.hits) console.error(`  ${h.mem_id} | ${h.why} | ${h.excerpt}`);
  }
  if (!result.ok) process.exitCode = 1;
}

// 仅作为 CLI 直接运行时执行 main；被单测 import 时不产生副作用。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
