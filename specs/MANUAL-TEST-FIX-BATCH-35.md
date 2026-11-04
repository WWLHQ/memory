# 批次35 手动测试报告 · 无意义会话禁止入库（质量门收紧 + 采集器只采用户 + 记忆库清空重采）

日期（UTC+08:00）：2026-11-01
分支：`main`
上一批次：批次34（`specs/MANUAL-TEST-FIX-BATCH-34.md`）

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,010,337 字节 = **116.36 MB** |
| SHA256 | `923dd6bfa11f8f86483030f936a80a69d7e2b0a21aee8fe525dca16f140ffe3c` |
| 构建完成（UTC+08:00） | 2026-11-01 12:41 |
| `npm run verify` | **全绿**：typecheck（渲染层 + electron 两份 tsconfig）→ oxlint `0 warnings / 0 errors`（459 文件）→ 代码索引新鲜 → vitest **128 文件 / 1441 用例全过** → 覆盖率 Statements 80.03% / Branches 72.32% / Functions 76.10% / Lines 83.19%（高于阈值）→ Electron 构建 → Playwright **94/94 E2E 通过**（33.7s） |
| 旧包清理 | 构建后删除 1 个旧 `release/installer-*`（`installer-20261101-044059-stale`），`release/installer/` 只留最新 |

## 1. 用户反馈与真因（三层，不是一个问题）

用户反馈：**「这些没有意义的会话记录怎么都放行入库了」**（附 10 张记忆库截图，内容是「我是 Claude Code，Anthropic 开发的官方 CLI 工具…」「我先看一下当前目录情况和开发环境」「Shell 能用了（有个临时文件报错是噪音）」「更新 HANDOVER。」这类条目）。

排查方式：把本机数据根 `memories.db.json` 的 **1642 行历史正文逐条**回灌给当时的质量门，看它到底拦不拦（脚本 `scratch/b35-replay.mjs`，本轮已完成并删除）。

| 层 | 实测事实 | 结论 |
|---|---|---|
| ① 判定层 | 旧门只拦 0～22 条浮动；**`**需求分析**` 里的 `*` 命中了「代码符号证据」**，厂商名 `Anthropic / CLI / API` 不在停用词表，「网站 / 桌面应用」中间那个两侧空白的 `/` 也算符号 | 不是「规则没写」，是**格式替内容逃过了判定** |
| ② 结构层 | 采集器 `sessionCollector` 把 JSONL 里 `user` 与 `assistant` **两类消息同等入库**；而过程旁白的主体就是助手消息 | 靠措辞区分用户/助手是语义问题，启发式做不到 → **必须在采集口按角色挡**，不能全指望质量门 |
| ③ 历史层 | 已落库的 1642 行里，`refined_by` 为真实 llm 的 **0 条**、带 L0 密文原文的 **1641 条** | 收紧规则只约束此后写入；老噪声不会自己消失，只能整库重来 |

用户本轮拍板三条口径：入库侧收口 = **质量门 + 采集器只采用户消息**；历史数据 = **库内内容全部删除、按新规则重新拉取，彻底重来**；单句裸需求（「请帮我做一个SolidWorks插件,要求:批量转换文件格式」）= **保留，算有效内容**。

## 2. 改动清单（逐文件为何要动）

