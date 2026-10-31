# 手动测试报告 · 修复批次 25（假展示与静默丢失收口）

- 日期：2026-10-31（本机时间 UTC+08:00；最终打包完成 **16:05**）
- 分支：main（未提交，等你验收后再决定是否提交）
- 正式安装包（本次产物）：`release/installer/MultiAgent Memory-0.1.0-setup.exe`
  - 体积：121,982,924 B = **116.33 MiB**
  - SHA256：`0c90e11ef27561942d05f5a653e8ebf06c54715d9b0d17957ce8e7faa360898c`
- 未打包目录（本次产物）：`release/installer/win-unpacked/MultiAgent Memory.exe`（249,934,848 B = 238.36 MiB）
- `release/` 现在**只有 `installer/` 一份产物**（批次19 规则：打包前强杀 `release/` 下旧实例，构建后删旧包）
- 关联文档：`specs/AUDIT-FULL-REVIEW-2026-10-31.md` §1（P0-1/2/3/6/7）与 §6（批次25）、`specs/code-map.md` 批次25、`AGENTS.md` §9 批次25

> **输出目录说明**：打包前 `release/installer` 被外部进程持有句柄（日志 `[package] release/installer 被外部进程占用（EPERM）`），本次先输出到 `release\installer-20261031-080529`，构建成功后按批次21 兜底（rename 仍 EPERM → 复制+删除）收口回 `release/installer`，并删除上一轮旧包。

---

## 0. 起因与结论

全量审核报告（`specs/AUDIT-FULL-REVIEW-2026-10-31.md`）§1 的 P0 里，有**五条「用户会据此做出错误判断 / 数据会静默丢失」的假展示**。按报告 §6 的批次 25 一次性收口：

| # | 结论 / 根因 | 处理 | 结果 |
| --- | --- | --- | --- |
| P0-1 | 层级管理页「保存」只 `dispatchEvent('layered-memory-save')`，全仓**只有 dispatch 自己这一处命中**、无人监听；`save()` 无 await、无失败分支，而文案承诺「改后写回真实账本 + 审计」→ 点保存按钮闪一下，账本零变化 | `MemoryLayeredPage.tsx` 的 `onSave` 改走 `coreUpdateContent`（与记忆库管理页同一条真实路径：过 L0→L1 质量门 → version+1 → `memory_op` 审计），失败显示内核原因 | 已落地 + 单测「点保存 → 内核收到 content 且 version+1」 |
| P0-2 | 日志页「审计全链路」弹窗不接收任何数据、不 fetch，却标注「（真实审计记录）」→ 排障主入口给假审计链 | `LogCards.tsx` `AuditModal` 打开即按 `request_id` 真查内核账本（`queryAudit`），逐行渲染；零行时显示「该 request_id 查无审计行」 | 已落地 + 单测（有行渲染、无行如实、请求失败报错） |
| P0-3 | 写页「五维查重」是同一个 Jaccard 的五次仿射变换（含未接大模型却展示的 `llm_judge`），「综合分」是假的 | `write/logic.ts` `scoreDedup` 收缩为**单值本地词面相似度** + 内核阈值对照；`DedupCard.tsx` 删掉五条假刻度与 `llm_judge` 标签，注明「预览非判定，真判定由内核写时执行」 | 已落地 + 单测 + 规格文档同步 |
| P0-7 | 内核不可达时 `.catch(() => setMemories([]))` → 把本机真账本渲染成「记忆账本还是空的」，无错误态、无重试 | 新增共享件 `src/web/shared/kernelLoad.tsx`（`useKernelLoad` 三态 + `KernelLoadError` 错误卡 + `ui:kernel_load_error` 日志 + 「重试」）；6 处同形页统一接入（记忆库/参数/监控/裁决/InlineAttribution/首页四卡） | 已落地 + 共享件单测 + 各页错误态测试 |
| P0-6 | FileStorage 写盘失败时「内存已改、磁盘未改」：`commitBatch` 先清 `batching` 再 persist，persist 抛错后 `close()` 因 `!batching` 直接 return → 整批静默丢失 | `commitBatch` 只在 persist **成功**后才清 `batching/dirty`，失败原样上抛并保留批次；`close()` 失败让调用方可见，障碍解除后重试才真正落盘；`putMemory/appendAudit/deleteMemory` 写盘失败撤销内存改动（不留半态） | 已落地 + 单测（commitBatch 失败重试、close 重试、put/append/delete 撤销） |

