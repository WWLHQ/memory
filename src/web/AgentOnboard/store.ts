// 接入页本地持久化：用户真实接入过的 agent 名单与卡片配置快照（localStorage，跨 iframe/重载保持）。
// 不存放任何演示卡片：首次进入为空态，由真实扫描/手动接入产生。
import type { UiAgentCard } from '../../types/agentOnboard.ts';

// 本机检测扩展（2026-10-24）：用户手动「+ 新增接入卡片」的 agent 名 → 卡片配置快照
// （localStorage 持久化，退出重登 / 切页 / 重载保持）
const DETECTED_KEY = 'agentOnboardDetectedAgents';

export interface DetectedCardSnapshot {
  name: string;
  /** 卡片配置快照（null = 旧版无快照，恢复时按默认 P3 口径重建） */
  card: UiAgentCard | null;
  /** 首次添加时间 */
  addedAt: number;
}

/** 记录已添加的本地检测 agent 卡片（持久化，防重复；按 name 覆盖更新配置） */
export function addAgentCard(name: string, card: UiAgentCard | null = null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(DETECTED_KEY);
    const arr: DetectedCardSnapshot[] = raw ? (JSON.parse(raw) as DetectedCardSnapshot[]) : [];
    const i = arr.findIndex((s) => s.name === name);
    if (i >= 0) {
      if (card) arr[i] = { ...arr[i], card };
    } else {
      // card 缺省时存 null 占位（恢复时若无快照则按默认 P3 口径重建）
      arr.push({ name, card: card ?? (null as unknown as UiAgentCard), addedAt: Date.now() });
    }
    localStorage.setItem(DETECTED_KEY, JSON.stringify(arr));
  } catch { /* localStorage 不可用 → 静默 */ }
}

/** 移除已添加的 agent 卡片快照（agent 卸载后检测不到 → 卡片删除时调用） */
export function removeAgentCard(name: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(DETECTED_KEY);
    const arr: DetectedCardSnapshot[] = raw ? (JSON.parse(raw) as DetectedCardSnapshot[]) : [];
    const next = arr.filter((s) => s.name !== name);
    localStorage.setItem(DETECTED_KEY, JSON.stringify(next));
  } catch { /* 静默 */ }
}

/** 读取已添加的本地检测 agent 卡片快照（退出重登 / 重载后恢复卡片用；兼容旧版 string 数组） */
export function listDetectedAgents(): DetectedCardSnapshot[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DETECTED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 兼容旧版（纯 string 数组）：转成 card=null 快照
    if (typeof arr[0] === 'string') {
      return (arr as string[]).map((name) => ({ name, card: null, addedAt: 0 }));
    }
    return arr as DetectedCardSnapshot[];
  } catch {
    return [];
  }
}