| 文件 | 改了什么 | 为什么必须动这个文件 |
|---|---|---|
| [src/core/memagent/qualityGate.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/qualityGate.ts) | 判定前 `stripDecoration` 去 Markdown 装饰（只用于判定，落库正文不变）；`TECH_STOP` 扩厂商与通用 IT 词 + `LOOSE_SYM_RE` 只认贴着字的符号；新增 `HARD_FACT_RES/hasHardFacts` 做**段级硬事实豁免**（裸版本号/裸产品名不算硬事实）；过程旁白改**整句**口径 `sentences.every(isMetaSentence)` + `NARRATION_GUARD_RE`（请/务必/不要/必须/确保/尽量 = 要求，不是旁白）+ `NARRATION_SELFOP_RE`（更新记忆/HANDOVER/跑 selftest） | ① 层的全部漏网口径都在这一个文件里。身份自述与过程旁白**不给证据豁免**，能力清单与身份询问**保留**豁免（「我可以帮你优化 PostgreSQL 的索引配置」必须放行） |
| [src/core/memagent/sessionCollector.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/sessionCollector.ts) | `SessionLogSource.roles?` + `DEFAULT_COLLECT_ROLES=['user']`（源不声明就只采 user）；`ScanResult.roleSkipped`；jsonl/zstd 在**算哈希之前**按角色挡；分块源 `parse` 后过滤（游标 `msgIndex` 索引过滤后数组）；`parseClaudeJsonl` 对 `isMeta:true` 返回 null；`ApplyScanResult` 增 `filtered`；**WorkBuddy 显式 `roles:['assistant']`** | ② 层的结构修复。角色跳过不占单轮限流名额、游标照常推进（不会因挡下助手消息而漏采用户消息）。WorkBuddy 日志整篇是 `##` 任务分块，属工作记录不是对话旁白，是唯一例外 |
| [src/core/memagent/ledgerReset.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/ledgerReset.ts)（**新**） | `scanLedgerForReset`（只读预览：条数/层级/来源/带 L0 密文数/真实 LLM 产物数/墓碑数/样本 id，不改数据不写审计）+ `purgeLedger`（逐行删 + 向量 `remove`，一批一次落盘，单行失败不中断并记 `failed_ids`，写 `security_change/op='ledger_purge'`；**强制 `backup_confirmed:true` + `admin_user_id`，缺任一抛错且一行不删**） | ③ 层。纯函数、可单测，不做 IO 之外的决定；备份与游标重置留给主进程，才能在「清空成功但游标写失败」时如实分开回显 |
| [src/electron/ipcChannels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/ipcChannels.ts) | 新增 `ledger:resetPreview` / `ledger:resetRecollect` | 通道常量单一真源；`PRELOAD_CHANNELS` 自检基线随 `Object.values(IPC)` 自动扩，preload 不注册就测不过 |
| [src/electron/main.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/main.ts) §采集区 | 预览需会话、执行需管理员 + 逐字口令 `RESET`；顺序固定 **`backupBeforeKernelChange('ledger-reset')`（并额外拷 `collector-cursor.json`）→ `purgeLedger` → 游标与 `seen` 归零 → `runRecollectCatchUp`（最多 80 轮、单轮仍钳 50 条、轮间让出 300ms）**；`collector:status` 返回值补 `last/apply/recollecting`；`collector:role-gate` 动作日志；采集汇总 `console.log` 带 `filtered` | 清空必须在主进程：桌面端是 FileStorage 的唯一写者（浏览器 dev 只是只读镜像）。备份失败一律拒绝清空，绝不无备份动用户数据 |
| [src/electron/preload.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/preload.ts) | 新 `ledgerReset.{preview,run}` 并加入 `contextBridge.exposeInMainWorld('api', …)`；`collector.status` 返回类型补 `last/apply/recollecting` | IPC 边界类型契约；`confirmText` 只在参数里出现一次，不进日志 |
| [src/desktop/hostBridge.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/desktop/hostBridge.ts) | `HostMethod` 加两条通道 + `CHANNEL_TO_NATIVE` 映射 `['ledgerReset','preview'/'run']` | iframe 子页（概览页内的安全页）走宿主消息桥，不映射就只在顶层窗口可用 |
| [src/web/security/LedgerResetCard.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/LedgerResetCard.tsx)（**新**） | 管理员预览卡 + 口令输入门禁（没逐字输入 `RESET` 按钮 `disabled`）+ 回执（已删/应删/失败数、备份路径、`security_change`）+ **游标写失败的显式警告** + 追采进度轮询（`collector:status`，2s） | 用户要的是「彻底重来」，但清空不可逆：把「备份路径 / 会删掉多少真实 LLM 产物 / 追采不是一次点完」全部摆在点按钮之前 |
| [src/web/security/SecurityPage.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/SecurityPage.tsx) | 在「遗留账本清理」卡下方挂 `<LedgerResetCard enabled={role==='admin'} />` | 与批次24 同类「改账本」能力同区，权限口径一致 |
| [src/web/Home/programLogLabels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/Home/programLogLabels.ts) | 4 条 kernel 事件 + 2 条通道中文标签 | 「有动作就有日志」还不够，日志页要能用人话读出「清空前备份 / 被拒 / 已完成」 |
| 文档 | `AGENTS.md` §3 两行新「改哪里」映射、§9 质量门口径重写 + 新增批次35 边界条；`specs/code-map.md` 批次35 章节；`specs/需求规格书.md` §2.2 不变量 5 重写 + 新增不变量 10/11 + §19.20 | 规则单一真源在代码，但**口径与取舍**必须落在文档，否则下一个人会把 `roles:['user']` 当 bug 改回去 |

