# Cline 中文汉化包 + 免费模型调用桥（非官方）

> ⚠️ 非官方项目，与 Cline 官方无关。仅对**本地安装的客户端**做运行时界面汉化，不修改其任何文件。
> 本项目采用 **MIT 许可**，详见 [`LICENSE`](LICENSE)。

## 组件

| 目录 | 内容 |
|---|---|
| `cline-zh/` | 汉化包本体：启动器（WebView2 调试端口 + CDP 注入）、注入器、翻译引擎、词库/规则、自测与合并脚本 |
| `tools/cline-bridge.mjs` | **零依赖** 桥接：直连 Cline 桌面端本地传输层（手写 WebSocket 帧），可列出会话/模型、派发会话与消息 |
| `tools/cline-account-check.mjs` | 只读核对账号登录态与模型可用性（不打印任何密钥） |
| `tools/*.py` | 逆向/抽取/覆盖率工具（用于从新版客户端重新生成词库） |
| `docs/` | 隐私与代码上传审计报告 |

## 快速开始（汉化）

前置：Node.js **22+**（依赖内置 WebSocket）、Cline 桌面版。

1. **先完全退出 Cline**（含托盘图标）——调试端口只在全新启动时生效，启动器会自动检测并等待。
2. 双击 `cline-zh/Launch-Cline-ZH.bat`，保持黑窗口开着。
3. 界面变中文；`cline-zh/zh-status.json` 里 `"ok": true` 即成功。
4. 还原：关掉黑窗口，正常双击 Cline 图标即恢复英文。

## 免费模型调用（cline-bridge）

```bash
node tools/cline-bridge.mjs status                          # hub/会话/运行状态
node tools/cline-bridge.mjs cmd list_cline_recommended_models '{}'   # 实时免费模型清单
node tools/cline-bridge.mjs cmd list_provider_models '{"provider":"cline"}'
node tools/cline-bridge.mjs watch read_session_messages '{"sessionId":"..."}' 30
```

- 通道：`ws://127.0.0.1:<sidecar端口>/transport`（端口自动发现；协议 `{id,command,args}` → `{id,ok,result}`，事件 `{type:"event",event:{name,payload}}`）。
- **前置条件：客户端已登录 Cline 账号**（免费模型 `cline-free/*` 由官方网关按账号鉴权），否则返回 `ACCOUNT_NOT_AUTHENTICATED`。
- 免费模型（2026-09-20 实测清单，均 1M 上下文、支持最高推理档）：

| 模型 ID | 名称 |
|---|---|
| `cline-free/kimi-k3` | Kimi K3 |
| `cline-free/deepseek-v4.1-flash` | DeepSeek V4.1 Flash |
| `z-ai/glm-5.3-flash` | GLM-5.3-Flash |
| `cline-free/muse-spark-1.3-contributor` | Muse Spark 1.3 Contributor |
| `cline-free/solar-pro4` | Solar Pro 4（512K） |

## 已知限制 / 待办

- `tools/*.py` 里的路径目前**硬编码了本机目录**，开源前需参数化。
- 词库基于 **Cline 0.0.32** 前端 class 名做跳区；客户端大版本升级后需重跑抽取脚本并更新 `zh-cn.js` 的 `SKIP_SELECTOR`。
- 需要 Node 22+；启动器窗口提示为**纯 ASCII**（cmd 用 OEM 编码解析 .bat，写中文会破坏解析）。
- 仓库地址与 Release 附件见 `PUBLISH.md`。
