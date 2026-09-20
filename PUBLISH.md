# 发布步骤（本地 → 远端）

> 现状：**GitHub 已推送**（`main` 单提交干净历史，作者 = `deepseekv4flash <209341479+blcj114514@users.noreply.github.com>`，MIT 许可）；
> Gitee 镜像待注册完成后按下方步骤补推。

## 一、先在两边各建一个**空仓库**

| 平台 | 入口 | 仓库名 | 注意 |
|---|---|---|---|
| GitHub | https://github.com/new | `cline-zh` | **不要**勾 README / .gitignore / license（避免首推冲突） |
| Gitee | https://gitee.com/projects/new | `cline-zh` | 同样保持空白 |

## 二、双击 `publish.cmd`（或手动两条命令）

```
cd <仓库目录>
git remote add github https://github.com/<你的用户名>/cline-zh.git
git push -u github main
git remote add gitee  https://gitee.com/<你的用户名>/cline-zh.git
git push -u gitee  main
```

`publish.cmd` 会依次问你两个平台的用户名（留空则跳过该平台），然后建远端并推送。
首次推送会经 Git Credential Manager 弹浏览器授权；若更倾向 SSH，把地址换成 `git@github.com:<用户名>/cline-zh.git`（需先把公钥加到账号）。

## 三、发布 Release（可选但建议）

把 `cline-zh-oss-dist\cline-zh-v1.1.4.zip` 作为附件上传：
- 标题：`v1.1.4 —— 汉化包 + 免费模型桥`
- 正文：直接复制 `CHANGELOG.md` 的 v1.1.4 段

## 四、发布前最后自检（30 秒）

```
cd <仓库目录>
git status                                   # 应干净
git log --format="%h %an %s" -3               # 作者应为 deepseekv4flash
python -c "import json;print(len(json.load(open('cline-zh/dict.json',encoding='utf-8'))),'条词条')"   # 1327
```

## 注意

- `.gitattributes` 已固定 `*.bat/*.cmd` 为 **CRLF**——Windows 用户 clone 后启动器才能正常解析，**不要改成 LF**。
- 仓库**不含** Cline 的可执行文件与反编译原始产物；`docs/` 里只有自写的审计报告。
- 本汉化包是**非官方**项目，README 已注明与 Cline 官方无关；请勿在仓库名/描述里暗示官方背书。
