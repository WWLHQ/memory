# 批次36 手动测试报告 · 入库规则更新后的存量处置（规则版本戳 + 只读回放 + 存量重判）

日期（UTC+08:00）：2026-11-02
分支：`main`（批次35 与批次36 的改动都还未提交）
上一批次：批次35（`specs/MANUAL-TEST-FIX-BATCH-35.md`）

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,012,760 字节 = **116.40 MB** |
| SHA256 | `219DFF8F3FC11ACAF7EE88409ECFDFC47667579F6954BA7D210E4A95193694E6` |
| 构建完成（UTC+08:00） | 2026-11-02 10:02 |
| `npm run verify` | **全绿**：typecheck（渲染层 + electron 两份 tsconfig）→ oxlint `0 warnings / 0 errors` → 代码索引新鲜（290 文件）→ vitest **130 文件 / 1476 用例全过** → 覆盖率 Statements 80.2%（9721/12120）/ Branches 72.51%（6921/9544）/ Functions 76.3%（2215/2903）/ Lines 83.36%（8447/10132）→ Electron 构建 → Playwright **94/94 E2E 通过**（32.2s） |
| 旧包清理 | 构建后删除 1 个旧 `release/installer-*`（`installer-20261102-020207-stale`），`release/installer/` 只留最新 |
| 只读回放器实测 | `npm run rejudge` 于 2026-11-02 10:03 (UTC+08:00) 对真实账本跑通，末尾原样打印「本次只读，未写任何文件」 |

## 1. 这一批解决什么（用户的两个追问）

- **「以后入库规则有更新后应该怎么处理？」** → 批次35 收紧了规则，但已落库的 1642 行不会自己变干净，而且规则下次还会再变。本批次把「规则变了怎么对账存量」做成常态能力：**规则版本戳 → 只读回放 → 存量重判**。
- **「我说的删除库只是删除 L1–L6 的库，不用重新读，直接从 L0 重新生成」** → 本批次当时选的是**不需要解锁、不需要 LLM、不动采集游标**的「按当前规则重判」，理由要说准（含 2026-11-02 的实测校正）：
  - 实测硬事实：`content_l0_enc`（v2 信封）**0 行**、真实 LLM 精炼产物（`refined_by='llm'`）**0 行** → 未解锁 L0 写密钥时任何「重新入库」都会先撞上 `E_L0_LOCKED`。
  - **校正（2026-11-02）**：本条原写「数据根没有 `l0-keyring.json`（L0 写密钥从未初始化）」是**错的**。本机实测该文件**存在**（2026-11-01 17:06 UTC+08:00 由批次37 之前的 `l0:setup` 建好：`admin_wrap` 有、`grants`/`requests` 各 0、**没有 `recovery_wrap`**），但 `memories.l0.json` 仍不存在、全库 v2 信封仍 0 行——**键环立着了，它保护的密文一份都还没有**。结论（必须先解锁才能重入库）不变。
  - **校正**：本节初稿写「`content_orig` 0 行」是**我的错误断言**。实测 1642 行里 **1641 行带 `content_orig`，而且是明文原文**（5,775,945 字节 / 全库 21,153,428 字节；其中 684 行与脱敏后的 L1 不同，例如助手自述里的 `` `claude-haiku-4-5` `` 反引号仍在原文中）。所以「从 L0 重新生成」**原料是在的**，只是它需要 L0 写密钥解锁 + L0 原库落位——这条随批次37（L0 与 L1–L6 拆两个库文件 + 首启强制选位 + L0 管理密码 + 双库备份 + **按 L0 重建 L1–L6**）落地。
  - 就此与用户确认的当时口径：写入**保持现状**（不解锁就拒写，`E_L0_LOCKED`），存量走重判。

**口径分工（以后照 this 判断用哪个入口）**

| 变了什么 | 用哪个能力 | 需要 L0 写密钥 / LLM 吗 | 动采集游标吗 |
|---|---|---|---|
| 判定规则（`qualityGate` 的口径） | 本批次「规则重判存量」卡 / `npm run rejudge` | 都不需要 | 不动 |
| 采集规则（角色白名单、源开关那类） | 批次35「记忆库清空重采」卡（口令 `RESET`） | 不需要（重采从会话文件重读） | 归零后重采 |
| 两者都变 | 先重判，再按缺口补采 | — | — |

## 2. 改动清单（逐文件为何要动）

