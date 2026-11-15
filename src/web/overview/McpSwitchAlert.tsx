// 首页「客户端 MCP 开关」提示条（T3 展示层 · 落点①）。
// 原型唯一事实来源：design/ui/客户端MCP开关状态_原型.html 的①（af-alert / tag / 一键打开 / 去设置手动打开）。
// 诚实边界：一键打开成功后只切「待生效」态，绝不显示「已打开」；服务端离线时不提供一键打开。
import type { McpSwitchState } from '../shared/mcpSwitch.ts';

export interface McpSwitchAlertProps {
  state: McpSwitchState;
  busy?: boolean;
  error?: string | null;
  hint?: string | null;
  onEnable: () => void;
  onManual: () => void;
  onLaunch: () => void;
  onReload: () => void;
}

export function McpSwitchAlert(p: McpSwitchAlertProps) {
  if (p.state.view === 'ok') return null;
  const cls = p.state.view === 'pending' ? 'af-alert warn'
    : p.state.view === 'unknown' ? 'af-alert'
      : 'af-alert bad';
  return (
    <div data-testid="home-mcp-switch">
      <div className={cls} role="alert" data-testid="home-mcp-switch-alert">
        <span className="tag">MCP</span>
        <span className="mcp-switch-text">
          <b>{p.state.title}</b>：{p.state.detail}
        </span>
        <span className="mcp-switch-actions">
          {p.state.view === 'off' && (
            <button className="af-btn sm pri" type="button" data-testid="mcp-switch-enable"
              disabled={p.busy === true || !p.state.canEnable} onClick={p.onEnable}>
              一键打开
            </button>
          )}
          {(p.state.view === 'off' || p.state.view === 'pending') && (
            <button className="af-btn sm" type="button" data-testid="mcp-switch-manual" onClick={p.onManual}>
              去设置手动打开
            </button>
          )}
          {p.state.view === 'down' && (
            <button className="af-btn sm" type="button" data-testid="mcp-switch-launch" onClick={p.onLaunch}>
              去启动桌面端
            </button>
          )}
          {p.state.view === 'unknown' && (
            <button className="af-btn sm" type="button" data-testid="mcp-switch-reload" onClick={p.onReload}>
              重读
            </button>
          )}
        </span>
      </div>
      {/* 用户 2026-11-15 实机反馈：提示必须紧贴「去设置手动打开」按钮下方且足够醒目，
          原先用小灰字（.af-note）排在脚注之后，实际被当成没反应。 */}
      {p.hint ? (
        <div className="af-alert warn mcp-switch-hint" role="status" data-testid="mcp-switch-hint">
          <b>手动打开位置：</b><span>{p.hint}</span>
        </div>
      ) : null}
      <div className="af-note mcp-switch-note">{p.state.footnote}</div>
      {p.error ? <div className="af-alert bad" role="alert" data-testid="mcp-switch-error">一键打开失败：{p.error}</div> : null}
    </div>
  );
}
