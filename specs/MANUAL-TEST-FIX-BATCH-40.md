# 批次40 手动测试报告 · 短料在 L0→L1 就拦下 + L2–L6 精炼逻辑重新梳理

日期（UTC+08:00）：2026-11-03
分支：`main`，HEAD 仍是 `3a4080a`（**批次35、36、37、38、39、40 的改动全部未提交**；`git commit`/`git push` 需用户明确授权，本批未提交）
上一批次：批次39（`specs/MANUAL-TEST-FIX-BATCH-39.md`）
起因（用户原话）：「**在L0清洗脱敏生成L1的时候就要把字数少的过滤掉，不是等到精炼才过滤**」+「**L2-L6精炼逻辑重新在梳理下**」

---

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,042,433 字节 = **116.39 MB** |
| SHA256 | `E4CC44F09D9825E23A91D0610F9B1D030C5E6A08D0653744EAD3C6249371F7A1` |
| 构建完成（UTC+08:00） | 2026-11-03 14:32:19 |
| 安装包是否含本批全部代码 | **是**。本批最后一次源码/E2E 编辑 14:12:29（`e2e/write.spec.ts`）与 14:24:29（`programLogLabels.ts` + 其测试），安装包 **14:32:19** 落盘，晚于全部源码改动（`find src e2e -newermt "2026-11-03 13:00"` 逐一比对）。14:32 之后只改文档，未再改代码，故不重打包。 |
| `npm run verify:fast` | **退出码 0**：typecheck + oxlint + 索引新鲜度 + 单测 + 覆盖率 |
| `npm run lint` | oxlint `0 warnings / 0 errors`（497 文件，oxlint 1.90.0） |
| `npm run code:index:check` | 代码索引已是最新（**305 个文件**，本批两次 `--write` 刷新；`npm run package` 前又自动刷新一次） |
| 单测 | vitest **146 文件 / 1682 例全过** |
| `npm run test:coverage` | Statements 81.48% / Branches 73.83% / Functions 77.63% / Lines 84.52% |
| `npm run build:electron` + `npm run test:e2e` | Playwright **106 例通过**（36.4s，含 `e2e/write.spec.ts` 3 例、`e2e/setup.spec.ts` 12 例）——**在最后一处源码改动（`programLogLabels.ts`）之后复跑**，退出码 0 |
| 打包过程 | 两次 EPERM 回退都按批次21 的既定路径走完：`release/installer` 被外部进程占用 → 本次输出到带时间戳目录 → 构建成功后删除旧目录并**收口回 `release/installer`**（日志 `[package] 已删除旧安装包目录 release\installer-20261103-063157-stale` / `[package] 产物：release\installer；旧安装包目录清理 1 个`）。`release/` 下现在只有 `installer` 一个目录。 |
| 本批新增/改动测试 | `qualityGate.test.ts` 34→**42** · `refine.test.ts` **50**（「每层生成规格」describe 重写） · `refineQueue.test.ts` 19→**25** · `rebuild.test.ts` **12** · `merge.test.ts` **8** · `llmHonesty.test.ts` **6** · `webhook.test.ts` **12** · `rejudge.test.ts` **11** · `RefineQueueCard.test.tsx` 8→**10** · `llmGateway.test.ts` 28→**30** · `programLogLabels.test.ts` 10→**11** · `MemoryPage.test.tsx` **15** · `MemoryLayeredPage.test.tsx` **7** · `e2e/write.spec.ts` **3** |

> **注**：`npm run verify`（一条命令跑完 typecheck→lint→索引→覆盖率→Electron 构建→E2E）本批**分两段执行**（`verify:fast` 与 `build:electron + test:e2e`），两段各自退出码 0，等价于全流程绿。单次命令因超时被终止不是构建失败。

---

## 1. 用户两条问题的直接回答

**Q1「在 L0 清洗脱敏生成 L1 的时候就要把字数少的过滤掉，不是等到精炼才过滤」——已按此实现。**

