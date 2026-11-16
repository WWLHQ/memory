# 项目长期记忆（MEMORY.md）

## 仓库 / CI
- 远端 github.com/WWLHQ/memory（main）。CI：`npm test` → `validate_project.py` → `generate.py --check`；`build/` gitignored，CI 须先 generate 再 check。推含 `.github/workflows` 的提交 PAT 需 `workflow` 作用域。

## 首步读记忆库 · 防复发三道锁（2026-11-16 用户多轮明确，最高优先）
- **任何回复第一步必须 `recall_memory(project_id='P1', ...)`**，之后才推理/调其它工具。反复违反，用户已多次批评，以下三道锁缺一不可：
  1. **触发锁**：`UserPromptSubmit` 钩子 `~/.workbuddy/settings.json`（硬前置，模型无法跳过）+ 提示词（软约束）。曾因钩子路径少写 `.unpacked`（`app.asar` 应为 `app.asar.unpacked`）静默失效 → 已修；改后必须 `--self-test` 验 `SELFTEST_OK n/n`。项目级真源 `.codebuddy/settings.json` 用 `$CODEBUDDY_PROJECT_DIR/.codebuddy/hooks/force_recall.mjs`。
  2. **凭证锁**：每次回答末尾**原样输出** recall 返回的 `display.markdown`（命中数/省量/费用 + `⚙ 模式` 行 + 明细链接，URL 逐字保留，不得重建/省略）。这是服务端数据、编不出来 → 没凭证即没读。正文采用命中事实时就地标 `[n]`。
  3. **失败锁**：召回失败（多项目未传 project_id → `list_projects` 后显式传参；工具故障/索引丢失 → 重试≤2次）**必须显式声明「召回失败，已回退现查」+原因**，禁止静默跳过。钩子侧已落地：`recallHook.ts` 每次执行写 `%APPDATA%/MultiAgent Memory/recall-hook-status.json`（ok/empty/failed + 原因分类 + 时间 + hits），结构化 stderr `STATUS ...` 行；桌面端参数页「硬前置召回」卡片 A 层显示最近一次角标（成功绿/零命中灰/失败软红，悬停给人话原因，枚举一律译中文）。
- 不用 `conversation_search`/`knowledge_search` 冒充记忆库检索（前者是历史会话、后者是资料库，都不是自建记忆库）。
- 钩子状态真源：`src/core/memagent/recallPrelude.ts`（buildHookRunState/parseHookRunState/serializeHookRunState）+ `recallHook.ts`（hookStatusFilePath/recordStatus）；UI 读口 `src/electron/recallHard.ts` 的 `readHookRunState()` → `state().a.lastRun` → `web/params/RecallHardCard.tsx` 的 `lastRunBadge()`。
- 失败原因枚举 → 中文唯一表在 `RecallHardCard.tsx` 的 `FAIL_REASON_ZH`，别写第二套。
- **钩子健康度可主动查询（2026-11-16 新增，第 13 个 MCP 工具 `recall_hook_status`）**：读同一份状态文件，返回 `verdict` = `ok` / `empty` / `failed` / `stale`（>12h 无记录）/ `never_ran`，附中文原因、距今多久、`advice`（该不该告知用户）。**`never_ran` 是最有价值的结论**：状态文件不存在 = 钩子没装 / 安装路径写错 / 从没触发，「首步强制召回」完全没生效。真源 `src/core/memagent/mcpHookTools.ts`（`runHookStatusTool`，纯函数 + 注入 readText/now）；两处 dispatch：`mcp.ts`(8202) 与 `mcpHttp.ts`(8204)；主进程传 `join(USER_DATA, HOOK_STATUS_FILE)`，漏传会退回 env/APPDATA 默认路径（可能与钩子写的不是同一文件 → 误报 never_ran）。
- **「召回失败」与「钩子未生效」必须分开定性**：召回工具报错 / 索引丢失 = 服务侧问题，回退现查；`recall_hook_status` 报 `failed`/`never_ran`/`stale` = 钩子侧根本没跑，必须告知用户「钩子没生效」并让他去参数页核对安装态。**不要用「库里没命中」掩盖「根本没查」。**

