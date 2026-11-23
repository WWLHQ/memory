# STRATUM 设计系统规格（方案A · 层析）

> 设计真源：`D:\Work Folder\Agnet\Qoder\.qoder-cn\app\chat-session-visualizations\61703af4-3e41-4fe7-93ca-39b6b161bdd5\visualizations\stratum-a-full.html`（124KB · 1334 行 · 18 页演示稿）。
> 本文件是从该稿提取的**实现规格**（2026-11-21 用户拍板「程序全部 1:1 复刻」），实现以原稿为准，本文件是工作副本；原稿在仓库外不可提交，故此规格是仓库内的对齐基准，**取代** v5 稿（design-mockups/记忆工作台-界面重设计-v5.html）。

## 1. 令牌（亮 / 暗）

| 令牌 | 浅色 | 深色 |
|---|---|---|
| `--bg` | `#F3F5F8` | `#060B16` |
| `--surface` | `#FFFFFF` | `#0C1424` |
| `--surface2` | `#EDF1F6` | `#101B30` |
| `--ink` | `#0B1526` | `#E4EDF8` |
| `--muted` | `#5A6B82` | `#8296B0` |
| `--line` | `#DCE4EE` | `#1B2A45` |
| `--accent` | `#0088CC` | `#22D3EE` |
| `--accent-ink` | `#FFFFFF` | `#04222B` |
| `--accent-soft` | `rgba(0,136,204,.10)` | `rgba(34,211,238,.12)` |
| `--glow` | `rgba(0,136,204,.35)` | `rgba(34,211,238,.45)` |
| `--ok / --warn / --bad` | `#0E9F6E / #B45309 / #DC2626` | `#34D399 / #FBBF24 / #F87171` |
| `--ok-soft / --warn-soft / --bad-soft` | `rgba(14,159,110,.10) / rgba(180,83,9,.10) / rgba(220,38,38,.10)` | `rgba(52,211,153,.12) / rgba(251,191,36,.12) / rgba(248,113,113,.12)` |
| `--rail`（侧栏底） | `#0B1526`（亮暗两套同为墨蓝，亮色也是深侧栏） | `#04070F` |
| `--rail-ink` | `#8FA3BC` | `#8296B0` |
| `--rail-active` | `#22D3EE` | `#22D3EE` |
| `--rail-on` | `#FFFFFF` | `#E4EDF8` |
| `--rail-hover` | `rgba(255,255,255,.07)` | 同左 |
| `--rail-line` | `rgba(255,255,255,.08)` | 同左 |
| `--shadow` | `rgba(4,12,28,.18)` | `rgba(0,0,0,.5)` |
| `--c-l0…l6` | `#8FA3BC / #22D3EE / #38BDF8 / #818CF8 / #C084FC / #F472B6 / #FBBF24` | 亮暗同值 |

字体：`--sans: "PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif`；`--mono: ui-monospace,"Cascadia Mono","JetBrains Mono",Consolas,monospace`。基准 `13px/1.5`，数字一律 `.af-mono` + `font-variant-numeric:tabular-nums`。

圆角体系：容器/面板 `--r:10px`；按钮/步骤/命令框 8px；输入框/折叠块 7px；导航项 7px；徽章 4px；chip/pill 20px 全圆；外框整体 14px（外框仅演示卡，桌面壳不用）。

## 2. 壳层布局

- **标题栏 46px**：surface 底 + 底边 line。左：strata 徽标（6 根 2.5px 横条，宽度 60%→100%、透明度 .25→1、accent 色、间距 1.5px）+「MultiAgent Memory」600 加粗 + small「层析 STRATUM」11px muted；中：命令框 `flex:1;max-width:420px;margin:0 auto`（surface2 底、line 边、8px 圆角、⌕ 前缀、右侧 `<kbd>Ctrl K</kbd>` 1px 边 4px 圆角 11px mono）；右：浅色/深色/随系统三联主题切换（分体 label，选中项 accent 底 accent-ink 字）+「⚙ 首启向导」按钮 + 头像 24px 圆（accent 底白字）+「admin · 管理员」。
- **主体**：`grid-template-columns:196px 1fr`。
- **侧栏（深色 rail，亮暗主题都是深底）**：`padding:12px 10px`，flex column，gap 1px。分组标题 11px `letter-spacing:.14em`（工作台 / 记忆 / 连接 / 治理）`padding:11px 10px 4px`。导航项：`padding:6px 10px`、12px、圆角 7px、**左边 2px 透明边**（active 时变 rail-active 色 + rail-hover 底 + rail-on 字）；右侧计数 `.n` mono 11px 透明度 .65；图标用 emoji 原样复刻（🏠 ✍️ 🔍 📡 🗄 🧬 ♻️ 🌱 ⚖️ 🔌 🧠 🔄 ⚙️ 🛡 📜 🧾 💬）。侧栏底部图例 `margin-top:auto` 上边 rail-line：「层级刻度 · STRATA」+ 7 行（dot 7×7 圆角 2px + L0密文…L6索引 + cnt 右对齐透明度 .6）。
- **主区** `padding:18px 20px 30px`；页面栈 `.af-stack gap:14px`。

