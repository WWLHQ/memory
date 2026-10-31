/**
 * electron-builder 正式打包配置（E3）。
 * 与 tools/package-win.cjs 便携包互补：
 *   - 便携包输出 release/win-unpacked（手动测试用，不依赖 node_modules）
 *   - 本配置输出 release/installer（被索引器句柄占用时 package-builder 自动改用
 *     release/installer-<时间戳>），两者互不覆盖
 * 运行时无需 node_modules：main/preload 仅 external electron；
 * pglite / react 等依赖均由 vite 打进 dist 静态资源。
 */
module.exports = {
  appId: 'com.memagent.desktop',
  productName: 'MultiAgent Memory',
  directories: {
    buildResources: 'build-resources',
    output: process.env.MAM_OUTPUT || 'release/installer',
  },
  // 不含 default_app.asar 的 Electron 发行目录（tools/prepare-electron-dist.cjs 生成），
  // 避免该文件被扫描进程占用导致后续构建清理旧输出时 EBUSY。
  electronDist: '.data/electron-dist',
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    '!node_modules/**/*',
  ],
  asarUnpack: ['dist-electron/**/*'],
  npmRebuild: false,
  win: {
    icon: 'build-resources/icon.png',
    target: ['nsis', 'dir'],
    artifactName: '${productName}-${version}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: { target: ['dmg'] },
  linux: { target: ['AppImage'] },
};
