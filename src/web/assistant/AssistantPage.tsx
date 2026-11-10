// 记忆助手 · 整页（2026-11-10 用户要求：原悬浮窗改为整页页面）。
//
// 与原壳层浮窗（shell/MemoryAssistant.tsx）的区别：
// - 浮窗挂在壳层菜单栏内、覆盖在中心区之上；本页是真正的中心页标签（assistant.html）。
// - 页面自行读取真实账本快照（loadOverview，与首页/状态栏同源），不依赖壳层传入 props。
// - 回答仍只转述本次真实快照（answerOverviewQuestion），读不到就如实标注，绝不编造。
//
// 刷新约定（与全站一致）：
// - 页面内「重读」按钮 → 重新 loadOverview()（只重取数据，不重挂页面）；
// - 壳层 F5 → reloadNonce 递增 → iframe 重挂 → 页面重新挂载即重新取数（data-testid 保持不变）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadOverview, type OverviewSnapshot } from '../shell/overview.ts';
import { answerOverviewQuestion, OVERVIEW_SUGGESTIONS, type OverviewAnswer } from '../overview/overviewPageData.ts';
import { Icon } from '../shell/Icons.tsx';

export function AssistantPage() {
  const [overview, setOverview] = useState<OverviewSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [thread, setThread] = useState<OverviewAnswer[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await loadOverview();
      setOverview(next);
      setErr(null);
    } catch (e: unknown) {
      setErr((e as { message?: string })?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const ask = (question: string) => {
    if (!overview) return;
    const q = question.trim();
    if (!q) return;
    setThread((prev) => [answerOverviewQuestion(q, overview), ...prev]);
    setInput('');
    requestAnimationFrame(() => bodyRef.current?.scrollTo?.({ top: 0 }));
  };

  return (
    <div className="ma-page" data-testid="memory-assistant-page">
      <div className="ma-page-head">
        <span className="ma-mark"><Icon name="spark" size={14} /></span>
        <b>记忆助手</b>
        <span className="ma-spring" />
        <button
          className="ma-tool" type="button" onClick={() => void reload()} disabled={busy}
          title="重新读取真实账本" aria-label="重新读取真实账本" data-testid="ma-refresh"
        ><Icon name="refresh" size={12} /></button>
      </div>

      <div className="ma-state" data-testid="ma-state">
        {err
          ? `账本读取失败：${err}`
          : overview
            ? `账本读取 ${new Date(overview.loadedAt).toLocaleTimeString('zh-CN')} · 只转述本次快照，不含演示数据`
            : busy ? '正在读取真实账本…' : '账本尚未读取'}
      </div>

      <div className="ma-body" ref={bodyRef} data-testid="ma-body">
        {thread.length === 0 ? (
          <div className="ma-empty">
            问账本：成本、异常、冲突、同步、记忆条数…回答只依据本次真实账本读取。
          </div>
        ) : thread.map((a, i) => (
          <div className="ma-answer" key={`${a.question}-${i}`} data-testid="ma-answer">
            <div className="ma-q"><Icon name="user" size={11} />{a.question}</div>
            <div className="ma-lead">{a.lead}</div>
            <div className="ma-text">{a.body}</div>
            <div className="ma-src"><Icon name="check" size={10} />{a.state}</div>
          </div>
        ))}
      </div>

      <div className="ma-sugg">
        {OVERVIEW_SUGGESTIONS.map((q) => (
          <button className="ma-chip" key={q} type="button" onClick={() => ask(q)} disabled={!overview}>{q}</button>
        ))}
      </div>

      <div className="ma-ask">
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          placeholder="问账本：成本、异常、冲突、同步、记忆条数…"
          aria-label="问账本"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <button
          className="ma-send" type="button" title="发送（Enter）" aria-label="发送"
          onClick={() => ask(input)} disabled={!overview || !input.trim()} data-testid="ma-send"
        ><Icon name="play2" size={13} /></button>
      </div>
      <div className="ma-foot">
        Enter 发送 · Shift+Enter 换行 · 切换标签不丢会话
        <br />
        刷新约定：本页「重读」只重新取本页数据（不丢会话）；F5 刷新全部打开的页面与壳层读数。
      </div>
    </div>
  );
}