## 3. 组件基元（af- 前缀 1:1 对应实现）

- `af-head`：h1 18px/600 + `.sub` 12px muted + `.right`（margin-left:auto 按钮）。
- `af-btn`：默认 = surface 底 line 边 8px 圆角 `padding:6px 13px` 12px/500，hover 边+字变 accent；`.pri` = accent 底 600；`.danger` = bad 字+边；`.sm` = `3px 9px` 11px 6px 圆角；`.off` 透明度 .45。
- `af-alert`：accent-soft 底 accent 边 10px 圆角 `padding:8px 13px` 12px；`.warn/.bad` 变体；左侧 `.tag` mono 11px accent 底白字 4px 圆角。
- `af-panel`：surface 底 line 边 10px 圆角；头 `af-ph`（`10px 14px` 底边线，h3 13px/600，`.hint` mono 11px muted 右侧）；体 `af-pb`（`12px 14px`）。
- `af-chip`：mono 11px 胶囊 20px 圆角 line 边；`.on` = accent 边+字+soft 底。
- `af-badge`：11px mono 4px 圆角 `1px 7px` line 边；变体 ok/warn/bad/acc（字边底三件套同色系）。
- `af-table`：12px；th 11px/500 muted、surface2 底、`7px 9px`、底边线；td `7px 9px` 底边线；`.num` mono tabular；`tr.sel` accent-soft 底。
- `af-pager`：mono 11px muted `9px 14px` 上边线；页码 `.pgb` 1px 边 5px 圆角，`.on` accent。
- `af-stat`：`.k` 11px muted 两端对齐；`.v` mono 24px/600 `-0.02em`，`em` 12px muted；`.d` 11px ok/mut；`af-spark` 34px 折线 SVG。
- `af-prog/af-bar`：6px 高 3px 圆角，多段 `<i>` 并排；`af-prog-lb` mono 11px 两端。
- `af-list/af-li`：`7px 14px` 行 + 上边线分隔；`.st` 7px 圆点；`.nm` 500；`.ds` 11px muted；`.rt` mono 11px 右侧。
- `af-kv`：`grid auto 1fr`，dt 11px muted、dd mono 11px break-all。
- `af-det`：1px 边 7px 圆角 details/summary，summary `7px 10px` 12px/500。
- `af-pre`：mono 12px surface2 底 line 边 7px 圆角 `10px 12px` pre-wrap；`af-diff` del=bad-soft 底 bad 字，ins=ok-soft 底 ok 字。
- `af-steps/af-step`：横排等分，surface2 底 line 边 8px 圆角 `9px 12px`，`.no` 22px 圆（完成=ok 底白字，当前步=accent 底 + accent-soft 卡底 accent 边）。
- `af-tl` 时间线：左 2px 线 margin-left 14px，`.tm` mono 11px 宽 52px；`.err` 左边 bad、`.wrn` 左边 warn。
- `af-logwin`：196px 固定高滚动，surface2 底 mono 11px，级别色 `.lv.i`=accent `.w`=warn `.e`=bad。
- `af-pill`：mono 11px accent 字+边+soft 底 20px 圆角。
- `af-input/af-select/af-textarea`：surface2 底 line 边 7px 圆角 12px 字 `6px 10px`，focus outline 1px accent；`af-field` 11px muted 标签列布局 gap 4px；`af-switch` 34×19 圆角 10px、checked accent 底、knob 15px surface；`af-formgrid` 两列 12px gap。
- `af-empty`：`22px 14px` 居中 12px muted；`af-note` 11px muted；`af-red` bad 11px/500；`af-link` accent 500。

## 4. 18 页清单与现有页面映射

