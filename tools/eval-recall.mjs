// 召回效果评测器（批次60）：回答「一条记忆能不能被它自己的内容检索回来」，只出报告，绝不写盘。
// 为什么需要它：光看单条 query 命中不了，分不清是「query 不好」还是「排序坏了」；
//   调打分权重（A/B/C 方案）之前必须先有一条可复现的基准线，否则「效果变好了」只是感觉。
// 设计约束（诚实、可复核）：
//   · 只读：全程 readFileSync，没有任何写操作。
//   · 判定用的是生产代码（import forgetting.ts / vector.ts），不复制打分与分词，避免评测口径与线上漂移。
//   · leave-one-out：拿每条自己的内容派生 query，再看它在全库里的排名——目标条目恒为「自己」，
//     所以不需要人工标注，也不会因为标注偏好而偏袒某个方案。
//   · 按正文长度分档输出：这是本缺陷（长文被余弦稀释）能否被修好的唯一直接证据。
//   · 采样用等距抽样（非随机）→ 同一份账本每次跑出同一批样本，前后对比才可比。
// 用法：
//   node tools/eval-recall.mjs                          # 真实账本，200 条，标题+正文两种 query
//   node tools/eval-recall.mjs --limit 0                # 全量（慢）
//   node tools/eval-recall.mjs --lambda 0.3             # 试 A 方案融合强度（0=基线，纯余弦）
//   node tools/eval-recall.mjs --strategy title         # 只用首行标题派生 query
//   node tools/eval-recall.mjs --json                   # 机器可读（供前后对比脚本对账）
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

/** 数据根解析优先级：--file > --root > 引导指针 > 默认数据根（与 rejudge-dry.mjs 同口径） */
function resolveDbPath(args) {
  if (args.file) return resolve(args.file);
  if (args.root) return join(resolve(args.root), DB_FILE_NAME);
  const fallbackRoot = join(appDataDir(), ROOT_DIR_NAME);
  try {
    const ptr = JSON.parse(readFileSync(join(fallbackRoot, POINTER_NAME), 'utf8'));
    if (typeof ptr?.root === 'string' && ptr.root.trim()) return join(ptr.root.trim(), DB_FILE_NAME);
  } catch {
    // 指针缺失/不可读 → 回落默认数据根，不猜别的目录
  }
  return join(fallbackRoot, DB_FILE_NAME);
}

