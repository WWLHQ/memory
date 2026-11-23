// P1-6 离线深度评估（2026-11-23）：真跑 multilingual-e5-small 384 维，与现役 64 维 hash bag 对比。
// 性质：只读评估工具，不写账本、不改生产配置、不引入运行时依赖。
//   · e5-small ONNX 模型/tokenizer 从本地临时目录加载（env.allowRemoteModels=false，全程离线）；
//   · 打分/过滤/融合全部 import 生产代码（forgetting.ts / vector.ts），不复制公式；
//   · 两套口径互相校验：① leave-one-out 客观排名（query 取自记忆自身标题，目标=自己）；
//     ② 真实审计 query 的行为差异（top1 覆盖率 / evidence_thin / 与基线的 top5 重合度，无人工标注故不算质量真值）。
// 用法：node tools/eval-semantic-offline.mjs [--loo 300] [--audit 150] [--model-dir <path>] [--json]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';

const ROOT = resolve('.');
const VECTOR = await import(pathToFileURL(join(ROOT, 'src/core/memagent/vector.ts')).href);
const FORGET = await import(pathToFileURL(join(ROOT, 'src/core/memagent/forgetting.ts')).href);

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const argv = process.argv.slice(2);
const LOO_N = Number(argValue(argv, '--loo', '300'));
const AUDIT_N = Number(argValue(argv, '--audit', '150'));
const JSON_OUT = argv.includes('--json');

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}
function resolveLedgerDir() {
  const base = join(appDataDir(), 'MultiAgent Memory');
  try {
    const ptr = JSON.parse(readFileSync(join(base, 'data-root.json'), 'utf8'));
    if (ptr?.ledgerDir) return ptr.ledgerDir;
    if (ptr?.root) return join(ptr.root, 'data');
  } catch { /* 指针缺失 → 默认数据根 */ }
  return join(base, 'data');
}

const ledgerDir = resolveLedgerDir();
const dbPath = join(ledgerDir, 'memories.db.json');
if (!existsSync(dbPath)) { console.error(`账本不存在：${dbPath}`); process.exit(1); }
const db = JSON.parse(readFileSync(dbPath, 'utf8'));
// 与线上候选集同口径：hardFilter + 有 64 维行向量 + 有正文
const mems = Object.values(db.memories ?? {}).filter(
  (m) => m && m.mem_id && m.content && Array.isArray(m.embedding) && FORGET.hardFilter(m),
);
if (mems.length < 10) { console.error(`可用候选过少：${mems.length}`); process.exit(1); }
// 调试用：小样本快速验证向量对齐（正式评估不传）
const MAX_MEMS = Number(argValue(argv, '--max-mems', '0'));
if (MAX_MEMS > 0) mems.length = Math.min(mems.length, MAX_MEMS);

const modelDir = argValue(argv, '--model-dir', 'C:/Users/LHQ/AppData/Local/Temp/p1-6-eval/');
if (!existsSync(modelDir)) { console.error(`模型目录不存在：${modelDir}`); process.exit(1); }
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = modelDir.replace(/\\/g, '/');
const extract = await pipeline('feature-extraction', 'intfloat/multilingual-e5-small', { device: 'cpu', dtype: 'fp32' });

function textOf(m) { return m.content_l1 || m.content || ''; }
/** e5 要求 query:/passage: 前缀；逐段截断到 1500 字符（模型自身 512 token 上限会再截） */
function prefix(text, kind) { return `${kind}: ${String(text).slice(0, 1500)}`; }
async function embedBatch(texts, kind) {
  const out = [];
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => prefix(t, kind));
    const tensor = await extract(batch, { pooling: 'mean', normalize: true });
    for (let j = 0; j < batch.length; j += 1) {
      out.push(Array.from(tensor.data.slice(j * tensor.dims[1], (j + 1) * tensor.dims[1]), Number));
    }
  }
  return out;
}

console.error(`[1/5] 候选记忆 ${mems.length} 条，开始 e5 文档向量化…`);
const tEmbed = Date.now();
const docVecs = await embedBatch(mems.map(textOf), 'passage');
console.error(`[2/5] 文档向量化完成 ${((Date.now() - tEmbed) / 1000).toFixed(1)}s，384 维`);
// 与 P1-8′ 同口径：正文 tokenSet 只算一次（评估要跑数百 query × 全库，重复分词会主导耗时）
const docTokenSets = mems.map((m) => new Set(VECTOR.tokenize(m.content)));

