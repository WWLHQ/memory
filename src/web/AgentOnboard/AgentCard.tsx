// 单家宿主 Agent 接入卡片（规格 T3 / 19.2 · 19.3 · 5.2）
// ⚠ 硬性约定：结构、class、文案、data-* 属性严格对齐
//    design/ui/Agent接入页_原型.html 的 renderCards()，禁止偏离。
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

export function AgentCard(props: AgentCardProps) {
  const { agent: a, error, testDisabled, saveDisabled, injectVisible, stats: st } = props;
  const hasStats = !!st;
  // 连通成功率：tests>0 → 通过率；无统计或未采样（0）→ 「—」，不伪造百分比
  const tests = st?.tests ?? 0;
  const connVal = hasStats
    ? (tests > 0 ? Math.round(((st!.passed ?? 0) / tests) * 100) : null)
    : (a.conn > 0 ? a.conn : null);
  const connClass = connVal !== null && connVal < 95 ? 'warn' : '';
  const connDisp = connVal === null ? '未取数' : `${connVal}%`;
  const deg = a.state === 'degraded';
  const stTxt = a.state === 'connected' ? '已连通' : a.state === 'degraded' ? '降级（仅补偿）' : '未配置';
  const stDot = a.state === 'connected' ? 'connected' : a.state === 'degraded' ? 'degraded' : 'onboard';
  const circuitColor =
    a.circuit === 'OPEN' ? 'var(--err)' : a.circuit === 'HALF_OPEN' ? 'var(--warn)' : 'var(--ok)';
  // 平均延迟（真实）：历史 test/auto_bind 探测耗时均值；无样本 → 最近一次；再无 → 「—」
  const rtt = hasStats ? (st!.avgRtt ?? st!.lastRtt) : undefined;
  const latencyDisp = hasStats
    ? (rtt != null ? (rtt >= 1000 ? `${(rtt / 1000).toFixed(1)}s` : `${Math.round(rtt)}ms`) : '未取数')
    : (a.latency > 0 ? `${a.latency}s` : '未取数');
  const latencyWarn = hasStats ? rtt != null && rtt > 5000 : a.latency > 5;
  const latencyTitle = hasStats
    ? (st!.avgRtt != null ? `平均探测耗时（${tests} 次连通尝试）` : '最近一次探测耗时')
    : undefined;
  // 密钥轮换（真实）：后端审计最近 rotate ts；无记录 → 「未记录」
  const keyLast = hasStats
    ? (st?.lastRotateAt != null ? formatAgo(st.lastRotateAt) : (a.key.rotated ? '刚轮换' : '未记录'))
    : a.key.last;
  const staleDays = st?.lastRotateAt != null
    ? Math.floor((Date.now() - st.lastRotateAt) / 86_400_000)
    : null;

  return (
    <div className={`card${deg ? ' degraded' : ''}`} data-agent={a.name}>
      <div className="top">
        <span className={`badge ${a.badge}`}>{a.label}</span>
        <span className="agent-name">{a.name}</span>
        <span className="method">{a.method}</span>
        <span style={{ marginLeft: 'auto' }}>
          <span className={`statusdot st-${stDot}`} />
          {stTxt}
        </span>
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="k">连通成功率（&lt;95% ⚠）</div>
          <div
            className={`v ${connClass}`}
            data-conn-src={hasStats ? 'audit' : 'card'}
            title={hasStats
              ? (tests > 0 ? `${tests} 次连通尝试 / ${st!.passed ?? 0} 次通过（接入审计）` : '暂无真实样本，不估算')
              : undefined}
          >{connDisp}</div>
        </div>
        <div className="metric">
          <div className="k">熔断状态（5.2）</div>
          <div className="v" style={{ color: circuitColor }}>{a.circuit}</div>
        </div>
        <div className="metric">
          <div className="k">平均延迟（&gt;5s ⚠）</div>
          <div className={`v ${latencyWarn ? 'warn' : ''}`} title={latencyTitle}>{latencyDisp}</div>
        </div>
        <div className="metric">
          <div className="k">租户（只读·全局）</div>
          <div className="v" style={{ fontSize: 12 }}>{props.tenantOverride ?? a.tenant}</div>
        </div>
      </div>
      {hasStats ? (
        <div className="metric-src" data-metric-src>
          {tests > 0
            ? `指标来源：接入审计 · ${tests} 次连通尝试 / ${st!.passed ?? 0} 次通过${st!.lastTestAt != null ? ` · 最近 ${formatAgo(st!.lastTestAt)}` : ''}`
            : '暂无连通样本：登录自动接入会自动拨测一次；也可点「▶ 测试接入」立即生成'}
        </div>
      ) : (
        <div className="metric-src" data-metric-src data-metric-missing>
          指标未加载：本机接入后端未返回该 Agent 的审计样本；确认桌面端已启动，或点「🔍 手动检测」重建
        </div>
      )}

      <McpToolConfig tools={a.tools} onChange={props.onToolChange} />
      <IsolationConfig iso={a.iso} onChange={props.onIsoChange} />
      <ChannelConfig chan={a.chan} onChange={props.onChanChange} />
      <KeyMgmt apiKey={{ ...a.key, last: keyLast }} staleDays={staleDays} />

      <div className={`warn ${deg ? 'show' : ''}`}>
        {deg
          ? (a.circuit === 'OPEN'
            ? '⚠ 主通道 Webhook 熔断 OPEN，已降级为仅补偿通道（5min 延迟，数据完整性不受影响 · 5.4）'
            : `⚠ 最近一次真实拨测未通过：${props.failureReason ?? '原因未记录'} · 已降级为仅补偿通道（数据完整性不受影响 · 5.4）`)
          : ' '}
      </div>
      <div className={`errbox ${error ? 'show' : ''}`} data-err>{error}</div>

      <TestPanel agent={a} injectVisible={injectVisible} evidence={props.testEvidence} onRidClick={props.onRidClick} />

      <div className="btns">
        <button
          className="btn primary"
          data-act="test"
          disabled={testDisabled}
          title={testDisabled ? '熔断 OPEN 已停止主通道' : undefined}
          onClick={() => props.onAct('test')}
        >
          ▶ 测试接入
        </button>
        <button className="btn" data-act="rotate" onClick={() => props.onAct('rotate')}>轮换密钥</button>
        <button className="btn" data-act="save" disabled={saveDisabled} onClick={() => props.onAct('save')}>保存配置</button>
      </div>
    </div>
  );
}

// re-export 供容器层做工具归一化（原型 pref 可能是布尔 false）
export { toolRef };
export type { Form };