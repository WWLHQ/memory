# 项目长期记忆（MEMORY.md）

> 精简版（2026-11-17 压缩）。只留「下次还会用到的判据 / 路径 / 坑」；被删的叙事与逐条证据见 `ARCHIVE-2026-11-full.md`（同目录，需要时再读）。

## 0. 日期/时间口径（2026-11-18 用户明确，跨项目长期偏好）
- 所有和日期/时间相关的内容一律按北京时间（Asia/Shanghai，UTC+08:00）和北京时间日期：展示、日志、报告、文件名/标题、周几与自然日归属、截止日期、「今天/昨天」判断等都如此；UTC 时间先换算成 `+08:00` 再写。仅当用户当轮明确指定其他时区时例外。用户级 `MEMORY.md` 与记忆库 `mem_01M7PAKDYJ0YAWDBK7JX774BY9` 为长期真源。

## 1. 提交 / 打包纪律（最高优先）
- 远端 `github.com/WWLHQ/memory`(main)。CI：`npm test` → `validate_project.py` → `generate.py --check`；`build/` gitignored，CI 须先 generate 再 check。推含 `.github/workflows` 的提交 PAT 需 `workflow` 作用域。
- **打包 → 等实测 → 等明确确认 → 才 commit/push**。顺序：全门禁 → `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` → 验产物（`release/installer/`、`release/win-unpacked/`）→ 停·等测试 → 停·等确认 → push。门禁全绿不算自动提交理由。
- **【2026-11-19 用户明确 · 再次升级】需要打包时 assistant 直接关掉运行中的桌面端再打，不必停下来等用户确认、也不必等用户手动关闭**；关完仍须核实进程 0 + 8204 不通，再执行打包；整个打包闭环（关端→打包→验产物→启端→核运行态）一气呵成不等确认。此条只免「打包前的确认等待」；git commit/push 仍按提交前人工确认铁律单独等用户明确确认。
- 打包脚本曾清空根 `package.json` 的 scripts/devDependencies；但 2026-11-19 实测本次未清空（哈希打包前后一致）。**不要无条件 `git checkout -- package.json`**：工作区该文件本就有未提交改动（与 HEAD 不同），checkout 会丢失它们。正确做法=打包前后各记一次 sha256，一致就不动；真被清空才从打包前备份还原。
- 提交前展示改动清单 + 门禁输出 + 拟用信息；在途改动单列，禁 `git add .`；conventional commit + `Co-Authored-By: CodeBuddy Code`。每个原子任务先展示成果等确认再下一步。
- 纯净度（AGENTS.md §0.1）：下一个任务不会再用的就是临时物；收尾五步 跑验→扫→清→核→报。Bash `rm -rf` 被 genie-trash 接管、多文件目录拒删；`CODEBUDDY_SAFE_DELETE_ENABLED=0` 只对 Node `fs.rm` 生效。删不掉如实说 + 给命令，不换 shell 绕过安全护栏。

