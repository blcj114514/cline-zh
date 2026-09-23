# Cline 中文汉化包（非侵入式） v1.1.6

把 Cline 桌面版界面上的英文换成中文。**不修改 exe、不被更新覆盖、可一键还原。**

> v1.1.1（2026-09-19）：已在**真机 Cline 0.0.32 上启动验证通过**（界面实测 15 个中文文本节点 : 1 个英文节点，英文那个是产品名 "Cline"）。
> 本版通过**真实浏览器端到端测试**（无头 Chromium + 真实 DevTools 端口，22/22 断言）、**启动器实测**（含「Cline 已运行」分支）与**真机注入**（`zh-status.json` → `ok:true`）。详见文末「版本变更」。

---

## 一、原理

Cline 前端是 Tauri 外壳里的 Next.js 应用（390 个 chunk，brotli 压缩内嵌在 `cline-app.exe` 内），**没有 i18n 框架**，界面文案全部硬编码。因此改语言文件这条路走不通。

本汉化包采用 **WebView2 远程调试端口 + CDP 注入翻译层**：

```
Launch-Cline-ZH.bat
   ├─ 1. 预检：Cline 未在运行（关键！）+ 端口空闲 + Node >= 22
   ├─ 2. 设置 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
   ├─ 3. 启动 cline-app.exe
   └─ 4. 运行 injector.js  （仅注入 tauri.localhost / 含 cline 的页面）
           ├─ 连接 http://127.0.0.1:9222/json/list
           ├─ Page.addScriptToEvaluateOnNewDocument（刷新/导航后自动生效）
           └─ Runtime.evaluate（当前页面立即生效）
                    ↓
              zh-cn.js 在页面内运行
                    ├─ MutationObserver 监听 DOM 变化（实时）
                    ├─ 只翻译「界面固定文案」文本节点与 placeholder/title 等属性
                    ├─ 跳过代码 / 编辑器 / 输入值 / 预格式文本
                    └─ 跳过 Cline 的真实「内容容器」（正文、模型输出、工具输入输出）
```

**为什么安全**：

- 只读取 DOM 文本节点，**不注入任何网络请求**，不改动任何业务逻辑。
- 严格跳过代码区、编辑器、输入框的值、Markdown 正文与模型/工具输出 —— 你的代码和对话内容不会因为"长得像界面文案"就被改掉（v1.1 新增的内容容器跳区，见 §七）。
- 关闭启动器窗口或重启 Cline（不带调试参数）即完全恢复原状，**不写 Cline 任何文件**。

---

## 二、快速开始

**前置条件**：Node.js **22 或更高**（依赖内置 `WebSocket`）、Cline 桌面版。

> **⚠ 先完全退出 Cline（含右下角托盘图标）再启动。**
> 调试端口只在 Cline **全新启动**时才会打开；如果 Cline 已经开着，注入不会生效、界面保持英文。
> 启动器现在会自动检测：发现 Cline 在运行就提示你退出，并**在你退出后自动继续**。

1. 完全退出 Cline
2. 双击 `Launch-Cline-ZH.bat`
3. 保持黑窗口开着（它就是翻译层的宿主进程）

窗口输出示例：

```
  ============================================
   Cline Chinese Localization
  ============================================
   Cline exe  : E:\Cline\cline-app.exe
   Node       : C:\Program Files\nodejs\node.exe
   Debug port : 9222

   Starting Cline...
   Attaching translation layer. Keep this window open...

[00:10:21] 词库已加载：643 条译文 / 25 条规则
[00:10:21] 发现页面目标：http://tauri.localhost/index.html
[00:10:21] 注入成功。页面：http://tauri.localhost/index.html
```

> **关于语言**：启动器窗口里的**提示是英文**（cmd 解析 .bat 用的是系统 OEM 编码，批处理里写中文会把命令解析搞坏——这是 v1.1 实测踩到的坑），中文说明都在本文件里；**注入器打印的日志是中文**。

**Cline 装在别处？** 启动器会按顺序自动找：① 环境变量 `CLINE_ZH_CLINE_EXE` → ② 与本启动器同目录的 `cline-zh.path`（文件里只写一行完整 exe 路径）→ ③ `E:\Cline`、`D:\Cline`、`%LOCALAPPDATA%\Programs\Cline`、`%ProgramFiles%\Cline`。全都没找到时会打印这三种设法。

