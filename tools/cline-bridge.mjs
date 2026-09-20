#!/usr/bin/env node
/*
 * cline-bridge —— 直连 Cline Desktop 的本地传输层（零依赖，手写 WebSocket 帧）
 *
 * 通道：ws://127.0.0.1:<sidecar端口>/transport   （端口可从 ~/.cline/data/logs/code.log 的
 *       "Desktop sidecar ready" 取，或本脚本自动探测 code-sidecar 监听端口）
 * 协议：请求 {"id","command","args"} → 回复 {"id","ok":true,"result"} / {"id","ok":false,"error"}
 *       事件 {"type":"event","event":{"name","payload"}}
 * 已确认可用命令（hub 能力表）：session.create/list/get/run/abort、task.*、schedule.*、
 *       settings.get/set、run.enqueue/list、hub.status/drain、stream.replay、client.register/list
 *
 * 用法：
 *   node cline-bridge.mjs status                 # hub.status + client.list + session.list
 *   node cline-bridge.mjs cmd <命令> '<json参数>'  # 任意命令（原始返回）
 *   node cline-bridge.mjs watch <命令> '<json参数>' [秒]   # 发命令并持续打印事件
 */
import net from 'node:net';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CLINE_DIR = process.env.CLINE_DATA_DIR || `${os.homedir()}/.cline`;

// ---------- 端口发现 ----------
function portFromLog() {
  const log = `${CLINE_DIR}/data/logs/code.log`;
  if (!existsSync(log)) return null;
  const lines = readFileSync(log, 'utf8').split('\n').slice(-400);
  let last = null;
  for (const ln of lines) {
    try {
      const o = JSON.parse(ln);
      if (o.msg === 'Desktop sidecar ready' && typeof o.port === 'number' && o.mode === 'sidecar') last = o.port;
    } catch { /* 跳过非 JSON 行 */ }
  }
  return last;
}
function portFromProcess() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in (Get-Process code-sidecar -ErrorAction SilentlyContinue).Id } | Select-Object -ExpandProperty LocalPort"',
      { encoding: 'utf8', timeout: 15000 });
    const ports = out.split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n !== 25463);
    return ports[0] ?? null;
  } catch { return null; }
}

// ---------- 极简 WebSocket 客户端 ----------
class MiniWS {
  constructor(port, pathname = '/transport', origin = null) {
    this.port = port; this.pathname = pathname; this.origin = origin;
    this.buf = Buffer.alloc(0); this.handlers = { message: [], open: [], close: [] };
  }
  on(ev, fn) { this.handlers[ev].push(fn); return this; }
  emit(ev, ...a) { for (const f of this.handlers[ev]) f(...a); }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = net.connect(this.port, '127.0.0.1', () => {
        const lines = [
          `GET ${this.pathname} HTTP/1.1`, `Host: 127.0.0.1:${this.port}`,
          'Upgrade: websocket', 'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13',
        ];
        if (this.origin) lines.push(`Origin: ${this.origin}`);
        this.sock.write(lines.join('\r\n') + '\r\n\r\n');
      });
      let handshaken = false;
      this.sock.on('data', (d) => {
        if (!handshaken) {
          this.buf = Buffer.concat([this.buf, d]);
          const idx = this.buf.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const head = this.buf.slice(0, idx).toString('utf8');
          this.buf = this.buf.slice(idx + 4);
          const status = head.split('\r\n')[0];
          if (!/101/.test(status)) { reject(new Error('握手失败: ' + status)); this.sock.destroy(); return; }
          const accept = (head.match(/sec-websocket-accept:\s*(\S+)/i) || [])[1];
          const expect = crypto.createHash('sha1').update(key + GUID).digest('base64');
          if (accept !== expect) { reject(new Error('Sec-WebSocket-Accept 校验失败')); this.sock.destroy(); return; }
          handshaken = true;
          this.emit('open');
          if (this.buf.length) this._drain();
          resolve();
          return;
        }
        this.buf = Buffer.concat([this.buf, d]);
        this._drain();
      });
      this.sock.on('close', () => this.emit('close'));
      this.sock.on('error', (e) => { if (!handshaken) reject(e); else this.emit('close', e); });
    });
  }
  _drain() {
    for (;;) {
      const f = this._frame();
      if (!f) return;
      if (f.opcode === 1 || f.opcode === 0) this.emit('message', f.payload.toString('utf8'));
      else if (f.opcode === 9) this._send(f.payload, 10);          // ping → pong
      else if (f.opcode === 8) { this.sock.destroy(); return; }
    }
  }
  _frame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < off + 2) return null; len = b.readUInt16BE(off); off += 2; }
    else if (len === 127) { if (b.length < off + 8) return null; len = Number(b.readBigUInt64BE(off)); off += 8; }
    let mask = null;
    if (masked) { if (b.length < off + 4) return null; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) return null;
    const payload = Buffer.from(b.slice(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    this.buf = b.slice(off + len);
    return { opcode, payload };
  }
  _send(payload, opcode = 1) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, 0x80 | len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
    const mask = crypto.randomBytes(4);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, body]));
  }
  sendText(s) { this._send(Buffer.from(s, 'utf8'), 1); }
  close() { try { this.sock.destroy(); } catch {} }
}