批次39 之前的真实链路是「入库放行 → 后台精炼时才发现首层写不出来」。本机 `refine-queue.json` 实测**入队 1584 行 = done 262 · failed 238 · pending 1084**，而 238 条 failed 的原因**全是同一句**「首层（L2）就没有产出：模型答复不合规格或为空」。现在这道判断挪到了 `checkL0ToL1Quality`（L0 脱敏 → L1 那一步）：有效字 **< 30** 且既无硬事实也无具体技术信息 → **直接拒入库**，新拦截码 `short_low_signal`，写页 / MCP / 采集器 / 补炼队列**四处同一份判定**（同一函数，不存在第二套口径）。

**Q2「L2-L6 精炼逻辑重新梳理」——重新梳理成五条，核心是「按料给深度、按源文给字数」。**

对着 18 字的源要求模型写 50 字摘要，唯一「达标」的办法就是编料。真实账本 1585 行（缺 L1 **0** 行）按 L1 有效字分布实测：

| 有效字区间 | 行数 | 占比 | 批次40 后这一行该炼到 |
|---|---|---|---|
| < 30 字 | 422 | 26.6% | 质量门 v3 拦下（无事实/无技术证据的那部分），其余**停在 L1**（仍可检索） |
| 30–59 字 | 493 | 31.1% | **L2**（+ L6 索引） |
| 60–119 字 | 459 | 29.0% | **L3**（+ L6） |
| 120–239 字 | 150 | 9.5% | **L4**（+ L6） |
| ≥ 240 字 | 61 | **3.8%** | **L5**（+ L6） |

**只有 3.8% 的存量行该炼到 L5**——旧口径要求每条都往 L6 走，等于要求 96% 的行编造内容。

---

## 2. 本批口径（用户拍板 + 落码时的诚实补注）

| 拍板项 | 用户选择 | 落码结果 |
|---|---|---|
| 入库门槛怎么定 | **「双条件：<30 字 且 无硬事实」** | 采纳。落码时**多加了一道豁免**（不是加一道门槛）：`hasTechEvidence`（具体技术名词/符号）也放行。**原因**：批次35 已明确拍板「单句裸需求算有效内容」（「请帮我做一个SolidWorks插件,要求:批量转换文件格式」必须入库），只留「硬事实」一道会把批次35 放行过的短句重新杀掉——**口径冲突时优先保住已拍板的口径**。所以实际判据是 `<30 字 且 无硬事实 且 无具体技术证据` 才拦。 |
| 改动范围 | **「五条一起改」** | ① 入库门槛（v3）② 规格相对化 ③ 格式契约改查开头 ④ 深度按料给 ⑤ 停在哪儿记哪儿 + L6 独立通道——五条全部落地，见下表。 |
| 闸门是否放松 | 用户未提，**一条没动** | 只排不炼（`llmGateway.usable()` 为假就 return）、单条 ≤3 引擎、每自然日（UTC+08:00）≤500 行、`llm_partial` 不自动重试、正文零落盘——本批改的是「炼几层、每层写多少字、为什么停」，**不是「花多少钱」**。 |

---

## 3. 改动清单（逐文件理由）

**本批没有新增源码文件**（改动全部落在既有单一真源与三条管道上）。修改 11 个实现文件 + 13 个测试文件 + 1 个 E2E spec + 4 份文档。

### 3.1 实现（11 个）

