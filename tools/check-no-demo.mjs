#!/usr/bin/env node
// 批次42 阶段6 门禁：禁止已清除的演示/种子伪造标识回流到生产代码。
//
// 设计口径（specs/需求规格书.md §批次42 阶段6 + specs/demo-data-baseline.md）：
//   · **白名单清零**：ALLOWLIST 恒为空数组，脚本启动时自检；不允许为任何命中开例外。
//   · **范围界定 ≠ 白名单**：只扫 src/ 下的生产代码；`__tests__`、`*.test.*` 是契约判据与测试夹具，
//     specs/ 历史基线清单、design/ui 原型 HTML、tools/archive 归档脚本、e2e fixtures、.data 演练账本
//     属「非软件资产」，本来就不在扫描范围内，不算例外项。
//   · **不锁种子口令**：`DEFAULT_ADMIN_PASSWORD` / dev 演示账号属 E 类种子与阶段1 安全前置未决项，
//     是真实功能（种子管理员 + 首登提示），不是演示数据回流，故不列入判据；处置另案记录。
//   · **不误伤合法用途**：`slice(0, 8)` 等 9 处分页截断/sha 短码、L2 占位符、脱敏占位符、
//     明示 dry-run、`FakeLlmProvider` 零模型 stub 等 C 类真实语义均不列入判据。
//   · **全站页面判据（P1–P5，2026-11-09）**：判据从工作台壳层扩到**所有生产页面**（`src/web/`），
//     覆盖「写死计数/读数、『—』冒充读数、编造读数措辞、随机数读数」四类；注释行（`//`、`/*`、
//     文档注释）不作为 UI 读数，不参与 P 类判据，避免把「不伪造假数据」这类说明误判为编造措辞。
//     `src/electron`、`src/core`、`src/home` 等非页面代码不在 P 类范围（如后端随机验证码、
//     内核格式化函数不是渲染读数）；壳层与全部页面一律零容忍（口径：不可用就写原因，不填任何假数）。
//   · **变异契约（判据自证）**：默认每次运行会先跑内置自测（临时目录注入四类假数 →
//     必须逐条判红；干净样本 / 注释样本必须判绿）。自测不通过即退出码 1，证明判据本身没被削弱。
//
// 用法：
//   node tools/check-no-demo.mjs                 # 自测 + 扫描仓库；有命中退出码 1
//   node tools/check-no-demo.mjs --json          # 机器可读结果（含 selfTest；供 CI/Agent 消费）
//   node tools/check-no-demo.mjs --root=<dir>   # 覆盖扫描根（自测/复用，默认脚本所在仓库根）
//   node tools/check-no-demo.mjs --self-test     # 只跑内置变异自测
//   node tools/check-no-demo.mjs --help
//
// 接线：package.json `check:no-demo` → `verify:fast` → CI quality-gate / windows-gate 两个 job。
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 扫描根：仅生产代码目录；非软件资产不入扫描（范围界定，不是白名单） */
const SCAN_DIRS = ['src'];
const SCAN_EXT = new Set(['.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-electron', 'release', 'coverage',
  '__tests__', 'archive', '.data', '.git',
]);
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** 白名单清零：任何命中都必须改代码，不得在此登记例外。 */
const ALLOWLIST = [];

