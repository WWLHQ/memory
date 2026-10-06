# 已有项目怎么纳入本工作法（迁移指南）

> 适用：已经写了一半/上线的老项目，想用这套"低 token / 可校验 / 可维护 / BUG 可定位"的体系，但不想推倒重写。
> 核心原则：**不重写，渐进式纳入**。骨架与现有代码并存，先补"可追溯性"，再让新改动走新流程。

---

## 先分清两种情况

- **A. 空工作区**（如刚建的项目目录，里面还没代码）→ 直接用 `tools/init_project.py` 初始化即可（见 `README.md`「在新项目里初始化」）。
- **B. 已有代码的项目** → 走下面的迁移流程。

---

## 迁移流程（针对情况 B）

### 1. 种骨架（不动现有代码）
在本仓库运行，把 `meta/`、`specs/`、`tools/`、CI 生成到你的项目目录：
```bash
python tools/init_project.py "D:/path/to/老项目" "老项目名称" "一句话目标"
```
> init 只新增目录，**不会改动你已有的源码**，可放心跑。

### 2. 逆向补全 specs（让老代码"可定位"）
让 Agent 读现有代码，**反向**产出规范文档：
- `specs/requirements.md`：按代码实际功能提炼成 `REQ-xxx`
- `specs/acceptance.md` / `specs/test-plan.md`：对应 `AC` / `TC`
- `specs/code-map.md`：每个 `REQ` → 文件 → 函数 → 现有测试（这就是 BUG 可定位的桥梁）
- `known-issues.md`：已知坑/隐患

### 3. 选一个模块试点
挑一个**小且独立**的模块，按 [`meta/TASK_SPLITTING.md`](meta/TASK_SPLITTING.md) 拆成原子任务，用 [`meta/CODING_SOP.md`](meta/CODING_SOP.md) 改一次，跑 `validate` + `generate`，确认闭环顺畅。

### 4. 童子军法则（Boy Scout）
以后**每碰一段旧代码**，顺手做三件小事：
- 补/修该段的测试（让 `TC` 红能定位它）
- 在文件头加 `// REQ-xxx` 注释（接入 code-map）
- 更新 `known-issues.md`

不要求一次性全拆，碰到的才改。

### 5. 接 CI
`git init` + 推送后，[`.github/workflows/ci.yml`](.github/workflows/ci.yml) 自动跑门禁。

---

## 给 Agent 的「逆向补全 specs」指令模板

```
把现有项目纳入工作法体系：
1) 先读项目源码，理解它实际做什么；
2) 用 tools/init_project.py 已生成 meta/specs/tools（勿改源码）；
3) 把代码真实功能提炼成 specs/requirements.md 的 REQ-xxx（按模块分）；
4) 为每个 REQ 补 AC-xxx / TC-xxx 到 acceptance.md / test-plan.md；
5) 写 specs/code-map.md：REQ → 文件 → 关键函数 → 现有测试/验收命令；
6) 写 known-issues.md：已知隐患；
7) 跑 python tools/validate_project.py 必须全绿。
不要重写现有代码，只补文档与映射。
```

---

## 注意事项
- 老代码没测试 → 先补**关键路径**测试再动它，避免改出回归。
- 不要一次性全量拆分历史代码，按"改动驱动"渐进。
- `code-map.md` 是桥梁：补了它，老项目也立刻具备 BUG 秒级定位能力。
- 存量代码用 `生成脚本` 不参与；只有 `specs/` 是真相源，老代码是"既成事实"，映射到 specs 即可。

---

## 与新建项目的区别
| | 新建项目 | 已有项目 |
|---|---|---|
| 起点 | 空目录 + init | 有代码 + init |
| specs 来源 | 你写需求 | Agent 逆向提炼现有功能 |
| 第一批测试 | 随任务写 | 先补关键路径 |
| 节奏 | 全程新流程 | 新改动走新流程，旧代码碰才改 |
