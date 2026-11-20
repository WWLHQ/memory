# 网页会话采集：无状态 ID 对账改造 · 详细执行方案

> 状态：**已确认，执行中**　日期：2026-11-20　决策来源：mem_01M7WEPWP0KVZ00Y9QJYR6HCWZ

## 0. 执行期技术调整（2026-11-20，实现前发现）

原 §5.3 第12点"按 URL 直接导航抽取"在本架构下不可行：deepseek 侧栏条目是虚拟列表的 div（体检证实"同类成组 213 / 语义条目 0"，无 href），且单页 SPA 整页导航会销毁 `executeJavaScript` 的脚本上下文。
**改为**：保留"点侧栏条目抽正文"的现有机制（它已成功采过 176 条，不推倒重来），但 ① 去掉游标（每轮从顶扫）；② 去重判据从内容哈希改成"点开后从 `location.href` 提取的会话 ID"；③ 侧栏滚动收集多屏提升发现量；④ 落盘文件名用 ID。
核心架构（无游标 / ID 主键 / 文件系统即账本 / 删文件重采）与全部验收标准不变。副作用：已采会话仍需点开才能拿到 ID 判断跳过（不能靠侧栏 href 预判），这点与现状相同，不新增耗时。

## 1. 为什么改（一句话）

现状把"扫到第几条"当进度、把"正文哈希"当去重主键，两套状态互相打架，导致游标撞 200 死锁、同一会话重复导出（实测 **135 个 md 只有 101 个唯一会话 ID**）。改成：**会话 URL 里的 ID 做唯一主键，文件名即 ID，每轮全量对账做差集**——没有进度状态，死锁在结构上无法发生。

## 2. 目标 / 非目标

- 目标 G1：新会话一定被采到，删文件即可重采；G2：每个会话恰好一份文件；G3：无游标、无死锁、无"扫到底"误判；G4：状态人话可见（发现/已采/新增/差异）。
- 非目标 N1：不改插件抽取层（core.js 的 extractMessages/signature/contentKey 保持不动）；N2：不修 yiyan/qianwen/kimi/mimo/chatglm 的选择器与登录问题（独立议题）；N3：不做正文更新自动同步（改为删文件重采）。

## 3. 关键现状事实（现查，行号为当前源码）

| 事实 | 位置 |
|---|---|
| 侧栏条目最多取 200（driver 写死 `{max:200}`） | `webchatAutoConfig.ts:426`；`core.js:693` 默认 200 |
| `startAt=min(游标, items.length)`，游标 200 → 循环空转，reachedEnd 初值 true | `webchatAutoConfig.ts:481,486,487` |
| judgeSite 把 "steps=0" 归为 dom_changed | `webchatAutoConfig.ts:726,789` |
| sweep 遇 dom_changed 即 break，游标停在 200 | `webchatAutoCollect.ts:277,281` |
| 去重主键 = 正文内容哈希 `doneKeys` | `webchatAutoConfig.ts:131-134, 203-215`；`pickNewChats` |
| DriverChat 已含 `url` / `path` / `key` | `webchatAutoConfig.ts:269-275` |
| 导出请求已带 `url`，落盘文件名却是时间戳、撞名加 -1/-2 | `webchatAutoCollect.ts:211-218`；`webchatIngest.ts:142,147-160,212` |
| 去重账与文件是两套状态，"清空必须一次做完" | `webchatIngest.ts:271-274` |
| 现网：deepseek 135 md / 101 唯一 ID；doneKeys 176 | 现查导出目录 + state.json |

## 4. 目标数据模型

```
文件名：  <exportDir>/<site>/<会话ID>.md          （例：deepseek/01bd655d-490e-4cb2-acac-0f0274a603fe.md）
去重依据：文件名是否存在（文件系统即账本），不再读 contentKey
ID 提取：从 chat.url 解析 /a/chat/s/<uuid>；deepseek/doubao 用规则，其他站退化 <title hash>
状态文件：AutoState 保留 lastRound 供 UI 显示；doneKeys/cursors 停止写入（字段保留兼容读，标记 deprecated）
```

## 5. 改动清单（逐文件、逐函数）

### 5.1 `webchatIngest.ts`
1. `webchatExportFileName`：新增重载 `(stampMs, conversationId?)`——有 ID 时用 `<sanitize(id)>.md`，无 ID 回落时间戳。
2. `sanitizeConversationId`：只留 `[A-Za-z0-9_-]`，长度上限 80，空值视为无 ID；防路径穿越（沿用 `pickPath` 的 E_PATH_ESCAPE 边界）。
3. `handleExportRequest`：payload 增可选 `conversationId`，透传给文件名函数。**不删** `pickPath` 的撞名避让（无 ID 的旧路径仍需要）；有 ID 时若同名已存在 → 覆盖写（幂等），不加 -1。
4. 删除/改写 `webchatIngest.ts:271-274` 那段"清空双状态"注释与对应重置逻辑：新模型下"删 md 文件"本身就是重采，无需重置哈希账。

