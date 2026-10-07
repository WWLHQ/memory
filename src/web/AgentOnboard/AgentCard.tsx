// 单家宿主 Agent 接入卡片（规格 T3 / 19.2 · 19.3 · 5.2）
// ⚠ 硬性约定：结构、class、文案、data-* 属性严格对齐
//    design/ui/Agent接入页_原型.html 的 renderCards()，禁止偏离。
import type { UiAgentCard } from '../../types/agentOnboard.ts';
import type { Form } from '../../types/agentOnboard.ts';
import { McpToolConfig, toolRef } from './McpToolConfig.tsx';
import { ChannelConfig } from './ChannelConfig.tsx';
import { IsolationConfig } from './IsolationConfig.tsx';
import { KeyMgmt } from './KeyMgmt.tsx';
import { TestPanel } from './TestPanel.tsx';

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
}

export function AgentCard(props: AgentCardProps) {
  const { agent: a, error, testDisabled, saveDisabled, injectVisible } = props;
  const connClass = a.conn < 95 ? 'warn' : '';
  const deg = a.state === 'degraded';
  const stTxt = a.state === 'connected' ? '已连通' : a.state === 'degraded' ? '降级（仅补偿）' : '未配置';
  const stDot = a.state === 'connected' ? 'connected' : a.state === 'degraded' ? 'degraded' : 'onboard';
  const circuitColor =
    a.circuit === 'OPEN' ? 'var(--err)' : a.circuit === 'HALF_OPEN' ? 'var(--warn)' : 'var(--ok)';

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
          <div className={`v ${connClass}`}>{a.conn}%</div>
        </div>
        <div className="metric">
          <div className="k">熔断状态（5.2）</div>
          <div className="v" style={{ color: circuitColor }}>{a.circuit}</div>
        </div>
        <div className="metric">
          <div className="k">平均延迟（&gt;5s ⚠）</div>
          <div className={`v ${a.latency > 5 ? 'warn' : ''}`}>{a.latency}s</div>
        </div>
        <div className="metric">
          <div className="k">租户（只读·全局）</div>
          <div className="v" style={{ fontSize: 12 }}>{a.tenant}</div>
        </div>
      </div>

      <McpToolConfig tools={a.tools} onChange={props.onToolChange} />
      <IsolationConfig iso={a.iso} onChange={props.onIsoChange} />
      <ChannelConfig chan={a.chan} onChange={props.onChanChange} />
      <KeyMgmt apiKey={a.key} />

      <div className={`warn ${deg ? 'show' : ''}`}>
        {deg ? '⚠ 主通道 Webhook 熔断 OPEN，已降级为仅补偿通道（5min 延迟，数据完整性不受影响 · 5.4）' : ' '}
      </div>
      <div className={`errbox ${error ? 'show' : ''}`} data-err>{error}</div>

      <TestPanel agent={a} injectVisible={injectVisible} onRidClick={props.onRidClick} />

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