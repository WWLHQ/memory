# 工作台中心区 · 逐页差距清单（第 1 步）

- 基准：`UI-Design-Proposals/final-01-workspace.html`（v8-01 定稿，唯一视觉与信息架构基准）
- 实测：dev server `http://127.0.0.1:5180/workspace.html` + Chromium 1280×800，真实登录（`user_001`，本地后端 8211）后逐视图截图
- 取证目录：`release/gap-audit/`（定稿 `design-<slug>.jpg`，当前 `current-<slug>.jpg`，结构摘要 `summary.json`、`design-structure.json`）
- 结论：**18/18 个中心视图尚未对齐定稿；0 页已一致。其中 17 页仍是 iframe 旧页，1 页（个人记忆）是壳层诚实空态**。壳层（Ribbon/导航树/标签条/检查器/底部五标签/状态栏）与定稿一致，问题集中在中心区。

## 总览计数

| 类别 | 数量 | 视图 |
|---|---|---|
| 完全不一致 | 4 | 概览、个人记忆、L0、Agent 接入 |
| 部分不一致（信息块对应，差密度/组件/标签体系） | 14 | 记忆管理（全部）、分层 L1–L6、冲突裁决、写入、检索、审计与日志、生长、模型与成本、监控、同步、参数、安全与账号、生命周期、首启设置 |
| 已一致 | 0 | — |
| 仍是旧 iframe 页 | 17 | 除「个人记忆」外全部 |
| 另需新建 | 1 | 登录页（D7 新增约束：常规桌面登录页） |
| 全局待处理 | 1 | Electron 默认英文菜单栏（`File/Edit/View/Window`） |

## 逐页差距

