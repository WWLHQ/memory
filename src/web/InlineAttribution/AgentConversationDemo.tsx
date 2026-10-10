// REQ-004 T10 宿主集成：Claude Code 风格对话演示页（exercise harness，不绑定业务页）
// 把四类标识内联进会话气泡/头部/底部，外层包 AttributionConfigProvider + 挂 AttributionToggle。
// 示例数据对齐原型 design/ui/Agent界面内联标识_原型.html 的 MEM。
import { useState } from 'react';
import './inlineAttribution.css';
// 内联标识演示页不要求登录（pure UI demo），显式跳过门控
import { TenantProvider, type LoginFn, type LogoutFn } from '../Home/tenantContext.tsx';
const DUMMY_LOGIN: LoginFn = () => ({ ok: true, context: { enterprise_id: 'demo', team_id: 'demo', user_id: 'guest', perspective: 'personal', session_id: `guest-${Date.now()}` }, audit: { action: 'login', form: 'desktop', account: 'guest', at: Date.now() } });
const DUMMY_LOGOUT: LogoutFn = () => {};
import { AttributionConfigProvider } from './AttributionConfig.tsx';
import { AttributionToggle } from './AttributionToggle.tsx';
import { BackgroundChip } from './BackgroundChip.tsx';
import { MemoryInjectionTag } from './MemoryInjectionTag.tsx';
import { AgingWarnTag } from './AgingWarnTag.tsx';
import { TokenSavingBar } from './TokenSavingBar.tsx';
import { AttributionSummary } from './AttributionSummary.tsx';
import { applyFeedback } from '../../inlineAttribution/feedback.ts';
import { coreInlineAuditCount, coreInlineFeedback } from './coreInline.ts';
import type {
  AgingWarnMark,
  BackgroundMark,
  FeedbackAction,
  MemoryInjectionMark,
  TokenSaving,
  WriteBackMark,
} from '../../types/inlineAttribution.ts';

// ---- 示例数据（对齐原型 MEM） ----
const BACKGROUND: BackgroundMark = {
  count: 8,
  items: [
    { id: 'mem_002', kind: 'stack', text: 'Python 3.11 / FastAPI / PostgreSQL' },
    { id: 'mem_005', kind: 'constraint', text: 'API 响应 <200ms' },
    { id: 'mem_009', kind: 'decision', text: '2025-07-05 选 FastAPI 而非 Django（性能优先）' },
    { id: 'mem_014', kind: 'pitfall', text: 'Redis 连接超时 → 5s + 重试' },
  ],
};

const INJ_005: MemoryInjectionMark = {
  memory_id: 'mem_005',
  summaryL2: '约束：API 响应时间 < 200ms（10.3 性能验收）',
  decay_class: 'cold',
  aging_hint: '',
  request_id: 'req_017',
};
const INJ_009: MemoryInjectionMark = {
  memory_id: 'mem_009',
  summaryL2: '2025-07-05：选 FastAPI 而非 Django（性能优先，10.x 决策记录）',
  decay_class: 'hot',
  aging_hint: '45 天前记录，代码可能已改动，请校验（9.6 aging_hint）',
  request_id: 'req_017',
};
const INJ_021: MemoryInjectionMark = {
  memory_id: 'mem_021',
  summaryL2: 'L2 摘要：当前 FastAPI 版本与连接池配置（45 天）',
  decay_class: 'warm',
  aging_hint: '7 天前创建，如未更新可能已过时（9.6）',
  request_id: 'req_017',
};

const TOKEN_SAVING: TokenSaving = {
  actual_payload: 780,
  full_baseline: 1500,
  saved: 1420,
  breakdown: [
    { reason: '极简模式短查询：只回 ≤600t（2.4.1）', tokens: 600 },
    { reason: '次模式注入用 L2 占位符 ≤200t，非全文（2.4.3）', tokens: 200 },
    { reason: '命中 mem_009 衰减层=cold，仅给 L2 摘要（15.3）', tokens: 620 },
  ],
};

const WRITE_BACK: WriteBackMark = {
  memory_id: 'mem_030',
  request_id: 'req_018',
  summary: '新结论：本次会话识别的优化点（自动写入）',
};

// 回答段落：文本 + 可选内联注入标记 + 可选老化/证据警示
interface Seg {
  text: string;
  injection?: MemoryInjectionMark;
  aging?: AgingWarnMark;
}

const ANSWER_SEGS: Seg[] = [
  { text: '因为项目要求 API 响应 <200ms', injection: INJ_005 },
  {
    text: '，而你们 2025-07-05 记录过「选 FastAPI 而非 Django，性能优先」这一决策',
    injection: INJ_009,
    aging: { kind: 'aging', text: '45 天前记录，代码可能已改动，请校验（9.6 aging_hint）', request_id: 'req_017' },
  },
  { text: '。FastAPI 的异步 + Pydantic 校验正契合该约束。' },
  { text: '若当前代码已改动，建议校验最新配置', injection: INJ_021 },
  {
    text: '另：关于连接池上限，当前证据不足',
    aging: { kind: 'evidence_thin', text: '证据不足：未命中权威来源，建议切事实优先重试（2.4.3）', request_id: 'req_017' },
  },
];

