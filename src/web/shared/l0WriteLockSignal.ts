// L0 写锁状态信号（§4.4.4）：解锁/锁定写密钥后，让首页与壳层状态栏能立刻重读真实锁状态。
//
// 为什么需要：写密钥解锁走主进程 IPC（l0:writeUnlock），不写 localStorage，
// 所以首页快照（loadOverview）与状态栏读数都不会自动刷新 —— 用户解锁后首页
// 仍显示「写密钥未解锁」红条，状态栏也停在旧值（这正是 2026-11-10 反馈的 bug）。
//
// 机制：写锁状态变化时写一个带时间戳的 localStorage 信号键，同源其它页面通过
// storage 事件收到 → 重新读取真实 l0Status()（信号只是「该重读了」的提示，
// 真值永远来自内核 l0Status().write_unlocked，信号本身绝不携带状态值，
// 也不冒充解锁成功）。
//
// 键名沿用 memdesk.* 约定；首页的 storage 监听已匹配 /memdesk/ 前缀，
// 因此信号一到首页会自动 reload()，红条随即消失。

/** 信号键（带时间戳，天然触发 storage 事件） */
export const L0_WRITE_LOCK_SIGNAL_KEY = 'memdesk.l0.writeLockSignal.v1';

/** 写锁状态变化后广播「请重读真实锁状态」信号 */
export function signalL0WriteLockChanged(): void {
  try {
    localStorage.setItem(L0_WRITE_LOCK_SIGNAL_KEY, String(Date.now()));
  } catch {
    /* 存储不可用（隐私模式/配额满）不影响主流程：读者仍可手动重读 */
  }
}

/** 订阅写锁状态变化（返回取消订阅函数） */
export function onL0WriteLockChanged(handler: () => void): () => void {
  const onStore = (e: StorageEvent) => {
    if (e.key === L0_WRITE_LOCK_SIGNAL_KEY) handler();
  };
  window.addEventListener('storage', onStore);
  return () => window.removeEventListener('storage', onStore);
}