| 视图 | 定稿应有结构（块级） | 当前实际渲染 | 差距等级 | 真实数据链路 | 截图（定稿 / 当前） |
|---|---|---|---|---|---|
| 概览 | 标题「概览 — 意图工作台 · mem-prod-cn」；四标签（意图概览/指标明细/待处理/空账本预览）；意图问答条 + 4 张追问卡；14 行指标表（指标/当前值/趋势/对比/更新时间/数据来源/状态）；右侧真相栏 5 条 | 旧 `index.html`：登录后「你好，user_001」+ emoji 大统计卡（累计记忆 2910 / 累计动作 22419 / 近 1h 18 / 待裁决 0）、效果证据、L1–L6 图谱；无四标签/指标表/意图问答 | 完全不一致 | 有：`/api/home/feed`、`/api/health`、`/api/me`；壳层概览条另走 `loadOverview` | `design-overview.jpg` / `current-overview.jpg` |
| 记忆管理（全部） | 记忆管理工作台六标签；9 列紧凑表（ID/摘要/层级/状态/重要性/访问/最近更新/成本来源/同步）、16 行；工具条（新建/归档/锁定/导出/查找）；右侧真相栏 | 旧 `memory.html`：「🗂️ 记忆库管理页」；真实 2910 条、13 列大表 + 类型/状态/来源筛选 + 分页；无六标签与真相栏 | 部分不一致（只差密度与组件） | 有：内核 `listMemories/getMemory/putMemory/deleteMemory` + 审计 | `design-ledger-all.jpg` / `current-ledger-all.jpg` |
| 个人记忆 | 记忆管理「个人记忆」标签：时间筛选 + 最近确认列表 + 来源统计 + 收件箱（待上行/待确认） | 壳层独立空态：「个人记忆 · 不可用 / 程序暂无个人记忆数据模型」，无计数无回执 | 完全不一致（内容按 D2 诚实，但未落在记忆管理工作台标签框架内） | 无（程序暂无数据模型，按 D2 不造数） | `design-ledger-personal.jpg` / `current-ledger-personal.jpg` |
| 分层 L1–L6 | 记忆管理「分层」标签：6 行层策略表（层/规模/策略/时效/策略键/状态）；层级工具（压缩预览/批量归档/查看参数/解锁 L0）；样本列表 + 真相栏 | 旧 `memory-layered.html`：L6–L1 各层大卡片 + 每层独立筛选/分页，真实 2910 条；无统一层策略表/标签条/真相栏 | 部分不一致 | 有：`listMemories` + `l0:status/blobs` | `design-ledger-layers.jpg` / `current-ledger-layers.jpg` |
| L0 | 记忆管理「L0 密文（需解锁）」标签：沿用 9 列表格 + L0 过滤；锁定不显示条数；解锁在工具条 | 同一旧分层页锚点 `#l0bar`：L0 授权/密码卡 + 下方全部层卡片，不是记忆管理表格视图 | 完全不一致 | 有：`l0:status/unlock/blobs/grants`（桌面端） | `design-ledger-l0.jpg` / `current-ledger-l0.jpg` |
| 冲突裁决 | 标题「冲突裁决 · C-118」；待裁列表（C-118…C-137）+ 本端/镜像对比卡 + 四模式（auto_override/user_confirm/merge/hold）+ 确认裁决；底部记忆表与真相栏 | 旧 `dispute.html`：真实空态「当前账本无待裁决冲突」，无列表/裁决卡骨架，emoji 标题 | 部分不一致（诚实空态在，缺定稿结构） | 有：`listMemories(conflict_id)` + `conflict_resolve` 审计 | `design-ledger-conflict.jpg` / `current-ledger-conflict.jpg` |
| 写入 | 「写入 — ma.write」；三标签（写入表单/最近回执/查重与 L0 规则）；回执表 9 列；工具条；真相栏 | 旧 `write.html`：表单 + 查重 + 回执区；字段能力在，但无三标签/9 列回执表/真相栏 | 部分不一致 | 有：`ma.write` → 内核 `putMemory` + 审计 | `design-write.jpg` / `current-write.jpg` |
| 检索 | 三标签（检索工作台/历史查询/预算与注入规则）；10 行历史表 + 过滤/导出工具；真相栏 | 旧 `retrieval.html`：查询表单（场景/模式/层级）；无三标签、历史表与预算规则区 | 部分不一致 | 有：`ma.read` / 召回引擎 + `recall` 审计 | `design-retrieval.jpg` / `current-retrieval.jpg` |
| 审计与日志 | 四标签（审计事件/登录授权/L0 访问/程序日志）；8 列 12 行表；导出/筛选/原始日志；真相栏 | 旧 `audit.html`：单页表格（REQUEST_ID/PAYLOAD 等 8 列）+ 筛选；无四标签，列名与密度不同 | 部分不一致 | 有：`queryAudit` + `appendAudit`（22419 条真实） | `design-audit.jpg` / `current-audit.jpg` |
| 生长 | 四标签（判重与嫁接/回归评估/调度/红线自检）；9 列 8 行回归批次表；工具条；真相栏 | 旧 `growth.html`：五维判重 + 指标/Δ/调度真实实算；无四标签与回归批次表；部分「未测量」诚实态 | 部分不一致 | 有：`queryAudit(write/graft)` + `listMemories` | `design-growth.jpg` / `current-growth.jpg` |
| 模型与成本 | 三标签（引擎/计费/反向代理）；厂商/模型/余额/来源/采样/接口/计费表；空态来自网关 | 旧 `models.html`：向量模型 + 四用途 LLM 表 + 反代理映射；单页卡片，无三标签/计费表；余额诚实空 | 部分不一致 | 有：本地配置 + 后端探测；余额按会话鉴权（未配置时诚实空） | `design-cost.jpg` / `current-cost.jpg` |
| 监控 | 两标签（指标卡/告警时间线）；14 项分 5 组卡片；级别/时间窗/Agent 过滤；跳转动作 | 旧 `monitor.html`：已覆盖 14 项指标卡（5 组）+ 告警时间线 + 同款过滤；无两标签条，卡片密度旧 | 部分不一致（最接近定稿） | 有：`queryAudit(monitor_alert)` + `listMemories` | `design-monitor.jpg` / `current-monitor.jpg` |
| 同步 | 四标签（同步与对账/冲突裁决/通道与游标/L0 排除）；8 列通道表 + 立即同步/只看冲突/导出差异；真相栏 | 旧 `sync.html`：单页「立即同步 / 中枢对账视图 / 9.7 冲突队列」；无四标签与通道表 | 部分不一致 | 部分：PgSyncHub 通道接口；本版本无云端同步 → 空态诚实 | `design-sync.jpg` / `current-sync.jpg` |
| 参数 | 三标签（核心参数/存储备份/作用域）；7 列 19 行参数表 + 重新加载/恢复默认/导出；真相栏 | 旧 `params.html`：文案化表单卡 + 知识库策略只读表；无三标签/参数表/作用域列 | 部分不一致 | 有：内核 preference 快照 + `param_save` 审计 | `design-params.jpg` / `current-params.jpg` |
| 安全与账号 | 四标签（检查摘要/危险操作卡/账号与密钥/L0 审计）；6 列 9 行检查表 + 体检/解锁工具；真相栏 | 旧 `security.html`：管理员账号/密码策略/加密状态/L0 密钥环 3 张表；能力覆盖多，但无四标签与检查摘要表 | 部分不一致 | 有：`/api/login`、`/api/home-policy`、L0 密钥环 IPC | `design-security.jpg` / `current-security.jpg` |
| Agent 接入 | 四标签（接入概览/MCP 客户端/探针结果/接入配置）；7 列 6 行通道表 + 运行探针/新增通道；真相栏（真实 200/401） | 旧 `agentonboard.html`「可交互原型」：大黑卡式一键接入 + 自动发现 + 卡片全集；无四标签与通道表 | 完全不一致 | 有：`agentOnboard` 接口 + 宿主扫描（仅桌面端；浏览器如实不可用） | `design-agent.jpg` / `current-agent.jpg` |
| 生命周期 | 三标签（六状态/批量迁移/衰减阈值）；7 列状态表 + 批量迁移/压缩预览；真相栏 | 旧 `lifecycle.html`：六态表（5 列）+ 选中行迁移 + 调参面板，真实 2910 条；无三标签与 7 列口径 | 部分不一致 | 有：`listMemories` + `ma._memoryOp`（`lifecycle_change` 审计） | `design-lifecycle.jpg` / `current-lifecycle.jpg` |
| 首启设置 | 三标签（①存储/②模型/③安全）+ 步骤表 + 开始引导/恢复码 | 旧 `setup.html`；浏览器态只显示「请打开桌面应用完成首启设置」；桌面端旧向导尚未 Electron 截图核对 | 部分不一致（待桌面端复核） | 有：`setup:state / setup:finish` + 数据目录/备份 IPC（桌面端） | `design-setup.jpg` / `current-setup.jpg` |

