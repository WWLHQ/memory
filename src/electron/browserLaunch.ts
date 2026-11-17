// 浏览器扩展页启动解析（纯函数，便于单测）。
//
// 两条路都走过、都被实测打回，这里记下原因，避免第三个人再踩：
//   1) shell.openExternal('edge://extensions/') —— 内部 scheme 交给系统协议 handler，
//      Edge 跳应用商店、QQ 浏览器开空白页。
//   2) spawn(exe, ['edge://extensions/']) —— Chromium 禁止从命令行参数打开内部页，
//      非 http(s) 的 URL 一律被丢掉，结果是空白新标签。
// 唯一能打开「默认 profile 内部页」的方式是模拟用户在地址栏输入：
// 拉起浏览器 → 抢前台 → Ctrl+T 开新标签（绝不劫持用户正在看的标签）→ Ctrl+L / Ctrl+V / Enter。
//
// 2026-11-16 第二次实测事故：用户点「一键打开 Edge 扩展页」只多出一个空白标签、且**没有任何报错**
// （脚本退出码 0，即它以为成功了）。根因是 WScript.Shell.AppActivate 在前台锁面前会「假成功」：
// 它返回 True，但窗口没真拿到前台，随后 SendKeys 全发给了我们自己的 Electron 窗口。
// 所以这版做了三件事，缺一不可：
//   a) 用 AttachThreadInput + SetForegroundWindow 真抢前台，并用 GetForegroundWindow 回读确认；
//   b) 抢不到就 exit 3，绝不盲发按键（否则按键会落到用户当前窗口里乱按）；
//   c) 发完按键回读窗口标题，没变成扩展页就 exit 4 —— 失败要能自证，不能靠用户猜。
import { basename, dirname, join } from 'node:path';

export type SupportedBrowser = 'edge' | 'qq';

export interface BrowserLaunchOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  /** 注册表卸载项里的 DisplayIcon（Windows），用于定位装在非系统盘的 QQ 浏览器 */
  registryIcons?: string[];
}

/** 目标内部页地址。QQ 用带尾斜杠的 extensions/（与 edge://extensions/ 同形，社区实测可用）。 */
export function browserInternalUrl(browser: SupportedBrowser): string {
  return browser === 'edge'
    ? 'edge://extensions/'
    : 'qqbrowser://extensions/';
}

/**
 * 地址栏输入方案需要的运行期参数。
 * processName 用于 PowerShell 里 Get-Process 找主窗口；url 走剪贴板（避免 SendKeys 特殊字符）。
 * titleHints 是「扩展页真的打开了」的判据：窗口标题必须命中其中之一，否则算失败。
 * 用 \uXXXX 转义写，保证整段脚本是纯 ASCII（控制台代码页不会把中文写坏）。
 */
export interface ExtensionPageActivation {
  processName: string;
  url: string;
  titleHints: string[];
}

export function extensionPageActivation(browser: SupportedBrowser): ExtensionPageActivation {
  if (browser === 'edge') {
    return {
      processName: 'msedge',
      url: browserInternalUrl(browser),
      // 扩展 / Extensions
      titleHints: ['\\u6269\\u5c55', 'Extensions'],
    };
  }
  return {
    processName: 'QQBrowser',
    url: browserInternalUrl(browser),
    // 应用中心 / 扩展 / 插件 / Extensions
    titleHints: ['\\u5e94\\u7528\\u4e2d\\u5fc3', '\\u6269\\u5c55', '\\u63d2\\u4ef6', 'Extensions'],
  };
}

/** PowerShell 单引号字符串转义：内部单引号翻倍。 */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 抢前台需要的 4 个 Win32 入口。写成一行 C# 是刻意的：
 * 整个脚本保持单行（用 '; ' 连接），避免 -Command 传多行时被换行/引号解析吃掉。
 */
const NATIVE_SIG = [
  '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);',
  '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
  '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
].join('');

export interface ActivationScriptOptions {
  processName: string;
  /** 浏览器可执行文件绝对路径：没开浏览器时由脚本自己拉起（不是把内部 URL 当参数传） */
  executable: string;
  /** 扩展页标题正则片段（\uXXXX 转义）；空数组表示不做标题校验 */
  titleHints: string[];
}

/**
 * 生成「抢前台 → 新标签 → 地址栏粘贴 → 回读标题验证」的 PowerShell 单行脚本。
 * 退出码约定：0 成功；2 没找到带窗口的进程；3 抢不到前台；4 按键发了但页面没跳转。
 * 脚本内容保持纯 ASCII（含中文字样一律 \uXXXX），避免控制台代码页写坏中文。
 */
