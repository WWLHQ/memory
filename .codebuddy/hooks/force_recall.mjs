#!/usr/bin/env node
// CodeBuddy Code / WorkBuddy 的 UserPromptSubmit 钩子（开发态薄壳）：用户输入 → 强制召回 → 注入 additionalContext → 再推理。
// 硬前置：由宿主在「模型处理之前」同步执行，模型没有跳过空间；本钩子对任何故障一律 fail-open（只回 continue:true）。
//
// stdin  : {"hook_event_name":"UserPromptSubmit","prompt":"...","session_id":"...","cwd":"..."}
// stdout : {"continue":true} 或 {"continue":true,"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
//
// 本文件只做 IO 分派：召回/拼装逻辑全在 src/core/memagent/recallHook.ts（与打包态产物同一份）。
// 打包态由 tools/build-electron.cjs 把 recallHookCli.ts bundle 成 dist-electron/recall-hard/force_recall.mjs。
//
// 自检（不依赖 8204 在线）：node .codebuddy/hooks/force_recall.mjs --self-test
const MODULE = new URL('../../src/core/memagent/recallHook.ts', import.meta.url).href;

function log(msg) {
  // 只写 stderr：stdout 必须是纯 JSON，且绝不打印令牌、prompt 正文。
  process.stderr.write(`[force_recall] ${msg}\n`);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const isTest = process.argv.includes('--self-test');
  let mod;
  try {
    // Node 22.18+ 原生剥离 TS；旧版会抛错 → 非自检场景 fail-open，绝不猜测降级实现（保持单一真源）。
    mod = await import(MODULE);
  } catch (e) {
    log(`skip: ${String(e?.message ?? e).slice(0, 120)}`);
    if (isTest) throw e;
    return { continue: true };
  }
  if (isTest) {
    process.stdout.write(`${await mod.hookSelfTest()}\n`);
    return null;
  }
  return mod.runHook(await readStdin());
}

try {
  const out = await main();
  if (out) process.stdout.write(JSON.stringify(out));
} catch (e) {
  if (process.argv.includes('--self-test')) {
    process.stderr.write(`${String(e?.message ?? e)}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ continue: true }));
}
