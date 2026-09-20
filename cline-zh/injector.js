/*
 * Cline 中文汉化 —— CDP 注入器
 *
 * 作用：通过 WebView2 的远程调试端口连上 Cline 的页面，把 zh-cn.js 注入进去并常驻维持。
 * 零第三方依赖（使用 Node 22+ 内置 fetch / WebSocket）。
 *
 * 用法：
 *   node injector.js           常驻，持续保证界面是中文（推荐）
 *   node injector.js --once    注入一次后退出
 *
 * 环境变量：
 *   CLINE_ZH_PORT   调试端口，默认 9222
 *   CLINE_ZH_STATUS 状态文件路径，默认 <脚本目录>/zh-status.json
 *
 * v1.1.1 变更（2026-09-19）：
 *  - 字典改为就地合并 + 暴露原始规则，重注入后新词条立即生效
 *
 * v1.1.0 变更（2026-09-19）：
 *  - 连不上端口时给出人话提示（最常见原因：Cline 本来就在运行）
 *  - 心跳从「每 2 秒全量重扫」改为「每 10 秒存活检查，失效才重新注入」
 *  - 目标筛选更严格：只注入 tauri.localhost / 含 cline 的页面，避免误伤无关程序
 *  - 启动即检查 Node 版本（需要 22+，依赖内置 WebSocket）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PORT = process.env.CLINE_ZH_PORT || '9222';
const ONCE = process.argv.includes('--once');
const DIR = __dirname;
const STATUS = process.env.CLINE_ZH_STATUS || path.join(DIR, 'zh-status.json');

function log(...a) {
  const line = `[${new Date().toLocaleTimeString()}] ${a.join(' ')}`;
  console.log(line);
}

function writeStatus(obj) {
  try {
    fs.writeFileSync(STATUS, JSON.stringify(Object.assign({
      updatedAt: new Date().toISOString(),
      port: PORT
    }, obj), null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

function loadPayload() {
  const dict = JSON.parse(fs.readFileSync(path.join(DIR, 'dict.json'), 'utf8'));
  let rules = [];
  const rulesPath = path.join(DIR, 'rules.json');
  if (fs.existsSync(rulesPath)) rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const engine = fs.readFileSync(path.join(DIR, 'zh-cn.js'), 'utf8');
  // 字典必须「就地合并」而不是整体替换：引擎可能已经持有该对象，
  // 替换对象会让运行中的引擎继续用旧词库（v1.1.1 修复：重注入后词库不生效）。
  const prelude =
    'window.__CLINE_ZH_DICT__ = Object.assign(window.__CLINE_ZH_DICT__ || {}, ' + JSON.stringify(dict) + ');\n' +
    'window.__CLINE_ZH_RULES_RAW__ = ' + JSON.stringify(rules) + ';\n' +
    'window.__CLINE_ZH_RULES__ = window.__CLINE_ZH_RULES_RAW__;\n';
  return { payload: prelude + engine, dictCount: Object.keys(dict).length, ruleCount: rules.length };
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

function pickPage(targets) {
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) return null;
  // 首选 Cline 的 tauri.localhost 页面
  const tauri = pages.find(t => /tauri\.localhost/i.test(t.url || ''));
  if (tauri) return tauri;
  // 退而求其次：url 或标题里带 cline
  const cline = pages.find(t => /cline/i.test((t.url || '') + ' ' + (t.title || '')));
  if (cline) return cline;
  // 端口被别的程序占用时：宁可不注入，也不要在无关页面上改文案
  return null;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('WS error')));
      this.ws.addEventListener('close', () => {
        for (const [, p] of this.pending) p.reject(new Error('WS closed'));
        this.pending.clear();
        this.closed = true;
      });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
        else p.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout: ' + method)); }
      }, 15000);
      const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      try { this.ws.send(payload); } catch (e) { this.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }
  close() { try { this.ws.close(); } catch { } }
}

async function injectInto(target, payload, dictCount, ruleCount) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  try {
    await cdp.send('Page.enable');
  } catch { /* 某些目标不支持，忽略 */ }
  // 注册到「新文档创建时」，页面刷新/导航后依然自动生效
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: payload });
  // 当前页面立即生效
  await cdp.send('Runtime.evaluate', { expression: payload, returnByValue: true });
  const info = await cdp.send('Runtime.evaluate', {
    expression: 'window.__clineZhInfo ? JSON.stringify(window.__clineZhInfo()) : "null"',
    returnByValue: true
  });
  let parsed = null;
  try { parsed = JSON.parse(info.result.value); } catch { }
  return { cdp, url: target.url, title: target.title, info: parsed, dictCount, ruleCount };
}

