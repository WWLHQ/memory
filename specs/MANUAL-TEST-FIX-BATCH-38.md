# 批次38 手动测试报告 · §4.4.6 旧数据迁移拆成独立卡片（+ 批次35/36/37 实机执行台账校正）

日期（UTC+08:00）：2026-11-02
分支：`main`，HEAD 仍是 `3a4080a`（**批次35、36、37、38 的改动全部未提交**，工作区 71 条改动；`git push` 需用户明确授权）
上一批次：批次37（`specs/MANUAL-TEST-FIX-BATCH-37.md`）

## 0. 交付物（实测值，非估算）

| 项 | 值 |
|---|---|
| 安装包 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 122,035,135 字节 = **116.38 MB** |
| SHA256 | `E1BD92B537CECD913199D941EFA03663B67641FE9827F17F8835453B1C1EFC9D` |
| 构建完成（UTC+08:00） | 2026-11-02 21:45:42 |
| `npm run verify:fast` | **退出码 0（全绿）**：typecheck → oxlint → 索引新鲜度 → vitest **144 文件 / 1633 例全过** |
| `npm run lint` | oxlint `0 warnings / 0 errors`（492 文件 / 123 规则 / 93ms） |
| `npm run code:index:check` | 代码索引已是最新（**302 个文件**） |
| `npm run test:coverage` | Statements 81.09%（10614/13088）/ Branches 73.25%（7594/10367）/ Functions 77.25%（2377/3077）/ Lines 84.19%（9236/10970） |
| `npm run test:e2e` | Playwright **106/106 通过（35.6s）**（本批没改 E2E 覆盖的页面，跑一遍确认没回归） |
| 本批新增/改动测试 | `src/web/security/__tests__/L0MigrateCard.test.tsx` **8 例（新文件）** + `SecurityPage.test.tsx` 增至 **10 例**（新加「迁移表单不在 `l0-admin-card` 里」的归属断言） |
| 变异验证 | 把 `L0MigrateCard` 的禁用条件从 `busy \|\| writeUnlocked !== true` 改成只剩 `busy` → **8 例中 3 例失败**（未解锁 / 状态读不到 / 点刷新才放行），确认这三条门禁不是空断言；验完**已还原**（`npx tsc --noEmit` 与全量门禁均在还原后跑的） |
| 旧包清理 | `release/installer` 被外部进程占用（EPERM），本次产物先落 `release\installer-20261102-134521`，构建成功后按批次21 兜底**改用复制+删除**收口；日志原文：`[package] release/installer 被外部进程占用（EPERM），本次输出改到 release\installer-20261102-134521` → `[package] 旧 release/installer 删除失败（EPERM），继续尝试收口` → `[package] 目录重命名被占用（EPERM），已改用复制+删除：release\installer` → `[package] 已删除旧 release/installer，并把本次产物收口到固定目录` |

## 1. 这一批解决什么（用户原话）

> 「**旧数据迁移请单独拆出一个卡片**，点击迁移旧数据后显示：扫描 1642 · 明文迁移 0 · v1 迁移 0 · 待处理 0 · 跳过 1642 · 备份 `C:\Users\LHQ\AppData\Roaming\MultiAgent Memory\backups\l0-migrate-2026-11-02T13-03-23-744Z`」

它此前是「L0 密钥环管理卡」最底下的一段表单，和上方「设置管理密码 / 轮换 / 写密钥 / 申请审批 / 发放撤销」挤在一张卡里，既不显眼也不符合「批量动作卡各一张」的既有编排（拆分卡、重判卡、清空卡、重建卡都是独立卡）。

