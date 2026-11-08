// REQ-004 T10 宿主集成：Claude Code 风格对话演示页（exercise harness，不绑定业务页）
// 把四类标识内联进会话气泡/头部/底部，外层包 AttributionConfigProvider + 挂 AttributionToggle。
//
// ⚠ 接真口径（与记忆库管理页 / 自我净化与生长页 / 生命周期页一致）：
//   数据真相 = 内核账本（桌面 = 主进程 FileStorage 持久库；浏览器降级 = 内存态）。
//   · 已接入 agent 列表 = 接入页持久化状态（agentOnboardState）∪ 本机检测扩展卡 ∪ 账本 created_by_agent，
//     去重后呈现（useInlineReal.collectConnectedAgents）；
//   · 记忆库统一且不区分来源：各 agent 的记忆都写入同一主进程持久账本，调用记忆都从这一份账本读 ——
//     不按 created_by_agent / source_agent 过滤展示，账本里所有真实记忆对所有已接入 agent 一视同仁（统一召回池）；
//     切换 agent 只改变窗口头部标识，注入 / 背景 / token / 写入沉淀全部来自同一共享账本（不随 agent 变化）；
//   · 应用原则 = Claude Code 应用原则（§19.7 内联标识 + 2.4.1 预算 + 9.6 aging_hint + 7.2 反馈自生长）；
//   · 无 agent / 账本为空 → 诚实空态，绝不硬编码演示数据。
//   租户上下文（阶段5-D / A13·接真登录态）：只认 /api/me 返回的真实租户；
//   正在确认 → 「正在确认登录身份…」；确认后仍无真实 context → 登录门禁，不渲染账本数据、不显示身份占位。
//   本页不再跳过登录门控，也不再硬编码演示项目标识 / 假用户名之类的占位值。
//   规格 §4 降级：宿主不支持完整标记（off 级别）→ 退化为「回答前一行统计 + 可点展开」，不阻塞主输出；
//   evidence_thin / aging 诚实约束项不可关闭。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import './inlineAttribution.css';
import { TenantProvider, useTenant, useTenantRestoring } from '../Home/tenantContext.tsx';
import type { TenantContext } from '../../types/home.ts';
import { useLoginMirror } from '../Home/useLoginMirror.ts';
import { AttributionConfigProvider, useAttributionConfig } from './AttributionConfig.tsx';
import { AttributionToggle } from './AttributionToggle.tsx';
import { BackgroundChip } from './BackgroundChip.tsx';
import { MemoryInjectionTag } from './MemoryInjectionTag.tsx';
import { AgingWarnTag } from './AgingWarnTag.tsx';
import { TokenSavingBar } from './TokenSavingBar.tsx';
import { AttributionSummary } from './AttributionSummary.tsx';
import { coreInlineAuditCount, coreInlineFeedback } from './coreInline.ts';
import { loadRealInline, type ConnectedAgent, type RealInline } from './useInlineReal.ts';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import type {
  AgingWarnMark,
  FeedbackAction,
  MemoryInjectionMark,
} from '../../types/inlineAttribution.ts';

export function AgentConversationDemo() {
  return (
    <TenantWrapper>
      <InlineGate />
    </TenantWrapper>
  );
}

/** 外层：接真实登录镜像；租户身份只由 /api/me 恢复，恢复失败即未登录 */
function TenantWrapper({ children }: { children: ReactNode }) {
  const mirror = useLoginMirror();
  return <TenantProvider loginFn={mirror.login} onLogout={mirror.logout}>{children}</TenantProvider>;
}

/** 阶段5-D / A13：登录门控。未登录/身份未确认时不挂载数据层，既不读账本也不渲染身份占位。 */
function InlineGate() {
  const ctx = useTenant();
  const restoring = useTenantRestoring();
  if (restoring) {
    return (
      <div className="wrap" data-testid="inline-tenant-restoring">
        <div className="note">正在确认登录身份…（正在向后端核对真实租户，不显示任何账本数据）</div>
      </div>
    );
  }
  if (!ctx) return <InlineLoginGate />;
  return <InlineInner ctx={ctx} />;
}

/** 未登录门禁：真跳首页登录，不伪造身份、不渲染演示内容 */
function InlineLoginGate() {
  return (
    <div className="wrap" data-testid="inline-login-gate">
      <h1>◆ Agent 界面内联标识</h1>
      <div className="card">
        <b>请先登录</b>
        <div className="note">
          本页展示真实租户下的统一记忆库内联标识。未登录时不渲染账本数据，也不显示任何身份占位。
          请先在首页登录（跨页面登录态经 session 共享）后重试。
        </div>
        <button
          type="button"
          data-testid="inline-goto-login"
          onClick={() => {
            if (window.opener) window.close();
            else window.location.href = '/index.html';
          }}
          style={{ marginTop: 14, padding: '7px 14px', cursor: 'pointer' }}
        >
          → 前往登录页
        </button>
      </div>
    </div>
  );
}