## A 层钩子脚本路径（2026-11-16 事故，别再犯）
- **绝不能把 `…\resources\app.asar\…` 写进宿主 settings.json**：asar 内是虚拟路径，Electron 的 `fs` 看得见、**系统 node 看不见**，宿主正是用系统 node 起钩子 → 每轮 `ERR_MODULE_NOT_FOUND` → fail-open 静默 → 状态文件永不生成（`never_ran`），UI 却一路绿灯。
- **也不能直接写 `__dirname` 解析出的打包路径**：打包态它等于 `…\app.asar.unpacked\dist-electron`，绑死安装目录，换包/重装即失效。
- **唯一正确做法**：`src/electron/recallHookScript.ts` 的 `ensureStableHookScript()` 把自包含产物复制到 `<数据根>/recall-hard/force_recall.mjs`（内容一致不写盘），宿主配置只写这个不变路径。改路径策略时先看这个文件。
- **写盘成功 ≠ 内容还在**：`~/.workbuddy/settings.json` 的主人是宿主，它内存里有旧配置，落盘时会盖掉我们的修改（实测 19:09:32 写了、留了 `.bak`、落盘仍是旧路径）。所以写完必须回读（`recall-hard:a-hook-not-landed`），且 `state.a.overwritten` 为真时话术必须是「先完全退出宿主再保存」，**不能再说「点保存会重写」**（已被证伪，会让用户反复点）。
- **解析钩子路径必须优先取引号内整段**（`extractHookPathFromCommand`）：`%APPDATA%\...\MultiAgent Memory\...` **含空格**，旧正则 `[^"'\s,}]*force_recall\.mjs` 会截成 `Memory/recall-hard/force_recall.mjs` → 写对了却报「路径不符 / 被宿主改回」，且「已装且正确 → 不重写」分支永远走不到（每次保存都重写）。
  **教训：凡是路径比对/解析的测试，必须至少一例带空格**——上一轮所有用例都用 `D:\repo\...` 这种干净路径，直接漏掉这个坑。
- **判「A 是否真通」只看状态文件，不看 UI**：`%APPDATA%\MultiAgent Memory\recall-hook-status.json` 出现 `{"status":"empty"|"ok"}` 就是钩子真跑了（`empty` = 那轮没命中，是健康值）；文件不存在才是 `never_ran`。2026-11-16 19:34:19 实测已从 `never_ran` 转 `empty`。

## 硬前置召回 A/B/C 的权限边界（2026-11-16 用户要求下放到成员）
- **字段级真源**：`src/shared/recallHardConfig.ts` 的 `MEMBER_EDITABLE_KEYS = ['a_hook','c_strict_gate']` + `memberForbiddenFields(patch)`。主进程（真闸门）与 UI（按钮禁用）**共用这一份**，禁写第二套，否则会出现「界面能点、后端拒绝」。
- **主进程**：`recallHardSet` 用 `requireSession` 再按字段细分，**不要退回 `requireAdmin`**（那会把 A/C 一起锁死）。patch 里只要碰 `b_gateway` / `b_upstream` / `b_port` 就**整单拒绝**（不静默只改一半），返回 `E_AUTH_FORBIDDEN` + 文案「A / C 成员可改；B（LLM 网关与上游地址）仍需管理员」，并落 `denied=field_admin_only` warn 日志。
- **为什么 B 不下放**：启用 B 会把本机 8300 变成对外转发出口，且透传客户端上游凭据，属安全边界。
- **UI**：`canEditAC = isAdmin || role === 'member'` 控制 A/C 开关与「保存并生效」；B 开关与上游输入仍 `disabled={!isAdmin}`。成员看到 `rh-member-scope`（说明可改范围），未登录才看到 `rh-need-admin`。
- **测试坑**：`useSessionContext` 口径是「context 存在且非 admin 一律算 member」→ 测「未登录」必须让 fetch 返回 `context: null`（不能只把 role 置空串）。
- **hostCall 会附 sessionId**：断言 `api.recallHard.set` 的入参时只校验 `calls[0][0]`，别用 `toHaveBeenCalledWith(patch)`。

## 提交 / 打包纪律（最高优先）
- **打包 → 等实测 → 等明确确认 → 才 commit/push**；门禁全绿也不算自动提交理由。
- 顺序：全门禁 → `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` → 验产物 → 停·等测试 → 停·等确认 → push（产物 `release/installer/`、`release/win-unpacked/`）。
- 打包改写根 `package.json`（清空 scripts/devDependencies）不还原 → 打包后 `git checkout -- package.json`。
- 提交前展示改动清单 + 门禁输出 + 拟用信息；在途改动单列，禁 `git add .`；conventional commit + `Co-Authored-By: CodeBuddy Code`。
- 每个原子任务先展示成果等确认再下一步。

## UI 铁律（2026-11-14 用户明确，最高优先）
- **原始 JSON / `payload` / `JSON.stringify` 结果禁止进 UI 渲染**；整页必须是人话（中文名 + 一句摘要），不给「展开原文排查」的 `<details>`。
- 类比：字段名（`w_f`）、英文事件名（`weight_tuned`）、枚举值（`off/suggest/auto`）一律译中文；中文名唯一来源 `web/growth/recallLabels.ts`，别再写第二套。
- 回查改用「审计 ID + 时间」（`GrowthAuditEntry.requestId` 从账本 `request_id` 补），不靠把 JSON 糊给用户；不可翻译时写「没有可翻译的明细」，不拿原文兜底。

