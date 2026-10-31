# 手动测试报告 · 功能批次 9（L0 加密授权查阅 + L1–L6 逐层生成/查重/嫁接）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-131026/MultiAgent Memory-0.1.0-setup.exe`（121,946,052 B = 116.30 MiB）
- SHA256：`875c6f6e972ac3f303dd1aa3c94a488a0ff2d40a44d37e6d64b46769fc0b1363`
- 未打包目录：`release/installer-20261030-131026/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md` ～ `specs/MANUAL-TEST-FIX-BATCH-8.md`
- 通用手测入口：`specs/MANUAL-TEST.md`

> **本批次含内核数据格式变更**，覆盖安装前请先备份数据根（默认 `%APPDATA%\MultiAgent Memory`）：
> 1) L0 改为 v2 信封（`content_l0_enc`，JSON `{"v":2,"alg":"AES-256-GCM","iv","tag","ct"}`），`content_orig` 永不新写；
> 2) 新增 `l0-keyring.json`（仅存包裹后的 DEK，不存密码/DEK 明文）；
> 3) 新增嫁接字段 `graft_to` / `graft_layer` / `grafted_from`。
> 旧账本中的明文 `content_orig` 不会自动消失，需管理员在安全页执行「迁移旧数据」（迁移前自动备份）；未迁移条目的 L0 查阅显示为空，L1–L6 不受影响。

## 0. 本轮用户需求

