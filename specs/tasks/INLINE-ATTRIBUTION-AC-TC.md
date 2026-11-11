# REQ-004 / Agent 界面内联记忆标识 — 字段级 AC / TC

> 来源：`specs/需求规格书_Agent界面内联记忆标识.md`（19.7 §2.1–2.4 / §3 / §4 / §5）、`specs/acceptance.md` AC-004、`specs/tasks/INLINE-ATTRIBUTION.md` T1–T12。
> 口径（批次 A30）：REQ-004 **作为演示页保留**——强制演示标识、**不进主导航**、生产构建可达；数据取自本机真实账本，不伪造标记。
> 本文件把字段级行为显式落成 `AC-004-xx → TC-004-xx → 测试文件:用例名`，供红测试反查代码段。
> 诚实边界：真实 `write_memory` / 召回计算 / token 统计属 REQ-007；审计页跳转由回调桩承接；真实宿主内联属集成方职责。

---

## A. 数据模型 / 契约（T1）

| AC | 判据（字段 / 类型） | TC | 测试落点 |
|---|---|---|---|
| AC-004-01 | `MemoryInjectionMark`：`memory_id / summaryL2 / decay_class / aging_hint / request_id / evidence_thin?`；`DecayClass = hot\|warm\|cold\|dormant` | TC-004-01 | 类型契约（`npm run typecheck`）+ 各标记用例按字段构造 |
| AC-004-02 | `TokenSaving`：`actual_payload / full_baseline / saved / breakdown[{reason,tokens}]` | TC-004-02 | `marks.test.tsx`「TokenSavingBar 展开分解」「off 级别不渲染」 |
| AC-004-03 | `BackgroundMark`：`count / items[{id,kind:stack\|constraint\|decision\|pitfall,text}]` | TC-004-03 | `marks.test.tsx`「BackgroundChip 展开/收起条目」 |
| AC-004-04 | `AgingWarnMark`：`kind:aging\|evidence_thin / text / request_id`；`WriteBackMark`：`memory_id / request_id / summary` | TC-004-04 | `marks.test.tsx`「aging…」「evidence_thin…」「AttributionSummary 摘要行 + 💾 点击跳审计」 |
| AC-004-05 | `AttributionConfig{show_memory_attribution, attribution_level}`；`AttributionLevel = full\|token_only\|off`；`TrustDelta`：confirm +0.1 / reject −0.05 / disputed→冲突队列 | TC-004-05 | `AttributionConfig.test.tsx` 全组 + `inlineAttribution` 反馈纯逻辑用例 |

---

## B. ① 记忆注入标记（§2.1）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-10 | 内联 `🧠` 按 `decay_class` 着色（hot/warm/cold/dormant 四色）；**仅 `full` 渲染**，`token_only`/`off` 不挂载 | TC-004-10 | `marks.test.tsx`「四档衰减着色 + 仅 full 渲染」 |
| AC-004-11 | 弹层含 `memory_id` + `summaryL2` + `decay_class` + 老化提示（有则黄字） | TC-004-11 | `marks.test.tsx`「弹层字段 + 干预回调」 |
| AC-004-12 | `request_id` 非空 → 可点跳审计（`onOpenAudit(req)`） | TC-004-12 | `marks.test.tsx`「请求有链路：request_id 可跳审计；忘记/标错各回调动作」 |
| AC-004-13 | `request_id` 空串（账本无链路）→ **不渲染假审计链接**，显示「账本无链路」 | TC-004-13 | `marks.test.tsx`「账本无链路：request_id 空串不渲染假审计链接（批次48 A14）」 |
| AC-004-14 | 三干预按钮：记住→confirm、忘记→reject、这条记错了→disputed | TC-004-14 | `marks.test.tsx`「弹层字段 + 干预回调」+「请求有链路…忘记/标错各回调动作」 |

---

## C. ② Token 节省标记（§2.2）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-20 | 展示 `saved`（节省额）；`off` 级别不渲染 | TC-004-20 | `marks.test.tsx`「TokenSavingBar 展开分解」「off 级别不渲染」 |
| AC-004-21 | 点击可展开 `breakdown` 归因分解（极简 / L2 占位符 / 超支裁剪） | TC-004-21 | `marks.test.tsx`「TokenSavingBar 展开分解」 |
| AC-004-22 | 基线计算：= 同批记忆全文 token（只算被注入的 memory_id）；无全文对照则 `saved=0`，**不虚构倍数** | TC-004-22 | `useInlineReal.test.ts`「基线 = 同批记忆全文 token」「无全文对照 → 基线 = 实际，saved 0」 |

---

## D. ③ 背景免重复标记（§2.3）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-30 | 会话头 `📎 已带项目背景 N 条`；`off` 级别不渲染 | TC-004-30 | `marks.test.tsx`「off 级别不渲染」 |
| AC-004-31 | 点击「展开/收起」条目列表；每条含 `KIND_LABEL`（技术栈/约束/决策/踩坑）+ `text` + `id` | TC-004-31 | `marks.test.tsx`「BackgroundChip 展开/收起条目（技术栈/决策 + id）」 |

---

## E. ④ 老化 / 证据警示（§2.4 · §4 诚实约束）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-40 | **恒显示**：`aging` / `evidence_thin` 不受 `attribution_level` 影响（`off` 仍渲染） | TC-004-40 | `AttributionConfig.test.tsx`「off：仅 aging/evidence_thin 恒显示」；`marks.test.tsx`「aging 在 off 仍渲染」「evidence_thin 在 off 仍渲染」 |
| AC-004-41 | `aging`：confirm（我确认仍有效 +0.1）/ reject（确实过时 −0.05） | TC-004-41 | `marks.test.tsx`「aging 在 off 仍渲染，可 confirm/reject」「aging 可「确实过时」回调 reject −0.05」 |
| AC-004-42 | `evidence_thin`：「切事实优先重试」回调 `onSwitchFactFirst(req)` | TC-004-42 | `marks.test.tsx`「evidence_thin 在 off 仍渲染，可切事实优先」 |
| AC-004-43 | 默认老化文案：`aging_hint` 非空原样、否则 cold/dormant 给 45 天校验提示 | TC-004-43 | `src/inlineAttribution/decay.ts` 纯逻辑（`agingHintText`），经 TC-004-11 弹层用例间接覆盖 |

