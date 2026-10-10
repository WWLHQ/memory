# 全流程工作流 SOP（任务生命周期 · 固化版）

> 本文件是**主流程**，把已有的 [`TASK_SPLITTING.md`](TASK_SPLITTING.md)（任务长什么样）和
> [`CODING_SOP.md`](CODING_SOP.md)（怎么执行单个任务）串成一条**端到端、可复现**的生命周期。
> 本流程已在 2026-10-09 经「REQ-003/004/005 + 用户注册」完整跑通并人工验收通过，
> 固化为强制规范：**后续每个任务都必须按此流程走**，不得擅自减步。
>
> 适用命令（以 `package.json` 为准）：
> - `npm run typecheck` → `tsc --noEmit`
> - `npm test` → `vitest run`
> - `npm run test:e2e` → `node e2e/run.mjs --workers=1`
> - `npm run verify` → `typecheck && test && validate_project.py && generate.py --check`

---

## 〇、总览（一张图）

```
 需求/REQ
   │
   ▼
① 任务拆分 ── TASK_SPLITTING（8 属性，缺一项不开工）
   │
   ▼
② 逐任务编码 ── CODING_SOP（7 步循环，TDD + 外科修改）
   │
   ▼
③ 自检门禁 ── 交人之前先自己跑绿（typecheck + vitest + e2e + verify）
   │   ├─ 全绿？── 否 ──▶ ④ 修 BUG（记 pitfalls）── 回到 ③
   │   │
   │  是
   ▼
⑤ 人工验收 ── 组合 REQ 演示（overview.html），人点头才算过
   │   ├─ 通过？── 否 ──▶ ④ 修 BUG ── 回到 ③
   │   │
   │  是
   ▼
⑥ 提交 ── 中文 commit message，一个任务一个 commit
   │
   ▼
⑦ 收尾 ── 更新 STATE.md / pitfalls 记忆，进入下一个任务
```

**核心纪律**：③ 自检门禁必须在 ⑤ 人工验收**之前**全绿。
不把"自己都没跑绿的代码"交给人验收 —— 否则浪费人的时间、消耗信任。

---

## ① 任务拆分（TASK_SPLITTING）

- 依据需求把工作拆成**原子任务**，每个任务必须写满 8 属性（单一目标 / 输入 / 输出 / 验收 / 边界 / 依赖 / 上下文可控 / 可独立提交）。
- 拆分第一原则：**拆给模型吃**，不是拆给人看**。每个任务相关文件不超过窗口 30%~50%，否则继续拆。
- 任务清单落地为 `specs/tasks/*.md`，并形成 DAG（依赖关系）。
- 参考：[`meta/TASK_SPLITTING.md`](TASK_SPLITTING.md)。

---

## ② 逐任务编码（CODING_SOP）

对每个原子任务执行 7 步循环：

1. **领任务**：明确 `T{n}` 与单一目标。
2. **读输入**：只打开任务「输入」字段指定的文件。
3. **定契约**：先写失败测试（TDD）。
4. **外科实现**：只在「边界」内做局部 Edit，不整体重写。
5. **跑验收**：执行任务「验收」命令，必须全绿。
6. **跑门禁**：`python tools/validate_project.py` 0 失败。
7. **提交**：一个 commit，message 含 `T{n}`（**注意：本流程把提交放到第 ⑥ 步做完人工验收后再做**，避免反复 amend）。

参考：[`meta/CODING_SOP.md`](CODING_SOP.md)。

> ⚠️ 与 CODING_SOP 的差异：CODING_SOP 第 7 步「提交」在编码阶段完成即做。
> 本主流程要求**编码阶段只保证本任务验收绿 + validate 绿**，正式的 commit 推迟到第 ⑥ 步（人工验收后）统一做，
> 原因是：自检门禁和人工验收还可能暴露 BUG，提前提交会导致反复 amend 污染历史。

---

## ③ 自检门禁（交人之前必跑，缺一不可）

**这是本流程最关键的一道闸**。编码完成后、交人验收之前，必须在本机依次跑通：

| 顺序 | 命令 | 判据 | 失败即 |
|------|------|------|--------|
| 1 | `npm run typecheck` | 0 错误 | 修类型，回到 ② |
| 2 | `npm test` | 全部测试绿（当前 178/178） | 修单测/实现，回到 ② |
| 3 | `npm run test:e2e` | 全部 E2E 绿（当前 24/24）+ **无静默 SIGTERM** | 修 E2E/实现，回 ② |
| 4 | `npm run verify` | 串联 1+2+`validate_project.py`+`generate.py --check` 全绿 | 修后回到 1 |