---

## 三、一键还原

任选其一：

- 关掉启动器的黑窗口（下次正常双击 Cline 图标启动即全英文）
- 直接任务管理器结束 `injector` 的 node 进程

**汉化包不写入 Cline 任何文件，所以不存在"残留"。**

---

## 四、目录说明

| 文件 | 作用 |
|---|---|
| `Launch-Cline-ZH.bat` | 启动器：预检 → 设调试参数 → 启动 Cline → 挂载翻译层。**纯 ASCII**（见 §二的说明） |
| `injector.js` | CDP 注入器（常驻）。零第三方依赖，用 Node 内置 `fetch` / `WebSocket` |
| `zh-cn.js` | 页面内翻译引擎。MutationObserver + 属性翻译 + 跳区保护 |
| `dict.json` | **合并后词库（1315 条）**，按 key 长度降序，先匹配长句 |
| `rules.json` | **54 条正则规则**，处理带变量的动态文案（厂商名、`(China)`、`Latest` 后缀、`Provider: X` 等） |
| `dict-batch1~5.json` | 分批翻译的原始批次，保留备查 |
| `dict-batch6~12.json` | v1.1.1/1.1.2 新增批次：真机实测补齐的 45 条 + 系统性补齐的 407 条（设置页、引导页、SSH 对话框、通知表等） |
| `merge_dict.py` | 合并批次 → `dict.json`；键去空白 + 黑名单过滤（大小写不敏感）。可传目录：`python merge_dict.py <目录>` |
| `selftest.js` | 自测：手写最小 WebSocket 帧编解码 + mock CDP 端点 |
| `tests-merge.cjs` | 合并匹配单测：node:vm + 最小 DOM stub 真实执行 `zh-cn.js`（`node tests-merge.cjs`，10 条断言） |
| `zh-status.json` | 运行时状态快照（注入是否成功、译文条数等） |
| `_backup/` | 改动前的整目录还原点（保留最近 3 份） |

---

## 五、词库覆盖情况

| 指标 | 数值 |
|---|---|
| 前端抽取到的英文字符串总数 | 2557 条（5412 次出现） |
| 分类为「真实界面文案」 | 1112 条（含模型名等，未全部计入覆盖率分母） |
| **覆盖率分母**（过滤后的界面文案清单 `ui_shortlist.txt`） | **702 条** |
| 词库条目 + 规则 | **688 条 + 28 条规则** |
| 对分母的覆盖率（语料口径） | **89.2%**（626/702，独立脚本复核；不含"本来就含中文"充数） |
| 剩余未覆盖 | **76 条** = 52 条模型/产品专名 + **24 条内部调试日志串**（`FileDiff.DEBUG.*`、`parsePatchContent:` 等，本来就是不该动的 console 日志）+ 少量压缩代码碎片 |
| 真机界面实测（v1.1.1） | 侧边栏 / 按钮 / 输入框提示 / aria-label 共 15 个中文文本节点 : 1 个英文节点（英文那个是产品名 `Cline`，按设计保留） |

> **为什么语料口径反而从 91.6% 降到 89.2%？** 因为 v1.0 的"冒号规则"会把 `FileDiff.DEBUG.handlePointerLeave: no event` 这类**内部调试日志**的冒号也改成全角，于是那 24 条被算成了"已覆盖"——而这恰恰是应当避免的误伤（半英半中的日志比原文更难读）。v1.1 收窄规则后它们不再被改，覆盖率数字随之下降，但**真实界面质量是提升的**。
> 另外，语料口径**看不到** v1.1.1 补进来的 45 条真实界面文案（侧边栏 `会话/定时任务/自定义`、输入框提示、`aria-label` 等）——这些字符串当初根本没被抽取进语料，是真机实测时才从活界面里捞出来的。

> **「分段词条」的现行口径（v1.1.7 修正）**：默认靠「相邻文本节点合并匹配」把 React 拆开的
> 相邻文本节点拼回整句再查词库/规则，整句词条与模板规则（`Ready to use with X` 等）负责覆盖；
> 但个别 DOM 结构合并匹配拼不回整句，故保留了 `Pick the icon Cline shows in the` 这类半句键
> 作**兜底**——仅在合并匹配失败时才单独命中，并非全部退役。