1. 「L0 是落盘层不参与检索，只是对生成的 L1–L6 有异议后才查阅，从 L1 开始才入库，请重新更新逻辑。」
2. 「L0 层入库要加密，查阅需授权密码方可查阅；L1–L6 层每生成一层都要查重，有重复就嫁接不再生成下一层，如果没有就继续下一层，以此类推直到生成 L6。」
3. 「L0 是通过管理员授权指定账号指定密码来查阅的，指定账号凭指定密码查阅，查阅过程必须要连续，中途中断 5 分钟以上即锁定，如再次查阅需再次申请；请把我们讨论的结论同时也更新到需求文档。」

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 9-A 需求固化 | 新增/改写 §4.4.1–§4.4.8（L0 密钥层级、按账号一次性授权、连续会话、写密钥、G3、迁移、审计动作、落盘字段）；§2.1 L0→L1 质量门与脱敏；§2.2 逐层生成/查重/嫁接不变量；§6.1 逐层阈值；§6.2 分支嫁接；§16.1 各层规格；§19.10 审计动作封闭枚举登记 | `specs/需求规格书.md` |
| 9-B 规则单一真源 | 新增 `layerRules.ts`：`LAYER_ORDER`（L1–L6）、`LAYER_SPECS`（字数/必含/保留词/L6 keywords≤30）、`DEDUP_THRESHOLDS`（L1 0.70 / L2 0.75 / L3 0.80 / L4 0.85 / L5 0.90 / L6 0.90）、五维权重与无 LLM 归一化、`L0_POLICY`（v2 / 32B DEK / PBKDF2 100k / 5min / 60s / 5 次 / 15min）、`sanitizeL1`、`meaningfulLength`、`checkLayerSpec`；页面/测试不再各复制一套 | `src/core/memagent/layerRules.ts`、`qualityGate.ts`、`dedup.ts`、`crypto.ts` |
| 9-C 逐层生成与嫁接 | `coreWrite` 重写：L0→L1 质量门 → L0 先加密（无写密钥立即 `E_L0_LOCKED`，不落明文）→ L1 本地脱敏 → 逐层「生成 → 规格校验 → 该层查重」→ 命中阈值即新建记忆并分支嫁接、**停止生成下一层**；目标记忆只刷新 `grafted_from/confidence/version`，L1–L6 文本一字不改；无真实 LLM 只落 L1 且 `refined_by=stub`；写入审计含 `layer_decisions/spec_violations/graft_to/score/threshold` | `src/core/memagent/memories.ts`、`llm.ts`、`types.ts` |
| 9-D L0 密钥环 | 新增 `L0Vault`（800 行）：随机 32B DEK 只在主进程内存；管理密码 ≥8 位经 PBKDF2-SHA256(100k) 派生 KEK 包裹 DEK（`admin_wrap`）；按账号一次性授权（`grant_id + grantee + scope`，独立包裹同一 DEK）；解锁即消费并删除 wrapped DEK；连续会话 5 分钟空闲锁定、60s 心跳续期；启动/锁屏/休眠/退出清内存密钥并作废 active grant；5 次密码错误 → 锁定 15 分钟 + grant 作废；L0 解密全有或全无（任一失败整次 `E_AUTH_L0`）；迁移幂等、可重跑 | `src/core/memagent/l0vault.ts`、`src/home/server.ts` |
| 9-D 落盘 | `l0-keyring.json`（v2，原子写）只存包裹后的 DEK；`home-locks.json` 新增 `l0:<user_id>` 锁定项；`l0_session_id` 只存主进程内存（不落盘） | `src/electron/main.ts` |
| 9-E 端壳通道 | 18 个 L0 IPC：`status/setup/changePassword/requestAccess/listRequests/listGrants/grant/deny/revoke/unlock/heartbeat/lock/writeUnlock/writeLock/seal/decrypt/sessionInfo/migrate`；管理操作主进程 `requireAdmin` 强制；会话必须属于当前登录账号；启动即 `onAppRestart()` 作废上轮授权；30s `sweep` 兜底空闲回收；`powerMonitor` 锁屏/休眠清理；退出清理；迁移前备份 `memories.db.json` + `l0-keyring.json` 到 `backups/l0-migrate-<ts>/` | `src/electron/ipcChannels.ts`、`preload.ts`、`src/desktop/hostBridge.ts`、`src/electron/main.ts` |
| 9-E 页面接线 | 安全页新增 L0 管理卡（状态、首次设置/轮换管理密码、写密钥解锁/锁定、申请批准/拒绝、直接发放一次性授权、撤销、旧数据迁移报告）；日志页/记忆页新增连续查阅卡（管理员=管理密码；成员=grant_id + 一次性密码；倒计时/立即锁定/就地申请）；未登录时不显示任何密码输入（诚实门禁）；密码输入每次提交后清空 | `src/web/security/L0AdminCard.tsx`、`SecurityPage.tsx`、`src/web/logs/LogCards.tsx`、`src/web/memory/MemoryLayeredPage.tsx`、`src/web/shared/useL0Session.ts`、`l0Port.ts`、`src/web/kernel.ts` |
| 9-E 首页嫁接可视化 | 图谱新增 `graft` 边（橙色点线）与图例；节点抽屉显示「🌿 嫁接 · Lk」「嫁接至 <id>」「被嫁接 N 条」；底部统计「嫁接 N」；只画两端都在渲染集合内的嫁接边（不画悬空边） | `src/web/Home/layerGraph.ts`、`LayerGraphPanel.tsx`、`layerGraph.css` |
| 9-E 审计页 | 动作类型/中文标签/筛选补齐：`graft`、`memory_op`、`l0_view`、`l0_auth_fail`、`l0_auth_request`、`l0_auth_grant`、`l0_auth_deny`、`l0_auth_revoke`、`l0_auth_expire`、`security_change` | `src/web/audit/types.ts`、`logic.ts`、`FilterBar.tsx` |
| 测试 | 单测 100 文件 / 980 例（新增 `l0vault.test.ts`、质量门/逐层/嫁接/图谱嫁接/管理员 L0 卡/成员连续查阅等）；E2E 21 spec / 93 例按新语义更新（纯浏览器诚实降级、未登录不显示 L0 输入、写入 `E_L0_LOCKED`） | `src/core/memagent/__tests__/*`、`src/web/**/__tests__/*`、`e2e/*.spec.ts` |
| 文档 | `AGENTS.md` 已知边界补 L0 写密钥/连续会话；`specs/code-map.md`、`specs/MANUAL-TEST.md` 同步；`npm run code:index -- --write` 刷新符号索引 | `AGENTS.md`、`specs/*.md`、`specs/code-index.generated.md` |

### 关键设计（为什么这样实现）