## 2. 首步强制召回 · 三道锁（用户最高优先，反复违反过）
- 任何回复第一步必须 `recall_memory(project_id='P1', …)`，之后才推理/调其它工具。
- **触发锁**：`UserPromptSubmit` 钩子（`~/.workbuddy/settings.json`；项目级真源 `.codebuddy/settings.json` 指向 `$CODEBUDDY_PROJECT_DIR/.codebuddy/hooks/force_recall.mjs`）。曾因路径少写 `.unpacked` 静默失效 → 改后必须 `--self-test` 见 `SELFTEST_OK n/n`。
- **凭证锁**：回答末尾原样输出 `display.markdown`（命中数/省量/费用 + `⚙ 模式` 行 + 明细链接，URL 逐字保留、不得重建/省略）；正文采用命中事实就地标 `[n]`。另加一行 `🔎 本轮召回：<request_id>`（编不出来）；零命中写 `⚠ 本轮召回零命中 / 失败：<原因>，已回退现查`。
- **失败锁**：召回失败（多项目未传 id → `list_projects` 后显式传参；工具故障/索引丢失 → 重试≤2 次）必须显式声明「召回失败，已回退现查」+ 原因，禁止静默跳过。
- 不用 `conversation_search` / `knowledge_search` 冒充记忆库（前者历史会话、后者资料库）。
- **「召回失败」≠「钩子未生效」**：工具报错 = 服务侧，回退现查；`recall_hook_status` 报 `failed`/`never_ran`/`stale` = 钩子侧没跑，必须告知用户去参数页核对安装态。不许用「库里没命中」掩盖「根本没查」。
- 真源：`recallPrelude.ts`（buildHookRunState/parseHookRunState/serializeHookRunState）+ `recallHook.ts`（hookStatusFilePath/recordStatus）；UI 读口 `electron/recallHard.ts` 的 `readHookRunState()` → `state().a.lastRun` → `web/params/RecallHardCard.tsx` 的 `lastRunBadge()`；失败原因中文唯一表 = 该文件的 `FAIL_REASON_ZH`，别写第二套。
- **第 13 个 MCP 工具 `recall_hook_status`**：读同一份状态文件，`verdict` = `ok`/`empty`/`failed`/`stale`(>12h)/`never_ran`。`never_ran` 最有价值（文件不存在 = 钩子没装/路径写错/从没触发）。真源 `mcpHookTools.ts` 的 `runHookStatusTool`（纯函数 + 注入 readText/now）；两处 dispatch：`mcp.ts`(8202) 与 `mcpHttp.ts`(8204)；主进程必须传 `join(USER_DATA, HOOK_STATUS_FILE)`，漏传会退回 env/APPDATA 默认路径 → 误报 `never_ran`。
- **判「A 是否真通」只看状态文件不看 UI**：`%APPDATA%\MultiAgent Memory\recall-hook-status.json` 出现 `{"status":"ok"|"empty"}` 即钩子真跑（`empty` 是健康值）；文件不存在才是 `never_ran`。
- **复盘补漏钩子（2026-11-18 落地）**：`~/.workbuddy/settings.json` 的 UserPromptSubmit 现有两个钩子：`force_recall.mjs` + `recall-hard/session_review_patch.mjs`。后者读上一条 assistant 文本查复盘标题+沉淀行，声明 mem_id 时同 session 先 recall 再 get_memory 验真，只注入 `additionalContext` 不阻断；审计 `%APPDATA%\MultiAgent Memory\session-review-patch-audit.jsonl`。**fail-open catch 要区分「令牌文件真缺」与「代码错误」**：曾因未 import `readFile` 被 catch 成 token missing，真假 mem_id 全放行；已改 `readFileSync`。钩子不热加载，改完须重启 WorkBuddy。

## 3. A 层钩子脚本路径（2026-11-16 事故）
- 禁止把 `…\resources\app.asar\…` 写进宿主 settings.json：asar 是虚拟路径，Electron `fs` 看得见、**系统 node 看不见**（宿主用系统 node 起钩子）→ `ERR_MODULE_NOT_FOUND` → fail-open 静默 → 状态文件永不生成，UI 却全绿。
- 也禁止写 `__dirname` 解析出的打包路径（绑死安装目录，换包即失效）。
- **唯一正确做法**：`electron/recallHookScript.ts` 的 `ensureStableHookScript()` 把自包含产物复制到 `<数据根>/recall-hard/force_recall.mjs`，宿主配置只写这个不变路径。改路径策略先看此文件。
- **写盘成功 ≠ 内容还在**：宿主内存里有旧配置，落盘会盖掉我们（实测写了又回旧路径）。必须回读（`recall-hard:a-hook-not-landed`）；`state.a.overwritten` 为真时话术是「先完全退出宿主再保存」，**不能说「点保存会重写」**（已证伪）。
- **解析钩子路径优先取引号内整段**（`extractHookPathFromCommand`）：`%APPDATA%\...\MultiAgent Memory\...` 含空格，旧正则 `[^"'\s,}]*force_recall\.mjs` 会截断 → 误报「路径不符」，且「已装且正确→不重写」分支永不命中。教训：路径比对/解析的测试必须至少一例带空格。

