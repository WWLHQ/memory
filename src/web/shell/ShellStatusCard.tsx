// REQ-014 / T7（C8）：系统状态条（批次58 起常驻命令条右端，原侧栏卡位已移除）。
//
// - 常驻「在线/离线/未知」完整端点串（用户 2026-11-21 图2）：原来「系统在线」的位置直接显示
//   ● 在线 · HTTP 200 · 已登录 · home/onboard 端口（取自 backend.ts）· mcp 两端 · webhook 端口；
//   健康与登录态来自壳层真实 loadOverview（/api/health + 真实会话），端口取自 backend.ts 单一真源；
//   在线绿 / 离线红 / 未知灰，颜色 + ● 图标 + 文字三标识，窄窗口允许换行但绝不省略端口；
// - 进行中 / 需要关注条目同条展示（写入兜底积压、补炼队列、采集、同步、MCP 开关）；
// - 12s 轻量轮询拉取，不是长轮询；不实现部署向导（Electron 自带服务）。
import { useEffect, useState } from 'react';
import { buildNavStatus, publishNavStatus, type NavStatusItem } from '../shared/navStatusChannel.ts';
import { MCP_MANUAL_HINT, requestEnableMcpSwitch } from '../shared/mcpSwitch.ts';
import { HOME_BASE, ONBOARD_BASE } from '../backend.ts';
import { SHELL_STATUS_POLL_MS, loadShellStatus, toNavStatusSource, type McpSwitchBrief } from './shellStatus.ts';

const TONE_TITLE: Record<NavStatusItem['tone'], string> = {
  idle: '空闲',
  busy: '进行中',
  warn: '需要关注',
};

/** 状态条提示也要给下一步：只报「N 项异常 / N 站失败」用户不知道去哪里修 */
const FIX_HINT: Partial<Record<NavStatusItem['key'], string>> = {
  'mcp-issue': '处理办法：到「MCP 接入」页，点异常行的「怎么处理」查看具体文件与修复步骤',
  'web-issue': '处理办法：到「网页端接入」页，点「看失败原因与处理办法」逐站处理',
};

/** 端点区唯一数据源：壳层真实 loadOverview 的健康 + 会话，未知就如实 unknown（灰） */
export interface EndpointBrief {
  tone: 'online' | 'offline' | 'unknown';
  /** 形如 HTTP 200 / HTTP 503（后端未就绪） */
  detail: string;
  /** 已登录 / 未登录 / 登录未知 */
  session: string;
}

/** 端口标签：home/onboard 从 backend.ts 单一真源派生（A4 门禁禁硬编码字面量） */
const HOME_PORT = `:${new URL(HOME_BASE).port}`;
const ONBOARD_PORT = `:${new URL(ONBOARD_BASE).port}`;

const ENDPOINT_TITLE: Record<EndpointBrief['tone'], string> = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
};

export function ShellStatusCard({ endpoint }: { endpoint?: EndpointBrief }) {
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
        // 顺便回传给壳层侧栏（与 navCount 通道互不冲突；顶层窗口时为空操作）
        publishNavStatus(next);
      } catch {
        // 整轮失败 → 不显示任何状态条目（不保留上一轮旧值冒充"最新"）；在线判据由真实健康检查决定
        if (!alive) return;
        setItems([]);
      }
    };
    // 2026-11-22 启动提速：侧栏状态徽标不是首屏关键路径。
    // 首轮延后 800ms（让首页读数和底部面板先出），之后照常 12s 轮询；读到就显示，读不到不显示。
    const first = setTimeout(() => { void tick(); }, 800);
    const timer = setInterval(() => { void tick(); }, SHELL_STATUS_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
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

  const ep: EndpointBrief = endpoint ?? { tone: 'unknown', detail: '健康检查未读取', session: '登录未知' };
  const epDot = ep.tone === 'online' ? 'ok' : ep.tone === 'offline' ? 'err' : 'neutral';

  return (
    <div className="shell-status" data-testid="shell-status" role="status" aria-live="polite">
      {/* 唯一一份完整端点串：颜色 + ● 图标 + 在线/离线/未知文字；窄窗口换行，绝不省略端口 */}
      <span
        className={`ss-pill shell-endpoint ${ep.tone}`}
        data-testid="shell-status-net"
        data-health={ep.tone}
        title={`系统状态：${ENDPOINT_TITLE[ep.tone]}（${ep.detail} · ${ep.session} · 端口取自 backend.ts 单一真源）`}
      >
        <span className={`dot ${epDot}`} aria-hidden="true" />
        <span className="ss-ep-state">{ENDPOINT_TITLE[ep.tone]}</span>
        <span className="ss-ep-sep" aria-hidden="true">·</span>
        <span className="ss-ep-detail">{ep.detail}</span>
        <span className="ss-ep-sep" aria-hidden="true">·</span>
        <span className="ss-ep-session">{ep.session}</span>
        <span className="ss-ep-sep" aria-hidden="true">·</span>
        <span>home {HOME_PORT}</span>
        <span className="ss-ep-sep" aria-hidden="true">·</span>
        <span>onboard {ONBOARD_PORT}</span>
        <span className="ss-ep-sep" aria-hidden="true">·</span>
        <span>mcp :8202/:8204</span>
        <span className="ss-ep-sep" aria-hidden="true">·</span>
        <span>webhook :8203</span>
      </span>
      {(items ?? []).map((it) => (
        <span
          key={it.key}
          className={`shell-status-item ${it.tone}`}
          data-testid={`shell-status-${it.key}`}
          title={`${TONE_TITLE[it.tone]}：${it.label}（真实通道读数）${FIX_HINT[it.key] ? `。${FIX_HINT[it.key]}` : ''}`}
        >
          <span className={`dot ${it.tone === 'warn' ? 'err' : 'ok'}`} aria-hidden="true" />
          <span className="ss-label">{it.label}</span>
        </span>
      ))}
      {(mcpSwitch?.disabled === true || enablePending) && (
        <div className="ss-pop" data-testid="shell-status-mcp-actions">
          <div className="ss-pop-row">
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
          {enableError ? <div className="shell-status-err">一键打开失败：{enableError}</div> : null}
          {hint ? (
            <div className="shell-status-hint" data-testid="shell-status-mcp-hint">
              <b>手动打开位置：</b>{hint}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
