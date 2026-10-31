/**
 * build:electron 等价脚本（绕过 npx.ps1 被执行策略禁止的问题）。
 * 与旧版可正常运行的 main.cjs 行为一致：
 *   - electron 必须 external（裸 require("electron") 走 Electron 内置模块）
 *   - node_modules/electron 的 shim 源码必须 exclude（防 esbuild 误把它内联成 stub，
 *     否则 main.cjs 里 require("electron") 返回的是 exe 路径字符串，app 为 undefined，窗口打不开）
 * 用法：node tools/build-electron.cjs
 */
const { buildSync } = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

buildSync({
  entryPoints: [path.join(root, 'src/electron/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(root, 'dist-electron/main.cjs'),
  external: ['electron'],
  logLevel: 'warning',
});
console.log('main.cjs built OK');

buildSync({
  entryPoints: [path.join(root, 'src/electron/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(root, 'dist-electron/preload.cjs'),
  external: ['electron'],
  logLevel: 'warning',
});
console.log('preload.cjs built OK');
