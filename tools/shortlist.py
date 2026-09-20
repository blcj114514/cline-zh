# -*- coding: utf-8 -*-
# 路径解析（开源友好）：优先环境变量，其次脚本所在目录
import os, sys
BASE = os.environ.get("CLINE_AUDIT_DIR") or os.path.dirname(os.path.abspath(__file__))
ZH = os.environ.get("CLINE_ZH_DIR") or os.path.join(os.path.dirname(BASE), "cline-zh")
APP = os.environ.get("CLINE_APP_EXE") or r"E:\Cline\cline-app.exe"
import json, re, collections

SRC = os.path.join(BASE, "ui_strings.json")
OUT = os.path.join(BASE, "ui_shortlist.txt")
d = json.load(open(SRC, encoding="utf-8"))
items = [(x["s"], x["n"]) for x in d["strings"]]

KEY = ["send", "setting", "add ", "cancel", "delete", "remove", "save", "sign", "log in",
       "model", "provider", "workspace", "task", "history", "mcp", "skill", "plugin",
       "terminal", "auto-approve", "approve", "reject", "retry", "update", "install",
       "enable", "disable", "copy", "search", "new ", "open", "close", "edit", "create",
       "import", "export", "reset", "clear", "refresh", "connect", "account", "usage",
       "token", "context", "file", "folder", "browser", "checkpoint", "diff", "rules",
       "memory", "schedule", "agent", "chat", "message", "error", "failed", "warning",
       "confirm", "done", "loading", "not found", "no ", "are you sure", "you can",
       "please", "learn more", "try again", "get started", "sign out", "log out"]

# 短标签优先（<= 40 字符），长句另列
short = []
longs = []
for s, n in items:
    low = s.lower()
    if len(s.split()) <= 6 and len(s) <= 48 and any(k in low for k in KEY):
        short.append((s, n))
    elif len(s) <= 150 and any(k in low for k in KEY):
        longs.append((s, n))

seen = set()
L = []
L.append("### SHORT LABELS (%d) ###" % len(short))
for s, n in sorted(short, key=lambda x: x[0].lower()):
    if s in seen: continue
    seen.add(s)
    L.append("[%d] %s" % (n, s))
L.append("")
L.append("### SENTENCES (%d) ###" % len(longs))
for s, n in sorted(longs, key=lambda x: x[0].lower()):
    if s in seen: continue
    seen.add(s)
    L.append("[%d] %s" % (n, s))

open(OUT, "w", encoding="utf-8").write("\n".join(L))
print("short", len(short), "long", len(longs))