/** 内层：ctx 恒为 /api/me 返回的真实租户；user 标识直接取真实 user_id */
function InlineInner({ ctx }: { ctx: TenantContext }) {
  const userId = ctx.user_id;
  const [toast, setToast] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);

  // 真实数据：内核账本（接真口径；loadRealInline 不按 agent 过滤，召回池始终是全部真实记忆，
  // 故只加载一次）。内核读不到 → 错误态显示原因 + 重试（批次25 P0-7），绝不渲染成「无已接入 agent」。
  const load = useCallback(() => loadRealInline(), []);
  const ledger = useKernelLoad<RealInline>('inline-demo', load);
  const { phase, data: real, error: loadError, retry } = ledger;

  // 读到真实 agent 列表 → 默认选中第一个
  useEffect(() => {
    if (phase !== 'ok' || !real) return;
    setAgentName((cur) => cur ?? real.agents[0]?.name ?? null);
  }, [phase, real]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  // 干预反馈真写内核（ma._feedback：confirm +0.1 / reject −0.05 / disputed 挂 9.7），trust_delta 以回执为准
  // 诚实口径：账本无该记忆 → 明确提示「账本无此记忆」，绝不伪造成功
  async function handleFeedback(id: string, action: FeedbackAction) {
    try {
      const r = await coreInlineFeedback(id, action);
      if (!r.ok) {
        showToast(r.message ?? `反馈失败：${id}`);
        return;
      }
      const pct = r.trust_delta >= 0 ? `+${r.trust_delta.toFixed(2)}` : r.trust_delta.toFixed(2);
      const label =
        action === 'confirm'
          ? `已「记住」${id}（confirm ${pct} → 7.2 自生长）`
          : action === 'reject'
            ? `已「忘记」${id}（reject ${pct} → stale）`
            : `已标错 ${id}（→ 冲突裁决队列 P7，disputed）`;
      const total = await coreInlineAuditCount();
      showToast(`${label} · 写审计 4.3（累计 ${total} 条）`);
    } catch (e) {
      showToast(`反馈失败：${kernelErrorText(e)}`);
    }
  }
  function handleOpenAudit(req: string) {
    showToast(`开审计页定位 ${req}（审计已在内核账本 4.3）`);
  }
  function handleSwitchFactFirst(req: string) {
    showToast(`切事实优先重试（${req}）`);
  }

  // 当前选中 agent 的标签（badge/label 来自真实 agent 元数据）
  const currentAgent = real?.agents.find((a) => a.name === agentName) ?? null;

  if (phase === 'loading') {
    return (
      <div className="wrap">
        <div className="note">加载真实账本中…</div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="wrap">
        <h1>◆ Agent 界面内联标识</h1>
        <KernelLoadError what="读取共享记忆库" error={loadError} onRetry={retry} />
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    );
  }

  // 诚实空态：无任何已接入 agent（接入页从未接入 + 账本无 created_by_agent）
  if (!real || (real.agents.length === 0)) {
    return (
      <div className="wrap">
        <h1>◆ Agent 界面内联标识</h1>
        <div className="card" data-testid="inline-empty">
          <b>当前无任何已接入 agent。</b>
          <div className="note">
            请先在「Agent 接入配置页」完成一键接入（或本机检测到已安装 agent），
            本页将自动列出所有已接入 agent 并展示其统一记忆库的内联标识。
            空账本不伪造数据。
          </div>
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    );
  }

  return (
    <AttributionConfigProvider>
      <InlineInnerBody
        real={real}
        agentName={agentName}
        onAgentChange={setAgentName}
        currentAgent={currentAgent}
        userId={userId}
        ctx={ctx}
        showToast={showToast}
        handleFeedback={handleFeedback}
        handleOpenAudit={handleOpenAudit}
        handleSwitchFactFirst={handleSwitchFactFirst}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </AttributionConfigProvider>
  );
}

/** 实际渲染体：在 AttributionConfigProvider 内部，可安全调用 useAttributionConfig。
 *  所有标记数据来自 real（真实账本）；无数据时诚实空态。 */
