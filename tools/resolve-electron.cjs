// 用 win-unpacked 的 Electron 34.5.8 验证：在【干净 CWD】下，
// require("electron") 到底解析到哪里（内置模块 vs 项目根目录 node_modules/electron shim）。
// 注意：必须用 -e 方式跑（Electron 的 --version/-e 会走 ELECTRON_RUN_AS_NODE 模式），
// 且把 exe 复制到中性目录（如 C:\temp），避免 CWD 落在项目树内。
const dbg = (m) => console.error('[resolve]', m);
dbg('cwd=' + process.cwd());
dbg('execPath=' + process.execPath);
dbg('versions.electron=' + process.versions.electron + ' node=' + process.versions.node);

try {
  const el = require('electron');
  dbg('type=' + typeof el + ' isFunc=' + (typeof el === 'function'));
  dbg('val=' + (el && typeof el === 'object' ? Object.keys(el).slice(0, 12).join(',') : String(el).slice(0, 150)));
  dbg('el.app=' + (el && el.app ? 'DEFINED' : 'UNDEFINED'));
} catch (e) {
  dbg('require("electron") THREW: ' + e.message);
}

try {
  const resolved = require.resolve('electron');
  dbg('require.resolve("electron") = ' + resolved);
} catch (e) {
  dbg('require.resolve THREW: ' + e.message);
}
