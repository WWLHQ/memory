# REQ-006 / P2 写入页 — 任务拆分（原子任务 · 供 Agent 执行）

> 来源：`specs/需求规格书_其余页面字段级交互规格.md` §P2 写入页（13.6 / 6.1 / 17.6）。
> REQ-006 是 9 子页大伞；本文件只做 **P2 写入页**（用户指定继 P8 之后的下一个子页）。
> 实现基线：**沿用本项目已验证的「原型驱动 + 逻辑层纯函数单测 + 后端 mirror 注入点」模式**。
> 无现成 P2 原型 HTML，UI 依规格 §P2 自设计，复用暗色设计系统。
> 数据来源：本地草稿 + 内存态为真相；后端 mirror 可选 fire-and-forget，无端点时 safe-noop。
>
> ⚠ 同工作区 P8 记忆管理页（REQ-006/P8）已构建待人工验收、尚未提交；本 P2 同样按流程开发，
> 与 P8 同处未提交状态，待验收通过后统一按 ⑥ 提交。

---

## 边界总览（全任务共享）
- 新增：`write.html`（Vite 入口）、`src/web/write/**`、`specs/tasks/WRITE-PAGE.md`
- 修改：`vite.config.ts`（加 `write` entry）、`src/web/overview/Overview.tsx`（导航加写入页 + 计数）
- 不动：已有 `AgentOnboard/`、`Home/`、`InlineAttribution/`、`memory/` 自身、overview 渲染逻辑（仅加一项导航）

---

## T1 脚手架与导航接入
- 目标：建立写入页空壳并能被 Overview 导航到达
- 输入：`vite.config.ts` entry、`Overview.tsx` 的 `VIEWS`/`PLANNED`、`agentOnboardEntry.tsx` 样板
- 输出：`write.html`、`src/web/write/writeEntry.tsx`、`src/web/write/WritePage.tsx`（空壳）、`src/web/write/theme.css`（复用设计系统）、`vite.config.ts` 加 `write: 'write.html'`、`Overview.tsx` VIEWS 加 `{ id:'write', ic:'✍️', lbl:'写入页', desc:'P2 · 写入+六维查重', src:'/write.html', req:'REQ-006' }` + 计数 +1
- 验收：`npm run build` 含 write 产物；vitest 挂载测试渲染标题；Overview 含 write 项
- 边界：仅 `write.html` / `src/web/write/`(空壳+theme) / `vite.config.ts` / `Overview.tsx`
- 依赖：无前置；被 T2~T5 依赖
- 提交：`feat(REQ-006/P2-T1): 写入页脚手架与导航接入`

## T2 数据模型 + 种子 + 纯逻辑层（核心，纯函数 + 单测）
- 目标：定义写入草稿/类别/来源类型、种子标签、并把可算规则抽成纯函数单测覆盖
- 输入：§P2 表单字段（content/category/tags/source/session_id/project_id）；§6.1 五维查重（semantic35%/keyword20%/entity15%/structure10%/llm_judge20%）；§6.1 阈值表（L1 0.7…L6 0.9）；§13.6 is_duplicate；§2.2 ≥500 字精炼提示；§17.6 六类知识库
- 输出：
  - `src/web/write/types.ts`：`MemoryCategory`(decision/pitfall/preference/fact/project/feedback)、`SourceKind`(conversation/api/mcp)、`MemoryDraft`、`DedupResult`、`WriteReceipt`、`Layer`
  - `src/web/write/seed.ts`：`SEED_TAGS`（联想候选）、`CATEGORY_PREVIEW`（六类 → 默认半衰期/归档/合并策略预览）、`LAYER_THRESHOLDS`（L1..L6 阈值）
  - `src/web/write/logic.ts` + `logic.test.ts`：
    - `estimateTokens(text)`（中文字≈2 token/字，英文≈1.3 token/词；仅估算展示）
    - `needsRefine(content)` → content.trim().length ≥ 500 返回 true（触发「将精炼为 L1–L6」）
    - `validateDraft(d)` → { ok, errors }（content 非空、project_id 必填且非手填注入、category/source 枚举）
    - `scoreDedup(content, existing)` → 五维分值 + composite（加权和）+ is_duplicate（composite ≥ 对应层阈值）
    - `thresholdForLayer(layer)` → 0.7..0.9
    - `composeReceipt(d, dedup)` → { memory_id, layers{L1..L6}（L1 仅审计展开标记）, dedup_action }
- 验收：`npm test -- write/logic` 全绿（覆盖五维加权/阈值/校验/精炼提示/回执）
- 边界：仅 `src/web/write/{types,seed,logic}.ts`(+test)
- 依赖：T1
- 提交：`feat(REQ-006/P2-T2): 写入页数据模型 + 种子 + 纯逻辑层`