**改动清单（外科手术式，只动 4 个文件 + 2 个测试文件）**

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `src/web/security/L0MigrateCard.tsx` | **新文件**（独立卡） | 用户要求单独成卡 |
| `src/web/security/L0AdminCard.tsx` | 删掉内嵌的 `旧数据迁移（§4.4.6）` 整段（`l0-migrate-form` / `l0-mig-report` / `doMigrate` / 三个 `mig*` state / 两个 import），并把只读态提示改成「旧数据迁移见下方独立卡」 | 避免同一能力两处出现（迁移按钮出现两次必然有人点错） |
| `src/web/security/SecurityPage.tsx` | import + 挂在 `L0SplitCard` **之后**、`L0RecoveryCard` 之前 | 顺序即分工：**先换封法（本卡）、后换地方（37-C 拆分卡）** |
| `src/web/security/__tests__/L0MigrateCard.test.tsx` | **新文件** 8 例 | AGENTS §7.6「新能力至少覆盖正常/拒绝/边界」 |
| `src/web/security/__tests__/SecurityPage.test.tsx` | +1 例归属断言（迁移表单不在管理卡里） | 拆卡最容易出的错是「两处都有」或「两处都没有」 |
| `AGENTS.md` / `specs/code-map.md` / `specs/需求规格书.md` | §3 新增一行、§4.4.6 补入口段、批次38 小节与诚实边界、卡片计数「四张 L0 卡」→「五张」、测试计数 143/1624 → 144/1633 | AGENTS §8：索引过期视为功能未完成 |

**顺带修好的一处真实痛点**（上一轮排查「输入 SPLIT 后按钮不可点」时发现的同类问题）：本卡原来只在挂载时拉一次 `l0:status`，所以在**上方管理卡解锁写密钥之后**，本卡按钮仍是灰的、必须刷新整页。现新增独立的「刷新写密钥状态」按钮，点一下即重判并放行（`L0MigrateCard.test.tsx` 第 8 例专门钉这条）。

## 2. 本机当前真实状态（决定「实机第一步会看到什么」，全部命令行实测 2026-11-02 21:4x）

```
数据根：C:\Users\LHQ\AppData\Roaming\MultiAgent Memory
指针 data-root.json：setupDone = true · ledgerDir 与 l0Dir 同一个目录（两个库仍是两个文件）
记忆库 memories.db.json：1585 行
  · has_l0 = 1584（另有 1 行本来就没有 L0 原文）
  · 行上明文 content_orig = 0 · 行上信封 content_l0_enc = 0（信封在批次37-A 的「写入即搬」下已全部进 L0 库）
  · quality_gate_v 分布 = { "2": 1585 }（批次36 重判后全部重盖版本戳）
L0 原库 memories.l0.json：1584 条 / 9,979,455 字节 = 9.52 MB（0600）
密钥环 l0-keyring.json：v=2 · admin_wrap 有 · recovery 有（顶层字段名是 recovery，不是 recovery_wrap）· grants 0 · requests 0
```

## 3. 实机执行台账（本批最重要的校正：批次37 文档里「一行未搬」已被实机推翻）

取自内核 `security_change` / `memory_op` 与数据根 `actions.log`，时间一律 UTC+08:00：

| 时刻 | 事件 | 回执关键字段（计数，无正文） |
|---|---|---|
| 11-01 17:06:59 | `l0_admin_setup`（批次37 之前的 `l0:setup`） | 密钥环先于拆库立着 → 所以本机向导第②步回显成「本机已设置 L0 管理密码」 |
| 11-02 20:36:48 | `l0_recovery_rotated`（首启向导发码） | 指纹 `4f433527`，`admin_user_id = setup:first-run` |
| 11-02 20:38:52 | `l0:recovery-exported`（原生另存为） | `L0恢复卡-4f433527.txt`，1179 字节 → 向导第③步真完成，`setupDone` 落盘 |
| 11-02 20:57:52 | **`l0_migrate` 第 1 次** | `scanned 1642 · migrated_orig 1641 · migrated_v1 0 · pending 0` → **1641 行明文全部封成 v2**，并经 37-A 的「写入即搬」进 `memories.l0.json` |
| 11-02 21:03:23 | **`l0_migrate` 第 2 次（用户截图那条）** | `scanned 1642 · migrated_orig 0 · v1 迁移 0 · pending 0 · 跳过 1642`，备份 `backups/l0-migrate-2026-11-02T13-03-23-744Z` → **幂等重跑无事可做**，正是设计要的样子 |
| 11-02 21:25:19 | `rules_rejudge`（批次36 存量重判真执行） | `total 1642 · purge 57 · restamped 1585 · skipped_protected 0 · by_code {narration 36, thin 17, identity 3, capability_list 1}` → **与批次36 `npm run rejudge` 只读回放的预测逐字一致**，每行 `memory_op/op=rejudge_purge` 共 57 条 |
| — | `l0_split` 审计 **0 条** | `l0:splitRun`（逐字 `SPLIT`）**从未真机执行**——迁移已把存量搬完，拆分卡预览如实显示「已拆好 1641 · 本轮搬入 0」，用户看到的「本轮没有要搬的」是正确状态，不是故障 |

