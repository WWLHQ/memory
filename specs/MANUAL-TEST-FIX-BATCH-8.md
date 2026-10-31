---
status: done
---

# 手动测试报告 · 功能批次 8（首页 L1–L6 关系图谱）

- 日期：2026-10-30
- 分支：main（未提交）
- 正式安装包：`release/installer-20261030-083753/MultiAgent Memory-0.1.0-setup.exe`（121,930,758 B = 116.28 MiB）
- SHA256：`0445e5f6f9aba2be4d7e87c7702b61bf134dacf7139e19d8572498c08897911e`
- 未打包目录：`release/installer-20261030-083753/win-unpacked/MultiAgent Memory.exe`（249,934,848 B）
- 关联报告：`specs/MANUAL-TEST-FIX-BATCH-1.md` ～ `specs/MANUAL-TEST-FIX-BATCH-7.md`
- 通用手测入口：`specs/MANUAL-TEST.md`（§3.1 已加入图谱用例）

> 本批次只新增首页可视化与只读派生数据，**不修改内核数据格式/存储结构**，可直接覆盖安装；既有账本（`memories.db.json`）原样沿用。

## 0. 本轮用户需求

「首页增加 L1–L6 关系图谱图，类似 Obsidian 关系图谱，怎么好看怎么高端怎么来，要符合人机工程。」（附 Obsidian 网络图谱参考图）

## 1. 本轮改了什么

| 项 | 内容 | 主要文件 |
| --- | --- | --- |
| 8-A 图数据模型 | 从真实内核 `Memory` 派生图：六个层 hub（L1 清洗脱敏 / L2 会话摘要 / L3 得失分析 / L4 模式归纳 / L5 洞察提炼 / L6 投影索引）、记忆卫星节点、成员边（记忆→其有内容的层）、合并边（`merged_from` / `merged_into` 双向去重）、冲突边（同 `conflict_id` 且在渲染集合内）；按 `conflict > pinned > importance > 时间` 排序，默认最多 120 节点并如实统计 `truncated`。**G3 隐私**：cold/dormant 只输出「冷记忆 · 尾号」、archived 只输出「归档记忆 · 尾号」，`contents` 置空，任何层原文都不进入图数据 | `src/web/Home/layerGraph.ts` |
| 8-A 确定性布局 | 纯函数布局：中央「记忆账本」核 + 六层轨道（黄金角分布）+ 层内卫星（黄金比螺旋），坐标确定、重复渲染不抖动；含 spokes（核心→层）与边端点坐标 | `src/web/Home/layerGraphLayout.ts` |
| 8-B 交互面板 | 深色点阵 SVG 画布（渐变辉光、层 hub 光环、节点按 category 着色、标签描边防压线）；层筛选（chip + 点 hub）、搜索（仅匹配可见标签，G3 节点不可按原文搜索）、`Ctrl/⌘+滚轮` 缩放（55%–240%，普通滚轮保留页面滚动）、拖拽平移、双击/按钮复位、悬停高亮邻居 + 提示、点击节点详情抽屉（L1–L6 分行展示 / 隐私占位）、右上刷新、底部真实统计（记忆/精炼/合并/冲突/遮罩/截断/筛选/命中） | `src/web/Home/LayerGraphPanel.tsx`、`layerGraph.css` |
| 8-C 首页接线 | `getHomeFeed` 返回值新增 `graph`（存储不可达时为空图，不伪造）；`main.tsx` 统一 `loadFeed`，登录成功与「刷新」都重取真实聚合；`HomePage → Dashboard` 透传；图谱仅在**已登录**仪表盘渲染（未登录门控不变） | `src/web/Home/coreHome.ts`、`src/web/main.tsx`、`HomePage.tsx`、`Dashboard.tsx` |
| 8-C 动作日志 | scope `home`：`graph_zoom`、`graph_pan`、`graph_reset_view`、`graph_filter_layer`、`graph_node_open`、`graph_search`（只记 `query_len` + `hits`，**不记搜索原文**）、`graph_search_clear`、`graph_refresh` / `graph_refresh_failed` | `src/web/Home/LayerGraphPanel.tsx` |
| 测试 | 新增 3 个单测文件共 35 例：图数据 15、布局 7、面板 13；`coreHome`/`Dashboard` 补图谱断言；E2E 首页新增 ⑦（真实空态 + 六 hub + 六层 chip + 缩放/复位 + 刷新） | `src/web/Home/__tests__/layerGraph.test.ts`、`layerGraphLayout.test.ts`、`LayerGraphPanel.test.tsx`、`coreHome.test.ts`、`Dashboard.test.tsx`、`e2e/home.spec.ts` |
| 文档 | `AGENTS.md`（任务→文件新增图谱行）、`specs/code-map.md`（批次 8 映射）、`specs/MANUAL-TEST.md`（§3.1 图谱手测）、测试计数同步（99 文件 / 941 例；E2E 21 spec / 93 例）、`npm run code:index -- --write` 刷新（252 个文件） | `AGENTS.md`、`specs/*.md`、`specs/code-index.generated.md` |