**一句话结论**：五条全部「假展示 / 静默丢失」都已收口——假保存改真写、假审计链改真查、假五维改单值词面、空账本改三态错误卡、丢批改显式失败且可重试；改动面小、均有单测覆盖，P0-4/P0-5/P0-8/P0-9 留待批次 26/27（见 §5）。

---

## 1. 改动详解

### 1.1 层级管理页保存真正写回账本（P0-1）

`src/web/memory/MemoryLayeredPage.tsx`

- 删除无人监听的 `layered-memory-save` 事件（`:437`）与「假保存」`save()`（只 `setSaving(true)` 无 await/失败分支）。
- `onSave`（`:508`）改调 `coreUpdateContent(next.id, next.content)`——与记忆库管理页同一路径：L0→L1 质量门 → `content` 与 `content_l1` 同步 → `sha256` 重算 → `version+1` → `memory_op` 审计（`coreMemoryOps.ts`）。
- 保存失败把内核真实原因显示给用户（不再「按钮闪一下就回弹」）；文案「改后写回真实账本 + 审计」现在名实相符。
- 测试：`src/web/memory/__tests__/MemoryLayeredPage.test.tsx` 新增「点保存 → 内核收到 content 且 version+1」「保存失败显示内核原因」。

### 1.2 日志页审计全链路真查 request_id（P0-2）

`src/web/logs/LogCards.tsx`

- `AuditModal` 现在接收 `requestId` 并在打开时真查内核账本（`queryAudit({ request_id })`），逐行渲染时间/端/动作/消息/request_id。
- 零行时如实显示「本机账本中该 request_id 查无审计行」（不再印「（真实审计记录）」）。
- 查询失败时显示内核原因，不伪造空表。
- 测试：`src/web/logs/__tests__/LogCards.test.tsx` 覆盖「有审计行逐行渲染 / 无行如实 / 查询失败报错 / 打开即触发查询」。

### 1.3 写页查重指标诚实化（P0-3）

- `src/web/write/logic.ts`：删除五维仿射变换（`semantic/keyword/entity/structure/llm_judge` 五条假刻度），`scoreDedup` 只返回**一个真实可算的数**——本地词面相似度（Jaccard 分词重合度）+ 该层阈值对照。
- `src/web/write/DedupCard.tsx`：改为单条「词面相似度 x / 阈值 y（层）」进度条 + 判定「预览提示可能重复 / 预览未见重复」；卡片注明「本卡只是输入过程中的词面预览，不是入库判定：真正是否重复由内核在点『写入』时按四维对照同一阈值判定，未接入大模型时只查 L1」。
- `WritePage.tsx`：查重候选改为共享件 `useKernelLoad`（见 1.4），写入成功后 `replace()` 热刷新候选列表（保留旧列表直到新数据到达，不闪屏）。
- 规格同步：`specs/需求规格书_其余页面字段级交互规格.md` 与 `specs/需求规格书_UI页面设计.md` 的「五维查重」小节改为「查重预览（本地词面，非判定）」；`specs/tasks/WRITE-PAGE.md` 追加批次25 P0-3 修订说明。
- 测试：`src/web/write/__tests__/WritePage.test.tsx` 新增「内核不可达 → 查重候选如实报错、错误态不画查重卡」；`logic.test.ts` 同步单值口径。

### 1.4 内核不可达不再冒充空账本（P0-7 + 同形页）

新增共享件 `src/web/shared/kernelLoad.tsx`（19 页统一，不逐页各写一份）：

- `useKernelLoad<T>(label, load)` → `{ phase:'loading'|'ok'|'error', data, error, retry, replace }`；`retry` 重跑同一 `load`，`replace(next)` 只在 `phase==='ok'` 时生效。
- `KernelLoadError({ what, error, onRetry })`：渲染 `[data-testid=kernel-error]` / `kernel-error-title` / `kernel-error-reason` / `kernel-retry`（「重试」按钮），并记一条 `ui:kernel_load_error` 动作日志。
- `kernelErrorText(e)`：把内核异常归一到可展示文案（`E_IPC_TIMEOUT` 等原始码保留，便于对照 `actions.log`）。

