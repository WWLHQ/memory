/**
 * 生成打包用的 Electron 发行目录（硬链接，几乎不占额外空间），
 * 唯一改动是排除 resources/default_app.asar：
 * 该文件仅用于 Electron 无 app 参数的默认窗口，已打包应用用不到；
 * 在本机它会被工作区扫描进程长期持有句柄，导致 electron-builder
 * 下一次构建清理旧输出时 EBUSY，因此不进入打包产物。
 * 用法：node tools/prepare-electron-dist.cjs（npm run package 会自动执行）
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules/electron/dist');
const dest = path.join(root, '.data/electron-dist');
const version = require(path.join(root, 'node_modules/electron/package.json')).version;
const marker = path.join(dest, '.electron-version');
const EXCLUDE = new Set([path.join('resources', 'default_app.asar')]);

function upToDate() {
  try {
    return (
      fs.readFileSync(marker, 'utf8').trim() === version &&
      !fs.existsSync(path.join(dest, 'resources', 'default_app.asar'))
    );
  } catch {
    return false;
  }
}

function linkOrCopy(from, to) {
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}

function walk(rel) {
  if (EXCLUDE.has(rel)) return;
  const from = path.join(src, rel);
  const to = path.join(dest, rel);
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) walk(path.join(rel, name));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  linkOrCopy(from, to);
}

if (!fs.existsSync(src)) {
  console.error(`electron dist 不存在：${src}（先执行 npm install）`);
  process.exit(1);
}

if (!upToDate()) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) walk(name);
  fs.writeFileSync(marker, `${version}\n`);
  console.log(`electron-dist 已生成（${version}）-> ${path.relative(root, dest)}`);
} else {
  console.log(`electron-dist 已是最新（${version}）`);
}
