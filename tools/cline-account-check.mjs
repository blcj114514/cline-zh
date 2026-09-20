#!/usr/bin/env node
// 只读核对：Cline 账号登录态与模型可用性（绝不打印任何密钥/令牌，只输出是/否与数量）
import { ClineBridge } from './cline-bridge.mjs';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';

const CLINE = `${os.homedir()}/.cline`;
function portFromLog() {
  const log = `${CLINE}/data/logs/code.log`;
  if (!existsSync(log)) return null;
  let last = null;
  for (const ln of readFileSync(log, 'utf8').split('\n').slice(-400)) {
    try { const o = JSON.parse(ln); if (o.msg === 'Desktop sidecar ready' && o.mode === 'sidecar') last = o.port; } catch {}
  }
  return last;
}
const port = Number(process.env.CLINE_SIDECAR_PORT || portFromLog());
const br = await new ClineBridge(port).connect();

const safe = (v, depth = 0) => {
  if (v == null) return v;
  if (typeof v === 'string') return v.length > 60 ? `<string len=${v.length}>` : v;
  if (typeof v !== 'object') return v;
  if (depth > 2) return '<obj>';
  if (Array.isArray(v)) return [`array(${v.length})`, v.slice(0, 2).map((x) => safe(x, depth + 1))];
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const key = k.toLowerCase();
    const secretish = /key|token|secret|password|credential|auth/.test(key);
    out[k] = secretish ? `<${typeof val} ${val ? '有值(已隐藏)' : '空'}>` : safe(val, depth + 1);
  }
  return out;
};

for (const cmd of ['cline_account', 'get_global_settings']) {
  try {
    const r = await br.call(cmd, {}, 25000);
    console.log(`\n── ${cmd} ──`);
    console.log(JSON.stringify(safe(r), null, 1).slice(0, 2500));
  } catch (e) { console.log(`\n── ${cmd} ── 失败: ${e.message}`); }
}

// 免费模型里挑一个，确认它在 provider 的模型表里可见
try {
  const pm = await br.call('list_provider_models', { providerId: 'cline' }, 30000);
  const models = pm?.models ?? pm?.providers?.[0]?.models ?? [];
  const free = (Array.isArray(models) ? models : []).filter((m) => /free/.test(String(m.id || '')));
  console.log(`\n── list_provider_models(cline) ── 共 ${Array.isArray(models) ? models.length : '?'} 个；其中含 "free" 的 ${free.length} 个：`);
  for (const m of free.slice(0, 12)) {
    console.log('   ', m.id, '|', m.name, '| ctx', m.contextWindow ?? m.maxInputTokens ?? '?', '| effort', JSON.stringify(m.reasoningOptions ?? null));
  }
} catch (e) { console.log('\n── list_provider_models ── 失败: ' + e.message); }

br.close();
setTimeout(() => process.exit(0), 200);