- **L0 与检索彻底分离**：L0 是密文落盘层，不生成 embedding、不参与 recall/查重候选；L1 起才入库。语义向量永远从 L1 生成。
- **密钥分层**：DEK 随机生成且只在主进程内存；管理密码/授权密码只用于 PBKDF2 派生 KEK 包裹 DEK。落盘的只有 wrapped DEK，密码永不落盘。
- **写查分离**：写密钥缓存只暴露 `seal()`；查阅会话才持有 `viewDek`。锁写密钥不影响已解锁的查阅，反之亦然。
- **一次性授权**：成员解锁即消费 grant 并立刻删除 wrapped DEK；会话结束/中断/重启/锁屏都会作废授权，不存在“密码可复用”。
- **连续性兜底三层**：页面 1s 倒计时（失焦时不再心跳）→ 主进程 30s sweep → 启动/锁屏/休眠/退出钩子。任一环节断开都收敛到“锁定 + 授权作废 + 审计”。
- **嫁接不改目标**：新记忆保留自己的 L0/L1..Lk 并记录 `graft_to/graft_layer`；目标只累加 `grafted_from` 与置信度，原文一字不改，便于回查与回滚。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit`（strict） | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint，402 文件 / 123 规则） | **0 error / 0 warning** |
| 单元/集成测试 | `npm test` | **100 文件 / 980 用例全过** |
| 覆盖率 | `npm run test:coverage` | 语句 74.38%（6807/9151）、分支 65.36%（4415/6754）、函数 70.05%（1666/2378）、行 77.32%（5945/7688）；阈值 71/61/67/74，通过 |
| Web 构建 | `npx vite build` | 通过（19 个 HTML 入口；`main` 38.83 kB / gzip 13.54 kB，`kernel` 39.02 kB / gzip 14.83 kB，`security` 28.95 kB / gzip 8.40 kB） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功（仅存量 `import.meta` CJS 警告） |
| 真浏览器 E2E | `npm run test:e2e` | **21 spec / 93 用例全过（40.4s）** |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-131026/MultiAgent Memory-0.1.0-setup.exe` | 121,946,052 B = **116.30 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-131026/win-unpacked/` | `MultiAgent Memory.exe` 249,934,848 B，可直接运行 |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 被本机索引器占用（EPERM），打包脚本自动输出到时间戳目录，属预期；请使用上方 13:10:26 的安装包。

## 4. 手动测试用例（重点）

> 日志位置：`<数据根>\actions.log`（默认 `%APPDATA%\MultiAgent Memory\actions.log`）；账本：`memories.db.json`；密钥环：`l0-keyring.json`；登录/L0 锁定：`home-locks.json`。
> **红线**：任何日志/审计/URL 中都不得出现管理密码、授权密码、DEK、wrapped DEK 明文。

### 4.1 管理员初始化 L0 管理密码（首次）

1. 安装并启动，用 `admin` / `Admin@123456` 登录（首次登录后建议在安全页改默认密码）。
2. 打开「账号与安全」页，找到「🔐 L0 密钥环」卡：
   - 初始状态：`管理密码：未设置`、`写密钥：已锁定`、`活跃查阅会话 0`、`有效授权 0`；
   - 显示「首次初始化：设置管理密码（≥8 位）」。
3. 输入 7 位密码 → 提示「管理密码至少 8 位（§4.4.1）」；两次不一致 → 提示不一致。
4. 输入 ≥8 位密码两次 → 点「设置管理密码」：
   - 状态变为 `管理密码：已设置`、`写密钥：已解锁`（初始化会同时把写密钥放入内存）；
   - 提示「DEK 已生成并以管理密码包裹落盘」。
5. 打开数据根 `l0-keyring.json`：应为 `{"v":2,"admin_wrap":{"salt","iv","tag","ct"},"grants":[],"requests":[],"updated_at":...}`；**看不到密码或 DEK 明文**。
6. 轮换测试：旧密码 + 新密码 → 成功；再用旧密码「解锁写密钥」应报错；新密码可用。已加密数据无需重写（DEK 不变）。

### 4.2 写密钥与写入闭环（L0 加密落盘）

1. 安全页点「锁定写密钥」→ 状态 `写密钥：已锁定`；审计页出现 `security_change`（detail.op=`l0_write_lock`）。
2. 打开「写入」页，写入一条 ≥10 字、含敏感串的内容，例如：
   `部署失败：tcp://prod-db:5432/app 连接超时，api_key=sk-abcdefghijklmnop123456，联系人：张三，电话 13800138000`