## 4. 硬前置召回 A/B/C 权限边界（2026-11-16 下放到成员）
- 字段级真源 `src/shared/recallHardConfig.ts`：`MEMBER_EDITABLE_KEYS = ['a_hook','c_strict_gate']` + `memberForbiddenFields(patch)`；主进程（真闸门）与 UI（按钮禁用）共用，禁写第二套。
- 主进程 `recallHardSet` 用 `requireSession` 再按字段细分，**不要退回 `requireAdmin`**（会把 A/C 一起锁死）。patch 碰 `b_gateway`/`b_upstream`/`b_port` → 整单拒绝（不静默改一半），返 `E_AUTH_FORBIDDEN` + 「A / C 成员可改；B（LLM 网关与上游地址）仍需管理员」，落 `denied=field_admin_only` warn。
- **B 不下放**：启用 B 会把本机 8300 变成对外转发出口且透传上游凭据，属安全边界。
- UI：`canEditAC = isAdmin || role === 'member'` 控 A/C 与「保存并生效」；B 开关与上游输入仍 `disabled={!isAdmin}`。成员看 `rh-member-scope`，未登录才看 `rh-need-admin`。
- 测试坑：`useSessionContext` 口径是「context 存在且非 admin 一律 member」→ 测「未登录」须让 fetch 返 `context: null`（不能只把 role 置空串）；`hostCall` 会附 sessionId → 断言 `api.recallHard.set` 只校验 `calls[0][0]`，别用 `toHaveBeenCalledWith(patch)`。

## 5. UI 铁律（2026-11-14 用户明确）
- 原始 JSON / `payload` / `JSON.stringify` 结果禁止进 UI 渲染；整页必须人话（中文名 + 一句摘要），不给「展开原文排查」的 `<details>`。
- 字段名（`w_f`）、英文事件名（`weight_tuned`）、枚举值（`off/suggest/auto`）一律译中文；中文名唯一来源 `web/growth/recallLabels.ts`。
- 回查用「审计 ID + 时间」（`GrowthAuditEntry.requestId` 从账本 `request_id` 补），不糊 JSON；不可翻译时写「没有可翻译的明细」，不拿原文兜底。

## 6-7. 专题手册（细节在归档，动这两块前先读）
- **webchat 插件排障 / 一键打开浏览器扩展页**：完整判据（QQ 加密存储别考古、`Local Extension Settings\<ID>\000003.log` 解析 LevelDB WAL 拿真实任务记录、`webchat-verify/*.json` 当 fixture、MV3 SW 只做一次必须存 `chrome.storage.local`、去重记账绑「落盘成功」即 `background.js#writeStoredSig`、判据下沉 `shared/core.js` 的 `listSidebarItems`/`describeSidebar`/`findScrollAncestor`；`AppActivate` 假成功、必须 P/Invoke 回读 + `exit 3/4`、`^t ^l ^v {ENTER}`、纯 ASCII 单行）→ 见 `ARCHIVE-2026-11-full.md` §webchat、§一键打开扩展页。
- 一句话根因记忆：**能编造的证据都不算证据**——要么读到真实结构，要么显式失败退出码。

