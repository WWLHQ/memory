# 项目长期记忆（MEMORY.md）

## 仓库与 CI
- 远端：`https://github.com/WWLHQ/memory`（公开仓，默认分支 `main`），GitHub Actions 跑 CI。
- CI 门禁三道（`.github/workflows/ci.yml`）：`npm test` → `python tools/validate_project.py` → `python tools/generate.py --check`。
- **关键约定**：`build/` 是 SSOT 产物、**gitignored 不入库**。CI 必须**先 `python tools/generate.py` 重建 build/，再 `generate.py --check`**，否则全新 checkout 下 `--check` 必红（build/ 不存在）。
- 本地零依赖：`node --test`（Node 22 内置），无需 `npm install`；`npm test` 跑全部 45 例。

## Git / 推送习惯
- 本机无 `gh` CLI、Bash 工具非交互；推 GitHub 用 classic PAT。
- **推送含 `.github/workflows/*.yml` 的提交，PAT 必须带 `workflow` 作用域**（仅 `repo`/`public_repo` 不够）。
- 推完立即 `git remote set-url origin <干净URL>` 去除 token，并建议在 GitHub 删除该 PAT。
- 任务提交粒度：每原子任务（T1/T2…）单 commit；CICD 配置修复走 PR 验证双触发。

## 当前进度
- REQ-003（Agent 接入页）代码全量落盘（T1–T12），T1/T2 已分别 commit；T3–T12 此前写入但未逐任务提交。
- 下一步候选：补 T3–T12 逐任务 commit；或推进 REQ-004~REQ-012（补字段级 AC/TC + 跑通一个功能）。

## 提交约定
- **每次提交必须写提交日志**（conventional commit 风格）：`type(scope): 简述`（首行 ≤72 字），空行，正文写 Why/What/影响范围，结尾 `Co-Authored-By: CodeBuddy Code <noreply@codebuddy.ai>`。2026-10-07 起生效，CodeBuddy 每次 commit 遵守。
- 原子任务理想每任务一 commit；但 REQ-003 全量代码已在 initial commit `04cb27b` 打包（未逐任务拆）。决策：不重写已推送历史，改为在 `specs/code-map.md` 写任务→文件/函数归属以保证可追溯。

## 执行流程约定（用户 2026-10-07 明确）
- **每完成一个原子任务（一步），先展示成果（测试/门禁输出 + 改动清单），等人工确认后再继续下一步。** 不擅自连跑多步。
- 接真实后端按 T13→T14→T15 原子推进，沿用 TDD + 每任务一 commit + 门禁（npm test / validate / generate --check）。

## 实现与规格的差异（REQ-003）
- `specs/tasks/AGENT-ONBOARD.md` 按 TS+React 拆 `src/web/AgentOnboard/*.tsx` 单组件；**实际落地为纯 ESM JS**（零依赖、Node 内置 `node:test`），UI 合并进 `src/agentOnboard/render.js`、集成进 `service.js`、端矩阵进 `formMatrix.js`、`validators.js` 承载 R1–R10、`e2e.test.js` 承载 T12。可追溯映射以实际 JS 为准（见 `specs/code-map.md` REQ-003 任务级表）。

## 项目纯净度约定（用户 2026-10-10 明确）
- **验收/验证完成后，验证用的临时文件必须删除**（如 test-results/、失败截图、临时 html/log、一次性脚本）。
- **项目文件夹保持纯净**：与项目无关的文件及时清理，不留在仓库根目录。
- Windows 下避免产生 `nul` 垃圾文件（Git Bash 里 `> NUL` 会生成名为 nul 的实体文件，应使用 `> /dev/null`）。
- 验收收尾时默认执行一轮垃圾清扫并汇报清理清单，再走 commit。
- **入口 html / 产物文件名一律全小写**：Windows 文件系统大小写不敏感会掩盖 URL 与文件名的大小写错位，Linux CI 上直接 404（P13 时期 inlineAttribution.html 教训，5726a35 修复）。新增页面入口时命名前先确认。
- 跨平台排查 CI 失败：本地 WSL Ubuntu clone 到 ~/ 本地盘（勿在 /mnt 挂载盘 npm ci，会 EIO 损坏 Windows node_modules）跑 CI 同款命令（--workers=1）即可复刻；node_modules 损坏用 npm install 增量修复。