## 日志定位真因（不必跑起应用）
- 工具会话起不了 Electron（退出 0、1s 结束、main.log 零新增、端口不监听；三组对照已排除产品缺陷）→ 启新端须用户双击，不得断言崩了。
- 事实源：`%APPDATA%/MultiAgent Memory/` 的 `actions.log`（`[host:通道]{via,ms}` / `[ipc:通道]`）、`audit.jsonl`（解锁等业务事实）、`main.log`（bootstrap）。判读锁：看 `host:l0:writeUnlocked` 后有没有紧跟 `l0:myWriteWrap` 回退——有=端口返 false，无=返 true。

## L0 写锁（两把锁互不替代）
- 写锁 `write_unlocked`（能不能写）· 查阅锁 `active_sessions`（能不能查）。读口走无鉴权 `l0:writeUnlocked`；渲染层唯一读取口 `shared/l0WriteState.ts`，读不到回 null 不冒充 false。
- **首页「解锁后仍报未解锁」真因（2026-11-13 日志铁证）**：红条 `l0WriteLocked` 一直是对的（解锁后 home 读到的已是 true）；用户看到的是另一条蓝条 —— `coreHome.deriveKernelAnomalies` 把「近 30 分钟有 write 因 E_L0_LOCKED 失败」聚合成 error，解不解锁都挂，还带「去安全页解锁 →」，首页 `l0Alert` 分支无条件渲染。
- **修复**：① 只统计最后一次 `l0_write_unlock(_member)` 之后的被挡；② `deriveHomeView` 加 `l0WriteResolved`（available && unlocked），已解锁不再渲染该历史提示。
- 轮3–6 改刷新机制全无效（读锁链路本就正确）；轮7 统一 `hostCapability`/`hostCall`（删 `parentHasNativeApi`）只是加固，日志已证 home iframe 一直走 bridge。
- 跨文档刷新：信号键 `memdesk.l0.writeLockSignal.v1`（只带时间戳）+ focus/visibilitychange 补读。进库分流只认 `session_id`（有=放行，无=发件箱待判）。

## 壳层 / 页面
- 刷新三层：F5=全站重挂；页面内 `useRefreshAll` 只重取本页；卡片刷新只重取该卡。
- 配色用 `memoryManagement.css` 变量那套（浅色默认 + dark），别用 `shared/theme.css` 深色专套。导航折叠=44px 图标栏。记忆助手=`assistant.html`；个人记忆 → `memory.html?tab=personal`。入口 html 全小写。

## 纯净度（AGENTS.md §0.1）
- 判定：下一个任务不会再用的就是临时物。收尾五步默认执行：跑验→扫→清→核→报。
- Bash `rm -rf` 被 genie-trash 接管、多文件目录拒删；`CODEBUDDY_SAFE_DELETE_ENABLED=0` 只对 Node `fs.rm` 有效。删不掉如实告知+给命令。

## 回显通道
- 判档：自证头 `X-Memagent-Render: fold` > qoder 白名单 > detail。`workbuddy` 恒 `markdown-compact`（`<details>` 无折叠交互）；compact 只接 hint 不接 result。

## 批次61 / 其他
- GAP-1 召回权重真源 `shared/growthConfig.ts`（0.35/0.30/0.15/0.20），`forgetting.ts` 的 `SCORE_WEIGHTS` 仅转发；回归只出建议不写 `growth:v1`；`hardFilter` 先排 `deleted`/`merged_into`。
- REQ-003 实际落地纯 ESM JS（`src/agentOnboard/*`），追溯以 `specs/code-map.md` 为准。

## 召回模式（A1–A7 已上线，2026-11-13）
- 分流真源 `core/memagent/recallModes.ts`（`RECALL_MODE_SPECS` 三张表 + `resolveMode`）；**Web 与回显都只读内核**，别再写第二套词表（`web/retrieval/logic.autoDispatch` 已删，有测试锁「别再长回来」）。
- `RecallResult.dispatch` 与 `mode_dispatch` 审计**同一份对象**；回显 `⚙ 模式：…` 由 `recallInsight.buildRecallModeLine()` 出，落在 compact/full/html/明细页四处。
- 手动模式才启用权重(A3)/分层(A4)/次模式(A5)；`auto` 档逐条不变。自动分流到极简仍是**只观测**（`mode='minimal'` / `applied_mode='auto'`），别当成已执行。
- 会话视图（`scope=session`）`dispatch` 恒 `null`，不拿 auto 冒充已分流。
