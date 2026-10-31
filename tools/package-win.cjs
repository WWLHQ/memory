/**
 * 便携打包（免安装，供人工测试）：Electron 运行时 + dist/dist-electron → release/win-unpacked/
 * 用法：npm run package:win            增量：只替换 resources/app（运行时不变时最快）
 *      npm run package:win -- --refresh-runtime   强制重装 Electron 运行时
 * 产物：release/win-unpacked/MultiAgent Memory.exe，双击即用。
 * 不依赖 electron-builder：main/preload 只 external electron + Node 内置模块，产物无需 node_modules。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const PRODUCT_NAME = 'MultiAgent Memory';
const APP_NAME = pkg.name;
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const outDir = path.join(root, 'release', 'win-unpacked');
const appDir = path.join(outDir, 'resources', 'app');
const exeDst = path.join(outDir, `${PRODUCT_NAME}.exe`);
const refreshRuntime = process.argv.includes('--refresh-runtime');

function fail(msg) {
  console.error(`[package] ${msg}`);
  process.exit(1);
}

for (const p of [
  path.join(electronDist, 'electron.exe'),
  path.join(root, 'dist', 'index.html'),
  path.join(root, 'dist-electron', 'main.cjs'),
  path.join(root, 'dist-electron', 'preload.cjs'),
]) {
  if (!fs.existsSync(p)) fail(`缺少产物：${p}（请先执行 npm run build && npm run build:electron）`);
}

/** 删除目录；被系统占用（AV/索引）时不阻塞打包，留给下次 refresh */
function tryRemove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return true;
  } catch (e) {
    console.warn(`[package] 跳过清理（被占用）：${dir} -> ${e.message}`);
    return false;
  }
}

// 1) Electron 运行时：仅在缺失或显式 --refresh-runtime 时复制
const runtimeReady = fs.existsSync(path.join(outDir, 'electron.exe')) || fs.existsSync(exeDst);
if (!runtimeReady || refreshRuntime) {
  if (runtimeReady && !tryRemove(outDir)) fail('运行时刷新失败：目录被占用，请关闭正在运行的应用后重试');
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(electronDist, outDir, { recursive: true });
}

// 2) 可执行文件重命名（electron.exe → 产品名）
const exeSrc = path.join(outDir, 'electron.exe');
if (fs.existsSync(exeSrc)) {
  if (fs.existsSync(exeDst)) fs.rmSync(exeDst, { force: true });
  fs.renameSync(exeSrc, exeDst);
}

// 3) 应用本体（只替换 resources/app，不触碰 default_app.asar 等运行时文件）
tryRemove(appDir);
fs.mkdirSync(appDir, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'dist-electron'), path.join(appDir, 'dist-electron'), { recursive: true });
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: APP_NAME,
      productName: PRODUCT_NAME,
      version: pkg.version,
      description: pkg.description,
      main: 'dist-electron/main.cjs',
    },
    null,
    2,
  ),
  'utf8',
);

// 4) 产物自检
for (const p of [
  exeDst,
  path.join(appDir, 'package.json'),
  path.join(appDir, 'dist', 'index.html'),
  path.join(appDir, 'dist-electron', 'main.cjs'),
  path.join(appDir, 'dist-electron', 'preload.cjs'),
]) {
  if (!fs.existsSync(p)) fail(`打包产物缺失：${p}`);
}

console.log(`[package] OK -> ${exeDst}`);
console.log(`[package] app : ${appDir}`);