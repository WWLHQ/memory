// L0 写密钥状态的**唯一读取口**（§4.4.4 写锁）。
//
// 为什么要有这个文件：写锁状态在 5 处被读（写入页 masthead / 首页红条 / 壳层状态栏 /
// 层级面板 / 安全页各卡），历史实现各走各的通道：
//   · 有人读 `l0Status()`（= IPC `l0:status`，**requireAdmin**）→ 成员一调就抛，
//     表现为「安全页已解锁、写入页说未解锁、首页还在报红、状态栏写『不可用』」；
//   · 有人读账号级窄口子 `l0:myWriteWrap`（只需登录）；
//   · 有人自己拼 hostCapability 判断。
// 于是同一个事实在不同界面给出不同答案。现在统一到内核 `getWriteStatus()`：
//   内核内部已按「端口 isWriteUnlocked → 账号级 myWriteWrap → 管理员 status()」三级退化，
//   所以**任何角色**调它都拿得到真值；读不到时如实回 null（绝不冒充 false/已解锁）。
//
// 用法（需要的地方只对接这三样）：
//   const st = await readL0WriteState();          // 一次性读
//   const off = onL0WriteStateChanged(() => ...);  // 别处解锁/锁定后重读
//   写密钥变化后：signalL0WriteLockChanged()（由 coreSecurity 的解锁/锁定函数统一发）
import { getKernel } from '../kernel.ts';

export interface L0WriteState {
  /** 写密钥当前是否在内存（能不能真正写入）。null = 读不到 */
  unlocked: boolean | null;
  /** 待重放的写入条数（解锁时内核会顺带重放）。null = 读不到 */
  pending: number | null;
  /** kernel = 内核真值；unavailable = 读不到（浏览器模式 / 宿主桥未就绪 / 内核报错） */
  source: 'kernel' | 'unavailable';
  detail: string | null;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

/**
 * 读写锁真实状态。
 * 先判「有没有宿主 L0 通道」：没有 → 直接 unavailable（读不到 ≠ 未解锁）；
 * 有 → 走内核真值，内核报错也如实落 unavailable，不猜分支。
 */
export async function readL0WriteState(): Promise<L0WriteState> {
  try {
    const kernel = getKernel();
    // 内核明确说「没有 L0 通道」（纯浏览器 / iframe 无桥）时，getWriteStatus 的 false
    // 只是「读不到」而不是「未解锁」——必须在这里分清，否则会误报成写密钥告警。
    if (kernel.hasL0Channel && !kernel.hasL0Channel()) {
      return { unlocked: null, pending: null, source: 'unavailable', detail: '非桌面壳：无 L0 通道（浏览器 / 宿主桥未就绪）' };
    }
    const r = await kernel.getWriteStatus();
    return { unlocked: r.l0_unlocked === true, pending: r.pending_count, source: 'kernel', detail: null };
  } catch (e) {
    return { unlocked: null, pending: null, source: 'unavailable', detail: errText(e) };
  }
}

/** 订阅「写锁可能变了」：别处解锁/锁定后重读。真值永远来自 readL0WriteState()，信号不带状态。 */
export { onL0WriteLockChanged as onL0WriteStateChanged } from './l0WriteLockSignal.ts';
