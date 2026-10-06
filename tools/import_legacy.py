#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
遗留资料导入器 (import_legacy.py)

把已有资料（需求规格 / 原型 HTML / 章节索引）按本工作法结构归位，
生成索引与门禁，纳入体系（不删原文件，只复制）。

用法:
    python tools/import_legacy.py <源目录> <目标目录> "项目名" ["一句话目标"]

分类规则:
    *_原型.html / *.html          -> design/ui/
    含"索引"的 *.md               -> meta/
    其余 *.md（规格/需求/设计…）  -> specs/
    其他/临时文件                 -> _legacy/（原样保留）
"""
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
SCAFFOLD = TOOLS.parent

GENERIC_DOCS = [
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
    "meta/MIGRATION.md",
]

CORE_RULES = """## 核心规则（压缩）
1. 常驻只 `meta/index.md` + `meta/charter.md`
2. 按需加载、外科编辑
3. 改完跑 `python tools/validate_project.py` + 测试，必须全绿
4. 一切 Git 化、PR 化
5. `specs/` 为单一事实来源（SSOT）
"""


def classify(name: str):
    low = name.lower()
    if low.endswith(".html") or low.endswith(".htm"):
        return "design/ui"
    if low.endswith(".md"):
        return "meta" if "索引" in name else "specs"
    return "_legacy"


def add_frontmatter_if_missing(p: Path, title: str):
    text = p.read_text(encoding="utf-8", errors="ignore")
    if not text.startswith("---"):
        p.write_text(f"---\ntitle: {title}\nstatus: imported\n---\n\n{text}", encoding="utf-8")


def main():
    if len(sys.argv) < 4:
        print('用法: python tools/import_legacy.py <源目录> <目标目录> "项目名" ["一句话目标"]')
        sys.exit(2)

    src = Path(sys.argv[1]).resolve()
    target = Path(sys.argv[2]).resolve()
    name = sys.argv[3]
    goal = sys.argv[4] if len(sys.argv) > 4 else "（待填写）"

    if not src.exists():
        print(f"源目录不存在: {src}")
        sys.exit(1)
    if (target / "meta" / "index.md").exists():
        print(f"目标已初始化（存在 {target / 'meta' / 'index.md'}），已中止。")
        sys.exit(1)

    print(f"导入 '{src}' -> '{target}'（项目：{name}）")
    for d in ["meta", "specs", "design/ui", "samples", "tools", ".github/workflows", "_legacy"]:
        (target / d).mkdir(parents=True, exist_ok=True)

    # 复制通用脚本与文档
    for rel in GENERIC_DOCS:
        s = SCAFFOLD / rel
        if s.exists():
            dst = target / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, dst)

    # 分类归位已有资料
    imported_specs, imported_ui, imported_meta, imported_legacy = [], [], [], []
    for f in sorted(src.rglob("*")):
        if f.is_dir():
            continue
        cat = classify(f.name)
        dst_dir = target / cat
        dst = dst_dir / f.name
        if dst.exists():
            dst = dst_dir / f"{f.stem}_{len(list(dst_dir.iterdir()))}{f.suffix}"
        shutil.copy2(f, dst)
        rel = dst.relative_to(target).as_posix()
        if cat == "design/ui":
            imported_ui.append(rel)
        elif cat == "specs":
            add_frontmatter_if_missing(dst, f.stem)
            imported_specs.append(rel)
        elif cat == "meta":
            imported_meta.append(rel)
        else:
            imported_legacy.append(rel)

    # 生成索引（登记所有 specs / design 产物，避免孤儿）
    lines = [f"# 项目索引（完整性契约）", "",
             f"> 项目：{name}", "> 本文件是唯一入口，也是完整性契约：每个产物都必须在此登记。"]

    def sec(title, rels):
        if not rels:
            return
        lines.append("")
        lines.append(f"## {title}")
        for r in rels:
            lines.append(f"- [{Path(r).name}]({r})")

    sec("规格 specs（导入）", imported_specs)
    sec("设计 design/ui（导入原型）", imported_ui)
    sec("元信息 meta（导入索引）", imported_meta)
    sec("归档 _legacy", imported_legacy)
    lines += ["", "## 元信息 meta（体系）",
              "- 宪章：[meta/charter.md](meta/charter.md)",
              "- 状态快照：[meta/STATE.md](meta/STATE.md)",
              "- 决策：[meta/decisions.md](meta/decisions.md)",
              "- 已有项目迁移：[meta/MIGRATION.md](meta/MIGRATION.md)"]
    (target / "meta" / "index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  写入 meta/index.md（登记导入产物）")

    # 宪章 / 快照 / 决策 / README
    (target / "meta" / "charter.md").write_text(
        f"---\ntitle: 项目宪章\nstatus: active\n---\n\n# 一页纸项目宪章\n\n"
        f"- 项目：{name}\n- 目标：{goal}\n- 范围：（待填写）\n- 非目标：（待填写）\n", encoding="utf-8")
    (target / "meta" / "STATE.md").write_text(
        f"# 项目状态快照（压缩上下文）\n\n## 一句话定位\n{name}：{goal}\n\n"
        f"## 现状\n本仓库由已有资料导入：{len(imported_specs)} 份规格 / {len(imported_ui)} 个原型 / "
        f"{len(imported_meta)} 份索引。待做：把规格提炼为 REQ-xxx，补 code-map。\n\n{CORE_RULES}",
        encoding="utf-8")
    (target / "meta" / "decisions.md").write_text(
        "# 决策日志 (ADR)\n\n## ADR-001 采用遗留资料导入\n- 决策：不重写，先归位再结构化\n", encoding="utf-8")
    (target / "README.md").write_text(
        f"# {name}\n\n> {goal}\n\n由已有资料导入。入口：`meta/index.md`、`SOFTWARE_DEV_STEPS.md`、"
        f"`meta/MIGRATION.md`。\n\n## 命令\n```bash\npython tools/validate_project.py\npython tools/generate.py\n```\n",
        encoding="utf-8")

    print(f"导入完成：{len(imported_specs)} 规格 / {len(imported_ui)} 原型 / "
          f"{len(imported_meta)} 索引 / {len(imported_legacy)} 归档")
    print("\n运行初始门禁校验：")
    subprocess.run([sys.executable, str(target / "tools" / "validate_project.py"), str(target)])
    print("\n下一步：让 Agent 用 meta/MIGRATION.md 的『逆向补全 specs』指令，把规格提炼成 REQ/AC/TC + code-map。")


if __name__ == "__main__":
    main()
