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
//   · **壳层新增判据（批次48 S1–S8）**：`scope` 仅把判据限定到工作台壳层目录，避免把
//     其它模块合法的计数/类型声明误判；壳层内「写死计数、写死读数、『—』占位、编造读数措辞、
//     随机数读数」一律零容忍（全站口径：不可用就写原因，不填任何假数）。
//
// 用法：
//   node tools/check-no-demo.mjs                 # 扫描仓库；有命中退出码 1
//   node tools/check-no-demo.mjs --json          # 机器可读结果（供 CI/Agent 消费）
//   node tools/check-no-demo.mjs --root=<dir>   # 覆盖扫描根（自测/复用，默认脚本所在仓库根）
//   node tools/check-no-demo.mjs --help
//
// 接线：package.json `check:no-demo` → `verify:fast` → CI quality-gate / windows-gate 两个 job。
import { readdirSync, readFileSync } from 'node:fs';
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
  // 批次48 S1–S8：壳层生产代码不得出现编造读数（scope 限定，避免误伤其它模块合法计数）。
  { id: 'S01-shell-fake-count', scope: 'src/web/shell/', re: /\b(count|badge|ratio)\s*:\s*['"]?\d/, why: '壳层导航/命令不得携带写死的计数或徽标' },
  { id: 'S02-shell-dash-readout', scope: 'src/web/shell/', re: /['"]—['"]/, why: '壳层不得用「—」冒充真实读数' },
  { id: 'S03-shell-fixed-reading', scope: 'src/web/shell/', re: /\b(big|readout)\s*:\s*['"]\d/, why: '概览/状态读数不得写死数字' },
  { id: 'S04-shell-fake-wording', scope: 'src/web/shell/', re: /示例读数|演示读数|假数据|伪造读数/, why: '壳层不得出现编造读数措辞' },
  { id: 'S05-shell-random-readout', scope: 'src/web/shell/', re: /Math\.random\(/, why: '壳层真实读数不得用随机数生成' },
];

function parseArgs(argv) {
  const rootArg = argv.find((a) => a.startsWith('--root='));
  return {
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
    root: rootArg ? resolve(rootArg.slice('--root='.length)) : REPO_ROOT,
  };
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('check-no-demo：扫描 src/ 生产代码，禁止已清除的演示/种子伪造标识回流。');
    console.log('用法：node tools/check-no-demo.mjs [--json] [--root=<dir>] [--help]');
    return;
  }
  if (ALLOWLIST.length !== 0) {
    console.error(`[check-no-demo] 白名单必须为空，当前 ${ALLOWLIST.length} 项。命中请改代码，不要登记例外。`);
    process.exitCode = 1;
    return;
  }
  const result = scan(args.root);
  result.ok = result.hits.length === 0;
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
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