async function main() {
  // Node 版本关卡：需要内置 WebSocket（Node 22+）
  if (typeof WebSocket !== 'function') {
    log('当前 Node 版本过低（' + process.version + '），本工具依赖 Node 22+ 的内置 WebSocket。');
    writeStatus({ ok: false, stage: 'env', error: 'WebSocket 不可用，需要 Node >= 22，当前 ' + process.version });
    process.exit(1);
  }

  let loaded;
  try {
    loaded = loadPayload();
  } catch (e) {
    log('无法加载词库: ' + e.message);
    writeStatus({ ok: false, stage: 'load', error: e.message });
    process.exit(1);
  }
  log(`词库已加载：${loaded.dictCount} 条译文 / ${loaded.ruleCount} 条规则`);

  let lastTargetId = null;
  let conn = null;
  let attempts = 0;
  let failStreak = 0;
  let hb = 0;

  for (;;) {
    attempts++;
    try {
      const targets = await listTargets();
      failStreak = 0;
      const page = pickPage(targets);
      if (!page) {
        const seen = targets.filter(t => t.type === 'page')
          .map(t => t.title || t.url || t.id).slice(0, 3).join(' | ');
        log('未发现 Cline 页面，等待中…' + (seen ? '（端口上现有页面：' + seen + '）' : ''));
        writeStatus({ ok: false, stage: 'wait-target', attempts, seen });
      } else if (page.id !== lastTargetId || !conn || conn.closed) {
        if (conn) conn.close();
        log('发现页面目标：' + (page.url || page.id));
        const r = await injectInto(page, loaded.payload, loaded.dictCount, loaded.ruleCount);
        conn = r.cdp;
        lastTargetId = page.id;
        hb = 0;
        log(`注入成功。页面：${r.url}`);
        log('已生效译文条数：' + (r.info ? '引擎已运行 ' + r.info.runs + ' 次' : '未知'));
        writeStatus({
          ok: true, stage: 'injected', attempts,
          targetId: page.id, targetUrl: r.url, targetTitle: r.title,
          dictCount: r.dictCount, ruleCount: r.ruleCount, engine: r.info
        });
        if (ONCE) { conn.close(); setTimeout(() => process.exit(0), 150); return; }
      } else {
        // 存活检查（每 10 秒一次，不再每次全量重扫 DOM）
        hb++;
        if (hb % 5 === 0) {
          try {
            const alive = await conn.send('Runtime.evaluate', {
              expression: '!!window.__clineZhInstalled', returnByValue: true
            });
            if (!alive || alive.result.value !== true) {
              // 页面把我们清掉了（例如整页重载且新文档注册丢失）→ 重新注入
              log('检测到翻译层缺失，重新注入…');
              conn.close();
              const r2 = await injectInto(page, loaded.payload, loaded.dictCount, loaded.ruleCount);
              conn = r2.cdp;
              log('重新注入成功。');
            }
          } catch (e) { conn = null; lastTargetId = null; }
        }
      }
    } catch (e) {
      const msg = e.message || String(e);
      if (/fetch failed|ECONNREFUSED|ECONNRESET|timeout/i.test(msg)) {
        failStreak++;
        if (failStreak === 1 || failStreak % 15 === 0) {
          log('连不上调试端口 127.0.0.1:' + PORT + '（已尝试 ' + failStreak + ' 次）');
          log('  常见原因一：Cline 本来就在运行 —— 调试端口只在 Cline 全新启动时生效，');
          log('             请完全退出 Cline（含托盘图标），再用 Launch-Cline-ZH.bat 重新启动。');
          log('  常见原因二：端口被别的程序占用 —— 改 PORT（启动器里改，或 set CLINE_ZH_PORT=9333）。');
        }
      } else {
        log('提示: ' + msg);
      }
      writeStatus({ ok: false, stage: 'loop', attempts, error: msg });
      lastTargetId = null;
      if (conn) { conn.close(); conn = null; }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

main().catch(e => {
  log('致命错误: ' + (e && e.stack || e));
  writeStatus({ ok: false, stage: 'fatal', error: String(e && e.message || e) });
  process.exit(1);
});
