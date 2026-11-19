// 壳层常驻设置（阶段 A）：托盘常驻 + 开机自启的**纯逻辑**与持久化。
//
// 为什么单独成模块：main.ts 一旦 `import 'electron'` 就无法被单测直接加载，
// 于是「默认值 / 坏文件容错 / 关窗该隐藏还是真关 / 是否静默启动」这些判据全部下沉到这里，
// main.ts 只做 electron 侧接线（Tray、setLoginItemSettings）。判据只有一份，测试才能钉住。
//
// 与既有行为的关系：`keepInTray=false` 时完全退回旧行为（关窗即退出），
// 所以这个开关本身就是回滚路径——不需要再发一版代码。
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 设置文件名（落在数据根顶层，随数据根迁移；见 dataRoot.ts 的迁移白名单） */
export const APP_SHELL_FILE = 'app-shell.json';
/** 开机自启时附加的静默启动参数：只建托盘、不弹窗 */
export const HIDDEN_LAUNCH_ARG = '--hidden';

export interface ShellSettings {
  /** 关窗只隐藏（托盘常驻、后台服务继续跑）。false = 旧行为「关窗即退出」 */
  keepInTray: boolean;
  /** 开机自启（Windows 登录项，带 HIDDEN_LAUNCH_ARG 静默进托盘） */
  autoStart: boolean;
}

/**
 * 默认值：两项都开。
 * 理由（阶段 A 的前提）：不做常驻+自启，采集器再自动也只在「app 恰好开着」时成立；
 * 反过来，任何一项关掉都等于放弃「日常零干预」。
 */
export const DEFAULT_SHELL_SETTINGS: ShellSettings = { keepInTray: true, autoStart: true };

export type CloseAction = 'hide' | 'close';

/** 设置文件的绝对路径（dir = 数据根） */
export function appShellPath(dir: string): string {
  return join(dir, APP_SHELL_FILE);
}

/**
 * 容错解析：只接纳明确的 boolean，其余一律回落到对应默认值。
 * 为什么不抛：这个文件在**启动主路径**上读，一个坏字符不该让 app 打不开。
 */
export function normalizeShellSettings(raw: unknown): ShellSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (key: keyof ShellSettings): boolean =>
    typeof src[key] === 'boolean' ? (src[key] as boolean) : DEFAULT_SHELL_SETTINGS[key];
  return { keepInTray: pick('keepInTray'), autoStart: pick('autoStart') };
}

/** 读设置；文件缺失/坏 JSON/不可读 → 返回默认值（永不抛） */
export function readShellSettings(dir: string): ShellSettings {
  const file = appShellPath(dir);
  try {
    if (!existsSync(file)) return { ...DEFAULT_SHELL_SETTINGS };
    return normalizeShellSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULT_SHELL_SETTINGS };
  }
}

/**
 * 原子写：先写 .tmp 再 rename。
 * 为什么不能直接覆盖：进程被强杀/断电时留半个 JSON，下次启动就回到默认值，
 * 表现是「开机自启莫名其妙被关」——用 rename 才能保证要么旧的要么新的。
 */
export function writeShellSettings(dir: string, settings: ShellSettings): ShellSettings {
  // 先把非法组合收敛掉再落盘：任何调用方（UI / 托盘 / 未来配置导入）都存不出「自启但无常驻」
  const next = applyShellConstraints(normalizeShellSettings(settings));
  const file = appShellPath(dir);
  const tmp = `${file}.tmp`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 清理失败不掩盖原始错误 */ }
    throw e;
  }
  return next;
}

/**
 * 关窗时的动作判定。
 * `quitting` 必须优先级最高：托盘菜单「退出」/系统注销时的 close 不能被拦成隐藏，
 * 否则进程永远退不掉（用户只能杀进程）。
 */
export function resolveCloseAction(input: { quitting: boolean; keepInTray: boolean }): CloseAction {
  if (input.quitting) return 'close';
  return input.keepInTray ? 'hide' : 'close';
}

/** 本次是否静默启动（开机自启带 --hidden） */
export function isHiddenLaunch(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_LAUNCH_ARG);
}

/** 自启时要传给 exe 的参数（集中一处，避免设置与注册两边漂移） */
export function loginItemArgs(): string[] {
  return [HIDDEN_LAUNCH_ARG];
}

export type ShellPatch = Partial<ShellSettings>;

/**
 * 校验来自渲染层的改动。
 * 只接纳明确的 boolean，且必须至少改一项——空 patch 直接报错，
 * 免得「点了保存但什么都没变」被当成成功（那是谎报）。
 */
export function parseShellPatch(raw: unknown): { ok: true; patch: ShellPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '参数格式不对：需要 { keepInTray?, autoStart? }' };
  }
  const src = raw as Record<string, unknown>;
  const patch: ShellPatch = {};
  for (const key of ['keepInTray', 'autoStart'] as const) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== 'boolean') return { ok: false, error: `${key} 必须是布尔值` };
    patch[key] = src[key] as boolean;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: '没有要改的字段' };
  return { ok: true, patch };
}

/**
 * 联动收敛：没有常驻就不允许自启。
 * 「自启 + 关窗即退 + 无托盘」= 开机后窗口不显示、又没有托盘入口，用户根本打不开这个 app。
 * 保存与写入两侧都走这一条，避免 UI 传错就存出死锁组合。
 */
export function applyShellConstraints(settings: ShellSettings): ShellSettings {
  const next = { ...settings };
  if (!next.keepInTray) next.autoStart = false;
  return next;
}
