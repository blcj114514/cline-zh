# -*- coding: utf-8 -*-
"""合并分批词库 → dict.json（键去空白 + 黑名单过滤 + 按 key 长度降序）

用法：
    python merge_dict.py [目标目录]
    目标目录默认 = 本脚本所在目录

v1.1 变更：黑名单比对改为大小写不敏感（此前 "This route" 因大小写差异漏网）。
"""
import json, os, sys

DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))

# 泛化过度的短词 / 压缩代码碎片，永不进入词库（避免误翻界面上的正常文本）
# 比对时统一转小写，避免 "This route" 这类大小写变体漏网
BLACKLIST = {"not all", "in e&&e.href&&", "and sometimes with", "this route",
             "this routine", 'the value "', "in r)throw new it(", "in n)",
             "the value", "is invalid for option", "was accessed outside of",
             "needs to bail out of prerendering at this point because it used"}

merged = {}
for name in ("dict.json", "dict-batch1.json", "dict-batch2.json", "dict-batch3.json",
             "dict-batch4.json", "dict-batch5.json", "dict-batch6.json", "dict-batch7.json", "dict-batch8.json", "dict-batch9.json", "dict-batch10.json", "dict-batch11.json", "dict-batch12.json", "dict-batch13.json", "dict-batch14.json"):
    p = os.path.join(DIR, name)
    if not os.path.exists(p):
        continue
    d = json.load(open(p, encoding="utf-8"))
    for k, v in d.items():
        k = k.strip()           # 键必须与 translateWhole 去掉首尾空白后的核心文本一致
        if not k or k.lower() in BLACKLIST:
            continue
        merged[k] = v

# 去重后按 key 长度降序（先匹配长句，避免子串误伤）
out = {k: merged[k] for k in sorted(merged.keys(), key=lambda x: -len(x))}
json.dump(out, open(os.path.join(DIR, "dict.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

print("total entries:", len(out))
print("batch files still on disk (keep for review):", [f for f in os.listdir(DIR) if f.startswith("dict-batch")])
