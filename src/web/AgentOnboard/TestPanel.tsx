// 接入测试面板（规格 T8 / AC-003.8 · R7 必记 request_id · 注入预览）
// ⚠ 结构与文案严格对齐原型 renderCards 的 `.test` 区块。
import type { UiAgentCard } from '../../types/agentOnboard.ts';

interface Props {
  agent: UiAgentCard;
  /** 注入预览条（点击"测试接入"后显示） */
  injectVisible: boolean;
  /** request_id 点击 → 跳审计页（18.2-E） */
  onRidClick: (agentName: string) => void;
}

export function TestPanel({ agent, injectVisible, onRidClick }: Props) {
  return (
    <div className="test" data-test>
      接入测试：
      <span className="rid" data-rid onClick={() => onRidClick(agent.name)}>req_test_{agent.name}</span>
      <div className="inject" data-inject style={injectVisible ? undefined : { display: 'none' }}>
        注入预览：将注入 <b>5</b> 条记忆到 Agent prompt（payload ≈ 780 tokens）
      </div>
    </div>
  );
}