// 硬前置召回 A 方案 · CLI 壳（打包态入口）。
//
// `tools/build-electron.cjs` 用 esbuild 把本文件 bundle 成
// `dist-electron/recall-hard/force_recall.mjs`（自包含、零依赖、无需 TS 剥离 / node_modules），
// 宿主 hooks 指向这份产物；开发态则走 `.codebuddy/hooks/force_recall.mjs`（薄壳 import 同一份 recallHook.ts）。
//
// 这里只做 IO 适配，不含任何召回/拼装逻辑 → 两份入口不会漂移。
import { hookSelfTest, runHook } from './recallHook.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(`${await hookSelfTest()}\n`);
} else {
  process.stdout.write(JSON.stringify(await runHook(await readStdin())));
}