3. 提交 → toast 显示 `E_L0_LOCKED`（写密钥未解锁），**无回执**、账本不新增；`memories.db.json` 中不得出现该明文。
4. 回安全页用管理密码「解锁写密钥」→ 再回写入页提交：
   - 出现写入回执（memory_id / 动作 / 精炼状态）；
   - 无 LLM 时显示「精炼 未精炼（未接入 LLM）」，只落 L1，`refined_by=stub`；
   - 回执 L1 展开可见脱敏结果：URL → `[服务地址已脱敏]`、API Key → 占位符、姓名/电话 → 占位符。
5. 打开 `memories.db.json` 检查该条记忆：
   - 有 `content_l0_enc`（JSON v2 信封），**没有** `content_orig`；
   - 在文件中 grep 原始 URL/`sk-`/手机号 → 无命中（L0 恒密文，L1 已脱敏）。
6. 打开「检索」页搜索原始敏感串 → **不应命中 L0**（L0 不参与检索）；搜索脱敏后的技术关键词可命中 L1。

### 4.3 L1 查重与分支嫁接（无需 LLM 也可验证）

1. 确认写密钥已解锁。
2. 写入第一条：`部署服务时数据库连接超时，需要把连接池从 10 调到 50 并重试三次，否则夜间批处理会失败。`
3. 写入第二条（与第一条高度相似）：`部署服务时数据库连接超时，把连接池从 10 调到 50 并重试三次，夜间批处理就不会失败。`
4. 预期第二条回执动作为 `graft`，提示「与既有记忆相似（sim=…），已新建并分支嫁接」；第二条记忆 `graft_to` 指向第一条、`graft_layer` 为命中的层（当前无 LLM 时为 L1）。
5. 第一条记忆的 `grafted_from` 增加第二条的 `mem_id`，其 L1 文本**保持原样**（一字不改）。
6. 审计页可查到 `write`（detail 带 `graft_to/graft_layer/score/threshold/layer_decisions`）与独立的 `graft` 动作。
7. 写一条完全无关的内容 → 动作为 `create`（未命中阈值），继续生成下一层（无 LLM 时仅 L1）。
8. 写一条无信息量内容（如 `。。。` / 少于 10 个有效字符）→ 动作 `filtered`，无回执 ID，审计 `write` 带质量门拦截原因，账本不新增。

### 4.4 非管理员申请 → 管理员发放 → 成员一次性解锁

1. 准备一个普通成员账号（首页注册，或用管理员在安全页创建）；退出 admin，用成员登录。
2. 打开「记忆页（L0–L6）」或「日志页」：
   - L0 授权区显示「已授权账号 · grant_id + 一次性密码」；
   - 无授权时出现「提交查阅申请」表单。
3. 成员填项目 ID（如 `P1`）+ 理由 → 提交 → 显示 `request_id`；审计页出现 `l0_auth_request`。
4. 管理员登录 → 安全页 L0 卡 → 「查阅申请」表出现该申请 → 点「批准」：
   - 显示 `grant_id` 与**一次性授权密码**（仅显示这一次，请立即保存/线下交付）；
   - `有效授权 +1`；审计页出现 `l0_auth_grant`。
   - 也可用「直接发放一次性授权」：填账号、范围（`P1` 或 `*`）、密码（留空=系统随机）→ 发放。
5. 成员页面输入 `grant_id` + 授权密码 → 解锁：
   - L0 原文从 `[L0 已加密 · 需授权]` 变为真实内容（脱敏前原文，按 scope 校验项目）；
   - 显示「已解锁 · 剩余 04:5x（空闲 5 分钟自动锁定）」；
   - 审计页出现 `l0_view`（grant_id / l0_session_id / project_id / mem_ids）。