export function AgentConversationDemo() {
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  // 干预反馈真写内核（ma._feedback：confirm +0.1 / reject −0.05 / disputed 挂 9.7），trust_delta 以回执为准
  async function handleFeedback(id: string, action: FeedbackAction) {
    try {
      const r = await coreInlineFeedback(id, action);
      const pct = r.trust_delta >= 0 ? `+${r.trust_delta.toFixed(2)}` : r.trust_delta.toFixed(2);
      const label =
        action === 'confirm'
          ? `已「记住」${id}（confirm ${pct} → 7.2 自生长）`
          : action === 'reject'
            ? `已「忘记」${id}（reject ${pct} → stale）`
            : `已标错 ${id}（→ 冲突裁决队列 P7，disputed）`;
      const total = await coreInlineAuditCount();
      showToast(`${label} · 写审计 4.3（累计 ${total} 条）`);
    } catch {
      showToast('反馈失败：内核暂不可达');
    }
  }
  function handleOpenAudit(req: string) {
    showToast(`开审计页定位 ${req}（审计已在内核账本 4.3）`);
  }
  function handleSwitchFactFirst(req: string) {
    showToast(`切事实优先重试（${req}）`);
  }

  return (
    <TenantProvider loginFn={DUMMY_LOGIN} onLogout={DUMMY_LOGOUT}>
    <AttributionConfigProvider>
      <div className="wrap">
        <h1>Agent 界面内联记忆标识 · 演示</h1>
        <div className="sub">
          按《需求规格书_Agent界面内联记忆标识》(19.7) 实现 · 在 Claude Code 风格窗口里直接展示「这次回答/省 token 是记忆助手的功劳」· 用户可当场干预
        </div>

        {/* 主体：对话流 + Toggle + 图例 */}
        <div className="agentframe">
          <div className="agenthead">
            <span className="logo">◆ Claude Code</span>
            <span className="who">MVP·P1 · 记忆助手 MCP 已接入</span>
            <span className="who right">project=P1 · user=U1</span>
          </div>

          {/* ⑨ 内联标识 Toggle（顶部控制） */}
          <AttributionToggle
            onChange={(lvl) =>
              showToast(
                lvl === 'full'
                  ? '内联标识：完整显示'
                  : lvl === 'token_only'
                    ? '内联标识：仅 token 节省（🧠 隐藏，⚠ 仍显示）'
                    : '内联标识：关闭（⚠ 证据/老化警示仍强制显示 · 19.7 诚实约束）',
              )
            }
          />

          {/* ③ 背景免重复标记 */}
          <BackgroundChip mark={BACKGROUND} />

          <div className="chat">
            {/* 用户 */}
            <div className="msg">
              <div className="role">你</div>
              <div className="bubble user">为什么当时选了 FastAPI 而不是 Django？</div>
            </div>

            {/* Agent 回答，内联记忆注入 + 老化/证据警示 */}
            <div className="msg">
              <div className="role">Claude Code · 基于记忆回答</div>
              <div className="bubble">
                {ANSWER_SEGS.map((seg, i) => (
                  <div className="ans" key={i}>
                    {seg.text}
                    {seg.injection && (
                      <MemoryInjectionTag mark={seg.injection} onFeedback={handleFeedback} onOpenAudit={handleOpenAudit} />
                    )}
                    {seg.aging && (
                      <AgingWarnTag
                        mark={seg.aging}
                        onFeedback={handleFeedback}
                        onSwitchFactFirst={handleSwitchFactFirst}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ② Token 节省标记 */}
            <TokenSavingBar saving={TOKEN_SAVING} />

            {/* ⑧ 每回答贡献摘要 + 💾 写入沉淀标记 */}
            <AttributionSummary injections={[INJ_005, INJ_009, INJ_021]} saving={TOKEN_SAVING} writeBack={WRITE_BACK} onOpenAudit={handleOpenAudit} />
          </div>
        </div>

        <div className="legend">
          <b>🧠 记忆注入</b>：hover/click 看 memory_id + L2 摘要 + 衰减层，可「记住/忘记/标错」（13.7 反馈）·
          <b>⚡ Token 节省</b>：本次省了多少 + 分解 · <b>📎 背景免重复</b>：新会话自动带项目背景 ·
          <b>⚠ 老化/证据</b>：命中过期（9.6 aging_hint）或证据不足（2.4.3 evidence_thin，<b>必显示不可关</b>）·
          每处可点 request_id 跳审计（4.3）。
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </AttributionConfigProvider>
    </TenantProvider>
  );
}
