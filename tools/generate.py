#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成脚本 (generate.py) —— 从 specs/ 单一事实来源重建产物到 build/

作用：
  - 把"重建文档/UI"变成一条命令，而非手工重写（解决原始痛点：改动即重建）
  - 产物可丢弃、可复现：重新运行即证明 specs -> 产物 一致（完整性）
  - --check 模式供 CI 校验 build/ 是否与 specs 同步，不同步则退出 1

用法：
  python tools/generate.py            # 生成 build/SPEC.md, build/TRACE.md, build/SPEC.html
  python tools/generate.py --check   # 仅校验同步，不同步退出 1（CI 门禁）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECS = ROOT / "specs"
BUILD = ROOT / "build"

ID_RE = re.compile(r'^(#{2,4})\s+(REQ|AC|TC)-(\d+)\s*(.*)$')
REF_RE = re.compile(r'(REQ|AC|TC)-(\d+)')


def parse_items(path):
    """解析规范文件，返回 [{id, kind, num, title, body, refs:set}]"""
    if not path.exists():
        return []
    items = []
    cur = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = ID_RE.match(line)
        if m:
            if cur:
                items.append(cur)
            cur = {
                "id": f"{m.group(2)}-{m.group(3)}",
                "kind": m.group(2),
                "num": int(m.group(3)),
                "title": m.group(4).strip(),
                "body": [],
                "refs": set(),
            }
        elif cur is not None:
            cur["body"].append(line)
            for r in REF_RE.findall(line):
                cur["refs"].add(f"{r[0]}-{r[1]}")
    if cur:
        items.append(cur)
    for it in items:
        it["body"] = "\n".join(it["body"]).strip()
    return items


def render_spec_md(reqs, acs, tcs):
    out = ["# 项目规格（自动生成 · 勿手改）", "",
           "> 本文件由 `tools/generate.py` 从 `specs/` 生成，请勿直接编辑；改 specs 后重新生成。", ""]
    out += ["## 需求", ""]
    for it in reqs:
        out += [f"### {it['id']} {it['title']}", "", it["body"], ""]
    out += ["## 验收标准", ""]
    for it in acs:
        out += [f"### {it['id']} {it['title']}", "", it["body"], ""]
    out += ["## 测试用例", ""]
    for it in tcs:
        out += [f"### {it['id']} {it['title']}", "", it["body"], ""]
    return "\n".join(out).rstrip() + "\n"


def render_trace_md(reqs, acs, tcs):
    ac_by_req = {r["id"]: [a["id"] for a in acs if r["id"] in a["refs"]] for r in reqs}
    tc_by_ac = {a["id"]: [t["id"] for t in tcs if a["id"] in t["refs"]] for a in acs}
    out = ["# 可追溯矩阵（自动生成 · 勿手改）", "",
           "| REQ | 需求 | AC | 验收 | TC | 测试 |",
           "|-----|------|----|------|----|------|"]
    for r in reqs:
        acs_ids = ac_by_req[r["id"]]
        row_tcs = []
        for a in acs_ids:
            row_tcs += tc_by_ac.get(a, [])
        out.append("| {req} | {rt} | {ac} | {at} | {tc} | {tt} |".format(
            req=r["id"], rt=r["title"],
            ac=" / ".join(acs_ids) or "-",
            at=" / ".join(a["title"] for a in acs if a["id"] in acs_ids) or "-",
            tc=" / ".join(row_tcs) or "-",
            tt=" / ".join(t["title"] for t in tcs if t["id"] in row_tcs) or "-",
        ))
    return "\n".join(out).rstrip() + "\n"


def render_spec_html(reqs, acs, tcs, trace_md):
    def section(title, items):
        rows = ""
        for it in items:
            rows += f"<div class='card'><h3>{it['id']} {it['title']}</h3><pre>{it['body']}</pre></div>\n"
        return f"<section><h2>{title}</h2>{rows}</section>"

    # 把可追溯矩阵的 markdown 表格转成 HTML 表格
    tlines = [l for l in trace_md.splitlines() if l.strip().startswith("|")]
    table = ""
    if tlines:
        header = [h.strip() for h in tlines[0].strip("|").split("|")]
        table = "<table><tr>" + "".join(f"<th>{h}</th>" for h in header) + "</tr>"
        for l in tlines[1:]:
            cells = [c.strip() for c in l.strip("|").split("|")]
            table += "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"
        table += "</table>"

    html = f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>项目规格报告</title>
<style>
 body{{font-family:system-ui,'Microsoft YaHei',sans-serif;margin:2rem;color:#222}}
 h1{{border-bottom:2px solid #4a90d9;padding-bottom:.3rem}}
 h2{{color:#4a90d9;margin-top:2rem}}
 .card{{border:1px solid #ddd;border-radius:8px;padding:.8rem 1rem;margin:.6rem 0;background:#fafafa}}
 pre{{white-space:pre-wrap;font-size:.9rem}}
 table{{border-collapse:collapse;width:100%;margin-top:1rem}}
 th,td{{border:1px solid #ccc;padding:.5rem;text-align:left}}
 th{{background:#4a90d9;color:#fff}}
</style></head><body>
<h1>项目规格报告（自动生成）</h1>
{section('需求', reqs)}
{section('验收标准', acs)}
{section('测试用例', tcs)}
<section><h2>可追溯矩阵</h2>
{table}
</section>
</body></html>"""
    return html


def main():
    check = "--check" in sys.argv
    reqs = parse_items(SPECS / "requirements.md")
    acs = parse_items(SPECS / "acceptance.md")
    tcs = parse_items(SPECS / "test-plan.md")

    spec_md = render_spec_md(reqs, acs, tcs)
    trace_md = render_trace_md(reqs, acs, tcs)
    spec_html = render_spec_html(reqs, acs, tcs, trace_md)

    targets = {
        BUILD / "SPEC.md": spec_md,
        BUILD / "TRACE.md": trace_md,
        BUILD / "SPEC.html": spec_html,
    }

    BUILD.mkdir(exist_ok=True)

    if check:
        dirty = []
        for path, content in targets.items():
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                dirty.append(str(path.relative_to(ROOT)))
        if dirty:
            print("BUILD 不同步（请运行 python tools/generate.py）：")
            for d in dirty:
                print(f"  - {d}")
            sys.exit(1)
        print("BUILD 与 specs 同步 ✅")
        sys.exit(0)

    for path, content in targets.items():
        path.write_text(content, encoding="utf-8")
        print(f"生成: {path.relative_to(ROOT)}")

    print(f"完成：{len(reqs)} 需求 / {len(acs)} 验收 / {len(tcs)} 测试 -> build/")


if __name__ == "__main__":
    main()
