// REQ-014 / T7（C8）：侧栏真实状态卡。
//
// 只展示从宿主真实读到、且确实处于「进行中 / 需要关注」的状态：
// - 写入兜底积压（pending ≠ 成功）、补炼队列排队、采集运行中 / 停自动重试 / 连续失败；
// - 全部为空（系统空闲）时**整块不渲染**，不拿"一切正常"当装饰；
// - 12s 轻量轮询拉取，不是长轮询；不实现部署向导（Electron 自带服务）。
import { useEffect, useState } from 'react';
import { buildNavStatus, publishNavStatus, type NavStatusItem } from '../shared/navStatusChannel.ts';
import { MCP_MANUAL_HINT, requestEnableMcpSwitch } from '../shared/mcpSwitch.ts';
import { SHELL_STATUS_POLL_MS, loadShellStatus, toNavStatusSource, type McpSwitchBrief } from './shellStatus.ts';

const TONE_TITLE: Record<NavStatusItem['tone'], string> = {
  idle: '空闲',
  busy: '进行中',
  warn: '需要关注',
};

export function ShellStatusCard() {
  const [items, setItems] = useState<NavStatusItem[] | null>(null);
  // T3 落点③：一键打开后保持「待生效」，不因 12 秒复核把卡片刷没
  const [mcpSwitch, setMcpSwitch] = useState<McpSwitchBrief | null>(null);
  const [enablePending, setEnablePending] = useState(false);
  const [enableBusy, setEnableBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const snap = await loadShellStatus();
        if (!alive) return;
        const next = buildNavStatus(toNavStatusSource(snap));
        setItems(next);
        setMcpSwitch(snap.mcpSwitch?.status === 'ok' ? snap.mcpSwitch.view : null);
        // 顺便回传给壳层侧栏（与 navCount 通道互不冲突）
        publishNavStatus(next);
      } catch {
        // 整轮失败 → 不显示任何状态（不保留上一轮旧值冒充"最新"）
        if (alive) setItems([]);
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, SHELL_STATUS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  /** 一键打开只清禁用标记并备份原配置；客户端不会热重读，成功也只显示「待生效」。 */
  const onEnable = async () => {
    if (!mcpSwitch?.id) return;
    setEnableBusy(true);
    setEnableError(null);
    const r = await requestEnableMcpSwitch(mcpSwitch.id);
    setEnableBusy(false);
    if (!r.ok) { setEnableError(r.error ?? '未知原因'); return; }
    setEnablePending(true);
  };

  if ((!items || items.length === 0) && !enablePending) return null;

  return (
    <div className="shell-status" data-testid="shell-status" role="status" aria-live="polite">
      <div className="tree-group">系统状态</div>
      {(items ?? []).map((it) => (
        <div
          key={it.key}
          className={`shell-status-item ${it.tone}`}
          data-testid={`shell-status-${it.key}`}
          title={`${TONE_TITLE[it.tone]}：${it.label}（真实通道读数，无数据时不显示）`}
        >
          <span className={`dot ${it.tone === 'warn' ? 'err' : 'ok'}`} aria-hidden="true" />
          <span className="ss-label">{it.label}</span>
        </div>
      ))}
      {(mcpSwitch?.disabled === true || enablePending) && (
        <div className="shell-status-actions" data-testid="shell-status-mcp-actions">
          {enablePending ? (
            <span className="ss-label">已清除标记 · 待生效</span>
          ) : (
            <button className="shell-status-btn primary" type="button"
              data-testid="shell-status-mcp-enable" disabled={enableBusy}
              onClick={() => void onEnable()}>
              一键打开
            </button>
          )}
          <button className="shell-status-btn" type="button"
            onClick={() => setHint(MCP_MANUAL_HINT)}>
            去设置手动打开
          </button>
        </div>
      )}
      {enableError ? <div className="shell-status-err">一键打开失败：{enableError}</div> : null}
      {hint ? (
        <div className="shell-status-hint" data-testid="shell-status-mcp-hint">
          <b>手动打开位置：</b>{hint}
        </div>
      ) : null}
    </div>
  );
}
