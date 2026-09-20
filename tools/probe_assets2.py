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
import re, brotli, os, json

EXE = APP
OUTDIR = os.path.join(BASE, "extract")
OUT = os.path.join(BASE, "probe_assets2.txt")
os.makedirs(OUTDIR, exist_ok=True)

data = open(EXE, "rb").read()
L = []

pat = re.compile(rb"/(?:[A-Za-z0-9_\-./@]{2,140})\.(?:js|css|html|json|png|svg|ico|woff2|txt|map|wasm)")
occ = sorted([(m.start(), m.group(0).decode("latin-1")) for m in pat.finditer(data) if 9_400_000 <= m.start() <= 13_300_000], key=lambda x: x[0])
L.append("asset entries: %d" % len(occ))

def try_stream(buf, maxout=32*1024*1024):
    d = brotli.Decompressor()
    out = bytearray()
    try:
        step = 65536
        for i in range(0, len(buf), step):
            piece = buf[i:i+step]
            if d.is_finished():
                break
            res = d.process(piece)
            out += res
            if len(out) > maxout:
                return None
            if d.is_finished():
                return bytes(out)
        if d.is_finished():
            return bytes(out)
        return None
    except Exception:
        return None

ok = 0
recs = []
for i, (o, p) in enumerate(occ):
    end = o + len(p)
    nxt = occ[i+1][0] if i+1 < len(occ) else end + 5_000_000
    seg = data[end:min(nxt, end + 6_000_000)]
    for k in range(0, 10):
        r = try_stream(seg[k:])
        if r and len(r) > 64:
            recs.append((p, o, end + k, len(r)))
            ok += 1
            open(os.path.join(OUTDIR, p.replace("/", "__")), "wb").write(r)
            break

L.append("successfully decompressed: %d" % ok)
for p, o, d0, n in recs[:60]:
    L.append("  %-64s dlen=%8d" % (p[:64], n))

open(OUT, "w", encoding="utf-8").write("\n".join(L))
print("ok", ok)
