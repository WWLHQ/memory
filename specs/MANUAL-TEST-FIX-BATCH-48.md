# 手动测试报告 · 批次 48：Agent 接入页模板 1:1 复刻 STRATUM pg-agent

> 日期：2026-11-21 ｜ 前序：S0 壳层 + 批次46 首页 + 批次47 写入页 STRATUM 复刻（已交付运行）
> 设计真源：`stratum-a-full.html` pg-agent 视图段（仓库对齐基准 `specs/STRATUM-设计系统规格.md`）
> 用户要求同前两页：逐页 1:1 复刻（视觉+格式+符号+配色+**页面格式模板**），不残留上版任何东西；数据全接真实账本，演示数字不落。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/web/AgentOnboard/theme.css` | 整文件重写：STRATUM 令牌内嵌 `.aob-page`（亮 `#F3F5F8/#0088CC/--r:10px`、暗 `#060B16/#22D3EE`）；af 基元子集（head/btn/pri/danger/sm/alert+tag/panel/ph/pb/note/row/g3/badge/pill/kv/table+num/scrollx/field/input/select/textarea/formgrid/switch/check/steps/step+cur+pend/det+det-b/pre/li/empty/toast）；三步条 `.pend` 未到步灰圈数字变体（诚实化新增，设计稿只有全完成态）；`found/sw/dim/test` 保留为布局辅助类并按 af 度量重定义；**p0-*、card/btn/pill/metrics/stages/errbox/found-card 旧版式类清零** |
| `src/web/AgentOnboard/AgentOnboardPage.tsx` | 重建成设计稿单页模板：`af-head`（h1 Agent 接入 + sub「登录即自动接入 · 三路真扫 · 状态由内核账本重建（sync_scope=local-only）」+ 右侧 🔍 手动检测 / 撤销并重接）→ 失败 af-alert warn → 一键接入流水线 af-panel（设计稿三步制：扫描/绑定/拨测，note 全部实算实读，hint `trigger={login|manual|discover|未触发} · sid 记账去重 · 本轮已完成|进行中|待触发`）→ 扫描明细 → Agent 卡区 af-g3 → mcp-wire-summary note → MCP 客户端面板 → 网页版对话接入。**p0-pagehead、4 页签（p0-tabs/agent-tab-N/agent-panel-N）、接入概览表、探针结果表全部移除**——设计稿无 tab 无汇总表，逐 Agent 指标由卡片 af-kv 承载；探针回执（rid/证据）保留在卡片测试面板 |
| `src/web/AgentOnboard/AgentCard.tsx` | 设计稿 af-panel 卡：af-ph（h3 卡名 + af-badge 状态：CONNECTED ok / ⚠ 降级 warn / 半开探测中 warn / 熔断中 bad / 未配置 默认）+ af-kv 四行（成功率实算 `%（p/t）` 或「未取数 · 无有效样本」、平均延时实算 ms/s、密钥脱敏尾 `data-mask` + 宽限/上次、最近拨测 `HH:mm · ok|fail` 或 OPEN 时改「熔断原因」）+ metric 注记（审计来源 + 租户）+ af-det「接入配置」（MCP 工具/隔离/通道/密钥/测试面板五子组件原样内嵌）+ af-row 操作钮（测试/轮换密钥/保存配置/吊销——吊销仅当发现名单有对应行才渲染，诚实化）；真降级 af-alert warn、R4 违规 af-alert bad |
| `src/web/AgentOnboard/McpClientsPanel.tsx` | 设计稿 af-panel + **af-table 六列**（客户端 b+transport/live/run 徽标、配置文件 num mono、状态短徽标（完整语义在 title 与详情折叠）、身份头 ✓id/缺失/—、建议 guideFor 全文、操作 af-btn sm 组）；告警们（browser/scan-error/admin-gate/live-failed）→ af-alert 变体；七态总览 af-note；长内容（触发规则/foundUrl/note/error/手动打开提示/片段 pre）→ 行下第二个 `<tr colSpan=6>` 内 af-det 展开；表尾 af-note 设计稿原文（备份 .bak- 留 3 份/冲突拒绝覆盖/令牌不进日志）+ 原安全说明收进 af-note；**全部数据-testid 与交互逻辑（wireAll/toStdioAll/copySnippet/wire/toStdio/enableSwitch/12s 轮询/循环检测/mcp-scanned-at/mcp-server-live）原样保留**，只换壳 |
| `src/web/AgentOnboard/OneClickOnboard.tsx` | 设计稿 af-panel「扫描明细」：af-ph + af-row（⚡ 自动发现/🔍 手动检测/FormBadge/af-pill scanState）+ autoOnboardBadge（af-pill + ↻ 撤销并重接）+ af-det「扫描明细」（信号源 af-check/发现行/已安装行/原理 note）；FoundCard 统一外壳（af-badge 徽标映射 p0→acc/p1→ok/p2→warn/p3→默认 + found-head/found-meta）；**四段进度动画条删除**（容器层三步流水线承接进度语义），data-testid（manual-detect/btnDiscover/autoOnboardBadge/btnRebindAll/scanState/installed-agents/found/data-unbind）全保留 |
| 五个子组件 + FormBadge | McpToolConfig/IsolationConfig/ChannelConfig/KeyMgmt 行 `.row`→`af-row`、checkbox 加 `af-switch`（真开关样式）、pill→`af-badge`（对账/SHA-256 幂等/密钥脱敏/轮换宽限/超90天 warn）；FormBadge pill→`af-badge ok|warn`；data-tool/data-iso/data-chan/data-mask/formBadge 全保留 |
| `src/web/AgentOnboard/WebChatExportCard.tsx` | 只换壳：card→af-panel + af-ph（标题/hint）+ af-pb，btn→af-btn（pri/danger），确认输入框加 af-input；功能与 testid 全保留（用户 2026-11-16 新增需求不动） |
| 测试 4 文件 | `AgentOnboardPage.test.tsx`（16 处断言）：页签/四段进度/概览探针表断言改单页契约（无 p0-tabs、`#pipeline-steps .af-step` 三步、`#cards > .af-panel`、pipeline-hint trigger、af-kv 四行指标、statusdot→徽标文案）；`AgentCard.test.tsx`（9 处）：徽标/af-kv/af-badge.warn/tenant 注记契约；`McpClientsPanel.test.tsx`（6 处）：`.found`→`tr[data-client]`、状态短徽标文案、af-alert warn、手动提示紧邻详情行；`components.test.tsx`（3 处）：进度条迁移说明、found-head 新选择器 |
| `specs/code-map.md`、`specs/code-index.generated.md` | 同步本轮条目与符号索引 |

