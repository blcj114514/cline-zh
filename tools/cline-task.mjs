#!/usr/bin/env node
/*
 * cline-task —— 给 Cline Desktop 派活（对标 本地工具链 的 wb-task.sh）
 *
 * 免费模型白名单（强制，改白名单须先报备）：
 *   cline-free/kimi-k3 | cline-free/deepseek-v4.1-flash | z-ai/glm-5.3-flash |
 *   cline-free/muse-spark-1.3-contributor | cline-free/solar-pro4
 * 一律 reasoningEffort=max、上下文按模型上限（这几个都是 1M）。
 *
 * 用法：
 *   node cline-task.mjs --mode plan --cwd <目录> "任务描述"
 *   node cline-task.mjs --mode act  --cwd <目录> -f 任务单.md
 *   node cline-task.mjs --list                     # 列出免费模型与登录态
 * 选项： --model <id>（默认 cline-free/deepseek-v4.1-flash） --effort <max|high|…>（默认 max）
 *        --timeout <秒>（默认 600） --json
 *        --auto-approve   自动批准工具（**默认关闭**）：关闭时遇到需要审批的操作会挂起，
 *                         请到 Cline 界面点→批准；只有你完全信任该任务时才显式打开。
 */
import { ClineBridge } from './cline-bridge.mjs';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';

const ALLOWED = new Set([
  'cline-free/kimi-k3',
  'cline-free/deepseek-v4.1-flash',
  'z-ai/glm-5.3-flash',
  'cline-free/muse-spark-1.3-contributor',
  'cline-free/solar-pro4',
]);

function parseArgs(argv) {
  const o = { mode: 'plan', model: 'cline-free/deepseek-v4.1-flash', effort: 'max', timeout: 600, prompt: '', json: false, list: false, autoApprove: false, cwd: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') o.mode = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--effort') o.effort = argv[++i];
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--cwd') o.cwd = argv[++i];
    else if (a === '-f' || a === '--file') o.prompt = readFileSync(argv[++i], 'utf8');
    else if (a === '--auto-approve') o.autoApprove = true;
    else if (a === '--json') o.json = true;
    else if (a === '--list') o.list = true;
    else rest.push(a);
  }
  if (!o.prompt && rest.length) o.prompt = rest.join(' ');
  return o;
}

function portFromLog() {
  const log = `${os.homedir()}/.cline/data/logs/code.log`;
  if (!existsSync(log)) return null;
  let last = null;
  for (const ln of readFileSync(log, 'utf8').split('\n').slice(-400)) {
    try { const o = JSON.parse(ln); if (o.msg === 'Desktop sidecar ready' && o.mode === 'sidecar') last = o.port; } catch {}
  }
  return last;
}

const opt = parseArgs(process.argv.slice(2));
const port = Number(process.env.CLINE_SIDECAR_PORT || portFromLog());
if (!port) { console.error('× 未发现 Cline sidecar（Cline 桌面端没在运行？）'); process.exit(1); }
const br = await new ClineBridge(port).connect();

// 免费模型清单 + 登录态
const models = await br.call('list_cline_recommended_models', {}, 30000).catch((e) => ({ error: e.message }));
if (opt.list || !opt.prompt) {
  console.log('登录态:', JSON.stringify(await br.call('cline_account', { operation: 'get' }, 20000).catch((e) => ({ error: e.message }))));
  console.log('免费模型:');
  for (const m of (models.free || [])) console.log('   ', m.id.padEnd(44), m.name);
  if (opt.list) { br.close(); process.exit(0); }
  console.error('\n× 缺少任务描述。用法：node cline-task.mjs --mode plan --cwd <目录> "任务描述"');
  br.close(); process.exit(2);
}

if (!ALLOWED.has(opt.model)) {
  console.error(`× 模型 ${opt.model} 不在免费白名单内，拒绝执行。白名单：\n   ${[...ALLOWED].join('\n   ')}`);
  br.close(); process.exit(3);
}

const events = [];
br.onEvent((e) => { events.push(e); if (!opt.json && /message|run\.|session\./.test(e.name)) console.log(`  · ${e.name}`); });

console.log(`→ 启动会话：model=${opt.model} effort=${opt.effort} mode=${opt.mode} cwd=${opt.cwd} autoApprove=${opt.autoApprove}`);
if (!opt.autoApprove) console.log('  （未自动批准工具：遇到写入/命令类操作会挂起，请到 Cline 界面点批准；或加 --auto-approve 明确放行）');
const started = await br.call('chat_session_command', {
  request: {
    action: 'start',
    config: {
      providerId: 'cline',
      modelId: opt.model,
      mode: opt.mode,
      reasoningEffort: opt.effort,
      workspaceRoot: opt.cwd,
      autoApproveTools: opt.autoApprove,   // false = 需要你在 Cline 界面点批准；--auto-approve 才放行
    },
  },
}, 120000);
const sessionId = started?.sessionId || started?.session?.id;
console.log('  会话:', sessionId, JSON.stringify(started).slice(0, 200));
if (!sessionId) { console.error('× 未能创建会话'); br.close(); process.exit(4); }

console.log('→ 发送任务…');
await br.call('chat_session_command', { request: { action: 'send', sessionId, prompt: opt.prompt } }, 120000);

const t0 = Date.now();
let lastCount = 0, done = false, reply = '';
while ((Date.now() - t0) / 1000 < opt.timeout) {
  await new Promise((r) => setTimeout(r, 3000));
  let msgs = [];
  try { const r = await br.call('read_session_messages', { sessionId, maxMessages: 200 }, 30000); msgs = r?.messages || r || []; } catch { continue; }
  const assistant = (Array.isArray(msgs) ? msgs : []).filter((m) => (m.role || m.type) && String(m.role || m.type).includes('assistant'));
  if (assistant.length !== lastCount) lastCount = assistant.length;
  const last = assistant[assistant.length - 1];
  const text = last ? (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)) : '';
  if (text && text === reply) { done = true; break; }
  if (text) reply = text;
  if (!opt.json && text) process.stdout.write(`\r  已收到 ${text.length} 字符…`);
}
console.log('\n\n===== 回复 =====');
if (!reply) console.log('（可能是卡在等待工具审批或任务还没跑完——去 Cline 界面看一眼，或缺 --auto-approve）');
console.log(reply.slice(0, 4000) || '(超时未取到回复，可稍后用 read_session_messages 再取)');
if (opt.json) console.log('\n事件:', JSON.stringify(events.slice(-12), null, 1).slice(0, 2000));
br.close();
setTimeout(() => process.exit(0), 200);
