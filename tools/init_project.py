#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
项目初始化脚手架生成器 (init_project.py)

把一个空目录初始化成"低 token / 可校验 / 可维护"的项目骨架。

用法:
    python tools/init_project.py <目标目录> "项目名" ["一句话目标"]

说明:
    请在本工作法仓库内运行——脚本会从同级目录(tools/)复制 validate_project.py、
    generate.py，并从仓库根复制通用文档与 CI 配置到目标项目。
"""
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
SCAFFOLD = TOOLS.parent

CORE_RULES = """## 核心规则（压缩）
1. 常驻只 `meta/index.md` + `meta/charter.md`（约 2k token）
2. 按需加载、外科编辑（只改相关文件/章节，不整体重写）
3. 每阶段结束跑 `python tools/validate_project.py` + 测试，必须全绿
4. 一切 Git 化、PR 化（可 diff / 回滚 / 审计）
5. `specs/` 为单一事实来源（SSOT）；`REQ ↔ AC ↔ TC` 编号一一对应
"""

FLOW = """## 推荐流程（11 步）
1. 需求提出与收集
2. 需求分析与评审
3. 产品与交互设计
4. 技术方案设计
5. 项目计划与任务拆分
6. 编码开发
7. 测试验证
8. 预发布与验收
9. 发布上线到生产
10. 生产运维与监控
11. 反馈与迭代（回到第 1 步）
"""

GLOSSARY = """## 简写对照（中文）
| 简写 | 中文 |
|------|------|
| SSOT | 单一事实来源 |
| REQ  | 需求 |
| AC   | 验收标准 |
| TC   | 测试用例 |
| ADR  | 决策记录 |
| DoD  | 完成定义 |
| TDD  | 测试驱动开发 |
| PR   | 合并请求 |
| CI   | 持续集成 |
| UI   | 用户界面 |
| SOP  | 标准作业程序 |
"""

COPY_LIST = [
    "tools/validate_project.py",
    "tools/generate.py",
    ".github/workflows/ci.yml",
    ".gitignore",
    "AI_AGENT_PROJECT_PLAYBOOK.md",
    "SOFTWARE_DEV_STEPS.md",
    "meta/MAINTENANCE.md",
    "meta/TASK_SPLITTING.md",
    "meta/CODING_SOP.md",
    "meta/DEBUG_READINESS.md",
    "meta/BUG_SOP.md",
]


def write(target: Path, rel: str, content: str):
    p = target / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    print(f"  写入 {rel}")


def copy(target: Path, rel: str):
    src = SCAFFOLD / rel
    if not src.exists():
        print(f"  [跳过] 源不存在 {rel}")
        return
    dst = target / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"  复制 {rel}")


def main():
    if len(sys.argv) < 3:
        print('用法: python tools/init_project.py <目标目录> "项目名" ["一句话目标"]')
        sys.exit(2)

    target = Path(sys.argv[1]).resolve()
    name = sys.argv[2]
    goal = sys.argv[3] if len(sys.argv) > 3 else "（待填写）"

    if (target / "meta" / "index.md").exists():
        print(f"目标已初始化（已存在 {target / 'meta' / 'index.md'}），已中止。")
        sys.exit(1)

    print(f"初始化项目 '{name}' -> {target}")
    for d in ["meta", "specs", "design/ui", "samples", "tools", ".github/workflows"]:
        (target / d).mkdir(parents=True, exist_ok=True)

    for rel in COPY_LIST:
        copy(target, rel)

    write(target, "meta/charter.md", f"""---
title: 项目宪章
status: active
---

# 一页纸项目宪章

- 项目：{name}
- 目标：{goal}
- 范围：（待填写）
- 非目标：（待填写）
- 关键决策：
""")

    write(target, "meta/index.md", f"""# 项目索引（完整性契约）

> 项目：{name}
> 本文件是项目唯一入口，也是完整性契约：每个产物都必须在此登记，且每个登记项都必须真实存在。