**诚实化边界（有意不抄设计稿的部分）**：设计稿演示值（98.2%（167/170）/ 320ms / ****9f2e / 命中 3 Agent / 上次扫描 15:38:44）一律不抄，全部实算实读（成功率来自 /audit 真实样本、延时来自探测耗时均值、密钥尾来自 key.mask、扫描时间来自真扫时间戳）；设计稿三步条只有全完成态，新增 `.pend` 未到步与 `trigger=未触发` 初始态如实承载未开始状态；`p0-*` 在 asar 中仍有命中属**其它未复刻页面**（home/audit 等）的正常残留，接入页自身 chunk 已清零。

## 三道闸门证据

| 闸门 | 证据 |
|---|---|
| A · 影响面回归 | `npm run verify:fast` 全绿：typecheck 0 错、oxlint 0 error（2 条既有 warn 在壳层文件，非本轮）、`code-index:check` 最新（441 源码/155 文档）、check-no-demo 0 命中（4 处「—」冒充读数已改「未取数 · 原因」）、vitest 全量 **319 文件 / 4030 例全绿**；覆盖率 Statements 81.9% / Branches 73.89% / Functions 78.59% / Lines 85.17% |
| B · 效果验证 | AgentOnboard 定向 **164 例全绿**（11 文件）：三步流水线 done/cur/pend、pipeline-hint trigger 口径、af-kv 四行实算（50%（1/2）/200ms/熔断原因）、徽标五态、R4/R2 拦截、吊销后徽标回未配置、MCP 六列表 tr[data-client] 计数、状态短徽标、手动提示紧邻详情行、found-head 同构——断言打到真实渲染 DOM，均为「真的变了」型 |
| C · 变异验证 | 把 `badgeOf` 的熔断判定 `a.circuit === 'OPEN'` 临时改成 `'XOPEN'` → `AgentCard.test.tsx` 熔断 OPEN 用例**精确判红**（1 失败 / 11 绿）；原样还原 → 12 例复绿 |