接入点（全部去掉「catch 后 set 空数组」的旧路径）：

- `src/web/memory/MemoryPage.tsx`：三态 + 错误卡，不再显示「记忆账本还是空的」。
- `src/web/Params/ParamsPage.tsx`、`src/web/monitor/MonitorPage.tsx`、`src/web/dispute/DisputePage.tsx`：同形三态 + 错误卡。
- `src/web/InlineAttribution/AgentConversationDemo.tsx`：同形三态 + 错误卡（保留「诚实空态」与错误态分开）。
- `src/web/Home/coreHome.ts` + `Dashboard.tsx` + `HomePage.tsx`：内核读取失败时四卡/关系图谱上方显示红色横幅「内核账本没读到（不是『账本为空』）：<原因> —— 四卡 / 关系图谱暂为空，点『刷新图谱』重试」（`storageError` 透传），不再把失败当成空账本。

测试：`src/web/shared/__tests__/kernelLoad.test.tsx`（三态迁移、重试、错误文案、`replace` 语义、`ui:kernel_load_error` 日志）；各页错误态用例同步。

### 1.5 FileStorage 写盘失败不再静默丢批（P0-6）

`src/core/memagent/fileStorage.ts`

- `commitBatch()`：改为**先 persist、成功后**才清 `batching/dirty`；persist 抛错时原样上抛并**保留批次**（`batching/dirty` 不动），下次 `commitBatch`/`close()` 会再次尝试落盘。
- `close()`：批量未提交时照旧先 `commitBatch()`，失败原样上抛让调用方可见（退出前不把整批丢掉）。
- `putMemory/appendAudit/deleteMemory`：写盘失败时**撤销内存改动**（对 doc 做浅拷贝回滚），不留「内存新、磁盘旧」的半态；批量模式下只标脏、延迟到 `commitBatch` 集中暴露。
- 测试：`src/core/memagent/__tests__/fileStorage.test.ts` 新增一组「写盘失败不静默丢批」用例（commitBatch 失败保留批次并重试、close 失败重试、put/append/delete 写盘失败撤销）。

### 1.6 附带：一条测试稳定性修复

`src/core/memagent/__tests__/sessionCollector.test.ts`：`createReconciler` 的「注入 fake timer：到周期才自动跑」原本靠两个 50ms `setTimeout` 等异步文件扫描，全量并行负载下偶发「expected 1 to be 2」（本段 `npm run verify` 首跑即触发）。改为 `await r.runOnce()`（reconciler 的 `runOnce` 返回在途扫描 Promise），确定性等待，消除竞态。

---

## 2. 变更清单（批次25）

**新增 — 渲染共用**：`src/web/shared/kernelLoad.tsx`
**新增 — 测试**：`src/web/shared/__tests__/kernelLoad.test.tsx`

**修改 — 内核**：`src/core/memagent/fileStorage.ts`、`src/core/memagent/__tests__/fileStorage.test.ts`、`src/core/memagent/__tests__/sessionCollector.test.ts`
**修改 — 记忆页**：`src/web/memory/MemoryLayeredPage.tsx`、`MemoryPage.tsx`、`__tests__/MemoryLayeredPage.test.tsx`（`MemoryPage.test.tsx` 若存在同步）
**修改 — 日志页**：`src/web/logs/LogCards.tsx`、`__tests__/LogCards.test.tsx`
**修改 — 写页**：`src/web/write/logic.ts`、`DedupCard.tsx`、`WritePage.tsx`、`__tests__/WritePage.test.tsx`、`logic.test.ts`
**修改 — 同形页**：`src/web/Params/ParamsPage.tsx`、`src/web/monitor/MonitorPage.tsx`、`src/web/dispute/DisputePage.tsx`、`src/web/InlineAttribution/AgentConversationDemo.tsx`、`src/web/Home/coreHome.ts`、`Dashboard.tsx`、`HomePage.tsx`
**修改 — 文档**：`AGENTS.md`（§9 日志窗口口径修正 + 新增批次25 收口条目）、`specs/code-map.md`（日志口径 + 计数 + 批次25 段）、`specs/需求规格书_其余页面字段级交互规格.md`、`specs/需求规格书_UI页面设计.md`、`specs/tasks/WRITE-PAGE.md`、`README.md`、`specs/test-plan.md`、`specs/MANUAL-TEST.md`（计数 117/1248）

