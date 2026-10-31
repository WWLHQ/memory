/**
 * electron-builder 包装（npm run package 调用）。
 * 输出策略：优先 release/installer；打包前先强制结束本仓库 release/ 下运行中的旧实例（批次19，用户要求），
 * 旧目录再重命名到 installer-<时间戳>-stale（原子操作，避免运行中实例被边删边失败），构建成功后再清理；
 * 重命名仍被占用时改用带时间戳的新目录，保证打包命令任何时候都可重复执行。
 * 空间策略：打包成功后只保留本次输出，删除更早的 release/installer-* 目录，
 * 以及旧便携包 release/win-unpacked 与 builder 残留（避免误启动旧版）。
 * 若构建期间旧 release/installer 仍被短暂占用，成功后重试删除旧目录并把本次产物收口回固定路径；
 * 收口优先 rename，遇到 Windows 目录句柄导致的持续 EPERM 则退化为复制+删除（批次21 实测该环境 rename 恒失败）。
 * 构建失败时若固定目录已被腾空，则把旧目录改回 release/installer，优先保住可回退产物。
 * 清理失败只警告，绝不影响本次打包结果。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const preferred = path.join(releaseDir, 'installer');
let output = preferred;
let preferredLocked = false;
let stalePath = null;

function utcStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/** 同步等待（毫秒）：给被结束进程留出释放文件句柄的时间 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 重命名（最多 3 次）：Windows 索引器/杀软可能短暂占用目录，稍后即可成功 */
function renameWithRetry(from, to) {
  let lastErr = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      fs.renameSync(from, to);
      return null;
    } catch (err) {
      lastErr = err;
      if (i < 2) sleepSync(400);
    }
  }
  return lastErr;
}

/**
 * 目录搬运：优先 rename（同卷原子）。Windows 上目录句柄被宿主/索引器持有后，rename 会持续 EPERM，
 * 但复制与删除不受影响——此时退化为「复制 + 删除源目录」，保证产物仍能收口到固定路径。
 */
function moveDir(from, to) {
  const renameErr = renameWithRetry(from, to);
  if (!renameErr) return null;
  try {
    fs.cpSync(from, to, { recursive: true });
  } catch (err) {
    console.warn(`[package] 目录搬运失败（rename ${renameErr.code || renameErr.message} / copy ${err.code || err.message}）：${path.relative(root, from)}`);
    return err;
  }
  try {
    fs.rmSync(from, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[package] 已复制到 ${path.relative(root, to)}，但源目录删除失败（${err.code || err.message}）：${path.relative(root, from)}`);
  }
  console.warn(`[package] 目录重命名被占用（${renameErr.code || renameErr.message}），已改用复制+删除：${path.relative(root, to)}`);
  return null;
}

/**
 * 批次19（用户要求）：打包前强制结束本仓库 release/ 下运行中的旧实例，
 * 避免 release/installer 被占用而产出时间戳目录、导致旧程序残留。
 * 只匹配 ExecutablePath 位于本仓库 release/ 内的进程，不影响系统安装版或其它应用；
 * 结束失败只告警，后续仍按“重命名失败则输出时间戳目录”的兜底继续打包。
 */
function killReleaseProcesses() {
  if (process.platform !== 'win32') return;
  const prefix = releaseDir.replace(/'/g, "''");
  const script = [
    `$prefix = '${prefix}';`,
    `$procs = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) };`,
    `if ($procs) { $procs | ForEach-Object { Write-Output ("[package] 强制结束旧实例 PID " + $_.ProcessId + " " + $_.ExecutablePath); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }`,
  ].join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.error) {
    console.warn(`[package] 结束 release 旧实例失败（继续打包）：${r.error.message}`);
    return;
  }
  if (r.status !== 0) {
    console.warn(`[package] 结束 release 旧实例失败（继续打包）：${(r.stderr || '').trim() || `exit ${r.status}`}`);
    return;
  }
  if ((r.stdout || '').trim()) sleepSync(800);
}

killReleaseProcesses();

if (fs.existsSync(preferred)) {
  const candidate = path.join(releaseDir, `installer-${utcStamp()}-stale`);
  const renameErr = renameWithRetry(preferred, candidate);
  if (!renameErr) {
    stalePath = candidate;
  } else {
    preferredLocked = true;
    output = path.join(releaseDir, `installer-${utcStamp()}`);
    console.warn(
      `[package] release/installer 被外部进程占用（${renameErr.code || renameErr.message}），` +
        `本次输出改到 ${path.relative(root, output)}`
    );
  }
}

/**
 * 删除旧的时间戳安装包目录与旧便携包，只保留本次输出。
 * 不碰本次输出与 release/installer（可能是运行中实例的目录）。
 */
function cleanupOldOutputs(keepPath) {
  const keep = path.resolve(keepPath);
  let removed = 0;
  let failed = 0;
  let names = [];
  try {
    names = fs.readdirSync(releaseDir);
  } catch {
    return { removed, failed };
  }
  for (const name of names) {
    if (!name.startsWith('installer-')) continue;
    const full = path.join(releaseDir, name);
    if (path.resolve(full) === keep) continue;
    try {
      if (!fs.lstatSync(full).isDirectory()) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
      console.log(`[package] 已删除旧安装包目录 ${path.relative(root, full)}`);
    } catch (err) {
      failed += 1;
      console.warn(
        `[package] 旧安装包目录清理失败（${err.code || err.message}）：${path.relative(root, full)}`
      );
    }
  }
  // 旧便携包 / builder 残留不是本次交付物，打包成功后一并清掉，避免用户误启动旧版本
  for (const legacy of ['win-unpacked', 'builder']) {
    const full = path.join(releaseDir, legacy);
    if (!fs.existsSync(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
      console.log(`[package] 已删除旧便携包/残留 ${path.relative(root, full)}`);
    } catch (err) {
      failed += 1;
      console.warn(
        `[package] 旧便携包/残留清理失败（${err.code || err.message}）：${path.relative(root, full)}`
      );
    }
  }
  return { removed, failed };
}

const res = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/electron-builder/cli.js'), '--config', 'electron-builder.config.cjs', '--win'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MAM_OUTPUT: path.relative(root, output).replace(/\\/g, '/') },
  }
);

if (res.status === 0) {
  // 打包耗时较长，构建期间旧目录的占用通常已释放：此时删除旧 release/installer 并把本次产物收口回固定路径
  if (preferredLocked) {
    try {
      fs.rmSync(preferred, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[package] 旧 release/installer 删除失败（${err.code || err.message}），继续尝试收口`);
    }
    const moveErr = moveDir(output, preferred);
    if (!moveErr) {
      output = preferred;
      preferredLocked = false;
      console.log('[package] 已删除旧 release/installer，并把本次产物收口到固定目录');
    } else {
      console.warn(`[package] 本次产物保留在 ${path.relative(root, output)}`);
    }
  }
  const { removed, failed } = cleanupOldOutputs(output);
  const kept = path.relative(root, output);
  console.log(
    `[package] 产物：${kept}；旧安装包目录清理 ${removed} 个` +
      (failed > 0 ? `，${failed} 个被占用未删` : '') +
      (preferredLocked ? '；release/installer 本次被占用，已保留' : '')
  );
} else if (stalePath && !fs.existsSync(preferred)) {
  const restoreErr = moveDir(stalePath, preferred);
  if (!restoreErr) {
    console.log('[package] 构建失败，已把原 release/installer 恢复回固定路径');
  } else {
    console.warn(`[package] 构建失败且原 release/installer 恢复失败：${path.relative(root, stalePath)}`);
  }
}

process.exit(res.status ?? 1);
