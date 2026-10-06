#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
项目完整性与正确性校验器 (validate_project.py)

不依赖任何第三方库，纯 Python 标准库实现。
用法：
    python tools/validate_project.py            # 默认校验脚本所在项目的根目录
    python tools/validate_project.py <项目根>   # 指定根目录

退出码：0 = 全部通过；1 = 存在失败项。可接入 CI 作门禁。
"""
import os
import re
import sys
from pathlib import Path

# 编号：REQ-001 / AC-001 / TC-001
ID_RE = re.compile(r'(REQ|AC|TC)-(\d+)')
LINK_RE = re.compile(r'\[[^\]]+\]\(([^)]+)\)')
ANCHOR_RE = re.compile(r'#.*$')

# 需要被索引覆盖的产物目录
ARTIFACT_DIRS = ["specs", "design", "samples"]


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.checks = 0

    def ok(self, msg):
        self.checks += 1
        print(f"  [OK]   {msg}")

    def fail(self, msg):
        self.checks += 1
        self.errors.append(msg)
        print(f"  [FAIL] {msg}")

    def warn(self, msg):
        self.warnings.append(msg)
        print(f"  [WARN] {msg}")


def collect_ids(text):
    return set(m.group(0) for m in ID_RE.finditer(text))


def frontmatter_status(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            block = text[3:end]
            for line in block.splitlines():
                if line.strip().lower().startswith("status:"):
                    return line.split(":", 1)[1].strip()
    return None


def segment_blocks(text, prefix):
    """按 AC-/TC- 标题切分文本，返回 [(block_id, segment_text), ...]"""
    blocks = []
    cur_id = None
    cur_buf = []
    for line in text.splitlines():
        m = re.search(r'#+\s*.*(' + prefix + r'-\d+)', line)
        if m:
            if cur_id:
                blocks.append((cur_id, "\n".join(cur_buf)))
            cur_id = m.group(1)
            cur_buf = [line]
        elif cur_id:
            cur_buf.append(line)
    if cur_id:
        blocks.append((cur_id, "\n".join(cur_buf)))
    return blocks


def main(root: Path):
    print(f"== 校验项目: {root} ==")
    r = Report()

    # ---------- 0. 索引存在性 ----------
    index = root / "meta" / "index.md"
    link_norm = set()
    if not index.exists():
        r.fail("缺少 meta/index.md（项目索引 / 完整性契约）")
        return finish(r)
    idx_text = index.read_text(encoding="utf-8")
    links = LINK_RE.findall(idx_text)
    for lnk in links:
        clean = ANCHOR_RE.sub("", lnk).strip()
        if not clean:
            continue
        norm = os.path.normpath(clean)
        link_norm.add(norm)
        target = root / norm
        if not target.exists():
            r.fail(f"索引死链: {lnk} -> 文件不存在")
    r.ok(f"索引链接检查完成，共 {len(links)} 条")

    # ---------- 1. 死链 / 全量 ID 收集 ----------
    all_ids = {}        # 所有出现过的编号（用于引用完整性判断）
    defined_ids = {}    # 仅在标题中"定义"的编号（用于唯一性判断）
    spec_files = []
    for d in ARTIFACT_DIRS:
        base = root / d
        if base.exists():
            for p in base.rglob("*"):
                if p.suffix in (".md", ".html"):
                    spec_files.append(p)
                    txt = p.read_text(encoding="utf-8", errors="ignore")
                    for iid in collect_ids(txt):
                        all_ids.setdefault(iid, []).append(str(p))
                    for line in txt.splitlines():
                        if line.lstrip().startswith("#"):
                            m = ID_RE.search(line)
                            if m:
                                # 只有"归属规范文件"里的同前缀标题才算定义，避免映射/引用文档误报
                                prefix = m.group(1)
                                kw = {"REQ": "requirements", "AC": "acceptance", "TC": "test-plan"}.get(prefix)
                                if kw and kw.lower() in str(p).lower():
                                    defined_ids.setdefault(m.group(0), []).append(str(p))

    # ---------- 2. ID 唯一性（只查"定义"，引用不算）----------
    dup = {i: ps for i, ps in defined_ids.items() if len(ps) > 1}
    if dup:
        for i, ps in dup.items():
            r.fail(f"编号重复定义: {i} 出现在 {ps}")
    else:
        r.ok(f"编号唯一性检查完成，扫描到 {len(defined_ids)} 个定义编号")

    # ---------- 3. 引用完整性：AC -> REQ ----------
    req_ids = {i for i in all_ids if i.startswith("REQ-")}
    acc = root / "specs" / "acceptance.md"
    if acc.exists():
        blocks = segment_blocks(acc.read_text(encoding="utf-8"), "AC")
        broken = [b for b, seg in blocks if not (req_ids & collect_ids(seg))]
        if broken:
            for b in broken:
                r.fail(f"{b} 未引用任何 REQ 编号")
        else:
            r.ok(f"验收引用检查完成，{len(blocks)} 个 AC 均关联到 REQ")
    else:
        r.warn("未找到 specs/acceptance.md，跳过 AC->REQ 检查")

    # ---------- 4. 引用完整性：TC -> AC ----------
    ac_ids = {i for i in all_ids if i.startswith("AC-")}
    tp = root / "specs" / "test-plan.md"
    if tp.exists():
        blocks = segment_blocks(tp.read_text(encoding="utf-8"), "TC")
        broken = [b for b, seg in blocks if not (ac_ids & collect_ids(seg))]
        if broken:
            for b in broken:
                r.fail(f"{b} 未引用任何 AC 编号")
        else:
            r.ok(f"测试引用检查完成，{len(blocks)} 个 TC 均关联到 AC")
    else:
        r.warn("未找到 specs/test-plan.md，跳过 TC->AC 检查")

    # ---------- 5. 孤儿文件 ----------
    orphans = []
    for p in spec_files:
        rel = os.path.normpath(str(p.relative_to(root)))
        if rel not in link_norm:
            orphans.append(rel)
    if orphans:
        for o in orphans:
            r.warn(f"孤儿文件（未被索引引用）: {o}")
    else:
        r.ok(f"孤儿文件检查完成，{len(spec_files)} 个产物均被索引覆盖")

    # ---------- 6. frontmatter status ----------
    missing_status = []
    for p in root.glob("specs/*.md"):
        st = frontmatter_status(p.read_text(encoding="utf-8", errors="ignore"))
        if st is None:
            missing_status.append(str(p.relative_to(root)))
    if missing_status:
        for m in missing_status:
            r.warn(f"缺少 frontmatter status: {m}")
    else:
        r.ok("specs 文件 frontmatter 检查完成")

    return finish(r)


def finish(r):
    print("-" * 48)
    print(f"检查项 {r.checks} | 失败 {len(r.errors)} | 警告 {len(r.warnings)}")
    if r.errors:
        print("结果: 不通过（存在失败项，请修复后再合入）")
        return 1
    print("结果: 通过 ✅")
    return 0


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    sys.exit(main(root))