**关于剩余 59 条的取舍**：这些是**模型/产品的专有名称**。翻译它们会造成实际困扰（把 `DeepSeek Chat` 译成"深度求索聊天"，用户在模型列表里就找不到官方名字了），因此按设计保留原文。其中带括号的形态（`(free)`、`(China)`、`(Preview)`、`(Official API)`）已由正则规则本地化为全角中文括号。

自测结果：

```
[selftest] mock CDP listening on 19223
--- injector output ---
[00:10:21] 词库已加载：643 条译文 / 25 条规则
[00:10:21] 注入成功。页面：http://tauri.localhost/index.html
--- status.ok --- true | dict in page: 643
--- 注入后被翻译的文本 --- ["登录","设置","新建会话","Not in dict at all"]
```

最后一项 `Not in dict at all` 说明**未命中的文本原样保留**。

---

## 六、自定义与排障

**加词**：编辑 `dict.json` 加一条 `"English": "中文"`，重启启动器即可。键必须是**完整文本节点内容**（引擎会先去掉首尾空白再匹配）。

**加规则**：编辑 `rules.json`，格式 `["正则", "替换（可用 $1）"]`。规则只在词库未命中时生效，按数组顺序取**第一个**匹配。**必须带 `^...$` 锚点**（规则是"整节点替换"语义）。

**改端口**（9222 被占用时）：改 `Launch-Cline-ZH.bat` 里的 `set "PORT=9333"` 即可（v1.1 起该端口会自动传给注入器；此前版本改了不生效）。

**排查**：注入器每次尝试都会写 `zh-status.json`。若 `ok:false`，看 `stage` 与 `error`：

| stage | 含义 |
|---|---|
| `env` | Node 版本过低（< 22，缺内置 WebSocket） |
| `load` | 词库/规则 JSON 解析失败 |
| `wait-target` | 端口连上了，但没有可注入的页面（Cline 还没渲染完，会持续重试；`seen` 字段会列出端口上现有的页面，便于判断是不是被别的程序占了端口） |
| `loop` | 连接异常，正在重连（日志里会打印中文原因提示） |
| `injected` | 成功 |

**验证调试端口是否开着**：浏览器访问 `http://127.0.0.1:9222/json/list`，应返回 JSON 数组。

**已知限制**：

- 只覆盖 `placeholder` / `title` / `aria-label` / `alt` / `label` / `data-placeholder` 六类属性。
- 长度超过 400 字符的文本节点会跳过（避免误伤长正文）。
- 侧边栏会话标题、文件名等由内容派生的短文本，如果整串恰好等于某个词条，也会被翻译（纯显示层影响）。
- 若 WebView2 由系统策略禁止开启远程调试端口，本方案无法工作。
- **调试端口的安全边界**：端口只监听 `127.0.0.1`；启动器**故意不加** `--remote-allow-origins`，因此**带 Origin 的连接（例如你浏览器里打开的某个网页）会被 Chromium 拒绝**，只有原生客户端（注入器）能连。使用期间别让它暴露在不可信网络环境，用完关掉 Cline 即可关闭端口。
- **派活工具默认不自动批准工具**（`cline-task.mjs` 的 `autoApproveTools: false`）：遇到写入/执行类操作会挂起等你到界面点批准；只有完全信任任务时才加 `--auto-approve`。

---

## 七、跳区规则（v1.1 更新，改动前必读）

**标签级（文本不翻）**：`SCRIPT STYLE CODE PRE TEXTAREA KBD SAMP NOSCRIPT CANVAS SVG MATH IFRAME INPUT SELECT OPTION`

**容器级（整个子树不翻）**：`.monaco-editor`、`.cm-editor`、`.xterm`、`.view-lines`、`[contenteditable]:not([contenteditable="false"])`、`[data-cline-zh-skip]`，以及 v1.1 新增的 Cline 真实内容容器：