## 8. L0 写锁 / 日志定位
- 两把锁互不替代：写锁 `write_unlocked`（能不能写）· 查阅锁 `active_sessions`（能不能查）。读口走无鉴权 `l0:writeUnlocked`；渲染层唯一读取口 `shared/l0WriteState.ts`，读不到回 null 不冒充 false。
- **首页「解锁后仍报未解锁」真因**：红条恒正确，问题在 `coreHome.deriveKernelAnomalies` 把「近 30 分钟 write 因 E_L0_LOCKED 失败」聚合成 error（解不解锁都挂）。修法：① 只统计最后一次 `l0_write_unlock(_member)` 之后的被挡；② `deriveHomeView` 加 `l0WriteResolved`（available && unlocked），已解锁不再渲染该历史提示。轮3–6 改刷新机制全无效（读锁链路本就对）。
- 跨文档刷新：信号键 `memdesk.l0.writeLockSignal.v1`（只带时间戳）+ focus/visibilitychange 补读。进库分流只认 `session_id`（有=放行，无=发件箱待判）。
- 工具会话起不了 Electron（退出 0、1s 结束、main.log 零新增、端口不监听；三组对照已排除产品缺陷）→ 启新端须用户双击，不得断言崩了。
- 事实源 `%APPDATA%/MultiAgent Memory/`：`actions.log`（`[host:通道]{via,ms}` / `[ipc:通道]`）、`audit.jsonl`（业务事实）、`main.log`（bootstrap）。判读锁：`host:l0:writeUnlocked` 后紧跟 `l0:myWriteWrap` 回退 = 端口返 false；无回退 = true。

## 9. 召回模式 / 回显通道
- 分流真源 `core/memagent/recallModes.ts`（`RECALL_MODE_SPECS` 三张表 + `resolveMode`）；Web 与回显都只读内核，别写第二套词表（`web/retrieval/logic.autoDispatch` 已删，有测试锁「别再长回来」）。
- `RecallResult.dispatch` 与 `mode_dispatch` 审计是同一份对象；`⚙ 模式：…` 由 `recallInsight.buildRecallModeLine()` 出，落 compact/full/html/明细页四处。
- 手动模式才启用 权重(A3)/分层(A4)/次模式(A5)；`auto` 口径逐条不变。自动分流到极简仍是**只观测**（`mode='minimal'` / `applied_mode='auto'`），别当成已执行。`scope=session` 的 `dispatch` 恒 `null`。
- 回显判档：自证头 `X-Memagent-Render: fold` > qoder 白名单 > detail。`workbuddy` 恒 `markdown-compact`（`<details>` 无折叠交互）；compact 只接 hint 不接 result。
- 批次61：GAP-1 召回权重真源 `shared/growthConfig.ts`（0.35/0.30/0.15/0.20），`forgetting.ts` 的 `SCORE_WEIGHTS` 仅转发；回归只出建议不写 `growth:v1`；`hardFilter` 先排 `deleted`/`merged_into`。REQ-003 落地纯 ESM JS（`src/agentOnboard/*`），追溯以 `specs/code-map.md` 为准。

## 10. 壳层 / 页面
- 刷新三层：F5=全站重挂；`useRefreshAll` 只重取本页；卡片刷新只重取该卡。
- 配色用 `memoryManagement.css` 变量那套（浅色默认 + dark），别用 `shared/theme.css` 深色专套。导航折叠=44px 图标栏。记忆助手=`assistant.html`；个人记忆 → `memory.html?tab=personal`。入口 html 全小写。

## 11. 召回 A 方案一周观察（批次60，进行中）
- 采集器 `tools/recall-stats.mjs`（只读 audit.jsonl + memories.db.json；`--snapshot` 追加 `specs/reports/recall-snapshots.jsonl`；`--since ISO` 看区间）。
- 基线（11-11 重启前 135 次）：未命中 5.9% / 证据不足 21.9% / top1 覆盖 0.056 / 平均命中 4.16 / 重复query 13.5% / 延迟 p50·p95 716·1349ms。
- 11-17 全量 443 次：5.6% / 64.1% / 0.367 / 2.45 / 7.5% / 361·851·1611。**覆盖率大幅改善、平均命中数持续下滑（4.16→2.45→今日 1.39）与证据不足率飙升是同一件事的两面**（A 融合把分数量纲摊薄 + 用户 query 是长关键词堆叠）。
- 约定：**不为一周数据调 λ / 不改阈值 / 不改脚本凑数**；结算日 2026-11-19，届时按 `specs/reports/RECALL-WEEK-PLAN.md` 三档判定并出 `RECALL-WEEK-1.md`。