---

## F. 配置上下文与开关降级（§4）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-50 | `isVisible` 矩阵：`full` 全 true；`token_only` 仅 injection false、其余 true；`off` 仅 aging/evidence_thin true | TC-004-50 | `AttributionConfig.test.tsx`「full：全部显示」「token_only：仅 injection 隐藏」「off：仅 aging/evidence_thin 恒显示」 |
| AC-004-51 | `show_memory_attribution=false` → 非诚实类全隐；`setLevel` 生效 | TC-004-51 | `AttributionConfig.test.tsx`「show_memory_attribution=false」「setLevel 生效」 |
| AC-004-52 | Toggle 渲染三级别且可切换 | TC-004-52 | `AttributionConfig.test.tsx`「渲染三个级别且可切换」 |

---

## G. 贡献摘要 + 💾 写入沉淀（§3）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-60 | 每回答 1 行摘要 = `来自 N 条记忆 · 省 X token · 新沉淀 1 条记忆`（无 saving/writeBack 时不计该片段） | TC-004-60 | `marks.test.tsx`「AttributionSummary 摘要行 + 💾 点击跳审计」 |
| AC-004-61 | 💾 沉淀标记可点击 → `onOpenAudit(request_id)` | TC-004-61 | `marks.test.tsx`「AttributionSummary 摘要行 + 💾 点击跳审计」 |

---

## H. 宿主集成 / 演示页 / 入口 / 登录门禁 / 浮层（T10）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-70 | 已接入 agent 名单驱动切换器（去重、按真实来源）；无 agent → 诚实空态 | TC-004-70 | `AgentConversationDemo.test.tsx`「接入页持久化的 agent 名单驱动切换器」「无任何已接入 agent → 诚实空态」 |
| AC-004-71 | 有 agent 但账本无记忆 → 统一共享账本诚实空态，不伪造 🧠 注入 | TC-004-71 | `AgentConversationDemo.test.tsx`「有 agent 但账本无记忆 → 统一共享账本诚实空态」 |
| AC-004-72 | 切换 agent：底层同一共享账本，召回池不随之变化 | TC-004-72 | `AgentConversationDemo.test.tsx`「切换 agent：底层同一共享账本，召回池不随 agent 变化」 |
| AC-004-73 | `off` 级别：降级统计行出现（诚实约束） | TC-004-73 | `AgentConversationDemo.test.tsx`「off 级别：降级统计行出现」 |
| AC-004-74 | 内核不可达 → 显示内核原因与重试，不冒充「无 agent」 | TC-004-74 | `AgentConversationDemo.test.tsx`「内核不可达 → 显示内核原因与重试」 |
| AC-004-75 | 登录门禁：未登录 / `/api/me` 失败 → 保持门禁、不回落演示身份；已登录显示真实租户标识 | TC-004-75 | `AgentConversationDemo.test.tsx` 阶段5-D 三条 |
| AC-004-76 | 演示页首屏**强制演示标识**（登录门禁之外）；`#root` 缺失显式抛错 | TC-004-76 | `a30InlineDemoBadge.test.tsx` 2 例 |
| AC-004-77 | 浮层：无桥如实报错；有桥贴 Claude 右侧；跟随开关关闭→手动；`#root` 缺失显式抛错 | TC-004-77 | `floatEntry.test.tsx` 4 例 |
| AC-004-78 | 浮层拖拽条下渲染紧凑演示标识 | TC-004-78 | `floatEntry.test.tsx`（`demo-badge` 含「演示（DEMO）」） |

---

## I. 端到端（§5 / AC-004）

| AC | 判据（字段 / 行为） | TC | 测试落点 |
|---|---|---|---|
| AC-004-80 | 无已接入 agent → 诚实空态，不渲染任何伪造标记 | TC-004-80 | `e2e/inlineAttribution.spec.ts`「无已接入 agent → 诚实空态」 |
| AC-004-81 | 已接入 agent + 空共享账本 → 切换器 + 统一账本空态 | TC-004-81 | 同上「已接入 agent + 空共享账本 → 切换器 + 统一账本空态」 |
| AC-004-82 | 标识开关（19.7）：降级文案如实，空账本不因级别变化伪造标记 | TC-004-82 | 同上「标识开关（19.7）：降级文案如实」 |
| AC-004-83 | 未登录 → 登录门禁，不渲染账本数据或身份占位 | TC-004-83 | 同上「阶段5-D：未登录 → 登录门禁」 |

---

## 复核命令

```bash
npx vitest run src/web/InlineAttribution src/inlineAttribution   # 37 例（marks 11 + config 6 + demo 9 + float 4 + badge 2 + useInlineReal 5）
npx playwright test e2e/inlineAttribution.spec.ts                # 4 例（需真 dist 产物；本机带 CODEBUDDY_SAFE_DELETE_ENABLED=0）
npm run typecheck && npm run lint                                # 静态门禁
```

> 本轮新增 TC（此前字段已实现但无对应用例）：AC-004-12/14（request_id 跳转 + 忘记/标错）、AC-004-31（背景卡展开/收起）、AC-004-41（过时 reject）、AC-004-60/61（摘要行 + 💾 跳审计）。
