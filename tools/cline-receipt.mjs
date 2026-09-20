#!/usr/bin/env node
// 回执核对：账号(fetchMe/fetchBalance) + 指定会话的消息结构（模型/用量/effort 字段）
import { ClineBridge } from './cline-bridge.mjs';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';

function portFromLog() {
  const log = `${os.homedir()}/.cline/data/logs/code.log`;
  if (!existsSync(log)) return null;
  let last = null;
  for (const ln of readFileSync(log, 'utf8').split('\n').slice(-400)) {
    try { const o = JSON.parse(ln); if (o.msg === 'Desktop sidecar ready' && o.mode === 'sidecar') last = o.port; } catch {}
  }
  return last;
}
const port = Number(process.env.CLINE_SIDECAR_PORT || portFromLog());
const br = await new ClineBridge(port).connect();

const sessionId = process.argv[2] || (await br.call('list_chat_sessions', {}, 25000)).sessions?.[0]?.id;

// 账号
for (const op of ['fetchMe', 'fetchBalance']) {
  try {
    const r = await br.call('cline_account', op === 'fetchBalance' ? { operation: op, userId: (await br.call('cline_account', { operation: 'fetchMe' }, 20000)).id } : { operation: op }, 25000);
    const masked = JSON.parse(JSON.stringify(r, (k, v) => (/mail|name|id$|token|key|secret/i.test(k) && typeof v === 'string' ? (v.length > 8 ? v.slice(0, 4) + '***' : '***') : v)));
    console.log(`\n── cline_account(${op}) ──\n` + JSON.stringify(masked, null, 1).slice(0, 1200));
  } catch (e) { console.log(`\n── cline_account(${op}) 失败: ${e.message}`); }
}

// 会话消息结构
try {
  const r = await br.call('read_session_messages', { sessionId, maxMessages: 20 }, 30000);
  const msgs = r?.messages || r || [];
  console.log(`\n── read_session_messages(${sessionId}) ── 共 ${Array.isArray(msgs) ? msgs.length : '?'} 条`);
  const last = (Array.isArray(msgs) ? msgs : []).slice(-2);
  for (const m of last) {
    console.log('  ---');
    console.log('  keys:', Object.keys(m).join(', '));
    for (const k of ['role', 'type', 'model', 'modelId', 'providerId', 'usage', 'reasoningEffort', 'effort', 'ts', 'createdAt']) {
      if (m[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(m[k]).slice(0, 300));
    }
  }
} catch (e) { console.log('\nread_session_messages 失败: ' + e.message); }
br.close();
setTimeout(() => process.exit(0), 200);
