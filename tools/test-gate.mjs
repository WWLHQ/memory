// 全量测试门禁（批次48 A27）：4 分片串行跑全量 vitest，只对 Windows 原生崩溃码重试一次。
//
// 口径（用户 2026-11-06 定稿）：
// - 分片 4 片（`--shards=N` 可调，默认 4）；每片独立进程，降低单进程内存峰值与原生崩溃概率。
// - 仅 `0xC0000409`（STATUS_STACK_BUFFER_OVERRUN）重试一次；其它失败一律不重试。
// - **断言失败绝不重试、绝不吞掉**：只要 JSON 报告里有 failed test / failed suite，立即判红。
// - JSON 报告留档：`test-results/test-gate/<runId>/shard-<i>-a<n>.json` + `summary.json`。
//
// 用法：
//   npm run test:gate
//   node tools/test-gate.mjs --shards=4
//   node tools/test-gate.mjs -- src/web/models/__tests__/a28Tenant.test.ts   # 透传过滤参数（自检/定位用）
//
// 自检（只用于验证「崩溃重试」分支本身，正常跑测试不要用）：
//   MAM_TEST_GATE_SELFTEST_CRASH="2:once"  → 第 2 片第一次尝试模拟原生崩溃，重试一次后真跑
//   MAM_TEST_GATE_SELFTEST_CRASH="2:twice" → 第 2 片两次都模拟原生崩溃，门禁应判红（证明不会无限重试）

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST_BIN = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/** STATUS_STACK_BUFFER_OVERRUN；Windows 上 Node 以有符号 32 位或原值回传，两种都认 */
const NATIVE_CRASH_CODE = 0xC0000409;
const NATIVE_CRASH_CODES = new Set([NATIVE_CRASH_CODE, NATIVE_CRASH_CODE - 0x1_0000_0000]);
const CRASH_TEXT_RE = /0xC0000409|STATUS_STACK_BUFFER_OVERRUN/i;

function parseArgs(argv) {
  const opts = { shards: 4, outDir: null, extra: [] };
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--shards=(\d+)$/.exec(a);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1 && n <= 8) opts.shards = n;
      continue;
    }
    const o = /^--out=(.+)$/.exec(a);
    if (o) {
      opts.outDir = o[1];
      continue;
    }
    opts.extra.push(a); // vitest 过滤参数（文件名 / 用例名片段）
  }
  return opts;
}

function runIdNow() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 失败用例名（JSON 报告里 assertionResults.status === 'failed'） */
function failedTestNames(report) {
  const out = [];
  for (const suite of report?.testResults ?? []) {
    for (const a of suite.assertionResults ?? []) {
      if (a.status === 'failed') out.push(a.fullName || a.title || '(未命名用例)');
    }
  }
  return out;
}

function isCrashExit(exitCode, stderrTail) {
  return NATIVE_CRASH_CODES.has(exitCode) || CRASH_TEXT_RE.test(stderrTail || '');
}

/**
 * 单次尝试归类。判定顺序固定：先看 JSON 报告（断言失败绝不重试），再看退出码/崩溃码。
 * 返回 'pass' | 'assertion-fail' | 'error-fail' | 'crash'
 */
function classifyAttempt({ exitCode, report, stderrTail }) {
  const total = report?.numTotalTests ?? 0;
  if (report && total > 0) {
    if ((report.numFailedTests ?? 0) > 0 || (report.numFailedTestSuites ?? 0) > 0) return 'assertion-fail';
    // success=false 但无失败用例：unhandled error / 收集失败等，不是原生崩溃，不重试
    if (report.success !== true) return 'error-fail';
    // 报告全绿但进程非 0 退出：矛盾，按失败处理（不吞）
    return exitCode === 0 ? 'pass' : 'error-fail';
  }
  // 没有可用报告（崩溃时 vitest 来不及落 JSON）：只有原生崩溃码才允许重试
  return isCrashExit(exitCode, stderrTail) ? 'crash' : 'error-fail';
}