### 5.2 `webchatAutoCollect.ts`
5. `collectSite`：去掉 `doneKeysForSite()` / `startAt` / `maxAttempts` 传参，driver 只传 `siteKey,maxChats`；导出请求加 `conversationId: chat.id`（由 5.3 提供）。
6. `pickNewChats` 改为按 ID 过滤：入参增"已存在 ID 集合"（扫 `<exportDir>/<site>/*.md` 的 basename 得出），`chat.id ∈ 已存在` 即跳过；不再用 contentKey。
7. 不再 `state.doneKeys[chat.key] = ...`（去重由文件系统承担）。
8. 删除 `collectSiteSweep` 整段（游标分批逻辑），`sweepNow` 与 `runNow` 统一走 `runRound`：每站都是"全量发现 → 差集 → 采集"。保留 trigger 字段用于展示。
9. `runRound` 结果：`scanned=发现 ID 数，exported=落盘数，skipped=已在册数，missing=发现但抽取失败数`，状态 `exported>0 ? 'exported' : missing>0 ? 'dom_changed' : 'no_new'`。

### 5.3 `webchatAutoConfig.ts`
10. `DriverChat` 增 `id: string`（从 chat.url 解析；解析失败回落 `title+contentKey` 的短哈希，保证唯一）。
11. `buildDriverScript` 删除 `skipKeys/startAt/maxAttempts/reachedEnd/nextStart` 相关逻辑；循环改为"遍历全部 items、不跳过、不提前 break"，每个 item 产出 `{title,url,path,markdown,messages,key,id}`。
12. `listSidebarItems` 调用改 `{max: 1000}`（发现阶段宁可多取，不再有游标撞墙问题）；加**侧栏滚动收集**：用 `C.findScrollAncestor(items[0].el)` 逐屏滚动，按 href 去重累积，滚动到顶/底无新增即停。
13. `judgeSite`：`SiteStatus` 保留原枚举兼容 UI（不再产生 reachedEnd/nextStart）；`skipped` 改为"已在册数"。

### 5.4 `browser-extension/webchat-exporter/shared/core.js`
14. 仅当发现阶段需要：`listSidebarItems` 的 `maxItems` 默认从 200 提到 1000（保持 driver 显式传值一致）。**不改** signature/contentKey/extractMessages。

### 5.5 UI（`WebchatAutoCard.tsx` / `webchatAuto.ts`）
15. 卡片状态行改为：`发现 N 个会话 · 已采 M · 本次新增 K · 失败 J`；删除"补齐历史"按钮（已无游标概念，统一为"立即采集/同步"），或保留为同义按钮调用 `runNow`——二选一，默认保留按钮避免用户习惯断裂。
16. `AutoRoundView` 增 `skipped/missing` 字段；`trigger` 保留 'sweep' 兼容历史数据。

## 6. 数据迁移（一次性、幂等、可回滚）

- 新脚本 `tools/migrate-webchat-ids.mjs`（只读 + 重命名）：
  1. 扫 `<exportDir>/**/*.md`，解析 `- 来源：` 行的 URL，提取会话 ID；
  2. 同名 ID 多份：按"导出时间"保留最新一份，其余移到 `<exportDir>/_dedup_backup/`（**不删除**）；
  3. 重命名为 `<ID>.md`；无来源行的文件原名保留、跳过；
  4. 全程打印 `old → new` 清单，支持 `--dry-run`；失败可据清单反向还原。
- 执行顺序：**先跑 dry-run 给我核对清单 → 再实跑**。迁移前后的 `state.json` 备份到 `state.json.bak-<timestamp>`。
- 兼容：`doneKeys/cursors` 字段留在 state.json 不再写；旧 UI 读 lastRound 仍正常。

## 7. 测试矩阵（三道闸门）

| 编号 | 测试 | 类型 | 通过标准 |
|---|---|---|---|
| T1 | 同一会话改一行正文再采 | 单测 | 不新增文件（ID 命中） |
| T2 | 新会话插到侧栏顶部 | 单测 | 被发现并导出 |
| T3 | 删掉某会话 md 后重采 | 单测 | 该会话重新导出 |
| T4 | 侧栏 1000 条 + 虚拟滚动 | 单测（假 DOM） | 全部 ID 被收集 |
| T5 | 无游标字段仍能跑完整轮 | 集成 | 无 reachedEnd/nextStart 依赖 |
| T6 | 无 ID 站点（退化分支） | 单测 | 回落 title+hash，仍幂等 |
| T7 | ID 含非法字符/超长 | 单测 | sanitize 后安全，无路径穿越 |
| T8 | 迁移脚本 dry-run + 实跑 + 反向还原 | 脚本测试 | 176 文件无损、清单可回滚 |

