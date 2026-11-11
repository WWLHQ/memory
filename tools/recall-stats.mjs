// 召回真实数据统计器（批次60 周监控）：从本机审计日志算「真实使用」的召回质量，只读，绝不改账本。
// 为什么需要它：A 方案（覆盖率融合）的收益是用 leave-one-out 评测器证明的，那是「模拟检索」；
//   真实使用里会不会真的更容易搜到，只能看审计里每次 recall 的 hits / evidence_thin / 延迟。
// 设计约束（诚实、可复核）：
//   · 只读 audit.jsonl 与 memories.db.json；--snapshot 只追加一份统计快照到仓库内 specs/reports/。
//   · 不编造指标：缺字段（老审计没有 latency_ms 之类）就如实跳过并在输出里标注覆盖率。
//   · top1 覆盖率用生产的 tokenCoverage 重算（import forgetting.ts），与线上口径一致。
//   · 样本量不足时明确说「不足以下结论」，不给小数精度伪装可信度。
// 用法：
//   node tools/recall-stats.mjs                       # 全量统计（含上线前后对比）
//   node tools/recall-stats.mjs --since 2026-11-12T08:00  # 只看某个时刻之后（通常是重启后）
//   node tools/recall-stats.mjs --json                # 机器可读
//   node tools/recall-stats.mjs --snapshot            # 追加快照到 specs/reports/recall-snapshots.jsonl
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB_FILE_NAME = 'memories.db.json';
const AUDIT_FILE_NAME = 'audit.jsonl';
const ROOT_DIR_NAME = 'MultiAgent Memory';
const POINTER_NAME = 'data-root.json';

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function parseArgs(argv) {
  const a = { since: null, json: false, snapshot: false, file: null, root: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${k} 缺参数值`);
      i += 1;
      return v;
    };
    if (k === '--since') a.since = Date.parse(next());
    else if (k === '--json') a.json = true;
    else if (k === '--snapshot') a.snapshot = true;
    else if (k === '--file') a.file = next();
    else if (k === '--root') a.root = next();
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`未知参数：${k}`);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法：node tools/recall-stats.mjs [--since ISO] [--json] [--snapshot] [--file path] [--root dir]');
  process.exit(0);
}

const forgetting = await import(pathToFileURL(resolve('src/core/memagent/forgetting.ts')).href);
const vector = await import(pathToFileURL(resolve('src/core/memagent/vector.ts')).href);

/** 数据根：--file 指定 audit.jsonl；--root 指定数据根；否则按引导指针回落默认数据根 */
function resolveDataDir() {
  if (args.file) return dirname(resolve(args.file));
  if (args.root) return resolve(args.root);
  const fallback = join(appDataDir(), ROOT_DIR_NAME);
  try {
    const ptr = JSON.parse(readFileSync(join(fallback, POINTER_NAME), 'utf8'));
    if (typeof ptr?.root === 'string' && ptr.root.trim()) return ptr.root.trim();
  } catch {
    // 指针缺失 → 用默认数据根，不猜别处
  }
  return fallback;
}

const dataDir = resolveDataDir();
const auditPath = args.file ? resolve(args.file) : join(dataDir, AUDIT_FILE_NAME);
if (!existsSync(auditPath)) {
  console.error(`审计日志不存在：${auditPath}`);
  console.error('（桌面端没运行过、或数据根换了位置 → 如实报错，不编造数据）');
  process.exit(1);
}

// 账本只用于重算 top1 覆盖率；缺失时不影响其余指标
const dbPath = join(dataDir, DB_FILE_NAME);
let memText = new Map();
if (existsSync(dbPath)) {
  try {
    const db = JSON.parse(readFileSync(dbPath, 'utf8'));
    for (const m of Object.values(db.memories ?? {})) {
      if (m && m.mem_id) memText.set(m.mem_id, m.content_l1 || m.content || '');
    }
  } catch {
    memText = new Map(); // 账本损坏 → 覆盖率指标标为不可用，不用 0 冒充
  }
}

const records = [];
for (const line of readFileSync(auditPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try {
    records.push(JSON.parse(line));
  } catch {
    // 坏行跳过（轮转/半行写入）
  }
}

const recalls = records
  .filter((r) => r.action === 'recall' && r.detail)
  .filter((r) => (args.since ? r.ts >= args.since : true));
const mcpCalls = records
  .filter((r) => r.action === 'mcp_call' && r.detail)
  .filter((r) => (args.since ? r.ts >= args.since : true));

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const rate = (n, d) => (d ? Number((n / d).toFixed(4)) : null);

const withHits = recalls.filter((r) => typeof r.detail.hits === 'number');
const zeroHits = withHits.filter((r) => r.detail.hits === 0).length;
const thinKnown = withHits.filter((r) => typeof r.detail.evidence_thin === 'boolean');
const thin = thinKnown.filter((r) => r.detail.evidence_thin === true).length;
const latencies = recalls.map((r) => r.detail.latency_ms).filter((x) => typeof x === 'number');

// top1 覆盖率：命中排第一的那条，正文到底覆盖了提问多少 token（只有回显高亮的覆盖率能力才能算）
const coverages = [];
for (const r of recalls) {
  const first = Array.isArray(r.detail.mems) ? r.detail.mems[0] : undefined;
  const q = r.detail.query;
  if (!first || typeof q !== 'string' || !q.trim()) continue;
  const text = memText.get(first);
  if (typeof text !== 'string' || !text) continue;
  coverages.push(forgetting.tokenCoverage(new Set(vector.tokenize(q)), new Set(vector.tokenize(text))));
}

// 重复 query：同一条 query 被重复发起（可能是上次没搜到 / 不满意，属于弱信号，只作参考）
const qCount = new Map();
for (const r of recalls) {
  const q = typeof r.detail.query === 'string' ? r.detail.query.trim().toLowerCase() : '';
  if (q) qCount.set(q, (qCount.get(q) ?? 0) + 1);
}
const repeated = [...qCount.values()].filter((n) => n > 1).length;

// 首调合规：可靠会话里第一条就是 recall_memory 的比例（批次47 L3 的审计能力）
const reliable = mcpCalls.filter((r) => r.detail.reliable === true);
const firstRecall = reliable.filter((r) => r.detail.first_call === true && r.detail.tool === 'recall_memory').length;

const sinceLabel = args.since ? new Date(args.since).toISOString() : '全部';
const stats = {
  generated_at: new Date().toISOString(),
  since: sinceLabel,
  audit_file: auditPath,
  recall_calls: recalls.length,
  // 未命中是最直接的「搜不到」信号
  zero_hit_rate: rate(zeroHits, withHits.length),
  hits_known: withHits.length,
  // evidence_thin = 所有命中分都 <0.3，等于「有结果但都很弱」
  evidence_thin_rate: rate(thin, thinKnown.length),
  evidence_thin_known: thinKnown.length,
  avg_hits: withHits.length ? Number(mean(withHits.map((r) => r.detail.hits)).toFixed(2)) : null,
  latency_ms: latencies.length
    ? { p50: pct(latencies, 0.5), p95: pct(latencies, 0.95), max: Math.max(...latencies), n: latencies.length }
    : null,
  top1_coverage_mean: coverages.length ? Number(mean(coverages).toFixed(3)) : null,
  top1_coverage_n: coverages.length,
  repeat_query_rate: rate(repeated, qCount.size),
  first_call_recall_rate: rate(firstRecall, reliable.length),
  mcp_reliable_calls: reliable.length,
  clients: [...new Set(recalls.map((r) => r.detail.client).filter(Boolean))],
};

// 样本量不足时不给「率」的可信度伪装
const caveats = [];
if (recalls.length < 30) caveats.push(`recall 样本仅 ${recalls.length} 次（<30），未命中率/覆盖率不足以单独下结论`);
if (!latencies.length) caveats.push('审计里没有 latency_ms（老版本审计），延迟指标不可用');
if (!coverages.length) caveats.push('top1 覆盖率不可用（账本缺失或命中条目已被删）');
if (!reliable.length) caveats.push('没有可靠会话的 mcp_call 审计，首调合规率不可用');

if (args.json) {
  console.log(JSON.stringify({ ...stats, caveats }, null, 2));
} else {
  console.log(`审计：${auditPath}`);
  console.log(`统计区间：${sinceLabel}｜recall ${stats.recall_calls} 次｜客户端：${stats.clients.join(', ') || '未知'}`);
  console.log('');
  const line = (label, value, extra = '') => console.log(`  ${label.padEnd(20)} ${value}${extra}`);
  line('未命中率 (hits=0)', stats.zero_hit_rate === null ? '不可用' : `${(stats.zero_hit_rate * 100).toFixed(1)}%`, `  (n=${stats.hits_known})`);
  line('证据不足率', stats.evidence_thin_rate === null ? '不可用' : `${(stats.evidence_thin_rate * 100).toFixed(1)}%`, `  (n=${stats.evidence_thin_known})`);
  line('平均命中数', stats.avg_hits ?? '不可用');
  line('top1 覆盖率均值', stats.top1_coverage_mean ?? '不可用', `  (n=${stats.top1_coverage_n})`);
  line('重复 query 占比', stats.repeat_query_rate === null ? '不可用' : `${(stats.repeat_query_rate * 100).toFixed(1)}%`);
  line('首调召回合规率', stats.first_call_recall_rate === null ? '不可用' : `${(stats.first_call_recall_rate * 100).toFixed(1)}%`, `  (可靠会话 ${stats.mcp_reliable_calls})`);
  line('延迟 p50 / p95 / max', stats.latency_ms
    ? `${stats.latency_ms.p50} / ${stats.latency_ms.p95} / ${stats.latency_ms.max} ms`
    : '不可用');
  if (caveats.length) {
    console.log('');
    console.log('注意：');
    for (const c of caveats) console.log(`  - ${c}`);
  }
}

if (args.snapshot) {
  const out = resolve('specs/reports/recall-snapshots.jsonl');
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, JSON.stringify(stats) + '\n', 'utf8');
  console.log('');
  console.log(`快照已追加：${out}`);
}