export function buildExtensionPageActivationScript(opts: ActivationScriptOptions): string {
  const name = psLiteral(opts.processName);
  const exe = psLiteral(opts.executable);
  const hintRegex = opts.titleHints.length > 0 ? psLiteral(`(${opts.titleHints.join('|')})`) : '';

  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$sig = ${psLiteral(NATIVE_SIG)}`,
    'Add-Type -Namespace Mam -Name Native -MemberDefinition $sig',
    '$ws = New-Object -ComObject WScript.Shell',
    // 只认带标题的主窗口：隐藏的辅助进程 MainWindowHandle 也是 0，但标题为空窗口不能算
    `$find = { Get-Process -Name ${name} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 1 }`,
    '$p = & $find',
    // 没开浏览器时自己拉起；启动慢就给 8 秒（40 × 200ms），比 6 秒更容易吃到冷启动
    `if (-not $p) { Start-Process -FilePath ${exe}; for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 200; $p = & $find; if ($p) { break } } }`,
    'if (-not $p) { exit 2 }',
    '$h = [IntPtr]$p.MainWindowHandle',
    // SW_RESTORE：最小化的窗口抢不到前台
    '[Mam.Native]::ShowWindow($h, 9) | Out-Null',
    // 前台锁会让 SetForegroundWindow 直接失败；附加到当前前台窗口的输入队列即可绕过
    '$fg = [Mam.Native]::GetForegroundWindow()',
    '$fgPid = 0',
    '$fgTid = [Mam.Native]::GetWindowThreadProcessId($fg, [ref]$fgPid)',
    '$myTid = [Mam.Native]::GetCurrentThreadId()',
    '[Mam.Native]::AttachThreadInput($myTid, $fgTid, $true) | Out-Null',
    '[Mam.Native]::SetForegroundWindow($h) | Out-Null',
    '[Mam.Native]::AttachThreadInput($myTid, $fgTid, $false) | Out-Null',
    '$front = $false',
    'for ($i = 0; $i -lt 15; $i++) { if ([Mam.Native]::GetForegroundWindow().ToInt64() -eq $h.ToInt64()) { $front = $true; break }; [void]$ws.AppActivate($p.Id); [Mam.Native]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 200 }',
    // 抢不到前台就退出：盲发按键会把 Ctrl+T / Ctrl+V 打进用户当前窗口
    'if (-not $front) { exit 3 }',
    'Start-Sleep -Milliseconds 250',
    // Ctrl+T 新开标签：绝不把用户正在看的页面导航走
    "$ws.SendKeys('^t')",
    'Start-Sleep -Milliseconds 400',
    "$ws.SendKeys('^l')",
    'Start-Sleep -Milliseconds 200',
    "$ws.SendKeys('^v')",
    'Start-Sleep -Milliseconds 250',
    "$ws.SendKeys('{ENTER}')",
  ];

  if (hintRegex) {
    lines.push(
      '$hit = $false',
      `for ($i = 0; $i -lt 16; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.MainWindowTitle -match ${hintRegex}) { $hit = $true; break } }`,
      'if ($hit) { exit 0 }',
      // 按键发出去了但标题没变 → 只有两种可能：按键没落地，或浏览器拒了这个内部页
      'exit 4',
    );
  } else {
    lines.push('exit 0');
  }

  return lines.join('; ');
}

function cleanIconPath(icon: string): string {
  return icon.replace(/,0$/, '').trim();
}

export function browserExecutableCandidates(browser: SupportedBrowser, opts: BrowserLaunchOptions): string[] {
  const env = opts.env;
  const icons = (opts.registryIcons ?? []).map(cleanIconPath).filter(Boolean);
  const out: string[] = [];
  const add = (p?: string): void => {
    if (!p) return;
    if (!out.includes(p)) out.push(p);
  };

  if (browser === 'edge') {
    add(join(env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(join(env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(join(env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const icon of icons) {
      if (basename(icon).toLowerCase() === 'msedge.exe') add(icon);
    }
    return out.filter((p) => !p.startsWith('Microsoft'));
  }

  add(join(env.ProgramFiles ?? '', 'Tencent', 'QQBrowser', 'QQBrowser.exe'));
  add(join(env['ProgramFiles(x86)'] ?? '', 'Tencent', 'QQBrowser', 'QQBrowser.exe'));
  add(join(env.LOCALAPPDATA ?? '', 'Tencent', 'QQBrowser', 'Application', 'QQBrowser.exe'));
  add(join(env.LOCALAPPDATA ?? '', 'Tencent', 'QQBrowser', 'QQBrowser.exe'));
  for (const icon of icons) {
    const name = basename(icon).toLowerCase();
    if (name === 'qqbrowser.exe') add(icon);
    else if (name === 'app.ico' || name.endsWith('.ico')) add(join(dirname(icon), 'QQBrowser.exe'));
  }
  return out.filter((p) => !p.startsWith('Tencent'));
}

export function resolveBrowserExecutable(browser: SupportedBrowser, opts: BrowserLaunchOptions): string | null {
  if (opts.platform !== 'win32') return null;
  return browserExecutableCandidates(browser, opts).find((p) => opts.exists(p)) ?? null;
}