| 文件 | 为什么改 |
|---|---|
| `src/core/memagent/layerRules.ts` | **单一真源，本批的主战场**。① `LayerSpec` 新增 `minRatio`（L2 0.4 / L3 0.35 / L4 0.3 / L5 0.25）与 `mustStartWith`，`minChars` 语义降为「无源文时的兜底地板」；② 新 `layerBand(spec, source?)` 三条夹逼（相对下限、下限最多吃掉上限 80%、**上限受源文长度约束**）；③ 新 `DEPTH_CAP_BANDS`/`depthCapFor`/`targetLayers`/`isFullyRefined`/`headlineLayer`；④ `checkLayerSpecDetailed` 返回 `LayerViolationCode`（`empty/too_short/too_long/missing_keyword/bad_prefix/bad_json`），`checkLayerSpec` 退为薄封装；⑤ 新常量 `MIN_MEANINGFUL_WITHOUT_FACTS = 30` |
| `src/core/memagent/qualityGate.ts` | `QUALITY_GATE_VERSION` **2→3** + `QualityBlockCode` 新码 `short_low_signal`；判定放在所有具体噪声码**之后**（保证旁白/身份仍记自己的码）。拒时文案（写页/MCP 原样显示）：`有效内容仅 N 字（< 30），且既无硬事实也无任何具体技术信息` |
| `src/core/memagent/types.ts` | 阶梯产物上的违规条目补 `code?: LayerViolationCode`（types.ts:177）——中文 `reason` 可以随版本改写，**对账只认码** |
| `src/core/memagent/memories.ts` | 正常写入管道改用 `targetLayers(L1 有效字)` + `headlineLayer`；`refined_by` 语义变更：**炼满本行该炼的层 = `llm`**，缺层才是 `llm_partial`（memories.ts:182/249） |
| `src/core/memagent/rebuild.ts` | 按 L0 重建管道**同源**（rebuild.ts:313：这一行重建后应当炼到哪几层，由新 L1 的有效字数决定）——绝不允许「写入按料给深度、重建还硬要求炼到 L5」两套口径并存 |
| `src/core/memagent/refineQueue.ts` | 队列记账：新增 `LAYER_STOP_CODES`（11 个稳定码）+ 每行 `stop_layer`/`stop_code`、`RefineRowResult.to_layer`；`settle()` 在 done 时**清掉上一轮的旧码**（旧结论不能留着冒充本次）；`retryFailed` 清码；`summarizeRefineQueue` 汇总 `stop_codes`；阶梯中间层判废时**跳过 L6 再试它一次** |
| `src/electron/llmGateway.ts` | `buildLayerPrompt` 把算好的相对区间与格式契约**写进提示词**：`长度：X–Y 字（由上游 N 字按本层压缩比算出；写不够就是没内容，写超了就是没压缩，都算废）`、`格式契约：第一个词必须是「适用场景」…不许换成别的说法`。判定查开头的可行性依赖这一步 |
| `src/electron/main.ts` | §6f 补炼 tick 的动作日志（main.ts:1543-1545）新增 `to_layer`/`stop_layer`/`stop_code` 三个字段——排查时能在 `actions.log` 直接 grep 到「这行停在哪、为什么停」 |
| `src/web/params/refineQueue.ts` | `REFINE_STOP_LABELS`（**码→中文的唯一映射处**，11 个码全覆盖）+ `refineStopLabel`（未知码原样显示，不粉饰）+ `refineStopRows`（按行数从多到少排，UI 顺序稳定） |
| `src/web/params/RefineQueueCard.tsx` | 卡片新增「**阶梯停在哪**」一行（按码显示中文与行数，无码不占位），并在卡尾口径说明里加第四条「深度按这条 L1 的料给，不是每条都要炼到 L6」 |
| `src/web/Home/programLogLabels.ts` | `NOTE_KEYS` 补 `to_layer`/`stop_layer`/`stop_code`/`refined_by`——日志页**人话视图**里也能直接看出「这行停在哪、为什么停」（值只有层名与英文码，正文从不进日志）。不加这四个键，「停在哪儿记哪儿」就只在原始视图可见 |

### 3.2 测试（12 个 + 1 个 E2E）——**改这三处必同步**

