---
status: accepted-manual
---

# 手动测试报告 · 批次57-D（真机三问题修复：去登录 / 双栏断点 / 告警去重）

> **验收记录**：2026-11-10 用户在安装版真机验收通过（「已验收」）。本次验收基于 57-D 安装包（SHA256 `cde6ed6b…c87a11`），其中同时包含 57-B/57-C 的首页版式与真实数据改动——本轮三条真机反馈（去登录/双栏/告警重复）全部修复确认。

- 日期：2026-11-10
- 分支：main（上一笔 `84c3e30` 批次57-C；本批 ahead 待查 `git status -sb`，**未 push，待授权**）
- 正式安装包：`release/installer/MultiAgent Memory-0.1.0-setup.exe`（127,978,377 B = 122.05 MiB）
- SHA256：`cde6ed6b5747ffcd44baf64d01d0211fe36f46a4a1c69f4d0ada4c35c3c87a11`
- 未打包目录：`release/installer/win-unpacked/MultiAgent Memory.exe`
- 数据目录：安装包版 `%APPDATA%\MultiAgent Memory`
- 关联：`specs/code-map.md` 批次57-D 段落、上一轮 57-C（`84c3e30`）、用户真机反馈三点
- 范围口径：用户真机反馈「① 点击去登录无反应；② 首页布局还是没有改过来；③ 将下面的账本读取失败取消，留最上面一个提示即可」。本轮只修这三处，首页真实数据口径不变，记忆库暂停不动。

## 1. 本轮改了什么（根因 → 修复）

| 问题 | 根因 | 修复 | 文件 |
| --- | --- | --- | --- |
| ① 去登录无反应 | 首页按钮发 `goto:login` 给壳层，壳层按 NAV 表查 `findNav('login')` 得 undefined 后静默丢弃——`login` 有意不占主导航（登录走壳层弹窗），且旧测试只断言按钮可见、从没点过 | 壳层消息监听器特判 `login` → 打开壳层登录弹窗（与菜单/QAT/状态栏三入口同一弹窗实例，真实 `POST /api/login`） | `src/web/shell/Workspace.tsx`（onGoto +2 行） |
| ② 双栏塌单栏 | 桌面壳默认 1280 窗 − 250 导航栏 − 318 检查器（默认开）− 10 分条 ≈ **702px** 中心 iframe 宽 < 旧 900px 断点 → 首页双栏塌成单栏、右栏遥测叠到图谱下方，看起来「布局没改过来」 | 塌栏断点 900→640px；新增 ≤1010px 中段右栏收窄 264px；图谱高度改按 760/352 比例随宽缩放（宽栏 330px 封顶对齐定稿图，窄栏不留巨幅空白） | `src/web/overview/overviewPage.css` |
| ③ 告警重复 | 壳层中心区顶部已有「未登录只读条 + 账本读取失败条」两条提示，首页里又渲染一条同文红告警——同一段错误在中心区出现两遍 | 删页面里那条红告警，只留壳层顶部一条；页面各面板自身诚实失败原因保留（概览聚合失败告警与 L0 锁定提示不受影响） | `src/web/overview/OverviewPage.tsx`（删 5 行） |

测试面：`workspace.test.tsx` 新增 S3.5 describe（goto login → 登录弹窗开且不开 login.html 标签；goto audit → 照常开标签）；`e2e/home.spec.ts` 新增 ⑧（702px 实宽断言双栏 2 列 / 右栏 264px / 图谱高度按比例缩放）。

