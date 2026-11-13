/**
 * build:electron 等价脚本（绕过 npx.ps1 被执行策略禁止的问题）。
 * 与旧版可正常运行的 main.cjs 行为一致：
 *   - electron 必须 external（裸 require("electron") 走 Electron 内置模块）
 *   - node_modules/electron 的 shim 源码必须 exclude（防 esbuild 误把它内联成 stub，
 *     否则 main.cjs 里 require("electron") 返回的是 exe 路径字符串，app 为 undefined，窗口打不开）
 * 用法：node tools/build-electron.cjs
 */
const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/**
 * pglite 不能打进 CJS：它的 dist 用 import.meta.url 定位 initdb.wasm / pglite.wasm / pglite.data，
 * esbuild 把 import.meta 置空 → new URL(..., undefined) 抛 Invalid URL（默认单机中枢必挂）。
 * 处理：external + 把包（CJS 入口与 wasm/data 资产）复制到 dist-electron/node_modules，
 * 运行期 require 相对解析即可；electron-builder 与 package-win 都随 dist-electron 一起携带。
 */
const PGLITE_SRC = path.join(root, 'node_modules', '@electric-sql', 'pglite');
const PGLITE_DST = path.join(root, 'dist-electron', 'node_modules', '@electric-sql', 'pglite');
function copyPglite() {
  if (!fs.existsSync(PGLITE_SRC)) throw new Error(`缺少依赖：${PGLITE_SRC}`);
  fs.rmSync(PGLITE_DST, { recursive: true, force: true });
  fs.mkdirSync(PGLITE_DST, { recursive: true });
  for (const f of ['package.json', 'LICENSE', 'README.md']) {
    fs.copyFileSync(path.join(PGLITE_SRC, f), path.join(PGLITE_DST, f));
  }
  fs.cpSync(path.join(PGLITE_SRC, 'dist'), path.join(PGLITE_DST, 'dist'), {
    recursive: true,
    filter: (src) => !src.endsWith('.map'), // sourcemap 不参与运行，省 ~4MB
  });
}

buildSync({
  entryPoints: [path.join(root, 'src/electron/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(root, 'dist-electron/main.cjs'),
  external: ['electron', 'pg', '@electric-sql/pglite'],
  logLevel: 'warning',
});
copyPglite();
console.log('main.cjs built OK（pglite 外置并随 dist-electron 携带）');

buildSync({
  entryPoints: [path.join(root, 'src/electron/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(root, 'dist-electron/preload.cjs'),
  external: ['electron', 'pg'],
  logLevel: 'warning',
});
console.log('preload.cjs built OK');

/**
 * 批次62 A 方案：硬前置召回宿主钩子的**打包态产物**。
 * 宿主用系统 node 执行它，拿不到仓库源码、也不能指望原生 TS 剥离 → 必须自包含单文件（ESM）。
 * 入口 recallHookCli.ts 只是 IO 壳，逻辑复用 src/core/memagent/recallHook.ts 与 recallPrelude.ts，
 * 与开发态 `.codebuddy/hooks/force_recall.mjs` 共用同一份实现，避免两份注入逻辑漂移。
 */
buildSync({
  entryPoints: [path.join(root, 'src/core/memagent/recallHookCli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: path.join(root, 'dist-electron/recall-hard/force_recall.mjs'),
  logLevel: 'warning',
});
console.log('recall-hard/force_recall.mjs built OK（自包含 ESM，宿主直接 node 执行）');
