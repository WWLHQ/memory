// 单家宿主 Agent 接入卡片（批次48 起 1:1 对齐设计真源 stratum-a-full.html pg-agent 的 af-panel 卡）：
// af-ph(h3 卡名 + af-badge 状态) + af-pb(af-kv 四行真实指标 + af-row 操作钮) + af-det「接入配置」。
// 真实口径不变：成功率/平均延时只统计真实拨测样本（审计），无样本如实显「—」，绝不伪造演示数字。
import type { UiAgentCard, AgentRealStats } from '../../types/agentOnboard.ts';
import type { Form } from '../../types/agentOnboard.ts';
import { McpToolConfig, toolRef } from './McpToolConfig.tsx';
import { ChannelConfig } from './ChannelConfig.tsx';
import { IsolationConfig } from './IsolationConfig.tsx';
import { KeyMgmt } from './KeyMgmt.tsx';
import { TestPanel, type TestEvidence } from './TestPanel.tsx';

/** 相对时间（真实 lastRotateAt / lastTestAt 展示用） */
function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/** 时钟（真实 lastTestAt 展示用，本机时区 HH:mm） */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface AgentCardProps {
  agent: UiAgentCard;
  /** R4 违规提示文案（空 = 无违规） */
  error: string;
  /** 熔断 OPEN → 禁测试 */
  testDisabled: boolean;
  /** R4 违规 → 禁保存 */
  saveDisabled: boolean;
  /** 点击"测试接入"后显示注入预览 */
  injectVisible: boolean;
  onToolChange: (tool: 'recall' | 'write' | 'pref', checked: boolean) => void;
  onIsoChange: (key: 'projShare' | 'prefCross', checked: boolean) => void;
  onChanChange: (ch: 'webhook' | 'api', checked: boolean) => void;
  onAct: (act: 'test' | 'rotate' | 'save') => void;
  onRidClick: (agentName: string) => void;
  /** 吊销（撤销自动绑定，写审计 unbound）；仅当该卡在发现名单里有对应行时由容器传入 —— 找不到就不渲染该钮（诚实化） */
  onRevoke?: () => void;
  /** 真实统计（接入后端审计 + 本地测速）；传入即启用真实口径，无数据显「—」。
   *  缺省（组件单测直渲）→ 用卡片自带字段；未采样字段（0）一律显「—」。 */
  stats?: AgentRealStats;
  /** 本次测试的真实回执（真实 rid + 账本注入预览）；缺省 → 如实显示「尚未测试」。 */
  testEvidence?: TestEvidence;
  /** 真实拨测失败原因（服务层 lastTest）；降级告警如实展示，不冒充熔断文案。 */
  failureReason?: string;
  /** 真实租户覆盖（来自 TenantContext）；传入则覆盖卡片 tenant 字段。 */
  tenantOverride?: string;
}

/** 状态徽标（设计稿口径）：熔断 OPEN → bad「熔断中」；半开 → warn；连通 → ok「CONNECTED」；降级 → warn；未配置 → 默认 */
function badgeOf(a: UiAgentCard): { text: string; cls: string } {
  if (a.circuit === 'OPEN') return { text: '熔断中', cls: 'bad' };
  if (a.circuit === 'HALF_OPEN') return { text: '半开探测中', cls: 'warn' };
  if (a.state === 'connected') return { text: 'CONNECTED', cls: 'ok' };
  if (a.state === 'degraded') return { text: '⚠ 降级', cls: 'warn' };
  return { text: '未配置', cls: '' };
}