## T3 表单组件（字段 + 校验 + 实时反馈）
- 目标：实现 §P2 表单字段与校验、实时 token/精炼提示、project_id 只读必填（R2）、session_id 继承可清空
- 输入：T2 的 `validateDraft`/`estimateTokens`/`needsRefine`/`CATEGORY_PREVIEW`/`SEED_TAGS`
- 输出：`src/web/write/WriteForm.tsx` + 组件测试
  - content 多行（实时 token 显示 + ≥500 字提示「将精炼为 L1–L6（2.2）」）
  - category 下拉（六类）→ 选中带出默认半衰期/归档/合并策略预览
  - tags 标签输入（逗号/空格分隔 + 联想 SEED_TAGS）
  - source 下拉（conversation/api/mcp）
  - session_id 文本（默认全局继承，可清空）
  - project_id 只读 + 全局注入（R2：禁手填/禁空，缺失则禁提交）
  - 空 content / 缺 project_id → 提交按钮 disabled
- 验收：组件测试覆盖 空禁提交 / ≥500 字提示 / project_id 缺失禁提交 / category 预览联动
- 边界：仅 `src/web/write/WriteForm.tsx`(+test)
- 依赖：T2
- 提交：`feat(REQ-006/P2-T3): 写入页表单（字段 + 校验 + 实时反馈）`

## T4 查重反馈组件（6.1 五维 + 三模式动作）
- 目标：实现 §P2 查重反馈卡（五维进度条 + 综合分 vs 阈值 + is_duplicate + 合并/覆盖/保留三模式）
- 输入：T2 的 `scoreDedup`/`thresholdForLayer`；§9.7 三模式（合并/覆盖/保留）；§16.2 覆盖写 old_id/new_id 审计
- 输出：`src/web/write/DedupCard.tsx` + 组件测试
  - 五条进度条（semantic35%/keyword20%/entity15%/structure10%/llm_judge20%）
  - 综合分 vs 该层阈值（L1 0.7…L6 0.9），is_duplicate 触发查重卡
  - 命中既有记忆链接（跳 P8 记忆管理页，占位 `#`/导航）
  - 动作：合并到既有 / 覆盖旧值（写 old_id/new_id 审计占位）/ 保留两条
- 验收：组件测试覆盖 五维渲染 / composite ≥ 阈值→is_duplicate / 三模式按钮触发对应回调
- 边界：仅 `src/web/write/DedupCard.tsx`(+test)
- 依赖：T2、T3
- 提交：`feat(REQ-006/P2-T4): 写入页查重反馈（六维五维 + 三模式动作）`

## T5 写入回执 + mirror 注入 + 组合 E2E（自包含 harness）
- 目标：写入回执（memory_id + L1–L6 折叠，L1 仅审计展开）+ 后端 mirror 注入点 + 自包含 E2E
- 输入：T2 的 `composeReceipt`；`useBackendMirror` 同款 resolveBackendUrl 模式
- 输出：
  - `src/web/write/useWriteMirror.ts`：resolveBackendUrl 同款（?backend= 覆盖），本地为真相，mirror safe-noop
  - `WritePage.tsx` 编排：表单(T3) + 查重卡(T4) + 回执（memory_id 跳详情占位 + layers L1..L6 折叠，L1 标注「仅审计展开」）+ toast
  - `e2e/write.spec.ts`：仿 `e2e/memory.spec.ts` 自包含（静态服务 + 独立端口，无后端），断言核心链路：表单空禁提交 → 填内容 → 提交 → 回执 memory_id
- 验收：`npm run test:e2e --workers=1` 该 spec 绿；`npm run verify` 全绿
- 边界：仅 `src/web/write/{WritePage,useWriteMirror}.ts(x)` + `e2e/write.spec.ts`
- 依赖：T1~T4
- 提交：`feat(REQ-006/P2-T5): 写入页回执 + mirror 注入 + 自包含 E2E`

---

## 拆分说明（范围边界）
- 本拆分**只做 P2**，不做 P4/P5/P6/P7/P8(已完成待验)/P9/P11/P12（仍属 REQ-006 规划中）。
- 后端接入：home server 暂无 write/memory 端点，mirror 为 safe-noop（本地内存态即真相），不在本 REQ 新建后端。
- 审计：覆盖/合并动作产生审计占位（old_id/new_id），但审计落库/审计页属 P11，本页只产动作、不落地。
- 命中既有记忆「跳 P8」为占位导航（P8 已建，可真实跳转 /memory.html）。
