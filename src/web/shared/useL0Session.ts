// 渲染层 L0 连续查阅会话（§4.4.3，日志页 / 记忆层级页共用）：
// 解锁 → 5 分钟倒计时；页面可见且聚焦时每 60s 心跳续期；倒计时归零或心跳被拒 → 自动上锁。
// 真相仍在主进程 L0Vault（空闲回收 30s 兜底）；本 Hook 只做页面态与续期，不持有任何密钥。
import { useCallback, useEffect, useRef, useState } from 'react';
import { getKernel } from '../kernel.ts';

export const L0_HEARTBEAT_MS = 60_000;
const TICK_MS = 1_000;

export interface L0SessionView {
  l0_session_id: string;
  grant_id?: string;
  idle_timeout_ms: number;
}

export type L0UnlockOutcome =
  | { ok: true; session: L0SessionView }
  | { ok: false; error: string };

export type L0RequestOutcome =
  | { ok: true; request_id: string }
  | { ok: false; error: string };

export interface L0SessionApi {
  session: L0SessionView | null;
  /** 距离自动上锁的剩余毫秒（由本地计时 + 心跳续期驱动） */
  remainingMs: number;
  busy: boolean;
  unlock(password: string, grantId?: string): Promise<L0UnlockOutcome>;
  /** 非管理员申请查阅：管理员在安全页批准后发放 grant_id + 一次性授权密码 */
  requestAccess(projectIds: string[], reason?: string): Promise<L0RequestOutcome>;
  lock(): Promise<void>;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

export function useL0Session(opts: { onExpired?: (reason: string) => void } = {}): L0SessionApi {
  const [session, setSession] = useState<L0SessionView | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<L0SessionView | null>(null);
  const expiringRef = useRef(false);
  const onExpiredRef = useRef(opts.onExpired);
  onExpiredRef.current = opts.onExpired;

  /** 到期/被拒：先清页面态，再尽力通知主进程锁会话（已回收时幂等无副作用） */
  const expire = useCallback(async (reason: string) => {
    const s = sessionRef.current;
    if (!s || expiringRef.current) return;
    expiringRef.current = true;
    sessionRef.current = null;
    setSession(null);
    setRemainingMs(0);
    try {
      await getKernel().l0Lock(s.l0_session_id);
    } catch {
      /* 主进程已按空闲回收：无需重复处理 */
    }
    onExpiredRef.current?.(reason);
    expiringRef.current = false;
  }, []);

  const unlock = useCallback(async (password: string, grantId?: string): Promise<L0UnlockOutcome> => {
    setBusy(true);
    try {
      const r = await getKernel().l0Unlock({ password, grant_id: grantId?.trim() || undefined });
      const view: L0SessionView = {
        l0_session_id: r.l0_session_id,
        grant_id: r.grant_id,
        idle_timeout_ms: r.idle_timeout_ms,
      };
      expiringRef.current = false;
      sessionRef.current = view;
      setSession(view);
      setRemainingMs(r.idle_timeout_ms);
      return { ok: true, session: view };
    } catch (e) {
      return { ok: false, error: errText(e) };
    } finally {
      setBusy(false);
    }
  }, []);

  const requestAccess = useCallback(async (projectIds: string[], reason?: string): Promise<L0RequestOutcome> => {
    setBusy(true);
    try {
      const r = await getKernel().l0RequestAccess({ project_ids: projectIds, reason });
      return { ok: true, request_id: r.request_id };
    } catch (e) {
      return { ok: false, error: errText(e) };
    } finally {
      setBusy(false);
    }
  }, []);

  const lock = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    setSession(null);
    setRemainingMs(0);
    try {
      await getKernel().l0Lock(s.l0_session_id);
    } catch {
      /* 忽略：本地已锁定 */
    }
  }, []);

  // 倒计时（1s）：归零即上锁
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (remainingMs > 0) return;
    void expire('idle_5min');
  }, [session, remainingMs, expire]);

  // 心跳（60s）：仅在页面可见且聚焦时续期；隐藏/失焦即累计空闲，满 5 分钟自动上锁
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined') {
        if (document.visibilityState !== 'visible') return;
        if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
      }
      void (async () => {
        try {
          const r = await getKernel().l0Heartbeat(session.l0_session_id);
          setRemainingMs(r.idle_timeout_ms);
        } catch {
          await expire('heartbeat_rejected');
        }
      })();
    }, L0_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [session, expire]);

  // 卸载：清本地态（主进程会话按空闲自然回收）
  useEffect(() => () => { sessionRef.current = null; }, []);

  return { session, remainingMs, busy, unlock, requestAccess, lock };
}

/** 剩余毫秒 → mm:ss（页面倒计时展示） */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