## 本轮新增范围（已确认，未实现）

| 项 | 目标 | 当前 | 差距 | 链路 |
|---|---|---|---|---|
| 登录页（D7） | 常规桌面登录页：应用标识、账号、密码、登录按钮；401 / 密码错 / 后端不可达分别如实提示；记住会话；真实 `/api/login`；未登录时壳层显示真实未登录态，其余视图按程序能力禁用或只读；不照搬定稿演示模态、无「演示登录」入口 | 壳层无自己的登录页；概览 iframe 内是旧登录卡/模态 | 完全不一致（需新建） | 有：`/api/login` + `session:realpage` 持久化 |
| Electron 默认菜单栏 | `Menu.setApplicationMenu(null)` 去掉英文 `File/Edit/View/Window`；复制/粘贴/全选、Ctrl+F、F5、Ctrl+K、F1/F9 由渲染层快捷键承担；不新增中文菜单；不顺手加 `devTools:false` | 默认菜单栏仍在窗口顶部 | 不一致 | Electron 主进程 `main.ts` 菜单设置 + 渲染层快捷键 |

## 残留点

- 全部 18 个中心视图均未对齐定稿，需按第 2 步逐页重做；未重做期间 iframe 页头必须标「未对齐定稿」。
- 首启设置的桌面端（Electron）实际渲染尚未截图核对，需在重做该页前补一次真机截图。
- 定稿原型内的个人记忆 9 条、分层样本 16 条、冲突 6 条等均为演示数据，按 D2/全站零演示口径**不得复用**；重做时只保留结构与诚实空态。
- 截图取证为 1280×800 浅色；第 2 步逐页验收需补 1024×768 与深色四组。