| # | 设计页 | 版式要点 | 现有页面 |
|---|---|---|---|
| 1 | 首页 总览工作台 | g4 统计卡（Token节省 62.4% / 效率+41% / 复用 23次 / 成本¥0.86）+ cols(1fr/316px)：左=关系图谱 SVG（径向 accent 渐变核 + 椭圆轨道 + L1–L6 节点圈 21px + strata-row 六格条）+异常速览+最近审计；右=Token spark + 补炼队列进度 + MCP 接入列表 + 引擎延迟排行 + 今日概览；页脚 af-foot 端口状态行 | overview.html |
| 2 | Agent 接入 | 步骤条三步（扫描/绑定/拨测）+ g3 Agent 卡（badge ok/warn/bad + kv + 操作钮）+ MCP 客户端状态表 | agentonboard.html |
| 3 | 记忆库管理 | 筛选行 + 主表 11 列（访问强化/合并谱系两列 display:none 并入右侧详情抽屉）+ 行详情抽屉 300px（kv + L1 可编辑 textarea + 保存 version+1）+ 分页 | memory.html |
| 4 | 记忆层级管理 | L6→L0 七层各一面板（标题色=--c-lN + 行数 badge + hint 口径 + 小表 + pager）+ 右侧「当前行各层内容」details 折叠栈 | memory-layered.html |
| 5 | 生命周期 | 行状态勾选表 + 六态状态机 chip 链 + 右侧衰减参数（range 90 天 / 阈值 / 新鲜度 bar） | lifecycle.html |
| 6 | 净化生长 | g2：五维查重条形（semantic/keyword/entity/structure/llm_judge + Σ 综合分 alert）+ 短路嫁接步骤条；g3：生长指标 kv / 自生长收益 stat / 红线自检 R1-R5 | growth.html |
| 7 | 冲突裁决 | 待裁决队列表 + 双栏 diff 对比（af-pre + del/ins）+ 四联裁决按钮组（自动覆盖/人工确认/合并/挂起）+ 裁决历史表 | dispute.html |
| 8 | 全局参数 | g2 常规配置（range+formgrid+switch）/ 记忆库管理（kv 路径 + 备份）；LLM 引擎表（switch+测试连通+顺序 badge）；补炼队列 g4 统计 + 限额 chip 行 | params.html |
| 9 | 监控告警 | 筛选行（级别/1h·24h·7d chip/Agent 下拉）+ 六格 stat + 告警时间线 af-tl | monitor.html |
| 10 | 用户反馈 | cols：提交反馈表单（memory_id 下拉/user_id 只读/confirm·reject·disputed chip/星级★/原因 textarea）+ 反馈统计（三段 prog + 星级分布条形 + Top 反馈列表） | feedback.html |
| 11 | 账号与安全 | g2 当前账号/密码策略 + g2 L0 管理/L0 恢复 + 危险操作区（bad 边框三卡：REJUDGE/RESET/REBUILD 逐字口令）+ 成员与密钥（af-empty 真实空表）+ 最近安全审计表 | security.html |
| 12 | 检索 | 搜索行 + 模式 chip 组（hybrid/semantic/keyword/bm25/graph/recency）+ critical alert + cols：结果列表（score badge + 展开链接）/命中上下文 af-pre/审计轨迹 rid + 右侧 Token 预算（payload % + 三段 prog + 漏斗条形 + 裁剪明细 pre） | retrieval.html |
| 13 | 日志记录 | logwin 196px 人话/原文 chip 切换 + 筛选行 + 异常聚合 bad alert + 动作日志表 + L0 查阅授权行 | logs.html |
| 14 | 大模型配置 | g2 向量模型 kv/反代理面板 + 四用途路由表（write/judge/rerank/growth 双 switch）+ 计费与余额表（provenance badge）+ 最近拨测表 | models.html |
| 15 | 写入 | cols：写入表单（内容 textarea 88px/类别/来源 Agent/session_id·project_id 只读/标签联想 pill）+ E_L0_LOCKED warn alert + 就地解锁卡（warn 边框）+ 回执待生成卡；右侧查重预览（词面相似度 stat+bar）；最近写入表 | write.html |
| 16 | 审计日志 | 筛选行（动作/操作者/rid/时间范围）+ 全量表 9 列（min-width:1020px 横滚）+ pager 归档注记 + 导出 CSV/JSON | audit.html |
| 17 | 首启向导 | 三步步骤条 + 步骤①两库位置（路径输入+选择目录）/②L0 管理密码/③恢复卡 af-pre + 三 ✓ 进应用 | setup.html |
| 18 | 同步中枢 | g2 立即同步（红线 badge + pushed/pulled stat）/中枢对账 kv + 裁决队列表 + 形态 alert | sync.html |

壳内不在 18 页稿里的现有页面：login.html、assistant.html、index.html、workspace 壳、taskpane（悬浮窗）、webonboard.html——沿用同一令牌体系自适配，不单独出稿。

## 5. 实现要点约束

1. 侧栏恒为深色 rail（浅色主题下也是 `--rail:#0B1526` 深底），是本设计最大视觉特征；现有壳层浅色主题的浅侧栏要改。
2. 标题栏 46px（现 36px），中央命令框 + 右侧三联主题切换是新元素；「⚙ 首启向导」入口直达 setup。
3. 侧栏分组顺序：工作台（首页/写入/检索/监控）→ 记忆（记忆库/层级管理/生命周期/净化生长/冲突裁决）→ 连接（Agent 接入/大模型配置/同步中枢）→ 治理（全局参数/账号与安全/日志记录/审计日志/用户反馈）+ 底部 STRATA 图例。导航计数（.n）：记忆库 1467、冲突裁决 3、Agent 接入 3——真实数据接入。
4. 所有数字/ID/时间用 mono + tabular-nums；徽章/chip/tag 是三档不同形制，不可混用。
5. 表格 th 必须 surface2 底；面板头 .hint 右对齐 mono 11px。
6. 图标=emoji 原样，不换 SVG 图标库（1:1 要求）。
7. 主题三档（浅/深/随系统）：现壳 html[data-theme] 二态 + 需补「随系统」跟随 prefers-color-scheme。
8. 演示稿数据均为演示值，实现必须接真实账本数据（诚实化纪律），版式/配色/文案口径 1:1。