```
[class*="cline-markdown"]               Markdown 正文（模型回答/用户消息）
[class*="cline-chat-message-content"]   消息内容
[class*="cline-chat-reasoning-content"] 推理内容
[class*="cline-chat-thinking-content"]  思考内容
[class*="cline-chat-tool-content"]      工具调用输出
[class*="cline-chat-tool-details"]      工具详情（含文件路径/参数）
[class*="cline-chat-tool-code"]         工具代码块
[class*="cline-chat-tool-diff"]         差异视图
[class*="cline-chat-work-content"]      工作区内容
[class*="cline-chat-streaming-title"]   流式输出标题
```

这些 class 名来自 Cline 前端 bundle 的实际取值（`cline-*` 共 38 个语义化 class），不是猜的。

**属性级（会翻）**：`placeholder、title、aria-label、alt、label、data-placeholder`；输入框的 `value` 永不触碰。

**想给某个区域加保护**：给元素加 `data-cline-zh-skip` 属性即可。

---

## 八、安全边界

- 汉化包**不联网**、**不上报**、**不修改 Cline 安装目录与数据目录下的任何文件**。
- 它只做两件事：给本地 Cline 页面加一个远程调试端口；在页面里替换显示文本。
- 调试端口监听在 `127.0.0.1`（实测 netstat 确认只听本机回环），不对局域网开放。
- 注意：端口开启期间，**本机任何程序**都可以通过该端口读取/操作 Cline 的页面内容（这是 CDP 的固有性质）。用完关掉 Cline 即可。

> 关于 Cline 自身的网络行为与隐私审计结论，见 `../cline-audit/隐私与代码上传审计报告.md`。

---

## 九、版本变更

> 完整准确的版本史见根目录 `CHANGELOG.md`。要点（新 → 旧）：
>
> - **v1.1.6**（2026-09-23）：引擎新增「相邻文本节点合并匹配」；修复 3 条误用全角冒号而永不生效的规则；修正 `Plan`/`Taskbar` 错译；分段词条退役（见 §五）；词库 1327 → 1315，规则 50 → 54；新增 `tests-merge.cjs`。
> - **v1.1.5**（2026-09-20）：启动器移除 `--remote-allow-origins`；`cline-task.mjs` 默认不自动批准工具；Cline 路径自动探测。
> - **v1.1.4**（2026-09-20）：市场页全量汉化；词库 1164 → 1324，规则 34 → 50。
> - **v1.1.3**（2026-09-20）：修正 `Extra`/`Active` 错译；补 40 条 + 2 条规则。
> - **v1.1.2**（2026-09-20）：修复语料抽取漏块，补 407 条；词库 688 → 1114（明细见下）。
> - **v1.1.1**（2026-09-19）：修复「重注入后新词条不生效」；真机实测补 45 条 + 3 条规则（明细见下）。
> - **v1.1**（2026-09-19）：placeholder 可翻、内容容器跳区、启动器纯 ASCII 化等（明细见下）。
> - **v1.0**（2026-09-19）：首个版本。

早期版本的详细修复记录（按时间顺序）：

### v1.1（2026-09-19）—— 修问题为主

**功能缺陷**

1. **输入框/文本域的 placeholder 永远翻不了**：`SKIP_TAGS` 里的 `INPUT/TEXTAREA` 把属性通道也挡死了。现在属性翻译走独立的跳过判断 → 输入框 placeholder 正常翻译，**输入值仍然绝不触碰**（实测：placeholder `Settings → 设置`，输入值保持原样）。
2. **正文/模型输出/工具输入输出会被误翻**：引擎原本只判断"整段文本 == 词条"，不区分 UI 与内容。新增 §七 的内容容器跳区（依据 Cline 前端真实 class 名）→ 实测 5 类内容容器不再被动，UI 文案不受影响。
3. **批处理中文会破坏解析**：cmd 用系统 OEM 编码解析 .bat 字节，中文行的尾部字节会啃掉下一行首字节，`if errorlevel` 被读成 `rorlevel` 直接报错。→ 启动器改为**纯 ASCII**。
4. **`(...)` 括号文案会破坏 `if ( )` 块**：`echo ... (for example 9333).` 里的括号被当成块分隔符，触发 `. was unexpected at this time.` → 启动器改为 goto 流程、文案去括号。
5. **改端口不生效**：启动器只改了 WebView2 参数，没把端口传给注入器（README 的"改 9333"实为死路）。→ 现在自动透传 `CLINE_ZH_PORT`。
6. **规则 23 未锚定**：`(Data Used for Training)` 会产生多余空格（`Contributor （...）`）→ 改为锚定规则。
7. **规则 25 误改内部调试日志**：`DiffHunksRenderer.processDiffResult: ...` 这类字符串的冒号被改成全角（命中 84 条，多为 console 日志）→ 收窄为「大写字母开头、不含点号的标签」，命中降到 55 条且只剩 2 条调试串（`FileDiff: ...`）。
8. **黑名单大小写漏网**：`This route` 因大小写差异混进词库 → 比对改为大小写不敏感，词库 644 → 643 条。
9. **`[!]` 提示被吃掉**：`enabledelayedexpansion` 让 `!` 消失 → 去掉该开关（它本来也没被用到，还会误吃路径里的 `!`）。