export function AgentCard(props: AgentCardProps) {
  const { agent: a, error, testDisabled, saveDisabled, injectVisible, stats: st, tenantOverride } = props;
  const hasStats = !!st;
  // 连通成功率（真实）：tests>0 → 通过率 + 样本数；无统计或未采样 → 「— 无有效样本」
  const tests = st?.tests ?? 0;
  const passed = st?.passed ?? 0;
  const connVal = hasStats && tests > 0 ? Math.round((passed / tests) * 100) : (!hasStats && a.conn > 0 ? a.conn : null);
  const connDisp = connVal === null
    ? '未取数 · 无有效样本'
    : (hasStats && tests > 0 ? `${connVal}%（${passed}/${tests}）` : `${connVal}%`);
  const deg = a.state === 'degraded';
  const circuitOpen = a.circuit === 'OPEN';
  // 平均延时（真实）：历史 test/auto_bind 探测耗时均值；无样本 → 最近一次；再无 → 「—」
  const rtt = hasStats ? (st!.avgRtt ?? st!.lastRtt) : undefined;
  const latencyDisp = hasStats
    ? (rtt != null ? (rtt >= 1000 ? `${(rtt / 1000).toFixed(1)}s` : `${Math.round(rtt)}ms`) : '未取数 · 无拨测样本')
    : (a.latency > 0 ? `${a.latency}s` : '未取数 · 无拨测样本');
  const badge = badgeOf(a);
  // 密钥（真实）：后端审计最近 rotate ts；无记录 → 卡片字段（未记录）
  const keyLast = hasStats
    ? (st?.lastRotateAt != null ? formatAgo(st.lastRotateAt) : (a.key.rotated ? '刚轮换' : '未记录'))
    : a.key.last;
  const staleDays = st?.lastRotateAt != null
    ? Math.floor((Date.now() - st.lastRotateAt) / 86_400_000)
    : null;
  const lastTestAt = st?.lastTestAt;
  const lastTestOk = !props.failureReason;
  const metricSrc = (hasStats
    ? (tests > 0
      ? `指标来源：接入审计 · ${tests} 次连通尝试 / ${passed} 次通过${st!.lastTestAt != null ? ` · 最近 ${formatAgo(st!.lastTestAt)}` : ''}`
      : '暂无连通样本：登录自动接入会自动拨测一次；也可点「测试」立即生成')
    : '指标未加载：本机接入后端未返回该 Agent 的审计样本；确认桌面端已启动，或点「手动检测」重建')
    + ` · 租户 ${tenantOverride ?? a.tenant}`;

  return (
    <section className="af-panel" data-agent={a.name}>
      <div className="af-ph">
        <h3>{a.name}</h3>
        <span className={`af-badge ${badge.cls}`} data-testid={`agent-badge-${a.name}`}>{badge.text}</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 8 }}>
        <dl className="af-kv" data-testid={`agent-kv-${a.name}`}>
          <dt>成功率</dt>
          <dd
            className={connVal !== null && connVal < 95 ? 'warn' : ''}
            data-conn-src={hasStats ? 'audit' : 'card'}
            title={hasStats
              ? (tests > 0 ? `${tests} 次连通尝试 / ${passed} 次通过（接入审计）` : '暂无真实样本，不估算')
              : undefined}
          >{connDisp}</dd>
          <dt>平均延时</dt>
          <dd title={hasStats
            ? (st!.avgRtt != null ? `平均探测耗时（${tests} 次连通尝试）` : '最近一次探测耗时')
            : undefined}
          >{latencyDisp}</dd>
          <dt>密钥</dt>
          <dd data-mask>{a.key.mask}{a.key.rotated ? '（新）' : ''} · 宽限 {a.key.grace}h · 上次 {keyLast}</dd>
          {circuitOpen ? (
            <>
              <dt>熔断原因</dt>
              <dd>{props.failureReason ?? '连续拨测未通过（审计 lastTest）'}</dd>
            </>
          ) : (
            <>
              <dt>最近拨测</dt>
              <dd data-testid={`agent-lasttest-${a.name}`}>
                {lastTestAt ? `${fmtClock(lastTestAt)} · ${lastTestOk ? 'ok' : 'fail'}` : '未取数'}
              </dd>
            </>
          )}
        </dl>
        <p className="af-note" data-metric-src {...(hasStats ? {} : { 'data-metric-missing': '' })}>
          {metricSrc}
        </p>

        {/* 真降级才显示的告警（af-alert warn）；R4 违规走 af-alert bad */}
        {deg && (
          <div className="af-alert warn" role="alert" data-testid={`agent-degraded-${a.name}`}>
            {circuitOpen
              ? '⚠ 主通道 Webhook 熔断 OPEN，已降级为仅补偿通道（5min 延迟，数据完整性不受影响 · 5.4）'
              : `⚠ 最近一次真实拨测未通过：${props.failureReason ?? '原因未记录'} · 已降级为仅补偿通道（数据完整性不受影响 · 5.4）`}
          </div>
        )}
        {error && <div className="af-alert bad" role="alert" data-err>{error}</div>}

        {/* 接入配置（af-det 折叠）：MCP 工具 / 隔离粒度 / 采集通道 / 密钥 / 接入测试面板 */}
        <details className="af-det">
          <summary>接入配置（工具 / 隔离 / 通道 / 密钥 / 测试面板）</summary>
          <div className="det-b af-stack" style={{ gap: 8 }}>
            <McpToolConfig tools={a.tools} onChange={props.onToolChange} />
            <IsolationConfig iso={a.iso} onChange={props.onIsoChange} />
            <ChannelConfig chan={a.chan} onChange={props.onChanChange} />
            <KeyMgmt apiKey={{ ...a.key, last: keyLast }} staleDays={staleDays} />
            <TestPanel agent={a} injectVisible={injectVisible} evidence={props.testEvidence} onRidClick={props.onRidClick} />
          </div>
        </details>

        <div className="af-row">
          <button
            className="af-btn sm"
            data-act="test"
            disabled={testDisabled}
            title={testDisabled ? '熔断 OPEN 已停止主通道' : undefined}
            onClick={() => props.onAct('test')}
          >
            测试
          </button>
          <button className="af-btn sm" data-act="rotate" onClick={() => props.onAct('rotate')}>轮换密钥</button>
          <button className="af-btn sm" data-act="save" disabled={saveDisabled} onClick={() => props.onAct('save')}>保存配置</button>
          {props.onRevoke && (
            <button className="af-btn sm danger" data-act="unbind" onClick={props.onRevoke}>吊销</button>
          )}
        </div>
      </div>
    </section>
  );
}

// re-export 供容器层做工具归一化（原型 pref 可能是布尔 false）
export { toolRef };
export type { Form };