/** 等距抽样，保证每次跑同一批样本 */
function sampleEvenly(list, n) {
  if (n === 0) return [];
  if (n >= list.length) return list.slice();
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}
/** 标题派生 query（与 tools/eval-recall.mjs 同口径）：首行不足 8 字则用正文前 80 字 */
function queryFrom(text) {
  const first = text.split('\n')[0].trim();
  return first.length >= 8 ? first.slice(0, 120) : text.slice(0, 80);
}
const looTargets = sampleEvenly(mems, LOO_N).filter((m) => queryFrom(textOf(m)).length >= 8);

// 真实审计 query（现役 + 归档），去重后等距抽样；无人工标注，只做行为对比
const auditQueries = [];
try {
  const files = [join(ledgerDir, 'audit.jsonl')];
  const archiveDir = join(ledgerDir, 'audit-archive');
  if (existsSync(archiveDir)) for (const f of readdirSync(archiveDir)) if (f.endsWith('.jsonl')) files.push(join(archiveDir, f));
  const seen = new Set();
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o?.action !== 'recall') continue;
      const q = o.detail?.query;
      if (typeof q === 'string' && q.trim() && !seen.has(q)) { seen.add(q); auditQueries.push(q.trim()); }
    }
  }
} catch (e) { console.error('审计读取失败（继续只做 LOO）:', String(e)); }
const auditSample = sampleEvenly(auditQueries, AUDIT_N);
console.error(`[3/5] LOO query ${looTargets.length} 条，真实审计 query ${auditSample.length} 条，开始 query 向量化…`);
const allQueries = [...looTargets.map((m) => queryFrom(textOf(m))), ...auditSample];
const qVecs = await embedBatch(allQueries, 'query');
console.error(`[4/5] query 向量化完成，开始全量对比打分…`);
if (argv.includes('--debug-align')) {
  for (let i = 0; i < Math.min(3, looTargets.length); i += 1) {
    const a = qVecs[i]; const b = docVecs[i];
    const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0)) || 1;
    const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0)) || 1;
    const cos = a.reduce((s, v, k) => s + v * b[k], 0) / (na * nb);
    console.error('DEBUG_ALIGN', i, 'self_cos', cos.toFixed(4), 'q_len', a.length, 'd_len', b.length, 'q', queryFrom(textOf(looTargets[i])).slice(0, 50));
  }
}

const NOW = Date.now();
const LAMBDA = FORGET.RELEVANCE_FUSION_LAMBDA;
const TOPK = 5;
const VARIANTS = ['baseline', 'e5only', 'e5fusion', 'hybrid'];

function coverageOf(qTokens, docTokens) {
  return FORGET.tokenCoverageWeighted(qTokens, docTokens);
}
function top1Coverage(qTokens, ranked) {
  if (!ranked.length) return 0;
  return FORGET.tokenCoverage(qTokens, new Set(VECTOR.tokenize(ranked[0].m.content)));
}

/** 一次 query 同时算四个变体的排序；cos/覆盖率逐条共用，避免重复分词 */
function rankOne(query, qE5) {
  const qVec64 = VECTOR.embedSync(query);
  const qTokens = new Set(VECTOR.tokenize(query));
  const qE5Norm = Math.sqrt(qE5.reduce((a, v) => a + v * v, 0)) || 1;
  const qE5n = qE5.map((v) => v / qE5Norm);
  const rows = { baseline: [], e5only: [], e5fusion: [], hybrid: [] };
  for (let i = 0; i < mems.length; i += 1) {
    const m = mems[i];
    const cos64 = m.embedding ? VECTOR.cosine(qVec64, m.embedding) : 0;
    const d = docVecs[i];
    let dot = 0; for (let k = 0; k < d.length; k += 1) dot += qE5n[k] * d[k];
    const cosE5 = Math.max(-1, Math.min(1, dot));
    const cov = coverageOf(qTokens, docTokenSets[i]);
    const baseRel = FORGET.fuseRelevance(cos64, cov, LAMBDA);
    const e5Rel = FORGET.fuseRelevance(cosE5, cov, LAMBDA);
    const hybridRel = FORGET.fuseRelevance(0.5 * cos64 + 0.5 * cosE5, cov, LAMBDA);
    rows.baseline.push({ m, relevance: baseRel, score: FORGET.scoreMemory(m, baseRel, NOW) });
    rows.e5only.push({ m, relevance: cosE5, score: FORGET.scoreMemory(m, cosE5, NOW) });
    rows.e5fusion.push({ m, relevance: e5Rel, score: FORGET.scoreMemory(m, e5Rel, NOW) });
    rows.hybrid.push({ m, relevance: hybridRel, score: FORGET.scoreMemory(m, hybridRel, NOW) });
  }
  for (const v of VARIANTS) rows[v].sort((a, b) => b.score - a.score || a.m.mem_id.localeCompare(b.m.mem_id));
  return rows;
}

