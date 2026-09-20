/*
 * 本地自测：模拟一个 CDP 端点（HTTP /json/list + WebSocket），
 * 用来在没有浏览器的情况下验证 injector.js 的协议实现是否正确。
 *   node selftest.js
 *
 * v1.1：修正帧累积器（此前解析出完整帧后会丢弃缓冲区里的半包，可能造成偶发假失败）。
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 19223;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TARGET_ID = 'TEST-TARGET-1';

const calls = [];

// ---- minimal WebSocket frame helpers ----
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// 返回 { frames, rest }：rest 是尚未收全的尾部字节，必须保留等下一个 chunk
function decodeFrames(buf) {
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const opcode = buf[i] & 0x0f;
    const masked = (buf[i + 1] & 0x80) !== 0;
    let len = buf[i + 1] & 0x7f;
    let off = i + 2;
    if (len === 126) {
      if (off + 2 > buf.length) break;
      len = buf.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (off + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(off)); off += 8;
    }
    let maskKey = null;
    if (masked) {
      if (off + 4 > buf.length) break;
      maskKey = buf.slice(off, off + 4); off += 4;
    }
    if (off + len > buf.length) break;
    const payload = Buffer.from(buf.slice(off, off + len));
    if (maskKey) for (let k = 0; k < payload.length; k++) payload[k] ^= maskKey[k % 4];
    out.push({ opcode, payload: payload.toString('utf8') });
    i = off + len;
  }
  return { frames: out, rest: buf.slice(i) };
}

let evaluator = null;   // 用于在“页面”里执行注入的脚本

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/json/list') || req.url.startsWith('/json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{
      id: TARGET_ID, type: 'page', title: 'Mock Cline',
      url: 'http://tauri.localhost/index.html',
      webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/${TARGET_ID}`
    }]));
    return;
  }
  res.writeHead(404); res.end('nope');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.on('error', () => {});
  server.on('clientError', () => {});
  let acc = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    const { frames, rest } = decodeFrames(acc);
    acc = rest;                       // 保留半包，等下个 chunk 续上
    for (const f of frames) {
      let msg;
      try { msg = JSON.parse(f.payload); } catch { continue; }
      calls.push(msg.method);
      let result = {};
      if (msg.method === 'Runtime.evaluate') {
        const expr = msg.params.expression || '';
        if (expr.startsWith('window.__clineZhInfo ?')) {
          result = { result: { type: 'string', value: JSON.stringify(evaluator ? evaluator() : null) } };
        } else if (expr === '!!window.__clineZhInstalled') {
          result = { result: { type: 'boolean', value: !!(global.__mockInstalled) } };
        } else {
          // 真正执行注入的脚本，模拟页面环境
          try {
            const sandbox = makeSandbox();
            const fn = new Function('window', 'document', 'setTimeout', 'setInterval', 'NodeFilter', 'MutationObserver', expr);
            fn(sandbox.window, sandbox.document, sandbox.setTimeout, sandbox.setInterval, sandbox.NodeFilter, sandbox.MutationObserver);
            global.__mockRendered = sandbox.inspect();
            global.__mockDictSize = Object.keys(sandbox.window.__CLINE_ZH_DICT__ || {}).length;
            global.__mockInstalled = true;
            evaluator = () => ({
              version: sandbox.window.__clineZhVersion,
              dictSize: global.__mockDictSize,
              ruleCount: (sandbox.window.__CLINE_ZH_RULES__ || []).length,
              runs: 1,
              translated: sandbox.translated
            });
            result = { result: { type: 'undefined' } };
          } catch (e) {
            global.__mockEvalError = e.message + '\n' + (e.stack || '');
            result = { result: { type: 'string', value: 'EVAL_ERROR: ' + e.message } };
          }
        }
      }
      socket.write(encodeFrame(JSON.stringify({ id: msg.id, result })));
    }
  });
});

// 极简 DOM 打桩：足够验证引擎的遍历/替换逻辑
function makeSandbox() {
  const translated = [];
  function makeTextNode(value) {
    return { nodeType: 3, nodeValue: value, parentElement: null };
  }
  function makeEl(tag, text) {
    const el = {
      nodeType: 1, tagName: tag, attributes: {}, children: [], parentElement: null,
      closest() { return null; },
      hasAttribute(a) { return a in this.attributes; },
      getAttribute(a) { return this.attributes[a]; },
      setAttribute(a, v) { this.attributes[a] = v; },
      querySelectorAll() { return []; }
    };
    if (text != null) {
      const t = makeTextNode(text); t.parentElement = el; el.children.push(t);
    }
    return el;
  }
  const nodes = [makeEl('BUTTON', 'Sign in'), makeEl('BUTTON', 'Settings'), makeEl('DIV', 'New session'),
                 makeEl('SPAN', 'Not in dict at all')];  const body = {
    nodeType: 1, tagName: 'BODY',
    querySelectorAll() { return []; }
  };
  const document = {
    readyState: 'complete',
    body,
    documentElement: body,
    title: 'Cline',
    addEventListener() {},
    createTreeWalker(root, _show, filter) {
      const flat = [];
      (function walk(list) {
        for (const el of list) {
          for (const c of el.children) {
            if (c.nodeType === 3) flat.push(c);
            else walk([c]);
          }
        }
      })(root === body ? nodes : []);
      let i = 0;
      return {
        nextNode() {
          while (i < flat.length) {
            const n = flat[i++];
            const v = filter.acceptNode(n);
            if (v === 200) return n;   // FILTER_ACCEPT
          }
          return null;
        }
      };
    }
  };
  const windowObj = { addEventListener() {}, removeEventListener() {} };
  return {
    window: windowObj, document,
    translated,
    setTimeout: (f, t) => { f(); return 0; },
    setInterval: () => 0,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 200, FILTER_REJECT: 201 },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    inspect() {
      return nodes.map(el => el.children.map(c => c.nodeValue).join(''));
    }
  };
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('[selftest] mock CDP listening on', PORT);
  const statusFile = path.join(__dirname, 'selftest-status.json');
  try { fs.unlinkSync(statusFile); } catch {}
  const child = spawn(process.execPath, [path.join(__dirname, 'injector.js'), '--once'], {
    env: Object.assign({}, process.env, {
      CLINE_ZH_PORT: String(PORT),
      CLINE_ZH_STATUS: statusFile
    }),
    cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => out += d);
  child.on('exit', (code) => {
    const statusPath = path.join(__dirname, 'selftest-status.json');
    let status = null;
    try { status = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch {}
    const report = {
      exitCode: code,
      methodsSeen: calls,
      injectorOutput: out.trim().split('\n'),
      statusFile: status,
      renderedTextsAfterInjection: global.__mockRendered || null
    };
    fs.writeFileSync(path.join(__dirname, 'selftest-report.json'), JSON.stringify(report, null, 2));
    console.log('--- injector output ---');
    console.log(out.trim());
    console.log('--- CDP methods seen ---', JSON.stringify(calls));
    console.log('--- status.ok ---', status && status.ok, '| dict in page:', status && status.engine && status.engine.dictSize);
    console.log('--- 注入后被翻译的文本 ---', JSON.stringify(global.__mockRendered));
    if (global.__mockEvalError) console.log('--- EVAL ERROR ---\n' + global.__mockEvalError);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
  setTimeout(() => { try { child.kill(); } catch {} }, 20000);
});