**仍未真机执行的两项（要用户亲手点）**：`REBUILD`（按 L0 重建 L1–L6，安全页最后一张卡）与 `RESET`（记忆库清空重采）。

**顺带纠正我自己两次错误读数（写进文档免得下次再犯）**：① 密钥环字段是 `recovery`，我先前按 `recovery_wrap` 取值读成了「没有恢复码」，是假阴性；② 上一轮我说「库里 1642 行、1641 条信封」是 21:03 之前的状态，21:25 重判后已是 **1585 行 / 1584 条**——所以本批实机点迁移卡，回执会显示 **`扫描 1585 · 跳过 1585`**，不再是截图里的 1642，**这是行数变化不是卡片出错**。

## 4. 管理员手动测试步骤（唯一验收路径，逐步可核对）

1. 安装 `release/installer/MultiAgent Memory-0.1.0-setup.exe`（SHA256 见 §0），启动 → 因 `setupDone=true` 应**直接进主界面**（不再弹首启向导）。
2. 用 `admin` 登录 → 账号与安全页。**五张 L0 卡从上到下**应为：`L0 密钥环（§4.4）` → `L0 存量拆分迁移` → **`L0 旧数据迁移（§4.4.6：把行上的明文 / 遗留 v1 信封换成正宗 v2 封法）`** → `L0 恢复卡` → `按 L0 重建 L1–L6`。
3. 确认迁移卡**不在**密钥环管理卡里面（管理卡底部到「撤销授权表格 / 暂无授权记录」就结束了）。
4. 未解锁写密钥时：按钮「迁移旧数据」应为**灰的**，同行红字「需先解锁写密钥（迁移要重新加密）」；鼠标悬停按钮 title=「请先解锁写密钥」。
5. 在上方管理卡输入管理密码点「解锁写密钥」→ 回到迁移卡点**「刷新写密钥状态」**→ 红字消失、按钮可点（**不必刷新整页**，这是本批修的点）。
6. 点「迁移旧数据」（旧 v1 密码框留空，本机没有遗留 v1）→ 期望逐字回显：
   - 提示行：`迁移跑完了：报告如下（迁移前内核已自动备份数据根）`
   - 报告行：`扫描 1585 · 明文迁移 0 · v1 迁移 0 · 待处理 0 · 跳过 1585 · 备份 C:\Users\LHQ\AppData\Roaming\MultiAgent Memory\backups\l0-migrate-<UTC时间戳>`
   - 灰字：`本轮无事可做：行上已没有明文，也没有遗留 v1 信封`
