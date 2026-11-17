// 浏览器扩展页启动解析。
// 内部页不能走 shell.openExternal（跳商店/空白），也不能当命令行参数传（Chromium 丢弃 → 空白页），
// 只能「拉起浏览器 + 剪贴板放地址 + 模拟地址栏输入」，这里锁住这条链路的每个判定。
//
// 2026-11-16 实测事故锁：只 AppActivate 会「假成功」——它返回 True 但窗口没拿到前台，
// 随后 SendKeys 全发给自己的窗口，用户只看到多一个空白标签且**没有任何报错**。
// 所以下面几条断言是回归护栏，不是形式：必须真抢前台 + 抢不到就退出 + 发完按键回读标题。
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  browserInternalUrl, browserExecutableCandidates, buildExtensionPageActivationScript,
  extensionPageActivation, resolveBrowserExecutable,
} from '../browserLaunch.ts';

const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

describe('browserLaunch', () => {
  const env = {
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
  };

  it('内部扩展页使用浏览器自己的 scheme', () => {
    expect(browserInternalUrl('edge')).toBe('edge://extensions/');
    expect(browserInternalUrl('qq')).toBe('qqbrowser://extensions/');
  });

  it('激活参数：进程名对应真实 exe 名，url 与内部页一致，标题判据随浏览器不同', () => {
    const edge = extensionPageActivation('edge');
    expect(edge.processName).toBe('msedge');
    expect(edge.url).toBe('edge://extensions/');
    // 扩展 / Extensions
    expect(edge.titleHints).toContain('\\u6269\\u5c55');
    expect(edge.titleHints).toContain('Extensions');

    const qq = extensionPageActivation('qq');
    expect(qq.processName).toBe('QQBrowser');
    expect(qq.url).toBe('qqbrowser://extensions/');
    // QQ 的扩展页标题是「应用中心」——只认「扩展」会永远判失败
    expect(qq.titleHints).toContain('\\u5e94\\u7528\\u4e2d\\u5fc3');
  });

  it('脚本必须先真抢前台、抢不到就退出，绝不盲发按键', () => {
    const script = buildExtensionPageActivationScript({
      processName: 'msedge', executable: EDGE_EXE, titleHints: extensionPageActivation('edge').titleHints,
    });
    // 前台锁：只靠 AppActivate 会假成功，必须真的附加输入队列 + SetForegroundWindow
    expect(script).toContain('[Mam.Native]::AttachThreadInput($myTid, $fgTid, $true)');
    expect(script).toContain('[Mam.Native]::SetForegroundWindow($h)');
    expect(script).toContain('[Mam.Native]::ShowWindow($h, 9)');
    // 抢前台要回读确认，没拿到前台直接退出（exit 3），否则 Ctrl+T 会打进用户当前窗口
    expect(script).toContain('GetForegroundWindow().ToInt64() -eq $h.ToInt64()');
    expect(script).toContain('if (-not $front) { exit 3 }');
    expect(script.indexOf('exit 3')).toBeLessThan(script.indexOf("SendKeys('^t')"));
  });

  it('按键顺序：先 Ctrl+T 开新标签，再 Ctrl+L/V 粘贴，最后回读标题', () => {
    const script = buildExtensionPageActivationScript({
      processName: 'msedge', executable: EDGE_EXE, titleHints: extensionPageActivation('edge').titleHints,
    });
    expect(script).toContain("SendKeys('^t')");
    expect(script).toContain("SendKeys('^l')");
    expect(script).toContain("SendKeys('^v')");
    expect(script).toContain("SendKeys('{ENTER}')");
    // 顺序不能乱：^t 必须在 ^l 之前（否则会劫持用户正在看的标签页）
    const order = ["SendKeys('^t')", "SendKeys('^l')", "SendKeys('^v')", "SendKeys('{ENTER}')"]
      .map((k) => script.indexOf(k));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    // 发完要回读窗口标题验证；没跳转就是 exit 4，不能假装成功
    expect(script).toContain('$p.MainWindowTitle -match');
    expect(script).toContain('exit 4');
  });

  it('退出码约定齐全：0 成功 / 2 没窗口 / 3 抢不到前台 / 4 页面没跳转', () => {
    const script = buildExtensionPageActivationScript({
      processName: 'msedge', executable: EDGE_EXE, titleHints: ['Extensions'],
    });
    expect(script).toContain('exit 2');
    expect(script).toContain('exit 3');
    expect(script).toContain('exit 4');
    expect(script.trimEnd().endsWith('exit 4')).toBe(true);
  });

  it('不给标题判据时不做标题校验，报成功（留给未来的其它浏览器）', () => {
    const script = buildExtensionPageActivationScript({
      processName: 'msedge', executable: EDGE_EXE, titleHints: [],
    });
    expect(script).not.toContain('$p.MainWindowTitle');
    expect(script.trimEnd().endsWith('exit 0')).toBe(true);
  });

  it('URL 走剪贴板不拼进脚本；整段脚本保持纯 ASCII 单行', () => {
    const script = buildExtensionPageActivationScript({
      processName: 'msedge', executable: EDGE_EXE, titleHints: extensionPageActivation('qq').titleHints,
    });
    // SendKeys 会把 : / 当特殊字符，地址只能走剪贴板
    expect(script).not.toContain('edge://');
    expect(script).not.toContain('qqbrowser://');
    // 控制台代码页会把中文写坏：中文字样一律用 \uXXXX 转义
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7E]*$/.test(script)).toBe(true);
    // 单行：-Command 传多行时容易被换行/引号解析吃掉
    expect(script).not.toContain('\n');
  });

  it('进程名与可执行文件路径都做单引号转义，不产生注入', () => {
    const script = buildExtensionPageActivationScript({
      processName: "evil'name", executable: "C:\\a'b\\msedge.exe", titleHints: [],
    });
    expect(script).toContain("Get-Process -Name 'evil''name'");
    expect(script).toContain("Start-Process -FilePath 'C:\\a''b\\msedge.exe'");
  });

  it('Edge 从 ProgramFiles(x86) 找到 msedge.exe', () => {
    const target = join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const exe = resolveBrowserExecutable('edge', {
      env, platform: 'win32', exists: (p) => p === target,
    });
    expect(exe).toBe(target);
  });

  it('QQ 装在非系统盘时，从卸载项 DisplayIcon 定位到 QQBrowser.exe', () => {
    const target = 'D:\\Program Files\\Tencent\\QQBrowser\\QQBrowser.exe';
    const exe = resolveBrowserExecutable('qq', {
      env,
      platform: 'win32',
      exists: (p) => p === target,
      registryIcons: ['D:\\Program Files\\Tencent\\QQBrowser\\app.ico,0'],
    });
    expect(exe).toBe(target);
    expect(browserExecutableCandidates('qq', { env, platform: 'win32', exists: () => false }))
      .toContain(join(env.ProgramFiles, 'Tencent', 'QQBrowser', 'QQBrowser.exe'));
  });

  it('非 Windows 或找不到浏览器时诚实返回 null，不退回 shell.openExternal', () => {
    expect(resolveBrowserExecutable('edge', { env, platform: 'linux', exists: () => true })).toBeNull();
    expect(resolveBrowserExecutable('qq', { env, platform: 'win32', exists: () => false })).toBeNull();
  });
});