function jaccard(a, b) {
  const A = new Set(a.map((r) => r.m.mem_id));
  const B = new Set(b.map((r) => r.m.mem_id));
  let hit = 0; for (const id of A) if (B.has(id)) hit += 1;
  return hit / Math.max(1, A.size + B.size - hit);
}

// ① LOO 客观排名
const looStat = Object.fromEntries(VARIANTS.map((v) => [v, { r1: 0, r5: 0, ndcg5: 0, ranks: [] }]));
for (let i = 0; i < looTargets.length; i += 1) {
  const targetId = looTargets[i].mem_id;
  const rows = rankOne(queryFrom(textOf(looTargets[i])), qVecs[i]);
  if (argv.includes('--debug-rank') && i < 3) {
    for (const v of VARIANTS) {
      const rank = rows[v].findIndex((r) => r.m.mem_id === targetId) + 1;
      console.error('DEBUG_RANK', i, v, 'rank', rank, 'target_rel', rows[v].find((r) => r.m.mem_id === targetId)?.relevance.toFixed(4),
        'top1_rel', rows[v][0].relevance.toFixed(4), 'top1_id', rows[v][0].m.mem_id);
    }
  }
  for (const v of VARIANTS) {
    const s = looStat[v];
    const rank = rows[v].findIndex((r) => r.m.mem_id === targetId) + 1;
    s.ranks.push(rank);
    if (rank === 1) s.r1 += 1;
    if (rank > 0 && rank <= TOPK) { s.r5 += 1; s.ndcg5 += 1 / Math.log2(rank + 1); }
  }
}
// ② 真实 query 行为差异（以 baseline 为对照）
const auditStat = Object.fromEntries(VARIANTS.map((v) => [v, {
  top1Cov: 0, thin: 0, overlap5: 0, baselineTop1Kept: 0,
}]));
for (let i = 0; i < auditSample.length; i += 1) {
  const rows = rankOne(auditSample[i], qVecs[looTargets.length + i]);
  const qTokens = new Set(VECTOR.tokenize(auditSample[i]));
  const baseTop = rows.baseline.slice(0, TOPK);
  const baseTop1 = baseTop[0]?.m.mem_id;
  for (const v of VARIANTS) {
    const s = auditStat[v];
    const top = rows[v].slice(0, TOPK);
    s.top1Cov += top1Coverage(qTokens, top);
    if (top.every((r) => r.relevance < 0.3)) s.thin += 1;
    s.overlap5 += jaccard(baseTop, top);
    if (top[0]?.m.mem_id === baseTop1) s.baselineTop1Kept += 1;
  }
}

const pct = (n, d) => (d ? +(100 * n / d).toFixed(1) : 0);
function median(list) {
  const a = list.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
}
const result = {
  generatedAt: new Date().toISOString(),
  ledger: dbPath,
  candidates: mems.length,
  model: 'intfloat/multilingual-e5-small (ONNX O4, fp32, local only)',
  loo_queries: looTargets.length,
  audit_queries: auditSample.length,
  loo: Object.fromEntries(VARIANTS.map((v) => [v, {
    recall_at_1_pct: pct(looStat[v].r1, looTargets.length),
    recall_at_5_pct: pct(looStat[v].r5, looTargets.length),
    ndcg_at_5: +(looStat[v].ndcg5 / Math.max(1, looTargets.length)).toFixed(4),
    median_rank: median(looStat[v].ranks),
  }])),
  audit_behavior: Object.fromEntries(VARIANTS.map((v) => [v, {
    top1_token_coverage: +(auditStat[v].top1Cov / Math.max(1, auditSample.length)).toFixed(4),
    evidence_thin_pct: pct(auditStat[v].thin, auditSample.length),
    top5_jaccard_vs_baseline: +(auditStat[v].overlap5 / Math.max(1, auditSample.length)).toFixed(4),
    baseline_top1_kept_pct: pct(auditStat[v].baselineTop1Kept, auditSample.length),
  }])),
};

if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`\n候选 ${result.candidates} 条 ｜ LOO ${result.loo_queries} query ｜ 真实审计 ${result.audit_queries} query\n`);
  console.log('① LOO 客观排名（目标=query 来源记忆自己）');
  console.table(result.loo);
  console.log('② 真实审计 query 行为（无人工标注，不作为质量真值）');
  console.table(result.audit_behavior);
}
