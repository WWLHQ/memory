# 项目长期记忆（MEMORY.md）

## 仓库 / CI
- 远端 github.com/WWLHQ/memory（main）。CI：`npm test` → `validate_project.py` → `generate.py --check`；`build/` gitignored，CI 须先 generate 再 check。推含 `.github/workflows` 的提交 PAT 需 `workflow` 作用域。

## 提交 / 打包纪律（最高优先）
- **打包 → 等实测 → 等明确确认 → 才 commit/push**；门禁全绿也不算自动提交理由。
- 顺序：全门禁 → `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run package` → 验产物 → 停·等测试 → 停·等确认 → push（产物 `release/installer/`、`release/win-unpacked/`）。
- 打包改写根 `package.json`（清空 scripts/devDependencies）不还原 → 打包后 `git checkout -- package.json`。
- 提交前展示改动清单 + 门禁输出 + 拟用信息；在途改动单列，禁 `git add .`；conventional commit + `Co-Authored-By: CodeBuddy Code`。
- 每个原子任务先展示成果等确认再下一步。

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