6. 打开 `l0-keyring.json`：该 grant 状态 `consumed`，且 `wrap` 字段已删除（一次性消费）。
7. 同一成员再次用同一 `grant_id + 密码` 解锁 → 报「已过期/已使用/已撤销，请重新申请」；审计 `l0_auth_fail`（reason=`expired`）。
8. 换另一个账号使用该 `grant_id + 密码` → 报「该 L0 授权不属于当前账号」；审计 `l0_auth_fail`（reason=`wrong_user`），不返回任何明文。
9. 管理员在授权列表点「撤销」→ 状态 `revoked`、wrapped DEK 删除、审计 `l0_auth_revoke`；正在查阅的会话立即失效。

### 4.5 连续会话：5 分钟中断锁定

1. 成员（或管理员）解锁 L0，确认倒计时开始（`05:00` 起）。
2. **保持页面在前台且有焦点**：每隔 60s 心跳续期，倒计时回到 `05:00`（视为连续查阅，不锁定）。
3. **制造中断**：切到其他窗口/最小化/让页面失焦，静置 **> 5 分钟**：
   - 页面倒计时归零 → 自动锁定，L0 内容被清空，状态回到 `[L0 已加密 · 需授权]`；
   - 审计 `l0_auth_expire`（reason=`idle_5min`）；
   - `l0-keyring.json` 中该 grant 变为 `expired` 且 `wrap` 已删除；再次查阅必须重新申请。
4. 主动结束：解锁后点「立即锁定」→ 同上，审计 reason=`user_closed`，grant 立即作废。
5. 应用重启：解锁状态下完全退出并重开应用 → 启动时作废所有 active grant（审计 reason=`app_restart`），写密钥回到锁定态。
6. 锁屏/休眠：解锁后按 `Win+L` 锁屏再回来（或让系统睡眠再唤醒）→ L0 会话与写密钥都被清空；审计 reason=`screen_lock` / `suspend`；写入页此时提交应返回 `E_L0_LOCKED`。

### 4.6 5 次密码错误 → 15 分钟锁定 + 授权作废

1. 管理员：锁定写密钥后，连续 5 次输入错误管理密码：
   - 第 5 次后提示「密码错误次数过多，账号已锁定至 …」；
   - `home-locks.json` 出现 `l0:<user_id>`（fails=5、locked_until）；
   - 此时输入**正确**密码仍被拒绝（仍处于锁定窗口）；审计有 5 条 `l0_auth_fail`（reason=`bad_password`）。
2. 成员：用 grant 连续输错 5 次授权密码：
   - 账号锁定 15 分钟；
   - 该 grant 被系统作废：`l0-keyring.json` 状态 `revoked`、`wrap` 删除；审计 `l0_auth_revoke`（reason=`bad_password_5`）；
   - 即使之后输入正确密码也不能再用，需管理员重新发放。
3. 复测提示：等待 15 分钟自然解锁，或使用**独立测试数据根**复测（不要手改生产数据）。

### 4.7 旧数据迁移（有旧账本时）

1. 使用旧版本产生的数据根（含 `content_orig` 明文，或 v1 信封）。
2. 安全页 L0 卡：未解锁写密钥时「迁移旧数据」按钮禁用，并提示「需先解锁写密钥」。
3. 解锁写密钥 → 点「迁移旧数据」：
   - 显示报告「扫描 N · 明文迁移 X · v1 迁移 Y · 待处理 Z · 跳过 S」；
   - 显示自动备份目录 `backups/l0-migrate-<ts>/`（含 `memories.db.json` 与 `l0-keyring.json`）；
   - 审计 `security_change`（detail.op=`l0_migrate`）。
4. 检查 `memories.db.json`：被迁移条目的 `content_orig` 已清空，`content_l0_enc` 为 v2 信封。
5. v1 条目如需旧密码：输入错误旧密码 → `待处理 > 0` 并显式告警「请提供正确的旧密码后重试」；输入正确后重跑 → 待处理归零（迁移幂等）。
6. 迁移后再用管理员管理密码查阅 L0 → 能看到迁移后的原文；直接 grep 账本文件不再出现旧明文。

