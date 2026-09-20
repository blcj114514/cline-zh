# -*- coding: utf-8 -*-
# 路径解析（开源友好）：优先环境变量，其次脚本所在目录
import os, sys
BASE = os.environ.get("CLINE_AUDIT_DIR") or os.path.dirname(os.path.abspath(__file__))
ZH = os.environ.get("CLINE_ZH_DIR") or os.path.join(os.path.dirname(BASE), "cline-zh")
def _find_cline_app():
    """按 环境变量 -> 常见安装目录 顺序定位 cline-app.exe；都没找到则返回带提示的猜测值。"""
    env = os.environ.get("CLINE_APP_EXE")
    if env and os.path.exists(env):
        return env
    cands = [
        r"E:\Cline\cline-app.exe",
        r"D:\Cline\cline-app.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Cline", "cline-app.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Cline", "cline-app.exe"),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    return env or cands[0]
APP = _find_cline_app()
# -*- coding: utf-8 -*-
"""Coverage check: how much of the extracted UI copy is now translated."""
import os, re, json

A = BASE
Z = ZH

DICT = json.load(open(os.path.join(Z, "dict.json"), encoding="utf-8"))
RULES = [(re.compile(r[0]), r[1]) for r in json.load(open(os.path.join(Z, "rules.json"), encoding="utf-8"))]

def lookup(core):
    if core in DICT:
        return DICT[core]
    for rex, rep in RULES:
        if rex.search(core):
            out = rex.sub(rep, core)
            if out and out != core:
                return out
    return None

def collect(path, skip_cat=()):
    items = []
    cur = None
    for ln in open(path, encoding="utf-8").read().splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("###"):
            cur = s.strip("# ").split(":")[0].strip()
            continue
        m = re.match(r"^\[(\d+)\]\s*(.*)$", s)
        if m:
            items.append((cur, m.group(2)))
        else:
            items.append((cur, s))
    return items

out = []
total = 0
hit = 0
miss = []
CJ = re.compile(r"[\u4e00-\u9fff]")

for path, label in [(os.path.join(A, "ui_shortlist.txt"), "ui_shortlist")]:
    if not os.path.exists(path):
        continue
    items = collect(path)
    for cat, txt in items:
        if not txt or len(txt) > 400:
            continue
        total += 1
        if lookup(txt) or CJ.search(txt):
            hit += 1
        else:
            miss.append((cat, txt))

out.append("checked list : %s" % label)
out.append("total strings: %d" % total)
out.append("translated   : %d  (%.1f%%)" % (hit, 100.0 * hit / max(total, 1)))
out.append("untranslated : %d" % len(miss))
out.append("")
out.append("--- 未覆盖明细（按分类） ---")
from collections import Counter
c = Counter(x[0] for x in miss)
for k, v in c.most_common():
    out.append("  %-16s %d" % (k, v))
out.append("")
out.append("--- 未覆盖全文 ---")
for cat, t in miss:
    out.append("[%s] %s" % (cat, t))

open(os.path.join(A, "coverage.txt"), "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out[:40]))