**E2E 静默失败红线**（踩过坑）：
- 必须确认进程**正常退出**，不能出现"无输出被 SIGTERM"——那是 worker 退出被吊住。
- 跑完看一眼末尾是否有 `SIGTERM` 字样 / 非零退出码；有则查 teardown 里的挂起句柄（CDP / keep-alive socket）。
- 当前稳定配置：`test:e2e` 已带 `--workers=1`；harness 走 `ws://` 直连 + 3s 超时兜底（见 pitfalls #11）。

**门禁未全绿，禁止进入 ⑤ 人工验收。**

踩坑记录实时沉淀到 `.workbuddy/memory/pitfalls-*.md`，新增坑按 `## N.` 续写（当前已到 #13）。

---

## ④ 修 BUG（贯穿 ③ 与 ⑤ 之间）

- 自检或人工验收发现的任何问题，先**定位根因**再修，禁止"试一试"。
- 真实 BUG（如 CORS 白名单漏头、跨 iframe 登录态）优先修代码；测试耦合问题（如登录门控后 E2E 需预置 session）同步修测试。
- 每修一类坑，立即补一条 pitfalls 记录（现象 / 根因 / 修复 / 教训），见 [`BUG_SOP.md`](BUG_SOP.md) 与 pitfalls 文件。
- 修复后**必须回到 ③ 重跑门禁**，确认没引入回归。

---

## ⑤ 人工验收（人点头才算过）

- 自检门禁全绿后，启动本地服务，做**组合 REQ 演示**（而非单任务演示）：
  - 后端：`node --experimental-strip-types tools/dev-backend.mjs`（或对应 home server）
  - 前端：`vite` 静态服务（当前 `http://localhost:8127/overview.html`）
  - 演示路径覆盖本次涉及的所有 REQ 主流程 + 边界（登录 / 跨 iframe / 回退占位等）。
- 验收方式：人手动点；人确认「人工验收通过」后进入 ⑥。
- 若人提出改动 → 回到 ④ → ③ → ⑤。

> 注意：本地服务用 `run_in_background=true` 持久任务拉起，不要用 `&`（Windows 下工具调用结束即被杀，见 pitfalls #2）。

---

## ⑥ 提交（中文 message，一个任务一个 commit）

- 验收通过后，按任务提交。**一个原子任务 = 一个 commit**，message 用中文，含 `T{n}` 与目标。
  - 例：`feat(T4): 实现密码哈希函数`、`fix(server): CORS 白名单补 x-auth-session`
- 禁止把多个任务 / 多类改动混进一个 commit（破坏可回滚）。
- 禁止提前提交（见 ② 末尾警告）。
- 提交的代码必须对应「自检门禁全绿 + 人工验收通过」的状态。

---

## ⑦ 收尾（记忆与状态更新）

- 更新 `meta/STATE.md`：当前 REQ 进度、已完成任务、下一步。
- 更新 `.workbuddy/memory/` 当日日志 + pitfalls 文档（新坑续写）。
- 在 `meta/index.md` 确认新产物已登记（完整性契约）。
- 回到 ① 拆下一个 REQ / 下一个任务。

---

## 红线汇总（禁止）

- ❌ 跳过 ③ 自检门禁直接交人验收。
- ❌ E2E 出现静默 SIGTERM 仍当"通过"。
- ❌ 把没跑绿的代码提交。
- ❌ 多个任务混一个 commit。
- ❌ 越「边界」改文件 / 整体重写（用局部 Edit）。
- ❌ 不记 pitfalls（踩过的坑必须沉淀，防再犯）。

---

## 与既有 SOP 的关系

| 文件 | 角色 |
|------|------|
| `meta/TASK_SPLITTING.md` | 任务长什么样（8 属性） |
| `meta/CODING_SOP.md` | 单个任务怎么执行（7 步） |
| `meta/BUG_SOP.md` | BUG 事中处理流程 |
| `meta/DEBUG_READINESS.md` | BUG 事前可定位性准备 |
| **`meta/WORKFLOW_SOP.md`（本文件）** | **主流程：把上面串成生命周期，并强制「自检→人工验收→提交」顺序** |

简写：TDD=测试驱动开发 / E2E=端到端 / CI=持续集成 / DAG=有向无环图 / PR=合并请求。