## 元信息 meta
- 宪章：[meta/charter.md](meta/charter.md)
- 状态快照：[meta/STATE.md](meta/STATE.md)
- 决策：[meta/decisions.md](meta/decisions.md)
- 维护手册：[meta/MAINTENANCE.md](meta/MAINTENANCE.md)
- 任务拆分规范：[meta/TASK_SPLITTING.md](meta/TASK_SPLITTING.md)
- 编码执行 SOP：[meta/CODING_SOP.md](meta/CODING_SOP.md)
- BUG 可定位性（事前）：[meta/DEBUG_READINESS.md](meta/DEBUG_READINESS.md)
- BUG 处理 SOP（事中）：[meta/BUG_SOP.md](meta/BUG_SOP.md)

## 规格 specs
- 需求：[specs/requirements.md](specs/requirements.md)
- 验收：[specs/acceptance.md](specs/acceptance.md)
- 测试：[specs/test-plan.md](specs/test-plan.md)
""")

    write(target, "meta/STATE.md", f"""# 项目状态快照（压缩上下文 · 新会话直读）

> 本文件是"会话压缩"产物：新会话只需读 `meta/index.md` + 本文件即可接手，无需重读全部文档。

## 一句话定位
{name}：{goal}

{CORE_RULES}
{FLOW}
## 当前产物清单
- 待补充（随开发更新）

{GLOSSARY}""")

    write(target, "meta/decisions.md", """# 决策日志 (ADR)

## ADR 模板
- 日期：
- 决策：
- 原因：
- 影响：
""")

    write(target, "specs/requirements.md", """---
title: 需求规格
status: draft
owner:
---

# 需求规格

## REQ-001 示例需求（请替换）
描述这个需求的一句话。

<!-- 新增需求：写 ## REQ-002 ...，并同步在 acceptance.md 加 AC-002、test-plan.md 加 TC-002 -->
""")

    write(target, "specs/acceptance.md", """---
title: 验收标准
status: draft
---

# 验收标准

## AC-001 示例验收
对应 REQ-001：可观测的验收结果。
""")

    write(target, "specs/test-plan.md", """---
title: 测试标准
status: draft
---

# 测试标准

## TC-001 示例测试
对应 AC-001：一条命令即可验证。
""")

    write(target, "README.md", f"""# {name}

> {goal}

本仓库采用"低 token / 可校验 / 可维护"工作法。入口：
- 方法论：`AI_AGENT_PROJECT_PLAYBOOK.md`
- 开发步骤：`SOFTWARE_DEV_STEPS.md`
- 日常 SOP：`meta/MAINTENANCE.md`
- 项目索引（契约）：`meta/index.md`

## 与 Agent 协作的开场白
```
你是本项目的协作者。请严格遵守工作规则：
1. 每次先只读 meta/index.md 和 meta/charter.md，不要加载其他文件。
2. 改动只打开相关文件，做外科手术式局部编辑，不要整体重写。
3. 需求/验收/测试用 REQ-/AC-/TC- 编号互相引用，一一对应。
4. 改完运行 python tools/validate_project.py，必须 0 失败才能交付。
5. 新增产物文件必须在 meta/index.md 登记。
请先读 meta/index.md 和 meta/charter.md，确认理解范围，再等我的任务。
```

## 常用命令
```bash
python tools/validate_project.py   # 完整性/正确性门禁，0 失败=可合入
python tools/generate.py           # 由 specs/ 重建 build/
python tools/generate.py --check   # CI 校验 build 与 specs 同步
```
""")

    print("\n运行初始门禁校验：")
    subprocess.run([sys.executable, str(target / "tools" / "validate_project.py"), str(target)])
    print("\n完成。下一步：编辑 specs/ 写你的真实需求，再跑 generate.py + validate_project.py。")


if __name__ == "__main__":
    main()
