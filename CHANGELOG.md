# 变更记录

## v1.1.7 — 2026-09-25

- **适配 Cline 0.0.34 汉化增量**：新增 `cline-zh/dict-batch13.json`（**148 条**）。
- **词库大批量入库**：新增 `cline-zh/dict-batch15.json`（**730 条**，取自 sidecar 历史上游文案缺口三分清单中的「可入库」集），
  与 batch13 一并经 `merge_dict.py` 合并 → `dict.json` 1315 → **2245 条**。
- **规则 +3 条 `--flag` 报错规则**：`--X requires a value` / `--X is required for Y` / `--X or --Y`
  （**保留 flag 名原样、只翻其余部分**）→ `rules.json` 61 → **64 条**。
- **`tools/privacy-scan.py` 加固**：数字串边界收紧（sha256 不再误报）＋显式精确白名单；
  发版包扫描 `exit=0`，v1.1.5 包内真实路径泄漏仍能报出。
- **跳区表核对**：0.0.34 前端 10 个内容容器选择器全部仍在，`SKIP_SELECTOR` 无需改动。
- **README 口径修正**：「分段词条已退役」改为准确表述——默认靠合并匹配整句命中，
  半句键仅在合并匹配失败时兜底（真机实测发现个别 DOM 合并未命中，补
  `Pick the icon Cline shows in the` 兜底键）。

## v1.1.6 — 2026-09-23

- **引擎新增「相邻文本节点合并匹配」慢路径**：React 会把一句话拆成多个相邻文本节点
  （如 `"0" + " MCP server" + "s"`），逐节点匹配永远命不中。单节点匹配失败时，向后收集紧邻的
  兄弟文本节点拼接整组再查词库/规则；命中写回组内首节点、其余置空，未命中一个字符都不动
  （上限 8 节点 / 300 字符，遇元素节点即停）。引擎自报版本 1.1.1 → **1.1.6**。
- 新增 `cline-zh/tests-merge.cjs`：node:vm + 最小 DOM stub 真实执行引擎，10 条断言全绿
  （`node tests-merge.cjs`）。
- **修复 3 条永不生效的规则**：`Sort sessions:` / `Environment:` / `Provider:` 三条规则的
  模式误写成全角冒号，输入串总是先被通用冒号规则命中 → 改为半角冒号并移到通用冒号规则之前；
  `dict.json` 中 3 条全角键死条目（`Sort sessions：Time` / `Environment：Local` /
  `Notifications（F8）`）同步改写为半角键，恢复可达。
- **错译修正**：`Plan` 套餐 → **规划**（Plan/Act/Steer 模式语境）；`Taskbar` 任务栏中的图标
  → **任务栏**；补整句词条 `Pick the icon Cline shows in the Taskbar` 供合并匹配命中。
- **分段词条退役**：随合并匹配落地，删除 12 条为绕过节点拆分而建的片段词条
  （`This will delete` / `This removes` / `Ready to use with` / `Open folder “` /
  `No providers match "` / `on models that support it — no extra setup needed.` 及
  React/Vite 内部串碎片等），并为 `Ready to use with X`、`No providers match "X"`、
  `Open folder "X"`、`… on models that support it — no extra setup needed.` 补整句规则。
- 词库 1327 → **1315 条**，规则 50 → **54 条**。
- 工具：`merge_dict.py` docstring 删除残留本机路径；`tools/privacy-scan.py` 个人目录规则
  放宽（覆盖 `\\Users\\` 转义形态），并新增任意盘符路径告警规则。

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