/** 判据：全部来自阶段2–5 已清除、且当前生产代码零命中的伪造标识。正则不带 g，避免 lastIndex 漂移。 */
const RULES = [
  { id: 'A01-proxy-catalog', re: /PROXY_CATALOG/, why: '阶段3-B 已删的虚构反代理目录' },
  { id: 'A02-fake-models', re: /claude-free|gpt4o-mini|local-small/, why: '阶段3-A 已删的假模型名' },
  { id: 'A03-demo-flags', re: /forceBreach|forceTimeout|demo-breach|demo-timeout/, why: '阶段2 已删的演示注入开关' },
  { id: 'A04-demo-buttons', re: /模拟硬熔断|模拟超时|异常态演示/, why: '阶段2 已删的演示按钮' },
  { id: 'A05-injected', re: /\bINJECTED\b/, why: '阶段2 已删的演示常量' },
  { id: 'A06-seed-session', re: /session_id:\s*['"]s1['"]/, why: '阶段2 已删的演示 session' },
  { id: 'A07-hardcoded-budget', re: /pipeline_llm_tokens:\s*640|payload_tokens\s*[=:]\s*3100/, why: '阶段2 已删的写死预算值' },
  { id: 'A08-prototype-accounts', re: /\buser_001\b|\bteam_001\b/, why: '阶段5-B 已清的原型账号示例' },
  // 注意：`/overview.html` 是 Electron 主进程的真实入口 URL（src/electron/main.ts），不是假链接，
  // 故判据只锁「占位假链接」的旧声明，不锁 URL 本身。
  { id: 'A09-fake-audit-link', re: /跳检索页占位|REQ-012 待实现/, why: '阶段5-A 已删的占位假链接与过时声明' },
  { id: 'A10-placeholder-toast', re: /占位 toast|占位假链接|跳转处置：[^\n]*（占位）/, why: '阶段5-B 已删的假跳转提示' },
  { id: 'A11-restored-user', re: /restored-user|local-readonly/, why: '阶段5-D 已删的占位租户身份' },
  { id: 'A12-demo-tenant', re: /project=P1|\?\?\s*['"]U1['"]|（演示占位）/, why: '阶段5-D 已删的演示项目/假用户名' },
  { id: 'A13-skip-login', re: /显式跳过门控|不要求登录/, why: '阶段5-D 已删的跳过登录门控声明' },
  { id: 'B01-demo-algo', re: /演示级|演示用内存倒排|契约级演示/, why: '阶段4 已清的演示级算法标注' },
  { id: 'B02-fake-dims', re: /编造 0\.5|0\.2\s*\+\s*0\.2\s*×/, why: '阶段4-E 已删的五维兜底填数' },
  { id: 'B03-kb-prototype', re: /项目\/决策\/偏好\/流程\/事实\/上下文知识|尚未接入写路径/, why: '阶段5-E 已清的原型知识库分类与不实待办声明' },
  { id: 'B04-fake-dedup-action', re: /dedup_action\s*===\s*['"]merge['"]|三模式按钮/, why: '阶段5-E 已删的假查重动作' },
  { id: 'B05-sync-wired', re: /wired:\s*true/, why: '阶段4-H / 5-E 锁定的「同步未接线」边界' },
  { id: 'C01-safe-noop', re: /safe-noop|home server 暂无/, why: '阶段5-C 已清的伪 safe-noop 声明' },
  { id: 'C02-token-bill', re: /\/百万 token|真实 token 节省估算|账本无真实延迟采样|💰 本次 /, why: '阶段5-F 已清的旧金额/token 口径' },
  { id: 'C03-stale-doc', re: /耗时账本未采样/, why: '阶段5-F 已清的过时声明' },
  // 全站页面判据 P1–P5（2026-11-09）：范围 = `src/web/` 全部生产页面（含工作台壳层），
  // 不只看壳层。注释行不作为 UI 读数（skipComments），其余一律零容忍。
  { id: 'P01-page-fake-count', scope: 'src/web/', skipComments: true, re: /\b(count|badge|ratio|big|readout)\s*:\s*['"]?[1-9]/, why: '页面读数不得写死计数/徽标/比值（0 初始化累加器不算读数）' },
  { id: 'P02-page-dash-readout', scope: 'src/web/', skipComments: true, re: /['"]—['"]/, why: '页面不得用「—」冒充真实读数；不可用就写原因' },
  { id: 'P03-page-fixed-reading', scope: 'src/web/', skipComments: true, re: /\b(big|readout)\s*:\s*['"]\d/, why: '概览/状态读数不得写死数字' },
  { id: 'P04-page-fake-wording', scope: 'src/web/', skipComments: true, re: /示例读数|演示读数|假数据|伪造读数/, why: '页面不得出现编造读数措辞' },
  { id: 'P05-page-random-readout', scope: 'src/web/', skipComments: true, re: /Math\.random\(/, why: '页面真实读数不得用随机数生成' },
];

function parseArgs(argv) {
  const rootArg = argv.find((a) => a.startsWith('--root='));
  return {
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
    selfTest: argv.includes('--self-test'),
    root: rootArg ? resolve(rootArg.slice('--root='.length)) : REPO_ROOT,
  };
}

/** 注释行：文档说明不作为 UI 读数参与 P 类判据（避免把「不伪造假数据」说明误判为假数据）。 */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|<!--|\{\/\*)/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (e.isFile() && SCAN_EXT.has(extname(e.name)) && !SKIP_FILE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan(root) {
  const files = SCAN_DIRS.flatMap((d) => walk(join(root, d)));
  const hits = [];
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const rule of RULES) {
        if (rule.scope && !rel.startsWith(rule.scope)) continue;
        if (rule.skipComments && COMMENT_LINE.test(lines[i])) continue;
        if (!rule.re.test(lines[i])) continue;
        hits.push({
          rule: rule.id,
          why: rule.why,
          file: rel,
          line: i + 1,
          text: lines[i].trim().slice(0, 160),
        });
      }
    }
  }
  return { scanned: files.length, rules: RULES.length, allowlist: ALLOWLIST.length, hits };
}

/**
 * 变异契约：在临时目录注入四类假数，逐条断言判据必须判红；再放入干净样本与注释样本，
 * 断言不得误伤。判据被削弱（正则失效/范围漏配）时这里先红，而不是等真实假数回流才发现。
 */
function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), 'mam-no-demo-mut-'));
  const dir = join(root, 'src', 'web', 'fixture');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'FakePage.tsx'), [
    "export const nav = { count: 12, badge: '7', ratio: 4 };",
    "export const card = { big: '9' };",
    "export const cell: string = '—';",
    "export const note = '示例读数';",
    "export const r = Math.random();",
  ].join('\n'), 'utf8');
  writeFileSync(join(dir, 'CleanPage.tsx'), [
    "const acc = { count: 0 }; // 累加器 0 初始化，不是读数",
    "export const cell = '未取数（账本为空）';",
    "export const limit = Math.max(1, 2);",
    "// 历史注释：旧占位符 '—' / '示例读数' 已清除",
  ].join('\n'), 'utf8');
  const result = scan(root);
  const fakeRel = 'src/web/fixture/FakePage.tsx';
  const cleanRel = 'src/web/fixture/CleanPage.tsx';
  const expected = [
    'P01-page-fake-count',
    'P02-page-dash-readout',
    'P03-page-fixed-reading',
    'P04-page-fake-wording',
    'P05-page-random-readout',
  ];
  const checks = expected.map((rule) => ({
    rule,
    fired: result.hits.some((h) => h.rule === rule && h.file === fakeRel),
  }));
  const cleanHits = result.hits.filter((h) => h.file === cleanRel).length;
  rmSync(root, { recursive: true, force: true });
  return { ok: checks.every((c) => c.fired) && cleanHits === 0, checks, cleanHits };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('check-no-demo：扫描 src/ 生产代码，禁止演示/种子伪造标识回流；默认先跑变异自测。');
    console.log('用法：node tools/check-no-demo.mjs [--json] [--root=<dir>] [--self-test] [--help]');
    return;
  }
  if (ALLOWLIST.length !== 0) {
    console.error(`[check-no-demo] 白名单必须为空，当前 ${ALLOWLIST.length} 项。命中请改代码，不要登记例外。`);
    process.exitCode = 1;
    return;
  }
  const selfTest = runSelfTest();
  if (args.selfTest) {
    if (args.json) console.log(JSON.stringify({ selfTest }, null, 2));
    else if (selfTest.ok) console.log('[check-no-demo] ✅ 变异自测通过：四类假数逐条判红，干净/注释样本判绿');
    else for (const c of selfTest.checks) if (!c.fired) console.error(`[check-no-demo] ❌ 变异自测失败：${c.rule} 未判红`);
    if (!selfTest.ok) process.exitCode = 1;
    return;
  }
  if (!selfTest.ok) {
    console.error('[check-no-demo] ❌ 变异自测失败：判据未能识别注入的假数，门禁视为失效。');
    for (const c of selfTest.checks) if (!c.fired) console.error(`  - ${c.rule} 未判红`);
    if (selfTest.cleanHits > 0) console.error(`  - 干净样本误伤 ${selfTest.cleanHits} 处`);
    process.exitCode = 1;
    return;
  }
  const result = scan(args.root);
  result.ok = result.hits.length === 0;
  result.selfTest = selfTest;
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('[check-no-demo] ✅ 变异自测通过：四类假数逐条判红，干净/注释样本判绿');
    console.log(
      `[check-no-demo] 扫描 ${SCAN_DIRS.join('/')} 生产代码 ${result.scanned} 文件 · ` +
      `判据 ${result.rules} 条 · 白名单 ${result.allowlist} 条`,
    );
    console.log('[check-no-demo] ✅ 通过：已清除的演示/伪造标识零命中');
  } else {
    console.error(
      `[check-no-demo] 扫描 ${result.scanned} 文件，发现 ${result.hits.length} 处已清除标识回流（白名单为空，不予豁免）：`,
    );
    for (const h of result.hits) {
      console.error(`  ${h.file}:${h.line}  [${h.rule}] ${h.why}`);
      console.error(`      | ${h.text}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

main();