> 未动的文件（刻意）：`memories.ts` 写路径与 `coreMemoryOps` 未改——同一 `checkL0ToL1Quality` 已经覆盖手动编辑与摘要合并（批次10 无旁路口径不变）；`layerRules.ts` 的 `MIN_MEANINGFUL_CHARS`/脱敏未动，本批次不改变「有效字符 < 10 拦截」这条线。

## 3. 实测证据（本轮真实跑出来的数）

| 验证项 | 实测结果 |
|---|---|
| 历史账本逐条回放（1642 行 → 新门） | **拦下 57 条** = 助手过程旁白 36 + 有效内容不足 17 + 助手身份自述段 3 + 助手能力清单段 1；其余 1585 条放行（多为真实用户需求/事实/踩坑） |
| 副本整库清空（真实账本的临时副本，**线上账本未动**） | 预览 `total=1642 / by_layer={L1:1641, L2:1} / 带 L0 密文 1641 / 真实 LLM 产物 0` → `purged=1642 failed=0` → 剩余行 **0**、审计 **1 条** `op=ledger_purge` |
| 新采集口径在真实会话日志上跑一整轮（游标归零） | `collected=3051`（全部 user）· `roleSkipped=1757`（助手消息在采集口挡下）· `deduped=190` · 命中 277 个日志源 |
| 这 3051 条再过质量门 | **放行 2918 / 拦下 133**（其中「有效内容不足 10 字符」130、裸链接 2、能力清单段 1）；放行样例首条即用户点名要保留的那句「请帮我做一个SolidWorks插件,要求:批量转换文件格式」 |
| 单元/契约测试 | `qualityGate.test.ts` 22（批次10 原 15 例一字未改仍绿 + 批次35 新 7 例）、`sessionCollector.test.ts` 30、`dshZstdCollector.test.ts` 4、`ledgerReset.test.ts` 6、`LedgerResetCard.test.tsx` 9 |
| 门禁 | `npm run verify` 全绿（见 §0） |

## 4. 手动测试步骤（装完后请按此顺序验）

前置：安装 `release/installer/MultiAgent Memory-0.1.0-setup.exe`，用内置管理员 `admin` 登录（若已改密请用改后的密码）。

