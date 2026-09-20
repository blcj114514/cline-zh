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
import json, re

SRC = os.path.join(BASE, "ui_strings.json")
OUT = os.path.join(BASE, "translate_todo.txt")
d = json.load(open(SRC, encoding="utf-8"))
items = [(x["s"], x["n"]) for x in d["strings"]]

MODELISH = re.compile(
    r"^(?:[A-Za-z0-9][\w.\-+]*\s?){1,8}$"   # 纯专有名词样
)
PROVIDER_RULE = re.compile(r"^.{1,60} model provider from models\.dev$")
PAREN_VENDOR = re.compile(r"\s\((?:OpenAI|Azure|EU|Vertex AI(?: \(OpenAI-compatible\))?|Anthropic|Google|OpenRouter|Cline|AWS|Bedrock)\)$")
DUMP_DEBUG = re.compile(r"^(?:FileDiff|VirtualizedFileDiff|ResizeManager|InteractionManager|Virtualizer|useFileDiffInstance|parsePatchContent|DiffHunksRenderer)\b")

UI_NOUN_HINT = re.compile(
    r"\b(?:you|your|the|this|that|these|are|is|was|will|can|not|no|or|and|to|of|for|with|from|"
    r"please|try|failed|could|unable|error|select|choose|open|close|add|remove|delete|save|cancel|"
    r"settings|session|task|model|provider|workspace|file|folder|server|message|history|search|"
    r"account|agent|tool|skill|plugin|update|install|enable|disable|copy|reset|check|run)\b", re.I)

buckets = {"provider_rule": [], "model_name": [], "library_debug": [], "ui": []}
for s, n in items:
    if PROVIDER_RULE.match(s):
        buckets["provider_rule"].append((s, n)); continue
    if DUMP_DEBUG.match(s):
        buckets["library_debug"].append((s, n)); continue
    # 纯模型名：去掉括号厂商后只剩专有名词
    core = PAREN_VENDOR.sub("", s)
    if MODELISH.match(core) and not UI_NOUN_HINT.search(core) and len(core.split()) <= 6:
        buckets["model_name"].append((s, n)); continue
    buckets["ui"].append((s, n))

L = []
for k, v in buckets.items():
    L.append("### %s : %d ###" % (k, len(v)))
L.append("")
for k in ("ui", "library_debug"):
    L.append("")
    L.append("=" * 30 + " %s (%d) " % (k, len(buckets[k])) + "=" * 30)
    for s, n in sorted(buckets[k], key=lambda x: -len(x[0])):
        L.append("[%d] %s" % (n, s))

open(OUT, "w", encoding="utf-8").write("\n".join(L))
print({k: len(v) for k, v in buckets.items()})