| 文件 | 改了什么 | 为什么必须动这个文件 |
|---|---|---|
| [src/core/memagent/qualityGate.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/qualityGate.ts) | `QUALITY_GATE_VERSION = 2`（**改判定口径必须 +1**）+ 稳定 `QualityBlockCode`（`empty/thin/greeting/separator/empty_heading/decoration/bare_link/bare_json/bare_number/comment_only/import_only/require_only/meta_question/identity/capability_list/disclaimer/narration`）；`QualityCheckResult.code`；`NOISE_PATTERNS` 每条带码；`metaReplyReason` 返回 `{code,reason}`；新增 `filteredAuditDetail(raw, result)` 统一输出 `filter_code` + `gate_version` | 36-A。中文 `reason` 会随版本改写，**码不能随便换**——存量重判和回放器都按码对账。没有版本戳就无法回答「这行是按哪版规则放行的」 |
| [src/core/memagent/types.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/types.ts) | `Memory.quality_gate_v?: number` | 行级证据。历史行缺字段一律按 **v1**，**绝不猜它是最新版** |
| [src/core/memagent/memories.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/memories.ts) · [src/web/memory/coreMemoryOps.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/memory/coreMemoryOps.ts) · [src/core/memagent/forgetting.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/forgetting.ts) | 三处入库口（自动写入 / 手动改写 / 遗忘摘要）统一：拦下时写 `filteredAuditDetail(...)`，放行时盖 `quality_gate_v: QUALITY_GATE_VERSION` | 只要有**一处**没盖戳，重判预览就会出现「说不清这行按哪版规则来的」。质量门是三处共用同一函数，版本戳也必须三处共用 |
| [tools/rejudge-dry.mjs](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/tools/rejudge-dry.mjs)（**新**）+ [package.json](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/package.json) 的 `"rejudge"` | 全程 `readFileSync` 零写操作；数据根解析 `--file > --root > %APPDATA%/MultiAgent Memory/data-root.json 指针 > 默认根`；**直接 `import()` 生产 `qualityGate.ts`**（Node ≥ 24 原生跑 `.ts`）；只喂 `content_l1`（缺失才退 `content`）；输出总数/墓碑/缺 L1/行版本戳/放行/拦下/受保护/可删/码分布/层级分布/样本，`--code` `--limit` `--json` 可控 | 36-B。**在点任何删除按钮之前**就能用命令行看到「按新规则会拦下哪 57 条、码分别是什么」。与入库同一份规则文件，不存在「回放器和线上判定不一致」 |
| [src/core/memagent/rejudge.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/core/memagent/rejudge.ts)（**新**） | `scanRowsForRejudge`（只读预览：应删/受保护/需重盖戳/码分布/行戳分布/样本）与 `rejudgeRows`（应删行 `deleteMemory` + 向量 `remove` + **每行** `memory_op/op='rejudge_purge'`；放行行**只**重盖 `quality_gate_v`，正文/层级/`version`/向量都不动；`pinned`/`locked` 命中也不删只计数；缺 L1 不判定不删；单行失败不中断并回显 `failed_ids`；整轮 `security_change/op='rules_rejudge'`；**强制 `backup_confirmed` + `admin_user_id`**） | 36-C 内核。预览与执行共用同一 `decide()` → **回执数字与预览必然一致**，不会「预览 57 条、删完说 61 条」 |
| [src/electron/ipcChannels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/ipcChannels.ts) · [src/electron/main.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/main.ts) §采集区 · [src/electron/preload.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/electron/preload.ts) · [src/desktop/hostBridge.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/desktop/hostBridge.ts) | `rules:rejudgePreview`（需会话）/ `rules:rejudgeRun`（需管理员 + 逐字 `REJUDGE`）；执行前 `backupBeforeKernelChange('rules-rejudge')`，**备份失败直接拒绝**；`actionLog('kernel','rules:rejudge-run',…)`；preload `rulesRejudge.{preview,run}` + 宿主桥两条通道 | 重判是删真实账本，只能在主进程做（桌面端是 FileStorage 唯一写者），且必须管理员 + 先备份。三层门禁与批次35 的清空重采同一口径 |
| [src/web/security/RulesRejudgeCard.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/RulesRejudgeCard.tsx)（**新**）挂在 [SecurityPage.tsx](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/security/SecurityPage.tsx) | 管理员进入即只读预览（当前门版本、总数、应删/受保护/需重盖戳、码分布、行戳分布、最多 8 条样本 id）→ 逐字输入 `REJUDGE` 才解锁按钮 → 回执（已删/受保护跳过/缺 L1 跳过/重盖戳/失败 + 备份路径 + 两类审计键）；页脚写明「不需解锁 L0、不调 LLM、不动采集游标」并指路 `npm run rejudge` | UI 只渲染主进程真值：IPC 抛错就显示错误，**不装成「库已干净」**；非管理员不给入口也不发预览请求 |
| [src/web/Home/programLogLabels.ts](file:///D:/Work%20Folder/Agnet/Deepseek%20Harness/2026-10-06-16-15-17/src/web/Home/programLogLabels.ts) | `kernel:rules:rejudge-backup` / `-backup-fail` / `-rejected` / `-run` 四条中文标题 + `rules:rejudgePreview` / `rules:rejudgeRun` 通道说明 | 「有动作就有日志」＋日志页要能用人话看懂这次删了多少、为什么被拒 |

## 3. 实测基线（真实账本，2026-11-02 10:03 UTC+08:00 回放）

```
只读回放器 · 质量门 v2 · 2026-11-02 10:03:15 (UTC+08:00)
账本：C:\Users\LHQ\AppData\Roaming\MultiAgent Memory\memories.db.json

总行数 1642 · 墓碑行 0 · 缺 L1 正文 0 · 按行版本戳 v1:1642
重判后放行 1585 · 拦下 57 · 其中受保护 0 · 本次可删 57
拦截码分布：narration 36 · thin 17 · identity 3 · capability_list 1
按原 layer：L1 57
```

- 这 **57** 是「库里到底有多少噪声」的当前准确答案，比批次35 报告里「旧口径漏网 22 条」的估计更完整（22 只数了助手自述/清单/旁白三类，`thin` 那 17 条短寒暄/纯符号/裸数字当时没进那个口径）。
- 样本条目（回放器 `--code narration` 可直接定位）：`我先看一下当前目录情况和开发环境（SolidWorks 版本、.NET 环境等）。`、`Shell 能用了（有个临时文件报错是噪音）。目录是空的…`、`输出捕获有点问题，我换用 Read 工具直接读取 D:\tmp 下的版本文件。`、`项目骨架完成。现在写 Core 转换引擎。`——都是助手过程旁白，用户确认属于该拦的形态。
- **可删 57 但当前一行未删**：真实账本的删除只能由管理员在应用内亲手执行（见 §4）。本批次我没有对真实账本做任何写操作。

## 4. 手动验证步骤（装完后照做）

**准备**：安装并启动新版（数据根 `%APPDATA%\MultiAgent Memory`），用内置管理员 `admin` 登录。

1. **只读回放（命令行，不碰数据）**
   - 在项目目录执行 `npm run rejudge`。
   - 预期：打印上面 §3 的数字，末行是「本次只读，未写任何文件」。
   - 加 `--code narration` 只看旁白样本、`--json` 给脚本用、`--file <路径>` 指定别的账本回放。
   - 复核没写盘：`git status` 之外，执行前后 `%APPDATA%\MultiAgent Memory\memories.db.json` 的修改时间不变。
2. **安全页预览（只读）**
   - 「账号与安全」页 → 「规则重判存量」卡（在批次35 的「记忆库清空重采」卡下方）。
   - 管理员进页即自动拉一次只读预览：门版本 `v2`、总行数、应删、受保护、需重盖戳、码分布 `narration 36 / thin 17 / identity 3 / capability_list 1`、最多 8 条样本 id。
   - 数字应与 §3 回放一致（同一份 `qualityGate` 规则）。
   - 非管理员账号登录：卡片只显示「需管理员」，**不发预览请求**。
3. **口令门禁**
   - 未输入 / 输入 `rejudge`（小写带空格也算，会 trim+大写归一）之外的内容 → 「执行重判」按钮禁用。
   - 逐字输入 `REJUDGE` → 按钮可用。
4. **执行重判（这一步会真删数据）**
   - 点执行 → 回执应含：`已删除 57`、`受保护跳过 0`、`缺 L1 跳过 0`、`重盖版本戳 1585`、`失败 0`、**备份目录绝对路径**、两类审计键（每行 `memory_op / rejudge_purge`、整轮 `security_change / rules_rejudge`）。
   - 回安全页刷新预览 → 应显示「无应删行」（幂等）。
   - 记忆库管理页复核：那 57 条样本 id 不再出现；`我先看一下当前目录情况…` 这类行搜不到。
   - 抽查一条**保留**的行：正文、层级、`version` 不变，只是行上多了 `quality_gate_v=2`（可用 `npm run rejudge` 再跑一次，此时「本次可删」应为 0，行戳分布变成 `v2:1585`）。
5. **日志验证**
   - 「日志记录页」顶部程序运行日志（人话视图）应出现：`记忆库重判前备份`、`规则重判存量执行`（含 purged/restamped 计数）；被拒绝时是 `规则重判被拒绝`；备份失败是 `规则重判备份失败`。
   - grep 原文：在数据根 `rg "\[kernel:rules:rejudge" actions.log`。
   - 内核审计：审计页按回执里的 `request_id`（`req_rejudge_…`）「查阅审计」应查到 `security_change/op=rules_rejudge` 一行。
6. **失败路径抽查（可选但建议）**
   - 把数据根 `backups` 所在盘临时只读不可行的话，改用另一管理员会话在备份前中断应用：卡片应显示真实失败原因且**不显示成功回执**。
   - 口令对但会话失效（登出后停留页面再点）：应得到拒绝提示，一行不删。

## 5. 已知边界 / 未完成（不留给用户猜）

- **36-D 未做**：用户提的「L0 与 L1–L6 拆成两个文件存储」是独立改造，本批次**没有动**存储文件布局，`memories.db.json` 仍是单文件混放。需要请单独批次确认。
- **真实账本当前未清洗**：批次35 的 `RESET` 没点过，批次36 的 `REJUDGE` 也没点过（都不该由我代点）。§3 的 57 条仍在库里。
- **重判不产生新 L0、不改 L1–L6 正文**：它不会把「助手侧结论」补回来。想要新结论只能靠 `write_memory` 或手动改写。
- **删除不可逆**：唯一退路是回执里的备份目录；`pinned`/`locked` 行与缺 L1 行一律保留（后者属批次24/28-C 的遗留账本清理职责）。
- **预览与执行之间若有新写入，数字会有差**：卡片每次执行前重拉预览，仍以执行时点为准。
- **回放器依赖 Node ≥ 24**（直接 `import()` `.ts`）；纯浏览器模式（`npm run dev`）没有主进程 IPC，卡片如实显示不可用并指路命令行。
- **质量门仍是启发式**：判定顺序是「空 → `thin`（有效字符 < 10）→ 噪声模式 → 元信息」，所以短寒暄/纯符号先撞上 `thin` 码而不是 `greeting`/`separator`。本轮实测：`好的`、`好的好的好的好的`、`哈哈哈哈哈哈哈哈` 全部是 `thin`；`greeting`/`separator` 两个码在实测样本里没出现过（保留码位，以免下次版本改口径时码表漂移）。已知漏网：≥10 字的重复寒暄如 `你好呀！你好呀！谢谢啦！谢谢啦！`、`嗨嗨嗨，你好呀你好呀你好呀` **当前会放行**，纯分隔符串 `-------- separator separator` 也因带英文词放行——这类形态真实账本里几乎没有（回放 57 条中无此形态），要收紧就是下一版规则 + 版本号 +1 + 正反例，本批次不改判定口径。其余已知漏网（如「collect 幂等通过…」「A5 全绿。标记任务完成。」，因带硬事实/指令语气）取向是**宁可放过不可错杀**。
- **本批次未提交、未推送**：批次35 + 批次36 的全部改动都还在工作区（`git status` 可见），提交与推送等用户明确指示。
- 与批次35 相同的用户侧待办（本批次无关但仍在）：数据根里 `zhipu` 的 `baseURL` 仍是 `https://open.bigmodel.cn/api/v1`（正确预设 `https://open.bigmodel.cn/api/paas/v4`）；`deepseek`/`openrouter` 未配密钥；L0 管理密码仍未初始化；DSH 用的 MCP 令牌尚未轮换。

## 6. 测试

| 套件 | 规模 | 覆盖点 |
|---|---|---|
| `src/core/memagent/__tests__/qualityGate.test.ts` | 34 → **37 例** | 稳定码表（`empty/bare_number/bare_link/comment_only/import_only/bare_json/meta_question/narration/identity` 逐条断言真实码）、`unspecified` 兜底、放行分支不带码、`filteredAuditDetail` 的 `filter_code`+`gate_version` |
| `src/core/memagent/__tests__/rejudge.test.ts`（**新**） | **11 例** | 预览不改数据不写审计 / 缺 `quality_gate_v` 归因 v1 / 缺 `content_l1` 退回正文 / 删行 + 摘向量 + 双份审计 / 放行只盖戳且 `version` 不变 / `pinned`+`locked` 保留 / 缺 L1 保留 / 缺管理员拒绝 / 缺备份拒绝且零审计 / 单行失败回显 `failed_ids` / 幂等且预览数字 = 回执 / `filter` 只作用指定项目 |
| `src/web/security/__tests__/RulesRejudgeCard.test.tsx`（**新**） | **9 例** | 浏览器环境诚实不可用并指路 `npm run rejudge` / 非管理员不预览 / 真值回显含码分布与「受保护」 / `REJUDGE` 口令门禁（小写也断言逐字传给主进程） / 回执含备份路径与两类审计键 / 备份失败原样显示且无成功回执 / 干净态无按钮 / 只剩盖戳仍可执行 / IPC 抛错不装干净 |
| 全量 | **130 文件 / 1476 用例全绿**（批次35 后 128/1441 → 新增 `rejudge.test.ts` + `RulesRejudgeCard.test.tsx`） | `npm run verify` 全绿，含 Playwright 94/94 |
| 真机 E2E / 主进程 IPC | **未做** | `rules:rejudge*` 两个 handler 跑在 `main.ts`，不在 vitest 覆盖内；`e2e/` 是纯浏览器规格跑不到桌面壳。**必须按 §4 手测**，特别是第 4 步（真删）与第 5 步（日志） |