**变异验证**（改回旧逻辑必须红灯）：① 改回 contentKey 去重 → T1 红；② 加回 startAt 封顶 → T2/T4 红；③ 文件名改回时间戳 → T1/T3 红；④ 恢复"清空双状态" → T3 红。

## 8. 执行顺序与停点

1. T1–T7 测试先写（红灯）→ 实现 5.1–5.5 → 绿灯（TDD）。
2. 全门禁：`npm test` → `validate_project.py` → `generate.py --check` → `tsc --noEmit`。
3. 迁移脚本 dry-run → **把清单给你核对（停一次）** → 实跑迁移。
4. 打包闭环：关端 → package → 验产物 → 启端 → 核端口/bootstrap。
5. 真机验证：采一轮 → 确认新会话进库、删文件重采生效。
6. **停·等用户实测 → 等确认 → 才 commit/push**（提交纪律不变）。

## 9. 风险与边界

- R1：虚拟列表滚动收集仍可能漏，但只导致"本轮未发现"，下轮收敛，不会永久卡死。
- R2：文件名改 ID 后，用户按时间戳找文件的习惯要适配（UI 可显示标题）。
- R3：无稳定 URL 站点退化为标题哈希，同名会话可能冲突——已列 N2 为独立议题。
- R4：迁移期文件重命名，若此时端在运行会写乱——迁移前必须先关端（进程 0 + 8204 不通）。

## 10. 验收标准（DoD）

- [ ] deepseek 侧栏现存会话数 = 导出目录 deepseek 的 md 数（差异仅为失败项，且逐条有原因）
- [ ] 你截图那条「SolidWorks自动出工程图」被采到
- [ ] 连采 3 轮，文件数不再增长、无重复、无 dom_changed 误报
- [ ] 删一个 md 再采，该会话回来
- [ ] 全门禁绿 + 真机一轮 + 打包产物验证通过

## 11. 执行记录（2026-11-20）

- 5.1–5.5 已落地：`webchatIdReconcile.ts`（ID 主键 / 文件即账）、`webchatIngest.ts`（`<ID>.md` 幂等覆盖）、
  `webchatAutoConfig.ts`（驱动产出 ID、双轨跳过、`max:1000` + 滚动发现、`startAt` 恒 0）、
  `webchatAutoCollect.ts`（扫目录做差集、POST 带 `conversationId`、不再写 `doneKeys/cursors`）、
  `main.ts`（传导出目录真源）、`core.js`（默认上限 1000）、UI 状态行（发现/已采/新增/失败）。
- 站点 ID 规则补全：deepseek `/a/chat/s/<uuid>`、豆包 `/chat/<数字>`、文心一言 `/search/<数字>`、query `chatid=`。
- 门禁：`npm test` 3997/3997、`typecheck`、`lint`、`code:index:check`、`check:no-demo`、
  `validate_project.py`、`generate.py --check` 全绿（validate 的 146 条 frontmatter 警告为历史存量）。
- 变异验证：`node tools/verify-webchat-id-mutations.mjs` 4/4 按预期转红并自动还原。
- 迁移 dry-run：`node tools/migrate-webchat-ids.mjs "C:/Users/LHQ/Downloads/chat-exports"` →
  **176 份动作 = 113 次重命名 + 63 份移入 `_dedup_backup/`，0 跳过、0 错误**；
  清单见 `specs/reports/WEBCHAT-ID-MIGRATION-PREVIEW.json`。
- 用户 2026-11-20 21:04 确认 OK 后已实跑：`--apply --report WEBCHAT-ID-MIGRATION-APPLIED.json`，
  结果与 dry-run 完全一致（176 / 113 / 63 / 0 / 0）；复查 dry-run 得 0 动作 = 幂等。
  真实文件数：deepseek 101 + 备份 34、doubao 10 + 备份 28、yiyan 2 + 备份 1（合计主目录 113 / 备份 63）。
  迁移前 state.json 备份至 `state.json.bak-20261120-210537`。
- **执行中发现并修复**：迁移完成后 `skipKeysForSite` 仍把旧 `doneKeys`（176 内容键）注入跳过集合，
  会导致「删 `<ID>.md` 后重采」失效（违反 DoD 第 4 条）。已撤掉旧账注入，只以文件系统为账，
  并加源码锁 `expect(src).not.toContain('Object.keys(state.doneKeys)')`。
- 打包闭环：关端核验（进程 0 + 8204 不通）→ package → 验产物（`release/installer`，内置 main.cjs 已无旧账注入）→
  启端 → 核运行态（4 进程 / 8204 监听 / `bootstrap:done` 21:12:05）。package.json 哈希前后一致。
- 待办：**真机一轮（UI 点「立即采一轮」）→ 等用户实测 → 等明确确认才 commit/push**。MCP 仅 13 个记忆工具，
  采集走桌面 IPC，无法从工具会话触发；需用户在界面点按钮。
- 已知边界：工具会话启动 Electron 偶发失败（第二次未写日志），第三次干净重试成功；不据此断言产品崩溃。