| 文件 | 为什么改 |
|---|---|
| `qualityGate.test.ts`（34→**42**） | 新增 describe「批次40 短且无信号门」：纯短句必须拦且码为 `short_low_signal`；带硬事实（`pool_size=5` / `40001`）或带具体技术名词的短句必须放行；`哈哈哈`/`你是谁？` 仍记它们自己的码（`thin`/`meta_question`），**不许串成 `short_low_signal`** |
| `refine.test.ts`（**50**） | 「每层生成规格」describe 直接断言 `layerBand`/`depthCapFor` 的每一档边界（无源=`{12,300}`、18 字源=`{12,18}`、200 字源=`{80,200}`、5000 字源=`{240,300}` 上限夹住、4 字源的 L5=`{10,10}` 不是死规格；29/30/59/60/119/120/240 逐档）。真实 LLM 用例的 fixture 全部换成**实测过的压缩链**（L1 320 → L2 171 → L3 115 → L4 62 → L5 52 → L6 JSON）——旧的「短源 + 长摘要」样本按新规格**真的该判废，不是测试写错** |
| `refineQueue.test.ts`（19→**25**） | 新增 describe「批次40-C：深度按料给 + L6 独立通道 + 停在哪儿记哪儿」：短料行 `targets=['L1']` 且整行拒炼；L4 判废但 L2/L3/L6 到手 → 行 `layer='L3'` + `content_l6` 照常落 + `refined_by='llm_partial'` + `stop_layer/stop_code`；done 后旧码被清；`retryFailed` 清码；`summarizeRefineQueue.stop_codes` 聚合 |
| `rebuild.test.ts`（**12**） | 重建管道同源断言（新 L1 有效字决定层深） |
| `merge.test.ts`（**8**） | fixture 重写为实测压缩链；用例 5 断言 `llm.calls=['L2','L3','L4','L6']`（**L5 不再调用，L6 照炼**）且行 `layer='L3'`、`layer_specs` 键恰为 `['L1','L2','L3','L6']` |
| `llmHonesty.test.ts`（**6**） | 原文/产物换成同一批实测样本（旧样本会被新规格判废） |
| `webhook.test.ts`（**12**） | 4 处 fixture 正文加硬事实（`pool_size=5`/`504 状态码`/`120 秒`/`重试 3 轮`）——这些用例本来测的是去重与类别校验，不是质量门；不加事实就会被 v3 拦下、断言打在错误对象上 |
| `rejudge.test.ts`（**11**） | 行版本戳断言改用 `QUALITY_GATE_VERSION - 1` 参数化（原来硬编码 `v2`，版本一变就假失败） |
| `RefineQueueCard.test.tsx`（8→**10**） | 新增两例：按码显示行数、无 `stop_codes` 时不渲染该行 |
| `programLogLabels.test.ts`（10→**11**） | 新增一例：`detailNote` 对 `kernel:refine:row` 的 detail 必须带出 `to_layer/stop_layer/stop_code/refined_by`（否则「停在哪儿记哪儿」在人话视图里等于没记） |
| `llmGateway.test.ts`（28→**30**） | 新增两例：长度约束按**源文实时算**（100 字源 → `长度：40–100 字`，且断言旧的 `长度：12–300 字` 文案已废除、L6 无区间）、`mustStartWith` 契约在 L4/L5 提示词里且 L2 不带 |
| `MemoryPage.test.tsx`（**15**）/ `MemoryLayeredPage.test.tsx`（**7**） | 编辑草稿文本加硬事实（`回滚耗时 120 秒` 等）：手动改写同样过 v3 质量门（**旁路收口的正面证据**——旧文本现在会被入库门槛拒掉，说明门槛对手动编辑这条路径真的生效） |
| `e2e/write.spec.ts`（**3**） | 写入页那条「纯浏览器无主进程 → 如实 `E_L0_LOCKED`」的用例，输入改为带硬事实的句子（`上次回滚耗时 120 秒，网关报 504 状态码`），**断言仍打在 `E_L0_LOCKED`** 上；不加事实的话会先被 v3 拦下，测的就不是 L0 锁了 |

### 3.3 文档（4 份）

`AGENTS.md`（§3 新增「改这行该炼到哪一层」一行 + §9 批次40 大块 + 批次36 行版本号校正为 `3`）、`specs/code-map.md`（批次40 小节 + 批次9 表格加指向）、`specs/需求规格书.md`（§2.1 图后新增两条口径修订、§16.1 长度口径重写含 `minRatio` 表、§19.21 版本戳注为 3、新增 §19.24）、`specs/code-index.generated.md`（`npm run code:index -- --write` 刷新，305 文件）。

---

## 4. 管理员手测步骤（请在桌面端逐条走，截图/回执留档）

> 前置：本机账本实测现状（2026-11-03 14:2x UTC+08:00 只读核对，非推断）——
> `memories.db.json` **1585 行**、`quality_gate_v` **全部 v2**（都是批次40 之前放进来的）、`refined_by` = `stub 1323 / llm_partial 262`、行 `layer` = `L1 1323 / L3 249 / L2 12 / L4 1`；
> `refine-queue.json` **1584 行 = done 262 · failed 238 · pending 1084**、`enabled:true`、`day:2026-11-03`、`dayRows:500`（**当日额度已用满**）、238 条 failed **没有 `stop_code` 字段**（批次39 时代记的账）。

**A. 入库门槛（Q1 的正向验证）**

