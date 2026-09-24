# -*- coding: utf-8 -*-
"""tools/privacy-scan.py 的自测：在临时目录里造 fixture，跑真实扫描进程断言命中/不命中。

用法：
    python tools/privacy-scan-selftest.py

只读仓库；fixture 落 <repo>/../_tmp/p33/selftest（可用环境变量 PRIVACY_SCAN_TMP 覆盖），
跑完自动清理。退出码：0 = 全绿；1 = 有断言失败。
注意：fixture 与断言串一律用拼接构造，本文件自身不得含有可触发扫描器的完整字面量。
"""
import os, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN = os.path.join(REPO, "tools", "privacy-scan.py")
TMP = os.environ.get("PRIVACY_SCAN_TMP") or os.path.join(os.path.dirname(REPO), "_tmp", "p33", "selftest")

_ENV = dict(os.environ, PYTHONIOENCODING="utf-8")
BS = chr(92)  # 反斜杠

# ---- 断言语料（拼接构造，源码里不出现完整字面量）----
P_E_CLINE = "E:" + BS + "Cline"                                        # 白名单：启动器探测候选
P_D_EXE = "D:" + BS + "Cline" + BS + "cline-app.exe"                   # 白名单：启动器探测候选
P_E_ESC = "E:" + BS * 2 + "Cline"                                      # 白名单：转义形态
P_HOSTS = "C:" + BS + "Windows" + BS + "System32" + BS + "drivers" + BS + "etc" + BS + "hosts"
P_NODE = "C:" + BS + "Program Files" + BS + "nodejs" + BS + "node.exe"
P_USERDIR = "C:" + BS + "Users" + BS + "SomeoneElse" + BS + "docs"     # 真阳性：个人目录
P_USERDIR_HIT = "C:" + BS + "Users" + BS + "SomeoneElse"               # 扫描器实际打印的命中串
P_SECRET = "D:" + BS + "MySecret" + BS + "project"                     # 白名单之外 → 命中
P_SUB = "E:" + BS + "Cline" + BS + "secret.txt"                        # 白名单是精确匹配 → 子路径仍命中
P_REGEXESC = "accept:" + BS + "s*"                                     # P25 防回归：正则转义片段
N_PHONE = "13800" + "138000"                                           # 独立手机号 → 命中
N_ID13 = "123456789" + "0123"                                          # 独立 13 位长 ID → 命中

def run_scan(target):
    r = subprocess.run([sys.executable, SCAN, target], capture_output=True,
                       text=True, encoding="utf-8", errors="replace", env=_ENV)
    return r.returncode, r.stdout

def mk(name, files):
    d = os.path.join(TMP, name)
    os.makedirs(d, exist_ok=True)
    for fn, content in files.items():
        with open(os.path.join(d, fn), "w", encoding="utf-8") as f:
            f.write(content)
    return d

def sha_with(run):
    """把一段连续数字嵌进 64 位十六进制串（模拟 MANIFEST.sha256.txt 里的 sha256）。"""
    pad = 64 - len(run)
    return "a" * (pad // 2) + run + "f" * (pad - pad // 2)

# MANIFEST 行：<64hex>␣␣<path>，覆盖实测命中的 10/11/12/13 位数字片段 + 行首/行尾形态
MANIFEST = "".join(
    h + "  cline-zh/" + f + "\n" for h, f in [
        (sha_with("19790" + "15633"), "a.txt"),      # 10 位，嵌中段
        ("20866" + "280214" + "a" * 53, "b.txt"),     # 11 位，hash 开头
        (sha_with("19575" + "2855319"), "c.txt"),     # 12 位
        ("f" * 51 + "73341" + "77367187", "d.txt"),   # 13 位，hash 结尾
        (sha_with("54023" + "36324"), "e.txt"),
    ]
)

# (用例名, fixture 文件, 期望 exit, 输出中必含的串, 输出中禁含的串)
CASES = [
    ("manifest-sha256", {"MANIFEST.sha256.txt": MANIFEST}, 0, [], ["长数字串"]),
    ("phone-standalone", {"t.txt": "联系电话 " + N_PHONE + "\n"}, 1, [N_PHONE], []),
    ("id-13digit", {"t.txt": "编号 " + N_ID13 + "\n"}, 1, [N_ID13], []),
    ("users-dir", {"t.txt": "路径 " + P_USERDIR + "\n"}, 1, ["个人目录", P_USERDIR_HIT], []),
    ("wl-e-cline", {"t.txt": "探测 " + P_E_CLINE + "\n"}, 0, [], ["盘符路径"]),
    ("wl-d-exe", {"t.txt": "候选 " + P_D_EXE + "\n"}, 0, [], ["盘符路径"]),
    ("wl-escaped", {"t.txt": "字面量 " + P_E_ESC + "\n"}, 0, [], ["盘符路径"]),
    ("non-wl-drive", {"t.txt": "落在 " + P_SECRET + "\n"}, 1, ["盘符路径", "D:" + BS + "MySecret"], []),
    ("non-wl-ecline-sub", {"t.txt": "白名单外 " + P_SUB + "\n"}, 1, ["盘符路径"], []),
    ("regex-escape", {"t.txt": "正则片段 " + P_REGEXESC + "\n"}, 0, [], ["盘符路径"]),
    ("wl-hosts", {"t.txt": "屏蔽 " + P_HOSTS + "\n"}, 0, [], ["盘符路径"]),
    ("wl-nodejs", {"t.txt": "安装于 " + P_NODE + "\n"}, 0, [], ["盘符路径"]),
]

def main():
    if os.path.isdir(TMP):
        shutil.rmtree(TMP)
    os.makedirs(TMP)
    failed = []
    try:
        for name, files, want_exit, must, must_not in CASES:
            code, out = run_scan(mk(name, files))
            ok = code == want_exit and all(x in out for x in must) and not any(x in out for x in must_not)
            print("%s %-22s exit=%d (期望 %d)" % ("PASS" if ok else "FAIL", name, code, want_exit))
            if not ok:
                failed.append(name)
                print("----- 实际输出 -----\n%s\n--------------------" % out)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print("\n%d/%d 通过" % (len(CASES) - len(failed), len(CASES)))
    if failed:
        print("失败用例: " + ", ".join(failed))
        sys.exit(1)
    print("自测全绿 ✓")

if __name__ == "__main__":
    main()
