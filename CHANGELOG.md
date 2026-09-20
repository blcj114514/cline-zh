# 变更记录

## v1.1.5 — 2026-09-20（安全加固，建议升级）

- **启动器不再带 `--remote-allow-origins=*`**。注入器是原生客户端（不发 `Origin` 头），Connecting 不受影响；
  而**带 Origin 的连接（例如你浏览器里打开的网页）会被 Chromium 拒绝**——去掉了"网页可通过本机调试端口接管 Cline"的风险面。
  （删掉该参数后注入链路已用"真实 Chromium 调试端口 + 原版 injector"复测通过。）
- **`cline-task.mjs` 的 `autoApproveTools` 默认改为 `false`**：派活时遇到写入/执行类操作会**挂起等你批准**
  （到 Cline 界面点一下即可）；只有显式加 `--auto-approve` 才自动放行。避免对不可信任务描述自动放开工具。
- **路径不再写死**：启动器按 `CLINE_ZH_CLINE_EXE` 环境变量 → 同目录 `cline-zh.path` 文件 → 常见安装目录
  （`E:\Cline`、`D:\Cline`、`%LOCALAPPDATA%\Programs\Cline`、`%ProgramFiles%\Cline`）顺序自动定位 `cline-app.exe`，
  全都没找到时打印三种设法；`tools/*.py` 同样支持 `CLINE_APP_EXE` 环境变量并自动探测常见目录。
- 三种设法与"未加 allow-origins 仍可注入"均已实测；`docs`/词库内容不变（**1327 条 / 50 条规则**）。

## v1.1.4 — 2026-09-20
- **市场页全量汉化**：12 个分类标签 + 203 条条目的 tagline/描述性名称。
  其中 110 条 tagline 是统一模板（`Connect Cline to X` / `Interact with X`），用**规则**覆盖；
  新增 11 条命名模式规则（`X Docs/Toolbox/Skills/Devkit/Setup/Data/Search/Report/Local/Remote/Agent`）；
  纯品牌名（Airtable/Stripe/Azure/Sentry…）按"模型名同策略"保留原文。
- **内置工具页**：补 10 个工具的描述（含 UI 版与 sidecar 版两种原文）+ `teams` 长描述的规则化处理。
- **语音页**：补 `Connect a provider with transcription models — for example <提供商> — …` **模板规则**（原串含动态提供商列表）。
- 补齐 `+N more`、`N configured · M available` 等计数型规则。
- 词库 1164 → **1324 条**，规则 34 → **50 条**。

## v1.1.3 — 2026-09-20
- **修正 3 处错译**：`Extra`（思维档位，源码 = xhigh）附加 → **最高**；`Active`（账号页徽标）已启用 → **使用中**；补 `Inactive` → **未激活**。
- **补齐 40 条 + 2 条规则**：设置页导航（`General`/`Voice`）、内置工具标题与描述、通知开关 aria-label、SSH 对话框（`Test Connection`/`Disconnected`/`Unknown`/`User (optional)`）、账号页（`overview`/`usage`/`billing`/`Member since`/`Credits Balance`）、大小写变体（`Add provider`/`API key`）、以及**跨文本节点被拆开的句子**（如 `Pick the icon Cline shows in the` + `Taskbar`）。
  新增规则：`^Toggle (.+)$ → 切换 $1`、`^N configured · M available$ → 已配置 N 个 · 可用 M 个`。
- **逐页巡检（设置页 8 个分组 + 首页 + 会话页）干干净净**：剩余英文全部是**刻意保留**——用户数据（账号名/头像字母/邮箱/工作区名）、日期与数字、工具 ID（`read_files`/`run_commands`…，模型调用的字面标识）、模型与厂商专名、占位示例值（`ubuntu`/`sk-...`）、CLI 命令（`cline schedule`）。
- 验证"刷新后仍为中文"：页面重载后仍 `dict 1164 / rules 34`。
- 词库 1114 → **1164 条**，规则 32 → **34 条**。

## v1.1.2 — 2026-09-20
- **修复「语料漏块」**：早期抽取漏掉设置页/引导页/SSH 对话框/通知表等整块 chunk，导致覆盖率虚高。
  改用**位置抽取**（JSX 的 `children/placeholder/title/aria-label/label/alt`…）重扫 390 个 chunk，
  补 **407 条** + 10 条主题/图标名 → 词库 688 → **1114 条**；规则 28 → **32 条**（新增相对时间 `1m/2h/3d`）。
- 真机实测：界面 **16 个中文节点 : 3 个英文节点**，残留为账号名、头像首字母、产品名 `Cline`。
- 工具参数化：不再硬编码本机路径（`CLINE_AUDIT_DIR` / `CLINE_ZH_DIR` / `CLINE_APP_EXE`）。
- 新增桥接与派活工具：`cline-bridge.mjs` / `cline-task.mjs` / `cline-receipt.mjs`。

## v1.1.1 — 2026-09-19
- 修复「注入器重注入后新词条不生效」（字典整体替换 → 就地合并 + 引擎实时读取）。
- 真机实测补齐 45 条（侧边栏、按钮、aria-label、输入框 placeholder）+ 3 条规则。

## v1.1 — 2026-09-19
- 修复：输入框 placeholder 永远翻不了；正文/模型输出/工具输出被误翻（新增 10 个内容容器跳区）。
- 修复：启动器批处理中文破坏解析；`(...)` 破坏 `if` 块；改端口不生效；`[!]` 被吞。
- 修复：规则 23 未锚定；规则 25 误改调试日志；黑名单大小写漏网。
- 健壮性：连不上端口给人话提示；心跳 2s 全量重扫 → 10s 存活检查；只注入 tauri.localhost/cline 页面；Node < 22 直接报错。

## v1.0 — 2026-09-19
- 首个版本：644 条词库 + 25 条规则；WebView2 + CDP 注入；mock CDP 自测通过。