1. 装本批安装包并启动，进「记忆库写入」页。
2. 输入纯短句：`开始实施。先创建解决方案和项目文件。` → 提交**必须被拒**，页面显示 `有效内容仅 16 字（< 30），且既无硬事实也无任何具体技术信息`（16 字为本批交付前实测的 `meaningfulLength` 结果）。**这一步就拦，不再产生任何待炼队列条目**。
3. 输入同样短但带具体技术名词的句子：`请帮我优化 PostgreSQL 的索引配置。`（20 有效字）→ **必须放行**（批次35 口径不能破）。
4. 再输出一条带硬事实的短句：`网关 504 状态码重试 3 轮后归零。`（15 有效字）→ **放行**（豁免的是字数这一维）。**同一条要看第二件事**：它过得了入库门，但 `depthCapFor(15) = null` → **后台不会给它炼深层，行停在 L1 且仍可检索**（对照：`重试 3 轮后构建通过。` 只有 9 有效字，会被更早的 `thin` 码拦下，不是 `short_low_signal`——三条形同「短句」的句子走的是三个不同的门）。
5. 放行成功后核对版本戳：该行在 `memories.db.json` 里应带 `quality_gate_v: 3`（参数页/记忆库页不直接显示这个字段，可用只读方式查看数据根文件）；被拒时在动作日志与内核审计里应查到 `filter_code=short_low_signal` + `gate_version=3`（手动改写路径同样过门，记 `memory_op` / `filtered_l0_to_l1`）。

**B. 深度按料给 + L6 独立通道（Q2 的正向验证）**

> **前置（重要，否则会以为没生效）**：本机当日 `dayRows` 已到 **500 上限**，**新写入的行会停在 `pending` 不炼**（额度闸门对所有行一视同仁）。要么次日报额自动续炼，要么先在引擎卡停用云端引擎、再点「重试失败行」以外的入队动作前把额度想清楚。B 段验的是「行该炼多深」，可以在次日额度重置后一次性核对。

6. 写入一条 **≥240 有效字**的长内容（含错误码、带单位数值等硬事实），等后台补炼（额度见上面的前置）→ 层级管理页应看到 L2–L5 + L6 **齐全**，行 `layer` 为最深层。
7. 写入一条 **60–119 有效字**的内容 → 应只炼出 L2、L3（+ L6 索引），行 `layer` 报 **`L3`**，`refined_by='llm'`（**炼满本行该炼的层就是 `llm`**，不再一律 `llm_partial`）。**这就是「按料给深度」的直接体现，不是精炼失败。**
8. 挑一条批次39 遗留、`layer` 显示 `L3` 但 `content_l6` 有值的行（现状 249 行）→ 确认抽屉里 L6 是索引（keywords/projections），页面**没有**把它当成「炼到 L6」。

**C. 队列与「阶梯停在哪」**

9. 「参数」页 LLM 引擎卡下方「后台补炼队列」卡：当前应显示 `今日 500/500`（额度已满，**新行排队不炼，属预期**）。**下一步会真花钱，请在预算允许时再做**：
10. 点「重试失败行」（仅管理员）→ 238 行放回 pending（**码被清空**，旧结论不冒充本次），按**新的相对规格**重跑。之后回卡片看「阶梯停在哪」一行（`data-testid="refine-stop-codes"`），格式是 `中文标签（英文码）N 行` 用 ` · ` 连接，例如 `压得太狠（低于本层下限）（too_short）1 行 · 模型交白卷（empty）3 行`，行尾固定带一句口径说明「已炼成」不等于「炼到 L6」；`actions.log` 里 `[kernel:refine:row]` 条目应带 `to_layer`/`stop_layer`/`stop_code`，**日志记录页的「人话」视图现在也会把这几个字段摘要出来**（本批给 `NOTE_KEYS` 补了这四个键）。
11. 想只花本机的钱：先在引擎卡停用全部云端引擎（只留 Ollama），再点重试。

**D. 存量清理（本批没替你点）**

12. 命令行只读回放（不写盘）：`npm run rejudge`。实测本批交付前跑过：1585 行 → **放行 1461 / 拦下 124，124 条全是 `short_low_signal`、全是 L1、受保护 0**（2026-11-03 14:10 UTC+08:00）。
13. 要真删这 124 行：安全页「规则重判存量」→ 管理员**逐字输入 `REJUDGE`**，执行前强制双库备份。**这一步是不可逆的真实账本删除，必须由你亲手点；维护者没有代点。**

