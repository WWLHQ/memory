// 任务窗「待重放写入」只读视图（S5 / D6）：经 hostBridge 读 l0:pendingWrites。
//
// 口径：
// - 浏览器模式（无主进程）→ unavailable + 原因，绝不用 0 冒充「队列为空」；
// - 未登录 → unavailable + 原因（该通道需登录会话）；
// - 主进程报错/结构不完整 → error + 原因，不渲染半截数据；
// - 成功 → 原样展示主进程给的计数与摘要（正文不在返回值里，壳内拿不到）。

import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import type { PendingWritesView } from '../../shared/pendingWritesView.ts';

export type PendingWritesResult =
  | { status: 'ok'; view: PendingWritesView }
  | { status: 'unavailable'; detail: string }
  | { status: 'error'; detail: string };

export async function loadPendingWrites(): Promise<PendingWritesResult> {
  if (hostCapability() === 'none') {
    return { status: 'unavailable', detail: '浏览器模式：没有主进程，读不到 MCP 写入兜底队列；请用桌面端查看。' };
  }
  const sid = currentSessionId();
  if (!sid) {
    return { status: 'unavailable', detail: '未登录：该通道需要登录会话；未登录不读取队列。' };
  }
  try {
    const raw = await hostCall<PendingWritesView | { ok: false; error?: string }>('l0:pendingWrites', [sid]);
    if (!raw || typeof raw !== 'object' || (raw as { ok?: boolean }).ok !== true) {
      return { status: 'error', detail: (raw as { error?: string })?.error ?? '主进程未返回 ok' };
    }
    const view = raw as PendingWritesView;
    if (typeof view.count !== 'number' || !Array.isArray(view.items)) {
      return { status: 'error', detail: '主进程返回结构不完整（缺少 count/items）' };
    }
    return { status: 'ok', view };
  } catch (e) {
    return { status: 'error', detail: String((e as Error)?.message ?? e) };
  }
}