function parseArgs(argv) {
  const a = { limit: 200, strategy: 'both', lambda: 0, json: false, file: null, root: null, qlen: 0, diagnose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${k} 缺参数值`);
      i += 1;
      return v;
    };
    if (k === '--limit') a.limit = Number(next());
    else if (k === '--strategy') a.strategy = next();
    else if (k === '--lambda') a.lambda = Number(next());
    else if (k === '--json') a.json = true;
    else if (k === '--file') a.file = next();
    else if (k === '--root') a.root = next();
    else if (k === '--qlen') a.qlen = Number(next());
    else if (k === '--diagnose') a.diagnose = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`未知参数：${k}`);
  }
  return a;
}

/** 等距抽样：同一份账本每次得到同一批样本，保证前后对比可比 */
function sampleEvenly(list, n) {
  if (n <= 0 || n >= list.length) return list.slice();
  const step = list.length / n;
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(list[Math.floor(i * step)]);
  return out;
}

/** 正文长度分档：<500 / 500–1500 / >1500。长文是本次缺陷的嫌疑区，必须单独看 */
function bucketOf(len) {
  if (len < 500) return '短(<500)';
  if (len <= 1500) return '中(500-1500)';
  return '长(>1500)';
}

/** query 派生：title = 首行标题；body = 正文中间一段（模拟用户问正文细节，而不是复述开头）。
 *  qlen 覆盖默认长度：真实用户提问通常很短，长 query 会让覆盖率失去区分度（诊断用）。 */
function queryFrom(text, strategy, qlen) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (strategy === 'title') {
    return flat.split(/[\n。；！？]/)[0].slice(0, qlen || 40);
  }
  const mid = Math.floor(flat.length / 2);
  return flat.slice(mid, mid + (qlen || 60)).trim();
}

/** query 覆盖率：query 的 token 有多少比例在正文里出现过（A 方案的核心信号） */
function coverageOf(qSet, dSet) {
  if (qSet.size === 0) return 0;
  let hit = 0;
  for (const t of qSet) if (dSet.has(t)) hit += 1;
  return hit / qSet.size;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法：node tools/eval-recall.mjs [--limit N] [--strategy title|body|both] [--lambda L] [--json] [--file path] [--root dir]');
  process.exit(0);
}

const vector = await import(pathToFileURL(resolve('src/core/memagent/vector.ts')).href);
const forgetting = await import(pathToFileURL(resolve('src/core/memagent/forgetting.ts')).href);

const dbPath = resolveDbPath(args);
if (!existsSync(dbPath)) {
  console.error(`账本不存在：${dbPath}`);
  process.exit(1);
}
const db = JSON.parse(readFileSync(dbPath, 'utf8'));
const map = db.memories ?? {};
const all = Object.values(map).filter(
  (m) => m && m.mem_id && Array.isArray(m.embedding) && (m.content_l1 || m.content),
);

// 预计算正文 token 集（coverage 要反复用；2911 条 × 200 query 若每次重分词会慢到不可用）
const textOf = (m) => m.content_l1 || m.content || '';
const tokenSetCache = new Map();
for (const m of all) tokenSetCache.set(m.mem_id, new Set(vector.tokenize(textOf(m))));

const strategies = args.strategy === 'both' ? ['title', 'body'] : [args.strategy];
const now = Date.now();
const results = [];

for (const strategy of strategies) {
  const targets = sampleEvenly(all, args.limit);
  const ranks = [];
  const perBucket = new Map();
  const diagTarget = [];
  const diagAll = [];

  for (const target of targets) {
    const q = queryFrom(textOf(target), strategy, args.qlen);
    if (!q) continue;
    const qvec = vector.embedSync(q);
    const qSet = new Set(vector.tokenize(q));

    const scored = [];
    let targetCov = null;
    for (const m of all) {
      // 与线上一致：先过硬过滤（pinned 免检 / 只扫 hot+warm）
      if (!forgetting.hardFilter(m)) continue;
      const cos = vector.cosine(qvec, m.embedding);
      let rel = cos;
      if (args.lambda > 0 || args.diagnose) {
        const cov = coverageOf(qSet, tokenSetCache.get(m.mem_id));
        if (m.mem_id === target.mem_id) targetCov = cov;
        if (args.diagnose) diagAll.push(cov);
        if (args.lambda > 0) {
          // 用生产函数融合，不在这里另写一份公式——否则评测口径会与线上漂移
          rel = forgetting.fuseRelevance(cos, cov, args.lambda);
        }
      }
      scored.push({ id: m.mem_id, score: forgetting.scoreMemory(m, rel, now) });
    }
    // 稳定排序：score 相同按 id 定序，避免并列抖动影响对比
    scored.sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
    const rank = scored.findIndex((r) => r.id === target.mem_id) + 1;
    if (rank === 0) continue; // 目标自己没过 hardFilter（如 cold/dormant），不计入分母
    ranks.push(rank);
    if (args.diagnose && targetCov !== null) diagTarget.push(targetCov);

    const b = bucketOf(textOf(target).length);
    if (!perBucket.has(b)) perBucket.set(b, []);
    perBucket.get(b).push(rank);
  }

  const rec5 = ranks.filter((r) => r <= 5).length / ranks.length;
  const mrr10 = ranks.reduce((s, r) => s + (r <= 10 ? 1 / r : 0), 0) / ranks.length;
  const median = (arr) => {
    const s = arr.slice().sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const buckets = {};
  for (const [name, rs] of perBucket.entries()) {
    buckets[name] = {
      n: rs.length,
      recall5: Number((rs.filter((r) => r <= 5).length / rs.length).toFixed(4)),
      mrr10: Number((rs.reduce((s, r) => s + (r <= 10 ? 1 / r : 0), 0) / rs.length).toFixed(4)),
      median_rank: median(rs),
    };
  }
  const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) * p)];
  };
  results.push({
    strategy,
    lambda: args.lambda,
    n: ranks.length,
    recall5: Number(rec5.toFixed(4)),
    mrr10: Number(mrr10.toFixed(4)),
    median_rank: median(ranks),
    buckets,
    // 覆盖率区分度诊断：目标覆盖率若与全员几乎一样（gap≈0），说明 coverage 只是长度偏置的反向，
    // 那么 A 方案的高分就是「词袋自我包含」的同义反复，不能当成真实效果提升。
    coverage: args.diagnose && diagTarget.length
      ? {
        target_mean: Number(mean(diagTarget).toFixed(3)),
        all_mean: Number(mean(diagAll).toFixed(3)),
        all_p90: Number(pct(diagAll, 0.9).toFixed(3)),
        all_p99: Number(pct(diagAll, 0.99).toFixed(3)),
        gap: Number((mean(diagTarget) - mean(diagAll)).toFixed(3)),
      }
      : null,
  });
}

if (args.json) {
  console.log(JSON.stringify({ db: dbPath, total: all.length, results }, null, 2));
} else {
  console.log(`账本：${dbPath}`);
  console.log(`可评测条目：${all.length}（有向量且有条目正文）｜融合强度 λ=${args.lambda}（0=纯余弦基线）`);
  for (const r of results) {
    console.log('');
    console.log(`策略=${r.strategy}  N=${r.n}  Recall@5=${(r.recall5 * 100).toFixed(1)}%  MRR@10=${r.mrr10.toFixed(3)}  排名中位数=${r.median_rank}`);
    for (const name of ['短(<500)', '中(500-1500)', '长(>1500)']) {
      const b = r.buckets[name];
      if (!b) continue;
      console.log(`  ${name.padEnd(12)} N=${String(b.n).padStart(4)}  Recall@5=${(b.recall5 * 100).toFixed(1)}%  MRR@10=${b.mrr10.toFixed(3)}  中位排名=${b.median_rank}`);
    }
    if (r.coverage) {
      console.log(`  ── 覆盖率：目标=${r.coverage.target_mean} 全员均值=${r.coverage.all_mean} p90=${r.coverage.all_p90} p99=${r.coverage.all_p99} 差值=${r.coverage.gap}`);
      if (r.coverage.gap < 0.05) console.log('     ⚠ 差值 <0.05：coverage 几乎无区分度，A 方案的提升可能是同义反复，不能采信');
    }
  }
  console.log('');
  console.log('口径：leave-one-out 自检索；目标条目排名在全库（按生产 scoreMemory 打分）中取；未过 hardFilter 的目标不计入。');
}