### 4.8 首页嫁接可视化

1. 按 4.3 产生一对真实嫁接记忆。
2. 回首页 → 图谱卡片「刷新」：
   - 新记忆节点与目标节点之间出现**橙色点线嫁接边**；图例出现「嫁接」；底部统计「嫁接 1」。
   - 点新记忆节点：抽屉显示「🌿 嫁接 · L1」「嫁接至 · <目标 mem_id>」。
   - 点目标节点：抽屉显示「被嫁接 · 1 条新记忆」。
3. 无嫁接数据时：不显示嫁接边、图例与统计（不得伪造）。

### 4.9 审计与日志

1. 审计页筛选器应能分别筛出：`graft`（层级嫁接）、`memory_op`（记忆操作）、`l0_view`（L0 查阅）、`l0_auth_*`（申请/发放/拒绝/撤销/过期/失败）、`security_change`（安全变更）。
2. 抽查一条 `l0_view` → 用其 `request_id` 回查 `l0_auth_grant`；抽查 `l0_auth_fail` → 明细只有原因/次数/账号，**无密码**。
3. 打开 `<数据根>\actions.log`，grep `l0` / `security`：
   - 能看到 `[ipc:l0:*]` 调用记录、`[kernel:l0:migrate-backup]`、`bootstrap:l0-vault-ready`；
   - 日志中不出现管理密码/授权密码/DEK。

### 4.10 门禁与回归

1. 未登录打开安全页：L0 卡显示「需管理员权限…」，无设置/写密钥/发放控件；日志页/记忆页 L0 区显示「未登录（登录后生效）」，无密码输入框。
2. 普通成员打开安全页：同样只有「需管理员权限」提示；成员仍可在日志/记忆页提交查阅申请。
3. 首页登录门控、四卡指标、图谱缩放/筛选/搜索/刷新保持原行为；记忆页 L1–L6 浏览/编辑、写入页查重卡、日志页筛选正常。
4. 覆盖安装后旧账本可打开；未迁移的旧 L0 明文不会泄露到页面（显示空/遮罩），L1–L6 及图谱正常。

## 5. 已知限制（不应作为缺陷）

- **纯浏览器模式无法写入**：`npm run dev` 或静态 E2E 没有 Electron 主进程，无法解锁写密钥 → 写入返回 `E_L0_LOCKED`，不落明文；这是批次 9 的预期诚实降级。
- **未接入真实 LLM 时只有 L1**：`refined_by=stub`，L2–L6 不生成；逐层规格/阈值/嫁接停止逻辑已固化并有单测，接入 LLM Provider 后才可在界面验证 L2–L6 与深层嫁接。
- **旧明文 L0 不自动迁移**：需管理员在安全页手动执行迁移（迁移前自动备份）；未迁移条目的 L0 查阅为空，但不会报错或泄露。
- **一次性授权不可复用**：解锁即消费并删除 wrapped DEK；再次查阅必须重新申请、管理员重新发放。
- **“连续”的判定**：L0 面板可见且窗口有焦点时每 60s 心跳续期（视为持续查阅）；切走/最小化/失焦超过 5 分钟、锁屏、休眠、退出应用都会锁定并作废授权。前台长时间无鼠标操作不会自动锁定（按需求“连续查阅”语义）。
- **管理密码不可找回**：DEK 无后门；若管理密码与所有授权均丢失，只能删除 `l0-keyring.json` 重新初始化，历史 L0 密文将永久不可解（L1–L6 不受影响）。
- **迁移依赖桌面主进程存储**：纯浏览器下迁移显式 `E_NOT_IMPLEMENTED`；迁移的 v1 旧密码只用于本次解密，不落盘、不进日志。
- **图谱限制沿用批次 8**：只读视图、节点上限 120、嫁接边只画两端都在渲染集合内的关系；冷/休眠/归档记忆仍按 G3 遮罩。
- `sync()` 仍未接线：显式返回 `E_NOT_IMPLEMENTED`，页面标注「未实现」。