## 产物与运行态

| 项 | 值 |
|---|---|
| 安装包 | `release\installer\MultiAgent Memory-0.1.0-setup.exe`（123.3MB，2026-11-21 13:27） |
| SHA256 | `2438DAEFBB3733C2ECBA18D678666191DDD3182EA1A5331AB2F21C5786B3703E` |
| package.json | `git diff` 为空（未被 electron-builder 污染） |
| main.cjs | `app.asar.unpacked\dist-electron\main.cjs` 与 `dist-electron\main.cjs` SHA256 逐字节一致 |
| 产物标记 | `app.asar`（UTF-8 明文）：`aob-page` ×5 / `pipeline-steps` ×1 / `af-g3` ×4 / `agent-kv-` ×1 命中；接入页旧标记 `agent-panel-0` / `agent-tab-` **0 命中**（旧页签清零成立） |
| 关端核验 | 打包前 `MultiAgent Memory.exe` 进程 0、8200~8204 无 LISTENING |
| 启动 | `release\installer\win-unpacked\MultiAgent Memory.exe` 启动 → `D:\MultiAgent Memory\logs\main.log` `[2026-11-21T05:27:47.831Z] bootstrap:done`，8200/8201/8202/8203/8204 全部 LISTENING，进程 4 |
| 清扫 | 无本轮新增临时物（变异验证为内存内改写+还原，无落盘探针）；release 下 8 个历史 `installer-*` 被占用删不掉（已知边界，gitignored 不阻塞） |

## 手动验证步骤（用户实机）

1. 点侧栏「Agent 接入」：页头应为「Agent 接入」+ 灰色副行（登录即自动接入 · 三路真扫 · 状态由内核账本重建）；**没有 tab 栏**，右侧「🔍 手动检测」「撤销并重接」两钮。
2. 「一键接入流水线」：三步条（扫描/绑定/拨测），完成步绿圆 ✓、未到步灰圈数字；hint 为 `trigger=… · sid 记账去重 · 本轮已完成`；扫描 note 的「命中 N Agent / M 客户端」为真扫实值。
3. Agent 卡区（三列，≤900px 单列）：每卡为设计稿形态——卡名 + 状态徽标（CONNECTED 绿 / 降级黄 / 熔断中红 / 未配置灰）+ 四行 kv（成功率/平均延时/密钥脱敏/最近拨测或熔断原因）+ 「接入配置」折叠（工具/隔离/通道/密钥/测试面板）+ 测试/轮换密钥/保存配置/吊销（仅发现名单有的卡）。
4. 「MCP 客户端接入状态」：右上 hint 带上次扫描时间（UTC+08:00）+ ⚡一键适配全部 / 刷新状态 / ⇄全改stdio；表格六列（客户端/配置文件/状态/身份头/建议/操作），每行有 transport（stdio 零维护/HTTP）与实测连通徽标；行下「详情」折叠展开触发规则/完整指引/配置片段。
5. 「扫描明细」折叠：信号源勾选、发现行（徽标+状态+撤销）、已安装行（+新增接入卡片）、原理 note。
6. 底部「自带插件导出（网页版对话接入）」卡保留原功能。
7. 亮/暗主题切换：纸灰 `#F3F5F8` / 深空 `#060B16`，海洋蓝 accent，与首页/写入页同套。

## 已知边界 / 未完成

- 设计稿卡内第四行 kv 为「最近拨测 15:38 · ok」，实现按熔断 OPEN 改显「熔断原因」（设计稿熔断卡同口径），CLOSED/HALF_OPEN 显示最近拨测。
- 概览/探针两张汇总表随页签移除（设计稿无此面板）：逐 Agent 指标由卡片 af-kv 承载、探针回执由卡内测试面板承载；若实测后觉得需要汇总视图，可后续在页尾补通栏表（不进本轮）。
- 逐页复刻推进中：下一页待用户指定。