### 设计要点（为什么这样“高端且符合人机工程”）

- **信息层级**：中央核（总量）→ 六层 hub（层语义 + 真实条数）→ 记忆卫星（类别色 + 重要度半径），符合“先总后分”的阅读顺序。
- **不抖动**：布局纯确定，筛选/缩放/刷新不会导致节点乱跳，便于形成空间记忆。
- **低干扰**：默认只显示标签在节点右侧；悬停才放大邻居；搜索只做“压暗”不隐藏图层结构。
- **轮滚语义**：普通滚轮滚动页面，`Ctrl/⌘+滚轮` 才缩放画布（避免劫持页面滚动）。
- **诚实可视化**：无数据就是六个 hub + 空态文案；截断数量、遮罩数量都写在底部统计，不假装“全量”。

## 2. 自动化门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit`（strict） | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| 静态检查 | `npm run lint`（oxlint，393 文件 / 123 规则） | **0 error / 0 warning** |
| 单元/集成测试 | `npm test` | **99 文件 / 941 用例全过（12.44s）** |
| 覆盖率 | `npm run test:coverage` | 语句 75.01%（6150/8199）、分支 65.57%（4112/6271）、函数 71.70%（1531/2135）、行 78.20%（5365/6860）；阈值 71/61/67/74，通过 |
| Web 构建 | `npx vite build` | 通过（19 个 HTML 入口，`main` chunk 37.54 kB / gzip 13.29 kB） |
| Electron 构建 | `npm run build:electron` | `main.cjs` / `preload.cjs` 生成成功（仅存量 `import.meta` CJS 警告） |
| 真浏览器 E2E | `npm run test:e2e` | **21 spec / 93 用例全过（34.0s）**，含首页新增 ⑦ |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |

## 3. 打包产物

| 产物 | 路径 | 体积 / 校验 |
| --- | --- | --- |
| NSIS 安装包 | `release/installer-20261030-083753/MultiAgent Memory-0.1.0-setup.exe` | 121,930,758 B = **116.28 MiB**；SHA256 见文首 |
| 未打包目录 | `release/installer-20261030-083753/win-unpacked/` | `MultiAgent Memory.exe` 249,934,848 B，可直接运行 |
| 附加产物 | `latest.yml`、`setup.exe.blockmap`、`builder-debug.yml` | 同目录 |

`release/installer` 被本机索引器占用（EPERM），打包脚本自动输出到时间戳目录，属预期；请使用上方 08:37:53 的安装包。

## 4. 手动测试用例（重点）

> 日志位置：`<数据根>\actions.log`（默认 `%APPDATA%\MultiAgent Memory\actions.log`）。
> 图谱数据只来自真实内核账本；无数据时**不应**出现任何节点、边或示例数字。

### 4.1 入口与空态（真实账本）

1. 安装并启动，未登录时首页只显示登录门控——**不应**出现图谱卡片（图谱属于已登录仪表盘）。
2. 用 `admin` / `Admin@123456`（或自注册账号）登录。
3. 未写入任何记忆时观察四卡下方的「L1–L6 关系图谱」卡片：
   - 画布显示中央「记忆账本」核与六个层 hub（L1–L6 各自颜色 + 层名 + 计数 0）；
   - 覆盖层文案：**「内核账本暂无记忆」/「写入或采集后，L1–L6 关系图谱实时生成（无演示节点）」**；
   - 底部统计为 0，**不得**出现任何演示节点/边。

### 4.2 真实记忆 → 节点与层 hub

1. 打开「写入」页，写入 2–3 条记忆（建议不同类别/重要度），或通过 MCP / Webhook 写入。
2. 回到首页，点图谱卡片右上「刷新」。
3. **预期**：
   - 中央核显示「记忆账本 N 条」且 N 与四卡「累计记忆」一致；
   - 每条记忆出现一个卫星节点（颜色按 category；重要度高/置顶/冲突节点更大）；
   - 每条记忆都有一条边连到它有内容的层 hub；L1 层 hub 计数与实际含 L1 内容的记忆数一致；
   - 底部统计「记忆 / 精炼 / 合并 / 冲突 / 遮罩」与账本一致；节点超过 120 时显示「渲染 120 · 截断 X（按冲突/置顶/重要度）」。

