// 程序运行日志窗口（批次17 建，批次19 从首页迁至日志记录页）：真实尾读 <数据根>/actions.log。
// 批次24：默认「人话」视图（中文动作说明 + 关键字段摘要，原始 scope:action 仍随行展示），可切「原文」；
// 尾读窗口 50 条，正文区固定高度常驻纵向滚动条，默认停在最新一条（用户上翻时不再被轮询打断）。
// 无桌面壳能力时明确标注不可用，绝不伪造日志；日志尾读本身不写日志（避免观测刷屏）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import type { ActionLogTailResult } from '../../shared/actionLog.ts';
import { uiLog } from '../shared/actionLog.ts';
import {
  buildDiagnostics,
  copyText,
  countErrors,
  formatLogClock,
  parseProgramLogLine,
  type ProgramLogLine,
} from './programLog.ts';
import { humanizeProgramLog } from './programLogLabels.ts';

const DEFAULT_SCAN = 50;
const DEFAULT_POLL_MS = 5000;

type PanelState =
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; path: string | null; lines: ProgramLogLine[] };

type ViewMode = 'human' | 'raw';

export interface ProgramLogPanelProps {
  /** 尾读与错误检测窗口（默认最近 50 条；正文区可上下滚动查看这一窗口内的全部行） */
  scanLines?: number;
  /** 轮询间隔；0 = 关闭轮询（测试用） */
  pollMs?: number;
}

export function ProgramLogPanel({
  scanLines = DEFAULT_SCAN,
  pollMs = DEFAULT_POLL_MS,
}: ProgramLogPanelProps) {
  const capability = useMemo(() => hostCapability(), []);
  const [state, setState] = useState<PanelState>(
    capability === 'none' ? { kind: 'unavailable' } : { kind: 'loading' },
  );
  const [mode, setMode] = useState<ViewMode>('human');
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const alive = useRef(true);
  const inFlight = useRef(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 用户是否停在底部：只有本来就在底部时，轮询到新日志才自动跟到最新一条 */
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    if (capability === 'none' || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await hostCall<ActionLogTailResult>('log:tail', [scanLines]);
      if (!alive.current) return;
      if (!res?.ok) {
        setState({ kind: 'error', error: res?.error ?? '日志读取失败（未知原因）' });
        return;
      }
      setState({
        kind: 'ok',
        path: res.path ?? null,
        lines: (res.lines ?? []).map((l) => parseProgramLogLine(l)),
      });
      setRefreshedAt(Date.now());
    } catch (e) {
      if (!alive.current) return;
      setState({ kind: 'error', error: String((e as Error)?.message ?? e) });
    } finally {
      inFlight.current = false;
    }
  }, [capability, scanLines]);

  useEffect(() => {
    alive.current = true;
    if (capability === 'none') {
      return () => {
        alive.current = false;
      };
    }
    void load();
    if (!pollMs) {
      return () => {
        alive.current = false;
      };
    }
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void load();
    }, pollMs);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [capability, load, pollMs]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const shown = state.kind === 'ok' ? state.lines : [];
  const errors = state.kind === 'ok' ? countErrors(state.lines) : 0;

  useEffect(() => {
    const el = bodyRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [state, mode]);

  const onCopy = async () => {
    if (state.kind !== 'ok') return;
    const ok = await copyText(buildDiagnostics({ path: state.path, lines: state.lines }));
    setCopyState(ok ? 'ok' : 'fail');
    uiLog('ui', 'program_log_copy', { lines: state.lines.length, errors, copied: ok });
  };

  return (
    <section className="program-log" id="programLog" data-testid="program-log">
      <div className="program-log-head">
        <h3>
          🖥 程序运行日志 <span className="pl-sub">最近 {scanLines} 条 · 真实 actions.log · 可上下滚动</span>
        </h3>
        <div className="pl-actions">
          <button
            className={`btn${mode === 'human' ? ' active' : ''}`}
            type="button"
            data-testid="pl-mode-human"
            aria-pressed={mode === 'human'}
            onClick={() => setMode('human')}
          >
            人话
          </button>
          <button
            className={`btn${mode === 'raw' ? ' active' : ''}`}
            type="button"
            data-testid="pl-mode-raw"
            aria-pressed={mode === 'raw'}
            onClick={() => setMode('raw')}
          >
            原文
          </button>
          {refreshedAt && (
            <span className="pl-meta">更新于 {formatLogClock(new Date(refreshedAt).toISOString())}</span>
          )}
          {capability !== 'none' && (
            <button
              className="btn"
              id="btnRefreshProgramLog"
              type="button"
              onClick={() => void load()}
              disabled={state.kind === 'loading'}
            >
              {state.kind === 'loading' ? '读取中…' : '刷新'}
            </button>
          )}
        </div>
      </div>

      {state.kind === 'unavailable' && (
        <div className="pl-empty" id="programLogUnavailable">
          非桌面壳环境：无法读取本机程序日志（请在桌面应用内查看）。
        </div>
      )}
      {state.kind === 'loading' && <div className="pl-empty">读取程序日志…</div>}
      {state.kind === 'error' && (
        <div className="pl-empty err" id="programLogError">
          读取失败：{state.error}
        </div>
      )}
      {state.kind === 'ok' && shown.length === 0 && (
        <div className="pl-empty" id="programLogEmpty">
          暂无程序日志（有操作后会自动留痕）。
        </div>
      )}
      {state.kind === 'ok' && shown.length > 0 && (
        <div
          className="pl-body"
          id="programLogBody"
          ref={bodyRef}
          data-testid="program-log-body"
          onScroll={() => {
            const el = bodyRef.current;
            if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {shown.map((line, i) => {
            const h = humanizeProgramLog(line);
            return (
              <div
                className={`pl-line ${line.level}`}
                data-testid="program-log-line"
                key={`${line.ts ?? 'line'}-${i}`}
                title={line.raw}
              >
                <span className="pl-time">{formatLogClock(line.ts)}</span>
                <span className={`pl-level ${line.level}`}>{mode === 'human' ? h.level : (line.level === 'unknown' ? 'LOG' : line.level.toUpperCase())}</span>
                {mode === 'human' ? (
                  <>
                    <span className="pl-msg">
                      {h.title}
                      {h.note && <span className="pl-note"> · {h.note}</span>}
                    </span>
                    {h.code && <span className="pl-scope">{h.code}</span>}
                  </>
                ) : (
                  <>
                    {line.scope && <span className="pl-scope">{line.scope}:{line.action}</span>}
                    <span className="pl-msg">{line.message}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {state.kind === 'ok' && errors > 0 && (
        <div className="pl-alert" id="programLogFeedback" data-testid="program-log-feedback">
          <span>
            ⚠ 最近 {state.lines.length} 条程序日志中有 {errors} 条错误。请复制诊断信息反馈给维护者。
          </span>
          <button className="btn" id="btnCopyDiagnostics" type="button" onClick={() => void onCopy()}>
            {copyState === 'ok' ? '✅ 已复制' : copyState === 'fail' ? '复制失败（请重试）' : '📋 复制诊断信息'}
          </button>
        </div>
      )}

      {state.kind === 'ok' && state.path && (
        <div className="pl-path" title={state.path}>
          日志文件：{state.path}
        </div>
      )}
    </section>
  );
}
