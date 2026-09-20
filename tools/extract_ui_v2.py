# -*- coding: utf-8 -*-
# 路径解析（开源友好）：优先环境变量，其次脚本所在目录
import os, sys
BASE = os.environ.get("CLINE_AUDIT_DIR") or os.path.dirname(os.path.abspath(__file__))
ZH = os.environ.get("CLINE_ZH_DIR") or os.path.join(os.path.dirname(BASE), "cline-zh")
APP = os.environ.get("CLINE_APP_EXE") or r"E:\Cline\cline-app.exe"
# -*- coding: utf-8 -*-
"""更准的界面文案抽取：只看 JSX 里"文字位置"的字符串（children/placeholder/title/aria-label/label/alt…）
   输出：与现有词库的差值（= 真实缺口）"""
import json, os, re, sys, collections

sys.stdout.reconfigure(encoding="utf-8")
EXT = os.path.join(BASE, "extract")
ZH = ZH
OUT = os.path.join(BASE, "ui_gaps.json")

D = json.load(open(os.path.join(ZH, "dict.json"), encoding="utf-8"))
R = [(re.compile(p), r) for p, r in json.load(open(os.path.join(ZH, "rules.json"), encoding="utf-8"))]

# JSX/React 里承载界面文字的位置
POS = r'(?:children|placeholder|title|aria-label|alt|label|data-placeholder|"aria-description"|description|desc|hint|text|message|tooltip|heading|subtitle|caption)'
PAT = re.compile(POS + r':\s*"((?:[^"\\]|\\.){2,200})"')
PAT2 = re.compile(POS + r":\s*'((?:[^'\\]|\\.){2,200})'")

CJK = re.compile(r"[\u4e00-\u9fff]")
CODEISH = re.compile(r"(=>|\{\}|&&|\|\||function\s|=>|\(\s*\)|\.js\b|\.ts\b|\.json\b|https?://|@media|px\)|^\s*[.#][\w-]+\s*\{|var\(--|^\d+(\.\d+)?(px|rem|em|%)?$|^[a-z-]+:[a-z-]+$|_\w+\(|\)\s*;|#[0-9a-fA-F]{3,8}$)")
# 明显不该翻的：路径/域名/示例值/技术标识
KEEP = re.compile(r"^(?:~?/|\./|[A-Za-z]:\\|[\w.-]+@[\w.-]+|[\w.-]+\.(com|org|net|io|dev|ai)\b|https?://|npm |npx |git |node |bash |curl |ssh |port |localhost|127\.0\.0\.1|\d+(\.\d+)?\s*(px|rem|em|%|ms|s)?$|[A-Z_]{2,}$|[a-z_]+_[a-z_]+$|[\w-]+/[\w./-]+$)")

def looks_ui(s):
    s = s.strip()
    if not (2 <= len(s) <= 200):
        return False
    if CJK.search(s):
        return False
    if not re.search(r"[A-Za-z]", s):
        return False
    if CODEISH.search(s) or KEEP.search(s):
        return False
    # 至少要像一个词或短语（含空格或首字母大写或含常见标点）
    return bool(re.search(r"[A-Za-z]{2,}", s))

hits = collections.Counter()
where = collections.defaultdict(set)
files = [f for f in os.listdir(EXT) if f.endswith('.js')]
for f in files:
    t = open(os.path.join(EXT, f), encoding='utf-8', errors='replace').read()
    for m in list(PAT.finditer(t)) + list(PAT2.finditer(t)):
        s = m.group(1)
        s = s.replace('\\"', '"').replace("\\'", "'").replace('\\n', ' ').strip()
        if not looks_ui(s):
            continue
        hits[s] += 1
        if len(where[s]) < 3:
            where[s].add(f.replace('___next__static__chunks__', '')[:14])

def in_dict(s):
    if s in D:
        return True
    for cre, rep in R:
        if cre.search(s):
            return True
    return False

gaps = {s: n for s, n in hits.items() if not in_dict(s)}
print("抽到文字位字符串 %d 条（去重后 %d），其中**词库缺口 %d 条**" % (sum(hits.values()), len(hits), len(gaps)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({"total_ui": len(hits), "gaps": {s: {"n": n, "where": sorted(where[s])} for s, n in sorted(gaps.items(), key=lambda kv: -kv[1])}},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("已写出:", OUT)

print("\n=== 缺口预览（按出现次数，前 80 条）===")
for s, n in sorted(gaps.items(), key=lambda kv: -kv[1])[:80]:
    print("  [%2d] %s" % (n, s[:110]))