### 4.3 六层筛选与搜索

1. 点 `L1` chip：只有含 L1 内容的记忆保持高亮，其余压暗；再点一次或点「全部」恢复。
2. 点某个层 hub（画布中的圆点 + 层名）：效果与点击对应 chip 相同。
3. 在搜索框输入某条记忆的可见标题/摘要关键词：
   - 命中节点保持高亮，非命中压暗；
   - 输入无意义字符串 → 显示「无匹配记忆」提示；
   - 冷/休眠/归档记忆不可按其原文搜索命中（G3）。

### 4.4 缩放 / 平移 / 复位（人机工程）

1. 点 `+` / `−`：缩放值在 55%–240% 之间变化（按钮到边界后禁用）。
2. 按住画布拖拽：整体平移（松手不误触节点选择）；`Ctrl/⌘ + 滚轮` 缩放；**普通滚轮应滚动页面**，不缩放画布。
3. 双击画布或点「复位」：缩放回 100%、平移归零。
4. 缩放/平移/筛选/刷新后节点位置稳定，不出现随机跳动。

### 4.5 节点详情抽屉（含 G3 隐私）

1. 点任一普通记忆节点：右侧抽屉显示名称、category、所属层、衰减档、置顶/锁定/冲突标记、L1–L6 分行内容、`mem_id`、合并来源/标签等（只读）。
2. 点画布空白处或抽屉关闭按钮 → 抽屉关闭。
3. **隐私验证**：若账本中存在 `cold / dormant / archived` 记忆：
   - 节点标签仅为「冷记忆 · 尾号」/「归档记忆 · 尾号」；
   - 抽屉顶部显示「仅 L2 占位符，展开原文需审计」，**不得**出现任何层原文；
   - 用该记忆原文关键词搜索不到它。
   - （可调短遗忘周期触发冷化/归档，或使用已有冷记忆账本验证。）

### 4.6 合并边 / 冲突边（有真实数据才出现）

1. 通过遗忘周期/净化生长页产生一次真实合并（或使用含 `merged_from` 的账本）：图谱应出现合并边（合并来源 ↔ 合并结果），同一条边不重复绘制。
2. 账本中存在同 `conflict_id` 的多条记忆时：这些节点之间出现冲突边，底部「冲突」计数 > 0；点击冲突节点抽屉显示冲突标记。
3. 无合并/冲突数据时：不显示此类边，对应统计为 0（属预期，不得伪造）。

### 4.7 动作日志（排查入口）

1. 依次做：缩放、拖拽、切层、点节点、搜索、清空搜索、刷新。
2. 打开 `<数据根>\actions.log`，grep `graph_`：
   - 应看到 `[info] [home:graph_zoom]`、`[home:graph_pan]`、`[home:graph_filter_layer]`、`[home:graph_node_open]`、`[home:graph_search]`、`[home:graph_search_clear]`、`[home:graph_refresh]`；
   - `graph_search` 明细只有 `query_len` 与 `hits`，**绝不出现搜索原文**；
   - 刷新失败（例如强制断开存储）应出现 `[error] [home:graph_refresh_failed]`，页面不回退到假数据。

### 4.8 回归

1. 未登录门控、登录/登出、四卡实时指标、异常速览 `.rid` 溯源均保持原行为。
2. 覆盖安装后旧账本仍可打开，图谱与四卡读同一份账本。
3. 首页在通览页 iframe 内同样渲染图谱（与顶层窗口共享同一账本）。

## 5. 已知限制（不应作为缺陷）

- **图谱仅在已登录仪表盘出现**：未登录时首页按原设计显示灰置门控。
- **L2–L6 依赖真实 LLM Provider**：当前未装配 Provider，写入审计为 `refined_by=stub`，记忆一般只有 L1 内容，因此图上通常只连 L1 hub；这是诚实展示，不是图谱缺陷。
- **节点上限 120**：超出按「冲突 > 置顶 > 重要度 > 时间」截断，底部明确标注截断数；不提供“全部展开”（避免桌面端卡顿）。
- **冲突边只连接当前渲染集合内的同冲突组节点**；被截断的冲突记忆不会画出悬空边。
- **图谱为只读视图**：不支持在图谱内编辑/删除记忆；编辑请走记忆页（审计成对）。
- 冷/休眠/归档记忆的全量原文仍只能经审计展开（G3），图谱不提供绕过入口。
