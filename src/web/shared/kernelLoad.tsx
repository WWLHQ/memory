// 内核数据加载三态（批次25 P0-7）：loading / ok / error —— 「读不到」绝不渲染成「账本为空」。
// 各页共用本件：错误态显示内核真实原因 + 重试按钮，并落一条 ui:error 动作日志（§7.3）。
import { useCallback, useEffect, useRef, useState } from 'react';
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

/** 原始异常文本（仅写 actions.log / 排查用；禁止直接进 UI） */
export function kernelErrorRaw(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const msg = (err?.message ?? String(e ?? '')).trim();
  const text = msg || '未知错误';
  return err?.code && !text.includes(err.code) ? `${err.code}：${text}` : text;
}

/**
 * UI 唯一错误文案出口（2026-11-16 用户要求：说人话）。
 * Electron 会把主进程抛错包成 `Error invoking remote method 'xxx': Error: ...`，
 * 错误码 / IPC 方法名 / JSON 残片一律不上屏；只给一句能看懂、能照着做的话。
 */
export function humanErrorText(e: unknown): string {
  const raw = kernelErrorRaw(e);
  const s = raw.toLowerCase();

  if (/需要登录|未登录|会话.{0,8}(过期|失效)|e_auth_session|\b401\b/.test(s)) return '请先登录，登录后即可查看';
  if (/timeout|超时|未回话|aborted?|e_ipc_timeout/.test(s)) return '本机服务响应超时，请重试';
  if (/e_ledger_locked|e_storage_locked|账本.{0,8}锁定|库被.{0,12}锁定|\blocked\b/.test(s)) return '账本暂时被占用，请稍后重试';
  if (/e_l0_locked|写密钥.{0,8}(锁|未解锁)/.test(s)) return '写密钥未解锁，请先解锁';
  if (/failed to fetch|network|不可达|econnrefused|enotfound|\boffline\b/.test(s)) return '连不上本机服务，请确认程序正在运行';
  if (/e_not_implemented|not implemented|未实现|未接入/.test(s)) return '这个功能当前版本还没有提供';
  if (/^http\s+\d{3}/.test(s)) return '本机服务暂时没准备好，请稍后重试';
  if (/未知错误|unknown error|undefined|null/.test(s)) return '出了点问题，请稍后重试';

  // 剥掉 Electron IPC 的两层包装，再看里面有没有人能看懂的话
  let text = raw
    .replace(/^error invoking remote method\s+['"][^'"]+['"]\s*:\s*/i, '')
    .replace(/^(?:error|typeerror|referenceerror)\s*:\s*/i, '')
    .trim();
  text = text.replace(/^(?:error|typeerror)\s*:\s*/i, '').trim();
  // 内核常抛 `[E_XXX] 中文原因`：错误码丢掉，后面那句人话留着
  text = text.replace(/^\[?E_[A-Z0-9_]+\]?\s*[:：-]?\s*/i, '').trim();

  if (
    !text || !/[\u4e00-\u9fa5]/.test(text) ||
    /[[\]{}"]/.test(text) || /\bE_[A-Z0-9_]+\b/.test(text) || text.length > 40
  ) {
    return '出了点问题，请稍后重试';
  }
  return text;
}

/** 兼容旧调用：页面拿到的都是人话（原始异常由 kernelErrorRaw 留在日志里） */
export function kernelErrorText(e: unknown): string {
  return humanErrorText(e);
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
        const error = humanErrorText(e);
        uiLog('ui', 'kernel_load_error', { page: label, error: kernelErrorRaw(e) }, { level: 'error' });
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

/**
 * 把一个页面的多个数据源合成「刷新整页」入口（2026-11-10 统一刷新逻辑）。
 *
 * 背景：记忆库页有 6 个独立数据源（列表/分层策略/冲突队列/待重放/库位置/个人记忆），
 * 但页面上的「刷新」只调了其中 2 个的 retry，其余数据源仍显示旧值 —— 用户看到的是
 * 「刷新了但没全变」。本 hook 让页面级「刷新」= 本页全部数据源一起重取。
 *
 * 语义分层（全站统一约定）：
 * - 壳层 F5 → 全站刷新：iframe 重挂（页面重新挂载即重新取数）+ 状态栏/底部/导航角标重读；
 * - 页面内「刷新/重读」→ 只重取本页数据，不重挂页面、不丢会话与已填内容；
 * - 卡片级「刷新」→ 只重取该卡片自己的数据源。
 */
export function useRefreshAll(sources: Array<{ retry: () => void }>): () => void {
  const ref = useRef(sources);
  ref.current = sources;
  return useCallback(() => {
    for (const s of ref.current) s.retry();
  }, []);
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