**E. 门禁类（防回归）**

14. 用非管理员账号看参数页队列卡：开关/入队/重试三个控件应禁用且提示「需管理员」，「刷新」仍可用。
15. 纯浏览器 `npm run dev` 打开参数页：队列卡如实显示「不是桌面宿主环境」，**绝不显示一个假的 0 待炼**。
16. 日志记录页（人话视图）应能把 `[refine]` 条目读成中文，`[error]` 出现时可「复制诊断信息」；诊断与日志正文**不含任何正文、密钥、令牌**。

---

## 5. 与既有通道的分工（别走错门）

| 我要做什么 | 走哪条 |
|---|---|
| 改「这行该炼到哪层、每层允许多少字、为什么停」 | **本批**：`layerRules.ts`（`DEPTH_CAP_BANDS`/`layerBand`/`targetLayers`/`headlineLayer`） |
| 改「什么才允许进记忆库」 | `qualityGate.ts`（**改口径必须 `QUALITY_GATE_VERSION` +1**，本批已 2→3）+ 安全页重判卡 |
| 让存量 / 新行长出 L2–L6（不动 L1） | 批次39 后台补炼队列（参数页卡） |
| 规则变了，重判历史该删哪些行 | 批次36 存量重判（逐字 `REJUDGE`） |
| 采集口径变了，整库重来 | 批次35 清空重采（逐字 `RESET`） |
| L1–L6 那份库删了，从原文整行重造 | 批次37-E 按 L0 重建（逐字 `REBUILD`，需 L0 查阅会话） |

---

## 6. 诚实边界（未做 / 已知限制，不留给用户猜）

1. **只改规则与记账字段，没动数据**：那 238 条 `failed` 是批次39 绝对规格下记的账（实测**没有 `stop_code` 字段**），本批次**没有回滚队列、没有重炼存量**。想重炼就点「重试失败行」——放回 pending 按新规格重跑，**会再次真实调用引擎并消耗当日 500 行额度**（今日已用满，实际要等次日或先手动入队）。
2. **124 行 `short_low_signal` 存量仍在库里**：安全页「规则重判存量」按钮（逐字 `REJUDGE` + 强制备份）**维护者没替用户点过**；`RESET`/`SPLIT`/`REBUILD` 三条 run 也从未由维护者执行。
3. **深度档位是拍出来的工程常量**（每深一层源料大致翻倍 → 240/120/60/30），不是语义理解；`minRatio` 的 0.4/0.35/0.3/0.25 是**按真实账本长度分布回放标定**出来的，换模型或换采集口径需要重新标定。
4. **豁免判据仍是正则与词表**：`<30 字` 靠「硬事实 / 具体技术证据」放行，豁免的是**字数**这一维，不是「有没有信息量」的语义判断。宁可放过不可错杀的既有取舍不变。
5. **`headlineLayer` 只保证「行上报的深度不撒谎」**，不能证明产物质量——L2 合规但内容编造仍然会落库。本批把「不可能达成的绝对规格」换成「可达成的相对规格」，**降低了编造的动机，没有消除编造**。
6. **`main.ts` §6f 的定时与入队接线仍无自动化测试**（批次39 就声明过，本批未补）：纯函数 `refineQueue.test.ts` 25 例 + 卡片 10 例 + 网关 30 例覆盖，但 15s tick、启动全量入队、采集器写完即入队**只能按本报告 §4 在实机核对** `refine-queue.json` 与 `actions.log`。
7. **只排不炼、≤3 引擎、≤500 行/日、`llm_partial` 不自动重试、正文零落盘** 五条闸门一条未放松；队列文件与动作日志只有 mem_id、状态、层名、码与计数。
8. **价档 `price:0.01` 是记账口径，不是厂商账单**；本批未接任何计费真源。
9. **红线复述**：**L0 管理密码与恢复码同时丢失 = L0 原数据库不可恢复**，解密能力没有任何服务端兜底。本批与找回通道无关，但补炼/重判都会先双库备份——**请与密钥环、恢复卡分开存放离线副本**。
10. 未提交：批次35–40 全部改动仍在工作区（HEAD `3a4080a`）；`git commit`/`git push` 需用户明确授权。