## 2. 自动化门禁结果（三道闸门）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 主工程类型检查 | `npx tsc --noEmit` | 通过（0 错误） |
| Electron 类型检查 | `npx tsc --noEmit -p tsconfig.electron.json` | 通过（0 错误） |
| Lint | `npm run lint`（oxlint） | 0 warnings / 0 errors |
| 索引新鲜度 | `npm run code:index -- --write` + `check` | 通过（378 源码 / 122 文档） |
| 无演示标识 | `npm run check:no-demo` | 0 命中 |
| 全量回归（A） | `npm run test:gate`（4 片串行） | **229 文件 / 2650 例 0 失败、重试 0 次**（报告留档 `test-results/test-gate/20261110-104423/`） |
| 真浏览器 E2E（B） | `node e2e/run.mjs --workers=1 e2e/home.spec.ts e2e/overview.spec.ts e2e/crossTabAuth.spec.ts` | **11/11 通过**（含新⑧；真 dist + 真 home 后端 + CDP Chromium） |
| 变异验证（C） | `Workspace.tsx` 特判注入 `login`→`loginX` | 指定用例「57-D：iframe 请求 login → 打开壳层登录弹窗」**真实红灯** → 原样还原 → 2/2 复绿，`git diff` 无残留 |
| 正式打包 | `npm run package` | 退出码 0（NSIS + win-unpacked） |
| 702px 实宽截图（B） | 临时截图 spec（跑完即删） | 浅/深全页截图目视：双栏并排、图谱/层级行/右栏五面板齐、令牌跟随主题、无红色读取失败横幅（`%TEMP%\mam-57d\home-702-light.png` / `home-702-dark.png`） |

## 3. 包内产物校验（防「写了≠打进包」）

- `app.asar` 列表含 `dist/assets/workspace-BHnZeA6D.js`、`dist/assets/main-DViT5wTz.css`（本次构建产物）。
- 解包实测：
  - ① 壳层 goto 处理器含 `if(n===\`login\`){P(!0);return}` → 特判确在安装包内；
  - ② `main-DViT5wTz.css` 含 `@media (width<=1010px)`（264px 右栏）、`width<=640px`（塌栏点）、`.af-graph{aspect-ratio:760/352 … max-height:330px}`（压缩器把 `max-width` 写成现代 `width<=` 语法，首次按旧写法 grep 未命中属校验脚本误报，已按实语法复核）；
  - ③ 被删的页面告警文本「下方读数按读取失败」在全 asar **0 命中**；壳层顶部条「这不是空账本，概览页会如实标注」仍在。
- 校验方式：`@electron/asar.extractAll` 解到临时目录后逐文件读内容。

## 4. 真机手测清单（待用户在安装版执行）

- [ ] 覆盖安装 `release/installer/MultiAgent Memory-0.1.0-setup.exe`，未登录状态进首页：中心区顶部有「未登录只读条」和（账本未读到时）一条「账本读取失败」提示；**首页内容区不再出现第二条同文红色告警**。
- [ ] 点首页右上「去登录」：**壳层登录弹窗打开**（非无反应），输入真实账号密码可登录成功；登录后页脚变「已登录」、去登录按钮消失、红色读取失败条消失、右侧遥测与今日概览出真实读数。
- [ ] 默认 1280×860 窗（不折叠导航与检查器）：首页**左右双栏并排**——左侧图谱（环轨+六枢纽+层级行）/异常/最近审计，右侧 TOKEN 节省率/补炼/MCP/引擎/今日概览；图谱高度随栏宽比例缩放，无巨幅空白。
- [ ] 折叠右侧检查器（或拉宽窗口）后：右栏回到 300px 宽版式；窗口压到很窄（<640px）才塌成单栏。
- [ ] 浅/深/随系统三主题下版式均不溢出、不叠层；图谱环轨与枢纽颜色跟随主题令牌。
- [ ] 面板「管理/接入/配置」、头部「立即备份/写入记忆」、审计「查看全部审计」各跳转按钮照常打开对应标签（goto 通道回归口径）。
- [ ] 记忆库页（memory-bank）与本轮之前一致（暂停未动），无回归。

## 5. 已知边界

- 浏览器直连（无壳层）时「去登录」按钮仍为 no-op（`requestShellView` 无宿主可投递）——浏览器模式登录走 login.html 直达页；本轮未给 standalone 加回退。
- 检查器/导航栏折叠会改变中心区宽度：断点按 640/1010 两档覆盖，中间宽度右栏 264px。
- 打包时 6 个旧时间戳安装包目录被外部进程占用（EPERM）未删，产物已收口到固定 `release/installer`；不影响本次安装包完整性（与 57-B/57-C 相同口径）。
