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
import os, re, json, collections

ROOT = os.path.join(BASE, "extract")
OUT_JSON = os.path.join(BASE, "ui_strings.json")
OUT_TXT = os.path.join(BASE, "ui_strings.txt")

str_re = re.compile(r"""(?:"((?:[^"\\\n]|\\.){2,300})")|(?:'((?:[^'\\\n]|\\.){2,300})')|(?:`((?:[^`\\\n]|\\.){2,300})`)""")

STOP = set("""the a an and or of to in is are was were be been being for with without on at by from as it its this that these those you your yours we our us i me my he she they them their not no yes do does did done can could should would will shall may might must have has had if then than so such but also more most less least very just only other another each every any some all both few many much own same too s t don now here there when where why how what which who whom whose please click select open close save add remove delete edit update create new enter type use used using want need help""".split())

BAD_SUB = ["punctuation.", "support.", "keyword.", "meta.", "entity.", "storage.", "constant.",
           "string.quoted", "markup.", "comment.block", "source.", "text.html", "variable.other",
           "hover:", "focus:", "data-", "aria-", "var(--", "rgb(", "linear-gradient", "calc(",
           "translate", "rotate", "shadow-", "rounded-", "text-[", "bg-[", "http", ".css",
           "displayName", "scopeName", "fileTypes", "beginCaptures", "endCaptures", "contentName"]

TAILWIND_WORDS = ["flex", "items-", "justify-", "gap-", "px-", "py-", "p-1", "p-2", "m-1", "mt-", "mb-",
                  "w-full", "h-full", "min-w", "max-w", "shrink-0", "overflow-", "border-border",
                  "bg-", "text-sm", "text-xs", "text-muted", "font-", "leading-", "tracking-", "z-50",
                  "absolute ", "relative ", "inline-", "grid ", "col-", "row-", "group", "peer"]

def looks_like_tailwind(s):
    hits = sum(1 for w in TAILWIND_WORDS if w in s)
    return hits >= 3

def is_ui_text(s):
    if not s or not (2 <= len(s) <= 240):
        return False
    if any(b in s for b in BAD_SUB):
        return False
    if looks_like_tailwind(s):
        return False
    if "://" in s or "\\" in s:
        return False
    # dot-notation scopes / config keys
    if re.match(r"^[a-z][a-z0-9_\-]*(\.[a-zA-Z0-9_\-]+){2,}$", s):
        return False
    if re.match(r"^[A-Za-z0-9_\-]+\.[A-Za-z]{2,5}$", s):
        return False
    letters = sum(1 for ch in s if ch.isalpha())
    if letters < 3:
        return False
    if letters / len(s) < 0.55:
        return False
    if not re.match(r"^[A-Za-z]", s):
        return False
    if re.search(r"[{}<>;=_|^~`$@#\[\]]", s):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z'\-]*", s)
    if not words:
        return False
    # must look like natural language
    has_space = " " in s.strip()
    stop_hits = sum(1 for w in words if w.lower() in STOP)
    if has_space:
        if len(words) >= 2 and stop_hits >= 1:
            return True
        # Title Case labels like "New Task", "App Settings"
        if 2 <= len(words) <= 6 and all(w[0].isupper() for w in words if w.lower() not in STOP) and len(words) >= 2:
            return True
    return False

counter = collections.Counter()
where = collections.defaultdict(set)

for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        fp = os.path.join(dp, f)
        if os.path.splitext(fp)[1].lower() in (".woff2", ".png", ".ico", ".svg"):
            continue
        try:
            txt = open(fp, "r", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        name = f
        for m in str_re.finditer(txt):
            s = (m.group(1) or m.group(2) or m.group(3) or "").strip()
            if not is_ui_text(s):
                continue
            key = re.sub(r"\s+", " ", s)
            counter[key] += 1
            if len(where[key]) < 5:
                where[key].add(name)

json.dump({"strings": [{"s": s, "n": c, "files": sorted(where[s])} for s, c in counter.most_common()]},
          open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

L = ["distinct UI strings: %d" % len(counter), "total occurrences: %d" % sum(counter.values()), ""]
L.append("=== all (by length desc) ===")
for s in sorted(counter, key=lambda x: -len(x)):
    L.append("[%3d] %s" % (counter[s], s))
open(OUT_TXT, "w", encoding="utf-8").write("\n".join(L))
print("distinct:", len(counter))