function spawnVitest(args) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [VITEST_BIN, 'run', '--maxWorkers=1', ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout = (stdout + b.toString()).slice(-8000); });
    child.stderr.on('data', (b) => { stderr = (stderr + b.toString()).slice(-8000); });
    child.on('error', (e) => {
      resolvePromise({ exitCode: -1, stdout, stderr: `${stderr}\n${e.message}`, durationMs: Date.now() - startedAt });
    });
    child.on('close', (code, signal) => {
      resolvePromise({
        exitCode: code === null ? -1 : code,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/** 自检：直接给一个「模拟原生崩溃」的尝试结果，不真跑 vitest */
function simulatedCrash(attempt) {
  return {
    exitCode: NATIVE_CRASH_CODE,
    signal: null,
    stdout: '',
    stderr: `[selftest] 模拟原生崩溃 0xC0000409（attempt ${attempt}）`,
    durationMs: 0,
  };
}

function selftestSpec() {
  const raw = process.env.MAM_TEST_GATE_SELFTEST_CRASH || '';
  const m = /^(\d+):(once|twice)$/.exec(raw.trim());
  if (!m) return null;
  return { shard: Number(m[1]), mode: m[2] };
}

const STATUS_TEXT = {
  pass: '通过',
  'assertion-fail': '断言失败',
  'error-fail': '运行失败',
  crash: '原生崩溃',
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runId = runIdNow();
  const outDir = resolve(ROOT, opts.outDir ?? join('test-results', 'test-gate', runId));
  mkdirSync(outDir, { recursive: true });

  if (!existsSync(VITEST_BIN)) {
    console.error(`找不到 vitest：${VITEST_BIN}`);
    process.exit(2);
  }

  const selftest = selftestSpec();
  if (selftest) console.warn(`[自检模式] 第 ${selftest.shard} 片按 "${selftest.mode}" 模拟原生崩溃 0xC0000409`);

  console.log(`全量测试门禁：${opts.shards} 片，报告目录 ${outDir}`);

  const results = [];
  const retries = [];
  const totals = { files: 0, tests: 0, passed: 0, failed: 0 };
  const startedAt = Date.now();

  for (let i = 1; i <= opts.shards; i += 1) {
    const shard = { index: i, status: 'failed', attempts: [] };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const reportFile = join(outDir, `shard-${i}-a${attempt}.json`);
      rmSync(reportFile, { force: true }); // 防上一轮残留报告冒充本轮结果

      const simulate = selftest && selftest.shard === i && (selftest.mode === 'twice' || attempt === 1);
      const raw = simulate
        ? simulatedCrash(attempt)
        : await spawnVitest([
          `--shard=${i}/${opts.shards}`,
          '--reporter=json',
          `--outputFile=${reportFile}`,
          ...opts.extra,
        ]);

      const report = simulate ? null : readJson(reportFile);
      const verdict = classifyAttempt({ exitCode: raw.exitCode, report, stderrTail: raw.stderr });
      const rec = {
        attempt,
        verdict,
        exitCode: raw.exitCode,
        durationMs: raw.durationMs,
        reportFile: simulate || !existsSync(reportFile) ? null : reportFile,
        files: report?.testResults?.length ?? 0,
        tests: report?.numTotalTests ?? 0,
        failed: report?.numFailedTests ?? 0,
        failedTests: simulate ? [] : failedTestNames(report),
      };
      shard.attempts.push(rec);

      const detail = rec.reportFile
        ? `${rec.files} 文件 / ${rec.tests} 例 / 失败 ${rec.failed} 例`
        : `无 JSON 报告（exit=${raw.exitCode}）`;
      console.log(`[片 ${i}/${opts.shards}] 第 ${attempt} 次：${STATUS_TEXT[verdict]}，${detail}，${(raw.durationMs / 1000).toFixed(1)}s`);

      if (verdict === 'pass') {
        shard.status = 'passed';
        break;
      }
      // 只有原生崩溃才允许重试一次；断言失败 / 其它错误立即判红，绝不重试
      if (verdict === 'crash' && attempt === 1) {
        retries.push({ shard: i, attempt, reason: '0xC0000409' });
        console.log(`[片 ${i}/${opts.shards}] 原生崩溃 0xC0000409 → 按口径重试一次`);
        continue;
      }
      if (verdict === 'crash') {
        console.log(`[片 ${i}/${opts.shards}] 重试后仍原生崩溃 → 判红（不无限重试）`);
      }
      shard.status = 'failed';
      if (raw.stdout || raw.stderr) {
        const tail = `${raw.stdout}\n${raw.stderr}`.trim().slice(-1200);
        if (tail) console.log(`[片 ${i}/${opts.shards}] 输出尾部：\n${tail}`);
      }
      break;
    }

    const last = shard.attempts[shard.attempts.length - 1];
    totals.files += last.files;
    totals.tests += last.tests;
    totals.failed += last.failed;
    totals.passed += Math.max(0, last.tests - last.failed);
    results.push(shard);
  }

  // 汇总：任一片失败即整体失败；断言失败不会被重试掩盖
  const status = results.every((s) => s.status === 'passed') ? 'passed' : 'failed';
  const summary = {
    runId,
    status,
    shards: opts.shards,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    command: `vitest run --maxWorkers=1 --shard=i/${opts.shards} --reporter=json${opts.extra.length ? ` ${opts.extra.join(' ')}` : ''}`,
    totals,
    retries,
    results: results.map((s) => ({
      shard: s.index,
      status: s.status,
      attempts: s.attempts,
    })),
  };
  const summaryFile = join(outDir, 'summary.json');
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`\n门禁结果：${status === 'passed' ? '通过' : '失败'} —— ${totals.files} 文件 / ${totals.tests} 例，失败 ${totals.failed} 例，重试 ${retries.length} 次`);
  console.log(`JSON 报告留档：${summaryFile}`);

  process.exit(status === 'passed' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