// ---------- 业务层 ----------
export class ClineBridge {
  constructor(port) { this.port = port; this.ws = null; this.pending = new Map(); this.seq = 0; this.events = []; }
  async connect() {
    this.ws = new MiniWS(this.port);
    this.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'event') { this.events.push(m.event); for (const h of (this.eventHandlers || [])) h(m.event); return; }
      if (m.id != null && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.ok === false) reject(new Error(m.error || 'command failed'));
        else resolve(m.result);
      }
    });
    await this.ws.connect();
    await new Promise((r) => setTimeout(r, 120));   // 等 sidecar 的 host_ready 事件
    return this;
  }
  onEvent(fn) { (this.eventHandlers = this.eventHandlers || []).push(fn); }
  call(command, args = {}, timeoutMs = 30000) {
    const id = `bridge_${Date.now()}_${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`超时未回复: ${command}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.sendText(JSON.stringify({ id, command, args }));
    });
  }
  close() { this.ws && this.ws.close(); }
}

// ---------- CLI ----------
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('cline-bridge.mjs');
if (isMain) {
  const [mode = 'status', ...rest] = process.argv.slice(2);
  let port = process.env.CLINE_SIDECAR_PORT ? Number(process.env.CLINE_SIDECAR_PORT) : null;
  if (!port) port = portFromLog();
  if (!port) port = portFromProcess();
  if (!port) { console.error('× 找不到 Cline sidecar 端口（Cline 桌面端没在运行？）'); process.exit(1); }
  console.log(`· sidecar 端口 ${port}`);

  const br = await new ClineBridge(port).connect();
  console.log('· 传输层已连通\n');

  const show = (label, v) => console.log(`── ${label} ──\n` + JSON.stringify(v, null, 1).slice(0, 4000) + '\n');
  try {
    if (mode === 'status') {
      for (const c of ['hub.status', 'client.list', 'session.list', 'run.list']) {
        try { show(c, await br.call(c, {}, 20000)); } catch (e) { console.log(`── ${c} ── 失败: ${e.message}\n`); }
      }
      console.log('── 期间收到的事件 ──');
      console.log(br.events.map((e) => e.name).join(', ') || '(无)');
    } else if (mode === 'cmd' || mode === 'watch') {
      const cmd = rest[0];
      const args = rest[1] ? JSON.parse(rest[1]) : {};
      if (!cmd) { console.error('用法: cmd <命令> \'<json参数>\''); process.exit(2); }
      if (mode === 'watch') {
        br.onEvent((e) => console.log('[event]', e.name, JSON.stringify(e.payload).slice(0, 600)));
        const secs = Number(rest[2] || 30);
        console.log(`· 已发 ${cmd}，监听事件 ${secs} 秒…`);
        br.call(cmd, args, 600000).then((r) => console.log('── 回复 ──\n' + JSON.stringify(r, null, 1).slice(0, 4000))).catch((e) => console.log('× ' + e.message));
        await new Promise((r) => setTimeout(r, secs * 1000));
      } else {
        show(cmd, await br.call(cmd, args, 120000));
      }
    } else {
      console.error('用法: status | cmd <命令> [json] | watch <命令> [json] [秒]');
    }
  } finally {
    br.close();
    setTimeout(() => process.exit(0), 200);
  }
}
