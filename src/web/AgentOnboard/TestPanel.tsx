// 接入测试面板（规格 T8 / AC-003.8 · R7 必记 request_id · 注入预览）
// ⚠ 结构与文案严格对齐原型 renderCards 的 `.test` 区块。
// 真实化：只有拿到后端回执才显示 request_id 并可点开审计；后端不可达/未测试如实标注，
// 不伪造回执。注入预览实时取自内核账本（按卡片 top_k=5 · tokens≈字符/4 估算），
// 账本为空 → 诚实空态，不再硬编码演示数字。
import type { UiAgentCard } from '../../types/agentOnboard.ts';

export interface TestEvidence {
  /** 后端真实回执的 request_id（R7）；后端不可达时为 null */
  rid?: string | null;
  /** 真实注入预览（账本 top5）；账本为空 → null */
  inject?: { count: number; tokens: number } | null;
  /** 后端不可达 → 本地未验证 */
  local?: boolean;
  /** 本次真实拨测是否通过（缺省 = 未知） */
  ok?: boolean;
  /** 未通过/不可达的真实原因 */
  reason?: string;
}

interface Props {
  agent: UiAgentCard;
  /** 注入预览条（点击"测试接入"后显示） */
  injectVisible: boolean;
  /** 本次测试的真实回执（无 → 如实标注未测试/未验证） */
  evidence?: TestEvidence;
  /** request_id 点击 → 跳审计页（18.2-E） */
  onRidClick: (agentName: string) => void;
}

export function TestPanel({ agent, injectVisible, evidence, onRidClick }: Props) {
  const rid = evidence?.rid ?? '';
  const reason = evidence?.reason ?? '';
  // 三态：未测试 / 有真实回执 / 未生成回执（后端不可达或失败），后两种不显示可点击的假 rid
  const label = !evidence
    ? '尚未测试 · 点「▶ 测试接入」'
    : rid
      ? rid
      : evidence.local
        ? '后端不可达 · 本次未验证'
        : '未生成审计回执 · 本次未验证';
  const clickable = !!rid;
  const showReason = !!evidence && !!reason && evidence.ok !== true;
  const inject = evidence?.inject;
  return (
    <div className="test" data-test>
      接入测试：
      <span
        className={`rid${clickable ? '' : ' rid-muted'}`}
        data-rid
        data-rid-live={clickable ? 'true' : 'false'}
        title={clickable ? '点击到审计页定位本次 request_id' : '尚未拿到后端回执，不能定位审计'}
        onClick={clickable ? () => onRidClick(agent.name) : undefined}
      >
        {label}
      </span>
      {showReason ? <div className="test-reason" data-test-reason>原因：{reason}</div> : null}
      <div className="test-hint" data-test-hint>
        用途：对本机 Agent 真实拨测一次并写审计（生成 request_id 与耗时）。登录自动接入已完成自动拨测，
        因此不必逐张手点；手动测试用于复查/排障，不点不影响接入与指标。
      </div>
      <div className="inject" data-inject style={injectVisible ? undefined : { display: 'none' }}>
        {inject
          ? <>注入预览：将注入 <b>{inject.count}</b> 条记忆到 Agent prompt（≈ <b>{inject.tokens}</b> tokens · 实时取自账本 top5）</>
          : <>注入预览：账本暂无可注入记忆（写入记忆后此处显示真实条数）</>}
      </div>
    </div>
  );
}