**未做（留待后续批次，见 §5）**：P0-4（Webhook 8203 无鉴权 + GET 回吐正文）、P0-5（接入服务 8200 写端点零会话校验 + rotate-key 明文回密钥）、P0-8（批次 6–24 提交到版本控制，需你授权）、P0-9（CI 首推即红两道门禁）以及 P1/P2/P3 全表。

---

## 3. 自动化门禁结果（本机实跑，2026-10-31 15:40–16:05 UTC+08:00）

| 命令 | 结果 |
| --- | --- |
| `npm run code:index -- --write` | 已写入 `specs/code-index.generated.md`（276 个文件） |
| `npm run typecheck` | 通过（渲染 + Electron 双配置 0 错误） |
| `npm run lint`（oxlint） | 通过（0 error，`verify:fast` 内含） |
| `npm run code:index:check` | 通过（索引不过期） |
| `npm test` / `npm run test:coverage` | **117 文件 / 1248 用例全过**；覆盖率 语句 79.02%、分支 71.38%、函数 74.97%、行 82.02%，均高于阈值（71/61/67/74） |
| `npm run build:electron` | 通过（main.cjs / preload.cjs） |
| `npm run test:e2e` | **21 个 spec / 94 用例全过**（31.5s，真构建产物 + 真后端） |
| `npm run verify` | 全绿（退出码 0） |
| `npm run package` | 成功，`release/` 只剩最新 `installer/`（NSIS + win-unpacked 见文首 SHA256） |

批次25 新增/改写的测试覆盖点：

- `kernelLoad.test.tsx`（三态迁移 / 重试重跑 load / 错误文案归一 / `replace` 只在 ok 生效 / `ui:kernel_load_error` 日志）；
- `fileStorage.test.ts`（写盘失败不静默丢批：commitBatch 失败保留批次重试、close 失败重试、put/append/delete 写盘失败撤销内存改动、不留半态）；
- `MemoryLayeredPage.test.tsx`（点保存 → 内核收到 content 且 version+1、保存失败显示内核原因）；
- `LogCards.test.tsx`（审计 modal 真查：有行渲染 / 无行如实 / 查询失败报错）；
- `WritePage.test.tsx` + `logic.test.ts`（单值词面口径、内核不可达时查重候选如实报错且不画查重卡）。

> 注：首轮 `npm run verify` 因 §1.6 的 `sessionCollector` 计时测试竞态红了一次，已确定性修复并复跑全绿。

---

## 4. 手动测试步骤（待你执行）

时间一律按本机 UTC+08:00 阅读；动作日志位置 = 设置页「数据目录」卡片显示路径下的 `actions.log`。

### A. 安装与冒烟

1. 装 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（或直接用 `release/installer/win-unpacked/MultiAgent Memory.exe`）。
2. 登录（管理员 `admin`），首页正常出图即通过。

### B. P0-1 —— 层级管理页保存真写回账本

1. 打开「记忆层级管理页」→ 选一条记忆 → 改正文 → 点「保存」。
2. 保存后**内容不反弹**，出现成功回执；回到记忆库管理页看该条：正文已是新值。
3. 审计页可查到 `memory_op` 审计（含该记忆 id），`request_id` 可回查。
4. 故意把正文改成会被 L0→L1 质量门拦下的噪声（如纯寒暄）→ 保存应显示内核拒绝原因（不是假成功）。

### C. P0-2 —— 日志页审计全链路真查

1. 日志记录页任一行 `request_id` → 点「查阅审计」。
2. 弹窗应**逐行列出**该 `request_id` 的真实审计行（时间/端/动作/消息/request_id），不是一行占位。
3. 选一个账本里确实没有审计行的 `request_id`（或构造一次纯 UI 点击的 `ui:*` 日志）→ 弹窗如实显示「该 request_id 查无审计行」。

