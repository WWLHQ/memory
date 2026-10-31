// 内核数据加载三态（批次25 P0-7）：loading / ok / error —— 「读不到」绝不渲染成「账本为空」。
// 各页共用本件：错误态显示内核真实原因 + 重试按钮，并落一条 ui:error 动作日志（§7.3）。
import { useCallback, useEffect, useState } from 'react';
import { uiLog } from './actionLog.ts';

export type KernelLoadPhase = 'loading' | 'ok' | 'error';

export interface KernelLoadResult<T> {
  phase: KernelLoadPhase;
  /** 仅 phase='ok' 有值；phase='error' 时保持 undefined，调用方不得回退成空数组 */
  data: T | undefined;
  error: string | null;
  /** 重新发起加载（错误态「重试」） */
  retry: () => void;
  /** 就地替换/更新已加载数据（页面写成功后同步，避免重拉全量）；尚未加载成功时忽略 */
  replace: (next: T | ((prev: T) => T)) => void;
}

/** 内核/宿主桥异常 → 一行可读原因（保留 E_XXX 码，便于对照 actions.log） */
export function kernelErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const msg = (err?.message ?? String(e ?? '')).trim();
  const text = msg || '未知错误';
  return err?.code && !text.includes(err.code) ? `${err.code}：${text}` : text;
}

/**
 * 挂载即从内核读一次，失败可重试。
 * `load` 必须是稳定引用（模块级函数或 useCallback），否则每次渲染都会重新加载。
 */
export function useKernelLoad<T>(label: string, load: () => Promise<T>): KernelLoadResult<T> {
  const [state, setState] = useState<{ phase: KernelLoadPhase; data: T | undefined; error: string | null }>(
    { phase: 'loading', data: undefined, error: null },
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading', data: undefined, error: null });
    load().then(
      (data) => { if (alive) setState({ phase: 'ok', data, error: null }); },
      (e: unknown) => {
        if (!alive) return;
        const error = kernelErrorText(e);
        uiLog('ui', 'kernel_load_error', { page: label, error }, { level: 'error' });
        setState({ phase: 'error', data: undefined, error });
      },
    );
    return () => { alive = false; };
  }, [label, load, tick]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  const replace = useCallback(
    (next: T | ((prev: T) => T)) => setState((s) => {
      if (s.phase !== 'ok') return s;
      const data = typeof next === 'function' ? (next as (prev: T) => T)(s.data as T) : next;
      return { phase: 'ok', data, error: null };
    }),
    [],
  );

  return { ...state, retry, replace };
}

/** 统一的「内核数据没读到」回显：说清不是空账本，并给出原因与重试。 */
export function KernelLoadError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid="kernel-error"
      style={{
        border: '1px solid var(--line, #2b3441)', borderLeft: '3px solid #ff5c5c',
        borderRadius: 12, padding: '14px 16px', margin: '10px 0',
        background: 'var(--panel, #1a212b)',
      }}
    >
      <b data-testid="kernel-error-title">{what}失败：内核数据没读到</b>
      <div data-testid="kernel-error-reason" style={{ fontSize: 12, margin: '6px 0', opacity: 0.9 }}>
        原因：{error ?? '未知错误'}
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
        这不是「账本为空」——真的没有数据时会明确写「空」。请确认桌面端正在运行（或主进程未繁忙/库未被锁），然后重试。
      </div>
      <button type="button" data-testid="kernel-retry" onClick={onRetry} className="btn">重试</button>
    </div>
  );
}
