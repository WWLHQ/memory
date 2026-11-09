// 记忆助手：首页「问账本」问答框收进快捷栏（QAT），点击展开 / 再点收起。
// 面板挂在壳层菜单栏内，开闭状态与会话都由壳层持有——切换中心标签不重置、不丢会话。
// 回答只转述真实账本快照（answerOverviewQuestion）；读不到 / 未取数时如实标注，不编造。
import { useEffect, useRef, useState } from 'react';
import type { OverviewSnapshot } from './overview.ts';
import { answerOverviewQuestion, OVERVIEW_SUGGESTIONS, type OverviewAnswer } from '../overview/overviewPageData.ts';
import { Icon } from './Icons.tsx';

export interface MemoryAssistantProps {
  open: boolean;
  onClose: () => void;
  /** 壳层同一次真实账本读取（与层级刻度 / 状态栏同源）；null = 尚未读到 */
  overview: OverviewSnapshot | null;
  overviewBusy: boolean;
  onRefresh: () => void;
}

export function MemoryAssistant({ open, onClose, overview, overviewBusy, onRefresh }: MemoryAssistantProps) {
  const [input, setInput] = useState('');
  /** 问答会话：组件常驻壳层（收起只是不渲染），收起 / 切标签后再展开仍在 */
  const [thread, setThread] = useState<OverviewAnswer[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ask = (question: string) => {
    if (!overview) return;
    const q = question.trim();
    if (!q) return;
    setThread((prev) => [answerOverviewQuestion(q, overview), ...prev]);
    setInput('');
    requestAnimationFrame(() => bodyRef.current?.scrollTo?.({ top: 0 }));
  };

  if (!open) return null;

  return (
    <div className="ma-panel" role="dialog" aria-label="记忆助手" data-testid="memory-assistant">
      <div className="ma-head">
        <span className="ma-mark"><Icon name="spark" size={13} /></span>
        <b>记忆助手</b>
        <span className="ma-spring" />
        <button
          className="ma-tool" type="button" onClick={onRefresh} disabled={overviewBusy}
          title="重新读取真实账本" aria-label="重新读取真实账本" data-testid="ma-refresh"
        ><Icon name="refresh" size={12} /></button>
        <button
          className="ma-tool" type="button" onClick={onClose}
          title="收起记忆助手（Esc）" aria-label="收起记忆助手" data-testid="ma-close"
        ><Icon name="x" size={12} /></button>
      </div>
      <div className="ma-state" data-testid="ma-state">
        {overview
          ? `账本读取 ${new Date(overview.loadedAt).toLocaleTimeString('zh-CN')} · 只转述本次快照，不含演示数据`
          : overviewBusy ? '正在读取真实账本…' : '账本尚未读取'}
      </div>
      <div className="ma-body" ref={bodyRef}>
        {thread.length === 0 ? (
          <div className="ma-empty">问账本：成本、异常、冲突、同步、记忆条数…回答只依据本次真实账本读取。</div>
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
      <div className="ma-foot">Enter 发送 · Shift+Enter 换行 · 切换标签不丢会话</div>
    </div>
  );
}