### D. P0-3 —— 写页查重指标诚实化

1. 写页输入一段与已有记忆高度重叠的文本 → 查重卡只显示**一条**「词面相似度 x / 阈值 y（L1）」进度条 + 「预览提示可能重复」，不再出现 semantic/keyword/entity/structure/llm_judge 五条刻度。
2. 输入全新文本 → 「预览未见重复」；空内容不显示查重卡。
3. 点「写入」→ 真正判重由内核执行（重复则返回 `duplicate`，与预览一致）。

### E. P0-7 —— 内核不可达不再冒充空账本

1. 正常登录后记忆库页/参数页/监控页/裁决页/InlineAttribution 页都正常显示真实数据（无错误卡）。
2. 模拟内核不可达：临时把数据根指向一个被占用的/只读的位置（或在写入页配合 hostBridge 超时场景），刷新上述页面 → 应出现**红色错误卡**「读取 <什么> 失败：<内核原因>」+「重试」按钮，**绝不**显示「账本还是空的」。
3. 恢复内核 → 点「重试」→ 数据正常回来。
4. 首页四卡/关系图谱：内核读不到时显示顶部红色横幅「内核账本没读到（不是『账本为空』）：<原因>…点『刷新图谱』重试」，不再显示成空账本。
5. `actions.log` 应出现 `ui:kernel_load_error` 行。

### F. P0-6 —— FileStorage 写盘失败不再静默丢批

> 此条属内核正确性，日常 UI 难触发（需磁盘满 / 目录被锁）。可用单测验证：`npm test -- fileStorage.test.ts` 里「写盘失败不静默丢批」一组用例。真机验收可跳过后依赖测试 + 代码审查。

1. 单测确认 `commitBatch 写盘失败 → 批次保留，障碍解除后再次提交/close 才真正落盘`、`put/append/delete 写盘失败撤销内存改动`、`close() 失败让调用方可见` 全部通过。
2. （可选真机）把数据目录下的 `memories.db.json` 替换成同名的**只读**文件/目录，触发一次写入 → 应报内核写盘错误且不丢已提交数据，`actions.log` 有 `storage:close-commit` 失败痕迹。

---

## 5. 已知限制 / 未完成项

1. **P0-4 / P0-5 未做**（本机信任边界，属批次 26）：Webhook 8203 仍允许本机任意进程无鉴权写入且 GET 端点回吐精炼正文；接入服务 8200 写端点仍无会话/角色校验且 `rotate-key` 明文回密钥。这批需要令牌/会话设计，不在「假展示与静默丢失」范围。
2. **P0-8 未提交**：批次 6–24 的约 465 项改动仍未进版本控制（`git log -1` 仍停在 10-10 的 `e3bbf3d`）。按你的硬约束「未获明确授权不得 commit/push」，本轮仍只打包、不提交，等你验收后决定是否分三段提交。
3. **P0-9 未做**（CI 门禁可信度，属批次 27）：`validate_project.py` 的 TC-013 与 `generate.py --check` 仍红，CI 首推即红；本地 `verify` 全绿不覆盖 CI 那两道门禁。
4. P1/P2/P3 全表留待批次 26/27（报告 §6 已列清单）。
5. 安装包未代码签名（未配置证书），Windows SmartScreen 可能告警。
6. `sync()` 仍显式 `E_NOT_IMPLEMENTED`。
7. P0-7 的错误态覆盖 6 处同形页；其余 13 个入口若也存在「catch 后置空」的旧路径，将随批次 27 的卫生项一并排查（本轮已覆盖报告点名的全部位置）。

---

## 6. 结论

批次 25 的「假展示与静默丢失」五条（P0-1/2/3/6/7）全部收口：层级页假保存改真写、日志页假审计链改真查、写页假五维改单值词面、内核不可达不再冒充空账本（做成 19 页共享的三态件）、FileStorage 写盘失败不再静默丢批（显式失败 + 保留批次可重试）。全部门禁本机实跑通过（单测 117 文件 / 1248 用例、覆盖率过阈、Electron 构建、94 项 E2E），安装包已重新构建且 `release/` 只留最新一份；P0-4/5/8/9 按计划留待批次 26/27。
