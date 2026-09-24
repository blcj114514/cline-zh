# -*- coding: utf-8 -*-
"""推送前隐私自查：扫当前工作树 + 全部 git 历史，找不该公开的个人信息 / 凭据。

用法：
    python tools/privacy-scan.py                # 扫当前仓库（含 .git 历史）
    python tools/privacy-scan.py <仓库目录>

退出码：0 = 干净；1 = 有命中（**别推**）
"""
import os, re, subprocess, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATTERNS = {
    "邮箱地址": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "疑似密钥/令牌": re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,})\b"),
    "长 Bearer 串": re.compile(r"Bearer\s+[A-Za-z0-9._-]{25,}"),
    "个人目录 (Windows)": re.compile(r"[A-Za-z]:\\+Users\\+[A-Za-z0-9_.\-]+"),
    # 任意盘符路径告警（\\+ 同时覆盖源码里双反斜杠的转义形态）；\Users\ 由上面专门规则报告
    "盘符路径告警 (Windows)": re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:\\+(?!Users)[A-Za-z0-9_.\- 一-鿿]{2,}(?:\\+[A-Za-z0-9_.\- 一-鿿]+)*"),
    "个人目录 (类 Unix)": re.compile(r"/(?:home|Users)/[A-Za-z0-9_.\-]+"),
    "私网/非回环 IP": re.compile(r"\b(?!127\.0\.0\.1|0\.0\.0\.0)(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.\d{1,3}){3}\b"),
    "设备/账号标识": re.compile(r"\b(?:cl|usr|org|dev)-[A-Za-z0-9]{12,}\b"),
    "主机名样式": re.compile(r"\b(?:DESKTOP|LAPTOP|WIN)-[A-Z0-9]{6,}\b"),
    # 边界从 (?<!\d)/(?!\d) 收紧为 (?<![0-9A-Za-z])/(?![0-9A-Za-z])：
    # sha256 等十六进制/字母数字串里的连续数字片段不再误报；独立的手机号/长 ID 照旧命中
    "长数字串(可能是手机号/ID)": re.compile(r"(?<![0-9A-Za-z])(?:1[3-9]\d{9}|[1-9]\d{9,14})(?![0-9A-Za-z])"),
}
ALLOW = re.compile(r"@(?:users\.noreply\.github\.com|example\.(?:com|org)|github\.com)$|127\.0\.0\.1|0\.0\.0\.0")

# ---- “盘符路径告警 (Windows)”专用白名单（只对该规则生效；“个人目录”等规则不受影响）----
# 判定前先把命中串里的连续反斜杠折叠成单个 \，因此源码转义形态（如 E:\\Cline）一并覆盖。
# 精确匹配：包内文档化/系统级字面量
DRIVE_PATH_ALLOW_EXACT = {
    # Launch-Cline-ZH.bat 启动器的文档化探测候选 / CHANGELOG 版本史说明
    r"E:\Cline",
    r"D:\Cline",
    r"E:\Cline\cline-app.exe",
    r"D:\Cline\cline-app.exe",
    # README 安装说明里的 Node.js 默认安装路径（系统级，不含个人信息）
    r"C:\Program Files\nodejs\node.exe",
    # 兜底：Windows 目录本身（命中串在 \ 前被截断、只剩盘符+目录名时仍放行）
    r"C:\Windows",
}
# 前缀匹配：通用系统目录（含 C:\Windows\System32\drivers\etc\hosts 等）
DRIVE_PATH_ALLOW_PREFIX = (
    "C:\\Windows\\",
)

def _drive_path_allowed(s):
    n = re.sub(r"\\+", r"\\", s)
    return n in DRIVE_PATH_ALLOW_EXACT or n.startswith(DRIVE_PATH_ALLOW_PREFIX)

def texts_from_git(root):
    r = subprocess.run(["git", "-C", root, "rev-list", "--objects", "--all"],
                       capture_output=True, text=True, errors="replace")
    if r.returncode != 0:
        return []
    objs = [ln.split(None, 1)[0] for ln in r.stdout.splitlines() if ln.strip()]
    chk = subprocess.run(["git", "-C", root, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
                         input="\n".join(objs), capture_output=True, text=True, errors="replace")
    blobs = [l.split()[0] for l in chk.stdout.splitlines() if l.endswith(" blob")]
    out = []
    for sha in blobs:
        c = subprocess.run(["git", "-C", root, "cat-file", "blob", sha], capture_output=True)
        if c.returncode == 0:
            out.append(("blob " + sha[:8], c.stdout.decode("utf-8", errors="replace")))
    return out

def texts_from_tree(root):
    out = []
    for dp, dn, fn in os.walk(root):
        if ".git" in dp.split(os.sep):
            continue
        for f in fn:
            p = os.path.join(dp, f)
            try:
                out.append((os.path.relpath(p, root), open(p, encoding="utf-8").read()))
            except Exception:
                pass
    return out

found = False
for label, items in (("工作树", texts_from_tree(ROOT)), ("git 历史", texts_from_git(ROOT))):
    hits = []
    for name, t in items:
        for k, rx in PATTERNS.items():
            for m in rx.finditer(t):
                s = m.group(0)
                if ALLOW.search(s):
                    continue
                if k == "盘符路径告警 (Windows)" and _drive_path_allowed(s):
                    continue
                hits.append((name, k, s[:70]))
    seen, uniq = set(), []
    for h in hits:
        key = (h[1], h[2])
        if key not in seen:
            seen.add(key)
            uniq.append(h)
    print("=== %s：%d 处（去重 %d）===" % (label, len(hits), len(uniq)))
    for name, k, s in uniq[:25]:
        print("   [%s] %-22s %s  (%s)" % (k, s, name, ""))
    if uniq:
        found = True

print("\n结论:", "发现可疑内容 —— **先别推送**" if found else "未发现个人/凭据类内容 ✓")
sys.exit(1 if found else 0)