function InlineInnerBody({
  real, agentName, onAgentChange, currentAgent,
  userId, ctx, showToast, handleFeedback, handleOpenAudit, handleSwitchFactFirst,
}: {
  real: RealInline;
  agentName: string | null;
  onAgentChange: (n: string | null) => void;
  currentAgent: ConnectedAgent | null;
  userId: string;
  ctx: TenantContext;
  showToast: (msg: string) => void;
  handleFeedback: (id: string, action: FeedbackAction) => void;
  handleOpenAudit: (req: string) => void;
  handleSwitchFactFirst: (req: string) => void;
}) {
  const { level, setLevel } = useAttributionConfig();
  const injections = real.injections; // 当前 agent 真实注入标记（无则空数组）
  const hasData = injections.length > 0;

  // 回答段落：真实数据驱动（按当前 agent 注入标记生成；无数据 → 诚实空态提示）
  const segs: Array<{ text: string; injection?: MemoryInjectionMark; aging?: AgingWarnMark }> = useMemo(() => {
    if (injections.length === 0) return [];
    return injections.map((inj, i) => {
      const aging = real.agingWarns[i];
      return {
        text: `基于记忆 ${inj.memory_id}（${inj.decay_class} 层）：`,
        injection: inj,
        aging,
      };
    });
  }, [injections, real.agingWarns]);

  return (
    <div className="wrap">
      <div className="agentframe">
        {/* Agent 窗口头部：当前选中 agent（接真：所有已接入 agent 可切换，记忆库统一） */}
        <div className="agenthead">
          <span className="logo">◆ {currentAgent?.name ?? 'Agent'}</span>
          <span className="who">{currentAgent?.label ?? '扩展'} · 记忆助手 MCP 已接入</span>
          {/* 阶段5-D：只显示 /api/me 返回的真实租户标识，不再硬编码演示项目 P1 / 假 user */}
          <span className="who right" data-testid="inline-tenant">
            user={userId}{' · '}{ctx.enterprise_id}/{ctx.team_id}
          </span>
        </div>

        {/* 已接入 agent 切换器（统一记忆库·不区分来源：底层同一共享账本，所有已接入 agent 一视同仁，
            切换 agent 只改变窗口头部标识，召回池始终是全部真实记忆） */}
        <div
          data-testid="agent-switcher"
          style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0', flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}
        >
          <b style={{ fontSize: 12 }}>已接入 Agent（{real.agents.length}）· 统一记忆库·不区分来源：</b>
          <select
            data-testid="agent-select"
            value={agentName ?? ''}
            onChange={(e) => onAgentChange(e.target.value || null)}
            style={{
              padding: '4px 8px', background: 'var(--panel2)', border: '1px solid var(--line)',
              borderRadius: 6, color: 'var(--txt)', fontSize: 12, minWidth: 160,
            }}
          >
            {real.agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}（{a.label}）
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11 }}>
            共享账本 {real.memCount} 条 · 所有已接入 agent 共用同一召回池（19.4 跨 Agent 共享·不区分来源）
          </span>
        </div>

        {/* ⑨ 内联标识开关（嵌入窗口内，19.7 可开关；关闭 = 降级为统计行，非移除） */}
        <AttributionToggle
          onChange={(lvl) =>
            showToast(
              lvl === 'full'
                ? '内联标识：完整显示'
                : lvl === 'token_only'
                  ? '内联标识：仅 token 节省（🧠 隐藏，⚠ 仍显示）'
                  : '内联标识：降级为统计行（⚠ 证据/老化警示仍强制显示 · 19.7 诚实约束）',
            )
          }
        />

        {/* ③ 背景免重复标记（会话头部，真实账本最近 8 条该 agent 记忆） */}
        <BackgroundChip mark={real.background} />

        {/* ①④ 回答流：内联记忆注入 + 老化/证据警示（⚠ 恒显示） */}
        <div className="chat">
          {hasData ? (
            <>
              <div className="msg">
                <div className="role">你 · 示例提问（演示）</div>
                <div className="bubble user">为什么当时选了 FastAPI 而不是 Django？</div>
              </div>

              {/* Agent 回答（主输出不被阻塞；注入标记来自真实账本） */}
              <div className="msg">
                <div className="role">{currentAgent?.name ?? 'Agent'} · 基于记忆回答（真实账本）</div>
                <div className="bubble">
                  {segs.map((seg, i) => (
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

              {/* ② Token 节省 + ⑧ 贡献摘要/写入沉淀：完整显示；off 级别退化为 1 行统计（§4 降级） */}
              <TokenSavingBar saving={real.tokenSaving} />
              <AttributionSummary injections={injections} saving={real.tokenSaving} writeBack={real.writeBack} onOpenAudit={handleOpenAudit} />
              {level === 'off' && (
                <button
                  type="button"
                  className="degrade-line"
                  onClick={() => setLevel('full')}
                  title="完整标识已关闭（19.7 降级）· 点此恢复"
                >
                  本次回答由记忆助手支撑：{injections.length} 条注入 · 省 {real.tokenSaving.saved} token · {real.writeBack ? 1 : 0} 条自动写入（点击恢复完整标识 ▸）
                </button>
              )}
            </>
          ) : (
            // 诚实空态：统一共享账本中无任何可读记忆（不区分来源 agent）
            <div className="card" data-testid="inline-shared-empty" style={{ margin: '10px 0' }}>
              <b>统一记忆库中暂无可读记忆（所有已接入 agent 共享）。</b>
              <div className="note">
                所有已接入 agent 的记忆都写入同一持久账本（19.4 跨 Agent 共享·不区分来源），
                调用记忆都从这一份账本读。请通过 MCP write_memory 工具或写入页写入记忆后，
                此处将自动展示真实注入标识。空账本不伪造数据。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