1. **清空重采卡出现且只读**：账号与安全页 → 找到「记忆库清空重采（批次35…）」卡 → 自动出预览，应显示当前库真实条数（本机重装前实测 `1642`）与层级/来源分布，并点名「N 条带 L0 密文原文」「N 条是真实 LLM 精炼产物」。
2. **口令门禁**：不输入任何字 → 「清空并按新规则重采（N 条）」按钮必须是**禁用**；输入 `re` 仍禁用；输入 `RESET` 才可点。截图留存。
3. **备份先于清空**：点执行后，到数据根 `backup-config.json` 指向的备份目录（默认 `%APPDATA%/MultiAgent Memory/backups/`）应出现 `ledger-reset-<UTC时间戳>/`，内含 `memories.db.json`（可能还有 `l0-keyring.json`）与 **`collector-cursor.json`**。回执里的路径与之一一对应。
4. **审计成对**：审计日志页按回执里的 `request_id`（`req_ledger_reset_<ms>`）真查，应命中 1 条 `security_change`，`detail.op='ledger_purge'`、`purged` 与界面一致。
5. **追采在跑（不是一次点完）**：清空后卡片下方出现「追采进行中/已收敛」行，单轮入库最多 50 条；每 2s 自动刷新。**请至少观察到第二次刷新**，并确认「质量门拦下 N 条」「角色白名单挡下 N 条」都有真实数字（不是 0 占位）。
6. **只剩用户消息**：记忆库管理页按来源过滤/查看，重采后新增条目的 `source_agent` 应为 `collector:<agent>` 且正文都是**用户说过的话**；库里不应再出现「我是 Claude/我是 Agnes…」「我先看一下…」「更新 HANDOVER」这类条目（历史残留若第 3 步已清空则应为 0）。
7. **单句裸需求仍在**（用户点名口径）：检索「SolidWorks 插件 批量转换」应能命中「请帮我做一个SolidWorks插件,要求:批量转换文件格式」——它必须**没被**当成无意义内容拦掉。
8. **动作日志用人话可读**：日志记录页应出现「清空记忆库前备份」「记忆库清空并按新规则重采」；若故意口令输错，应出现「清空记忆库被拒（确认口令不符）」。`rg "\[kernel:ledger:reset" <数据根>/actions.log` 可 grep 到原文。
9. **权限负例**：普通成员账号看同一卡 → 只显示「需管理员账号才能执行清空」，不自动预览、不给按钮；纯浏览器 `npm run dev` 打开安全页 → 显示「当前为浏览器环境…需在桌面端执行」，不伪造条数。
10. **MCP 仍走通**：任意接入本库的 Agent 调 `recall_memory`，确认清空重采后仍能召回并回显提示（`display.markdown` 原样输出；DSH 档给两行摘要 + 明细链接）。

## 5. 已知限制与未覆盖项（诚实声明，别当成 bug 提）

1. **启发式仍会放过少量助手句**：实测「collect 幂等通过…」「A5 全绿。标记任务完成。」因带硬事实或指令语气仍会入库。取向是**宁可放过不可错杀**；要 100% 干净只有一条路——只采 user（本批次已做），助手侧结论请用 MCP `write_memory` 或手动写入沉淀。
2. **WorkBuddy 是唯一 `roles:['assistant']` 例外**：它的日志是 `##` 分块的任务记录，按用户口径保留采集。若不接受该源噪声，最小裁剪=删掉 `defaultAgentSources` 里那三行 `roles:['assistant']` 声明，其 323 条即整体不再入库（代码注释已写明）。
3. **追采不是一次点完**：单轮钳 50 条、最多 80 轮（≈4000 条）；本机一轮实测 `collected=3051` 是「不带限流跑满全量」的数，实际追采会分多轮完成，剩下的由 5 分钟周期继续。历史会话特别多时需数小时，**不是丢数据**。
4. **游标文件写失败**：此时内存游标已归零、本次重采照常，但**应用重启后会退回旧游标**（可能漏采某段历史），卡片会红字警告，不会假装全部就绪。
5. **清空不可逆**：唯一退路是第 3 步的备份目录（手工恢复=停应用后把 `memories.db.json` 拷回数据根）。真实 LLM 精炼产物（本机当前 **0 条**）删了不会自动重生成；预览会提前点名条数。
6. **不动的边界**：清空只删记忆行 + 进程内向量索引，不删 L0 密钥环、内核审计历史、home 账号/审计、MCP 令牌；`actions.log` 历史保留（排查证据）。
7. **主进程 IPC handler 无自动化覆盖**：`ledger:reset*` 走 `main.ts`，vitest 打不到（同批次34 的 `llm:*` 限制）；§4 第 3~8 步是**必须人工走一遍**的验收，不能只凭单测交付。
8. **`isMeta` 过滤只对 Claude 系 JSONL 生效**：其他源（zstd/分块 Markdown）没有该字段，靠角色白名单与质量门兜。
9. 本机数据根当前仍是旧 1642 行——**本轮未替用户执行清空**（属不可逆动作，且桌面端是账本唯一写者）。请管理员在页面上按 §4 亲手点，退路与回执都在。

## 6. 与批次34 的衔接

批次34 解决「拨测被启用位反向挡住」，批次35 解决「什么才允许进记忆库」。两者共同点：**先看动作日志的实测数再定性**（前者是 `ms:7~11` 说明没发 HTTP，后者是 1642 行逐条回放说明规则漏网），以及都把「拦截量」与「丢失量」分开记账（`roleSkipped` / `filtered` 都进状态与日志）。