7. 打开数据根 `backups\l0-migrate-<本次时间戳>\`，应看到**三类**文件（批次37-D 双库备份）：`memories-*.json`、`meml0-*.json`、`l0key-*.json`。只有第一类 = 备份不完整，请回报。
8. 日志记录页（人话视图）应出现本次的 `l0:migrate` 与 `l0:status`；切「原文」视图可按 `l0-migrate` grep 到备份目录。内核审计侧对应一条 `security_change/op=l0_migrate`（**只有计数与备份目录，没有正文、没有密码**）。
9. 红线抽查：在数据根执行 `rg -i "<你的管理密码>" actions.log main.log home-audit.json` 与 `rg -i "<恢复码前6位>" actions.log` → **都必须 0 命中**。
10. L0 库没被动过：`memories.l0.json` 条数仍是 **1584**（本轮无事可做，不该增减）。

## 5. 普通成员 / 未登录

- 迁移卡整张卡只剩一行说明：`需管理员权限：重加密与迁移前备份都是管理员动作。`（`l0-migrate-need-admin`），**不渲染密码框与按钮**，也不去拉 `l0:status`。
- 真实拦截仍在主进程：`l0:migrate` 走 `requireAdmin`，页面禁用只是防误点。

## 6. 纯浏览器模式（`npm run dev`）

无主进程 → 本卡 `coreL0Status()` 拿不到密钥环，按「未确认」处理：按钮禁用并写明「需先解锁写密钥（迁移要重新加密）——本机读不到密钥环状态，刷新后再试」。**绝不用页面内存对象冒充迁移成功**（`L0MigrateCard.test.tsx` 第 3 例覆盖）。

## 7. 已知边界（本批与遗留）

1. **本批只动渲染层卡片编排**：`l0:migrate` 的内核实现、备份前置、审计字段一个没改，所以行为与批次37 完全一致。
2. **迁移与拆分是两种活**：本卡换封法（明文/v1 → v2），37-C 拆分卡换地方存（信封 → `memories.l0.json`）。顺序**先本卡后拆分**；本机已两者皆完成（迁移真跑、拆分因无事可做而未点 SPLIT）。
3. **L2–L6 全库仍为空**（1585 行全是 L1、`refined_by` 全 `stub`），根因已实测定位：① 采集器写库时**根本没往 `coreWrite` 传 `llm`/`llmModel`**（`src/electron/main.ts:2385` 附近），所以采集来的行永远只落 L1；② MCP 两条服务（TCP 8202 `mcp.ts:68`、HTTP 8204 `mcpHttp.ts:117`）**显式钉死 `FakeLlmProvider`**（你这次的口径是：MCP HTTP 写入只落 L0，脱敏后才产出 L1——即这条维持 stub 是对的）；③ 历史那 987 行假 L2–L6 早被批次24/28-C 自动降级清回 L1（审计 `legacy_layer_demote` 两次：987 + 1）。**精炼器重设计尚未开始，等 §8 拍板。**
4. **引擎侧现在配置是好的**（不是上次批次34 的全关状态）：`llm-config.json` 实测 `ollama / zhipu / openrouter / custom_agnes-2.5-flash / custom_agnes-3.0-flash` 五个 `enabled=true` 且有成功拨测延时（352 / 2497 / 2058 / 475 / 1608 ms），`llm-keys.json` 里 `zhipu、openrouter、两个 custom` 有密钥；`deepseek` 未启用且无密钥。所以目前**只有应用内手动写入与安全页「按 L0 重建 + 勾选 LLM 重炼」两条路真能产出 L2–L6**。
5. **`REBUILD` / `RESET` 仍未真机执行**，需管理员在应用内逐字口令亲手点，维护者不代做。
6. **批次35–38 全部改动未提交**（HEAD `3a4080a`，工作区 71 条）；`git push` 需明确授权。
7. **DSH 的 MCP 令牌仍待轮换**（AGENTS §9 老遗留）；`~/.qoder-cn/settings.json` 里的 `MultiAgent Memory` 条目令牌当前与数据根 `mcp-token.txt` 一致（本轮实测 `true`，未打印令牌本体）。
8. Qoder 侧 `multiagent_memory` MCP 本会话未挂载：App 内该连接器状态为 `failed / connectivity / MCP_REMOTE_CONNECTION_REFUSED`（配置与令牌都对，8204 服务端实测 `initialize` 返回 200 且工具含 `recall_memory`），已 `retry` → 状态转 `ready`，**新会话即可用**（本会话工具表已固化，仍看不到）。

## 8. 待你拍板（精炼器重设计，本批未动一行代码）

| # | 决策点 | 选项 |
|---|---|---|
| A | 采集器要不要接精炼 | ① 写入即炼（同步，本机 7B 实测单次 ~28s/层，写 5 层≈2 分钟/条，1585 条不现实）② **写入只落 L0+L1，后台异步队列炼 L2–L6（推荐）** ③ 采集器永不炼，只给「批量补炼」按钮 |
| B | 存量 1585 行（全 L1）怎么处理 | ① 全量补炼（云端引擎 5 层 × 1585 次调用，真花钱/耗时）② 只补炼新写入 ③ 按 category / 时间窗抽样补炼 ④ 不动，等 `REBUILD` 时一起炼 |
| C | 队列状态放哪、崩了怎么办 | 落数据根 `refine-queue.json`（重启续跑、可看进度）/ 纯内存（重启即丢，靠幂等重跑） |
| D | 失败与成本控制 | 单条最多试几个引擎、每日调用上限与费用上限、`refined_by=llm_partial` 是否再自动重试 |