**健壮性 / 体验**

10. 连不上端口时打印**中文原因提示**（原来 `fetch failed` 被日志过滤掉，黑窗一片沉默）。
11. 心跳从「每 2 秒全量重扫 DOM」改为「每 10 秒存活检查，失效才重新注入」，降低大页面开销；引擎兜底轮询 2.5s → 5s。
12. 目标筛选收紧：只注入 `tauri.localhost` 或标题/地址含 `cline` 的页面，避免端口被别的程序占用时误改无关页面。
13. Node < 22 直接报错并写 `stage: "env"`（原来会每 2 秒刷 `WebSocket is not defined`）。
14. `selftest.js` 修正帧累积器（原来解析出完整帧后会丢弃缓冲区里的半包，可能导致偶发假失败）。

### v1.1.1（2026-09-19）—— 真机实测补齐

15. **修复「重注入后新词条不生效」**：注入器重新注入时是**整体替换** `window.__CLINE_ZH_DICT__`，而页面里已运行的引擎仍握着旧对象 → 词库更新永远不生效（v1.0 起就存在）。现在预置脚本改为**就地合并**，引擎改为**实时读取**字典与规则，重注入/热更新立即生效。
16. **补齐 45 条真实界面文案**（`dict-batch6.json`）+ **3 条新规则**（`Provider: X` / `Environment: X` / `Sort sessions: X`）：这些字符串当初未被抽取进语料，是真机实测时从**活的 Cline 界面**里逐条捞出来的（含侧边栏、按钮、`aria-label`、输入框 `placeholder`）。注：这 3 条规则的模式当年误写成了全角冒号，一直被通用冒号规则抢先命中、实际未生效，v1.1.6 已改为半角并前移修复。
17. **规则 25 副作用**：收窄后不再误改内部调试日志（语料口径覆盖率 91.6% → 89.2%，见 §五说明）。

### v1.1.2（2026-09-20）—— 系统性补齐设置页等

18. **发现并修复"语料抽取漏块"**：早期抽取流程漏掉了设置页/引导页/SSH 对话框等整块 chunk，导致"覆盖率 89.2%"虚高（分母里根本没有这些页面）。改用语料位置抽取（JSX 的 `children/placeholder/title/aria-label` 等）后重扫，得 **407 条新缺口**并全部补齐（含 `Connect a model to start building`、`Desktop notifications`、`Accent color`、`Add SSH Host` 全套表单、通知事件表等）。
19. 新增 **4 条相对时间规则**（`1m/2h/3d/5s` → `N 分钟前 / N 小时前 / N 天前 / N 秒前`）。
20. 真机实测：界面 **16 个中文节点 : 3 个英文节点**，残留 3 个为 **账号名、头像首字母、产品名 `Cline`**（均属"不该翻译"）。
21. **保留英文的清单与理由**（避免误翻导致困扰）：账号名/头像字母（用户数据）、`Cline`（产品名）、模型与厂商专名、技术标识与示例值（`~/.ssh/id_ed25519`、`dev.example.com or ssh-config-alias`、`sk-...`、`npx`、`us-east-1`、`{"key":"value"}`）、代码标识符（`function`/`BigInt`/`cuid`）、品牌名（CoreWeave/Cerebras/AskSage/SAP 等）。

### v1.0（2026-09-19）

首个版本：644 条词库 + 25 条规则，覆盖率 91.6%；WebView2 + CDP 注入；mock CDP 自测通过。
