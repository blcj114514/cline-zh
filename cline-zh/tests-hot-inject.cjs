// tests-hot-inject.cjs —— 验证 zh-cn.js 的「叠加注入可升级」（observer/timer/监听器按版本戳就地重建）
// 场景：同一 window 先注入打标 v1 → 再注入 v2（新规则/新词库/新版本号）→ 第三次同版注入。
// 断言：
//   ① 冷启动：observer / interval / 焦点与可见性监听器各注册恰好 1 次，初始全量扫描生效
//   ② 叠加注入：旧 observer disconnect、旧 timer clearInterval、旧监听器摘除 —— 就地重建、
//     活动净数量仍各 1；注入即全量扫描；新渲染的节点走 v2 规则（不是 v1 标记输出）
//   ③ 派发性：连「已断开/已清除的旧回调」（僵尸）被触发时也经 window.__clineZhRun 用最新代码
//   ④ 幂等：第三次注入后活动数仍净 1、规则仍最新、stats.runs 跨注入累计不归零
//   ⑤ 遗留边界：模拟 ≤1.1.6 旧版（设施不上 window）→ 升级后旧设施无法摘除（文档化限制），
//     但新设施照常带戳接管，再注入后新设施侧仍净 1
// 零依赖：node:vm + 最小 DOM stub（observer/interval/timeout/事件监听全部可捕获、手动触发）。
// 跑法: node tests-hot-inject.cjs   （全绿时打印 ALL PASS）
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '  actual=' + JSON.stringify(actual)); }
}

const SRC = fs.readFileSync(path.join(__dirname, 'zh-cn.js'), 'utf8');
const VER = (SRC.match(/__clineZhVersion = "([^"]+)"/) || [])[1];
check('源码含版本号', typeof VER === 'string' && VER.length > 0, VER);

// ---------- 最小 DOM stub（沿用 tests-merge.cjs 风格，补齐可捕获设施）----------
function text(v) {
  return { nodeType: 3, nodeValue: v, parentElement: null, nextSibling: null, previousSibling: null };
}
function el(tag, kids, opts) {
  const e = {
    nodeType: 1, tagName: tag, childNodes: kids || [],
    _skipZone: !!(opts && opts.skipZone),
    closest() { let p = this; while (p) { if (p._skipZone) return p; p = p.parentElement; } return null; },
    parentElement: null,
    hasAttribute() { return false; },
    getAttribute() { return null; },
    setAttribute() {},
    querySelectorAll() { return []; }
  };
  const cs = e.childNodes;
  for (let i = 0; i < cs.length; i++) {
    cs[i].parentElement = e;
    cs[i].nextSibling = cs[i + 1] || null;
    cs[i].previousSibling = cs[i - 1] || null;
  }
  return e;
}
function collectText(root, out) {
  if (root.nodeType === 3) { out.push(root); return; }
  for (const c of root.childNodes || []) collectText(c, out);
}
const NF = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };

function makeWorld() {
  const captured = {
    obs: [],            // MutationObserver 实例（cb/disconnected/observed）
    intervals: [],      // setInterval 回调（按下标当 id）
    cleared: [],        // clearInterval 收到的 id
    timeouts: [],       // setTimeout 队列（手动 drain）
    winListeners: {},   // window.addEventListener 注册表
    docListeners: {},   // document.addEventListener 注册表
    removed: []         // removeEventListener 调用记录
  };
  const body = el('BODY', []);
  function addTo(reg, t, cb) { (reg[t] = reg[t] || []).push(cb); }
  function delFrom(reg, t, cb) {
    const a = reg[t] || [], i = a.indexOf(cb);
    if (i >= 0) { a.splice(i, 1); captured.removed.push(t); }
  }
  const document = {
    readyState: 'complete',
    title: 'Cline',
    body,
    documentElement: body,
    addEventListener(t, cb) { addTo(captured.docListeners, t, cb); },
    removeEventListener(t, cb) { delFrom(captured.docListeners, t, cb); },
    querySelectorAll() { return []; },
    createTreeWalker(root, _show, filter) {
      const all = []; collectText(root, all); let i = 0;
      return {
        nextNode() {
          while (i < all.length) {
            const n = all[i++];
            if (!filter || filter.acceptNode(n) === NF.FILTER_ACCEPT) return n;
          }
          return null;
        }
      };
    }
  };
  const window = {
    addEventListener(t, cb) { addTo(captured.winListeners, t, cb); },
    removeEventListener(t, cb) { delFrom(captured.winListeners, t, cb); }
  };
  const sandbox = {
    window, document,
    NodeFilter: NF,
    MutationObserver: class {
      constructor(cb) { this.cb = cb; this.disconnected = false; this.observed = 0; captured.obs.push(this); }
      observe() { this.observed++; }
      disconnect() { this.disconnected = true; }
    },
    setInterval(cb) { captured.intervals.push(cb); return captured.intervals.length; },
    clearInterval(id) { captured.cleared.push(id); },
    setTimeout(cb) { captured.timeouts.push(cb); return captured.timeouts.length; },
    clearTimeout() {},
    console: { log() {} },
    location: { href: 'http://test.local/' }
  };
  vm.createContext(sandbox);
  return { window, sandbox, captured, body };
}

function drainTimeouts(c) { while (c.timeouts.length) c.timeouts.shift()(); }
const activeObs = c => c.obs.filter(o => !o.disconnected);
const lastObs = c => c.obs[c.obs.length - 1];
const lastTimer = c => c.intervals[c.intervals.length - 1];

// 模拟 injector.js 的 prelude：词库就地合并 + 规则整体替换，然后执行引擎脚本
function inject(w, sandbox, src, dict, rules) {
  w.__CLINE_ZH_DICT__ = Object.assign(w.__CLINE_ZH_DICT__ || {}, dict);
  w.__CLINE_ZH_RULES_RAW__ = rules;
  w.__CLINE_ZH_RULES__ = rules;
  vm.runInContext(src, sandbox);
}

// v1 = 本源码把版本号打标（模拟旧版本：函数对象必不同 → 版本戳必不同）
const v1src = SRC.replace(/__clineZhVersion = "[^"]+"/, '__clineZhVersion = "hotv1"');
check('v1 脚本已打版本标记', v1src.includes('"hotv1"'), v1src.includes('"hotv1"'));

const dict1 = { 'Open Settings': '打开设置' };
const rules1 = [['^([0-9]+)m ago$', '$1 V1分钟前']];   // v1 规则输出带标记，可与 v2 区分
const dict2 = { 'Fresh Term': '新术语' };
const rules2 = [['^([0-9]+)m ago$', '$1 分钟前']];

// ======================================================================
// 世界 A：v1（新版打标）→ v2（新版）→ v2（同版再注）
// ======================================================================
const A = makeWorld();
const wA = A.window, sA = A.sandbox, cA = A.captured, bodyA = A.body;

// ---------- ① 冷启动 ----------
bodyA.childNodes.push(el('DIV', [text('10m ago')]));    // v1 规则命中 → '10 V1分钟前'
bodyA.childNodes.push(el('DIV', [text('Fresh Term')])); // v1 词库/规则不认 → 保持英文
inject(wA, sA, v1src, dict1, rules1);
const v1Run = wA.__clineZhRun, v1Scan = wA.__clineZhScan;
check('① v1 注入即全量扫描（v1 规则生效）',
  bodyA.childNodes[0].childNodes[0].nodeValue === '10 V1分钟前', bodyA.childNodes[0].childNodes[0].nodeValue);
check('① v1 不认识的词保持英文',
  bodyA.childNodes[1].childNodes[0].nodeValue === 'Fresh Term', bodyA.childNodes[1].childNodes[0].nodeValue);
check('① observer 注册恰好 1 次', cA.obs.length === 1 && cA.obs[0].observed === 1, [cA.obs.length, cA.obs[0].observed]);
check('① interval 注册恰好 1 次', cA.intervals.length === 1, cA.intervals.length);
check('① 焦点/可见性监听各 1 次',
  (cA.winListeners.focus || []).length === 1 && (cA.docListeners.visibilitychange || []).length === 1,
  [cA.winListeners.focus, cA.docListeners.visibilitychange]);
check('① 版本戳=当次 __clineZhScan',
  wA.__CLINE_ZH_OBS_STAMP__ === v1Scan && wA.__CLINE_ZH_TIMER_STAMP__ === v1Scan && wA.__CLINE_ZH_LISTEN_STAMP__ === v1Scan,
  [wA.__CLINE_ZH_OBS_STAMP__ === v1Scan, wA.__CLINE_ZH_TIMER_STAMP__ === v1Scan, wA.__CLINE_ZH_LISTEN_STAMP__ === v1Scan]);
check('① 版本号为 v1 标记', wA.__clineZhVersion === 'hotv1', wA.__clineZhVersion);

// v1 期间变更 → 当前活动 observer（v1 的 schedule）派发 v1 规则
const d1 = el('DIV', [text('5m ago')]);
bodyA.childNodes.push(d1);
lastObs(cA).cb();
drainTimeouts(cA);
check('① v1 期间变更走 v1 规则', d1.childNodes[0].nodeValue === '5 V1分钟前', d1.childNodes[0].nodeValue);

// ---------- ② 叠加注入 v2（不 reload）：戳不符 → 旧设施就地重建 ----------
const obs0 = wA.__CLINE_ZH_OBS__, timer0 = wA.__CLINE_ZH_TIMER__, lis0 = wA.__CLINE_ZH_LISTEN__;
const runsBefore2 = wA.__clineZhStats.runs;
inject(wA, sA, SRC, dict2, rules2);
check('② 旧 observer 已 disconnect', cA.obs[0].disconnected === true, cA.obs[0].disconnected);
check('② observer 就地重建（活动净 1）',
  cA.obs.length === 2 && activeObs(cA).length === 1 && wA.__CLINE_ZH_OBS__ !== obs0,
  [cA.obs.length, activeObs(cA).length]);
check('② 旧 timer 已 clearInterval 并重建',
  cA.cleared.indexOf(timer0) >= 0 && cA.intervals.length === 2, [cA.cleared, cA.intervals.length]);
check('② 旧监听器摘除并重挂（净 1）',
  cA.winListeners.focus.length === 1 && cA.docListeners.visibilitychange.length === 1 &&
  cA.winListeners.focus[0] !== lis0 && cA.removed.indexOf('focus') >= 0 && cA.removed.indexOf('visibilitychange') >= 0,
  [cA.winListeners.focus.length, cA.docListeners.visibilitychange.length, cA.removed]);
check('② 全局 run/scan 已重写为新闭包',
  wA.__clineZhRun !== v1Run && wA.__clineZhScan !== v1Scan,
  [wA.__clineZhRun === v1Run, wA.__clineZhScan === v1Scan]);
check('② 版本号升级为当次源码', wA.__clineZhVersion === VER, wA.__clineZhVersion);
check('② 注入即全量扫描（存量英文按 v2 词库收敛）',
  bodyA.childNodes[1].childNodes[0].nodeValue === '新术语', bodyA.childNodes[1].childNodes[0].nodeValue);
check('② stats.runs 跨注入累计不归零', wA.__clineZhStats.runs === runsBefore2 + 1, [runsBefore2, wA.__clineZhStats.runs]);

// ---------- ③ v2 注入后：新渲染节点走 v2 规则；僵尸回调也派发到最新代码 ----------
const d2 = el('DIV', [text('8m ago')]);
bodyA.childNodes.push(d2);
lastObs(cA).cb();
drainTimeouts(cA);
check('③ observer 派发 v2 规则（新渲染→中文）', d2.childNodes[0].nodeValue === '8 分钟前', d2.childNodes[0].nodeValue);
check('③ 输出不含 v1 标记', d2.childNodes[0].nodeValue !== '8 V1分钟前', d2.childNodes[0].nodeValue);

// 僵尸 observer（已 disconnect 的 v1 实例）被触发：其 schedule 闭包经 window.__clineZhRun 派发到 v2
const d3 = el('DIV', [text('7m ago')]);
bodyA.childNodes.push(d3);
cA.obs[0].cb();
drainTimeouts(cA);
check('③ 僵尸 observer 回调仍派发 v2 规则', d3.childNodes[0].nodeValue === '7 分钟前', d3.childNodes[0].nodeValue);

// 僵尸 timer（已 clearInterval 的 v1 回调）同理
const d4 = el('DIV', [text('3m ago')]);
bodyA.childNodes.push(d4);
cA.intervals[0]();
check('③ 僵尸 timer 回调仍派发 v2 规则', d4.childNodes[0].nodeValue === '3 分钟前', d4.childNodes[0].nodeValue);

// 当前活动 timer：兜底全量扫描，词库与规则都应按 v2
const d5 = el('DIV', [text('4m ago'), text('Open Settings')]);
bodyA.childNodes.push(d5);
lastTimer(cA)();
check('③ timer 兜底派发 v2 规则（时间）', d5.childNodes[0].nodeValue === '4 分钟前', d5.childNodes[0].nodeValue);
check('③ timer 兜底派发 v2 词库（词条）', d5.childNodes[1].nodeValue === '打开设置', d5.childNodes[1].nodeValue);

// ---------- ④ 第三次注入（同版 v2）：仍重建但活动数恒 1，计数不归零 ----------
const runsBefore3 = wA.__clineZhStats.runs;
inject(wA, sA, SRC, {}, rules2);
check('④ 第三次注入后 observer 活动净 1', cA.obs.length === 3 && activeObs(cA).length === 1,
  [cA.obs.length, activeObs(cA).length]);
check('④ 第三次注入后 timer 活动净 1', cA.intervals.length === 3 && cA.cleared.length === 2,
  [cA.intervals.length, cA.cleared.length]);
check('④ 监听器仍各净 1（不重复注册）',
  cA.winListeners.focus.length === 1 && cA.docListeners.visibilitychange.length === 1,
  [cA.winListeners.focus.length, cA.docListeners.visibilitychange.length]);
check('④ stats.runs 继续累计（+1 而非归零）', wA.__clineZhStats.runs === runsBefore3 + 1,
  [runsBefore3, wA.__clineZhStats.runs]);
const d6 = el('DIV', [text('6m ago')]);
bodyA.childNodes.push(d6);
lastObs(cA).cb();
drainTimeouts(cA);
check('④ 第三次注入后变更仍走 v2 规则', d6.childNodes[0].nodeValue === '6 分钟前', d6.childNodes[0].nodeValue);
check('④ __clineZhInfo 正常', (function () {
  const info = wA.__clineZhInfo();
  return info && info.version === VER && info.dictSize >= 2 && info.ruleCount === 1;
})(), wA.__clineZhInfo && wA.__clineZhInfo());

// ======================================================================
// 世界 B：模拟 ≤1.1.6 旧版（__clineZhInstalled 早退 + 设施不上 window）
// → 升级时旧设施无法摘除（文档化边界），但新设施照常带戳接管
// ======================================================================
const B = makeWorld();
const wB = B.window, sB = B.sandbox, cB = B.captured;
const legacySrc = [
  '(function(){',
  '  if (window.__clineZhInstalled) return;',          // 旧版早退
  '  window.__clineZhInstalled = true;',
  '  window.__clineZhVersion = "1.1.6-legacy";',
  '  function run(){ window.__LEGACY_RUNS__ = (window.__LEGACY_RUNS__ || 0) + 1; }',
  '  function schedule(){ setTimeout(run, 100); }',
  '  try { new MutationObserver(schedule).observe(document.documentElement, {}); } catch (e) {}',
  '  try { setInterval(run, 5000); } catch (e) {}',     // 均不存 window → 无戳可摘
  '  try { window.addEventListener("focus", schedule, true); } catch (e) {}',
  '  try { document.addEventListener("visibilitychange", schedule, true); } catch (e) {}',
  '  window.__clineZhRun = run;',
  '})();'
].join('\n');
inject(wB, sB, legacySrc, dict1, rules1);
check('⑤ 旧版已安装且无任何版本戳',
  wB.__clineZhVersion === '1.1.6-legacy' && !wB.__CLINE_ZH_OBS_STAMP__ && !wB.__CLINE_ZH_TIMER_STAMP__,
  wB.__clineZhVersion);
inject(wB, sB, SRC, dict2, rules2);
check('⑤ 新版接管（版本号/全局函数已换）', wB.__clineZhVersion === VER && typeof wB.__clineZhScan === 'function',
  wB.__clineZhVersion);
check('⑤ 新 observer/timer 带戳注册',
  wB.__CLINE_ZH_OBS__ === cB.obs[1] && wB.__CLINE_ZH_OBS_STAMP__ === wB.__clineZhScan &&
  wB.__CLINE_ZH_TIMER__ != null && wB.__CLINE_ZH_TIMER_STAMP__ === wB.__clineZhScan,
  [wB.__CLINE_ZH_OBS__ === cB.obs[1], wB.__CLINE_ZH_TIMER__]);
check('⑤ 文档化边界：旧版设施无法摘除（observer/timer 僵尸各 1）',
  cB.obs.length === 2 && activeObs(cB).length === 2 && cB.intervals.length === 2 && cB.cleared.length === 0,
  [cB.obs.length, activeObs(cB).length, cB.intervals.length, cB.cleared.length]);
// 再注入一次新版：带戳设施侧仍保持净 1（旧僵尸除外）
inject(wB, sB, SRC, {}, rules2);
check('⑤ 再注入后带戳 observer 侧仍净 1',
  cB.obs.length === 3 && wB.__CLINE_ZH_OBS__ === cB.obs[2] && cB.obs[1].disconnected === true,
  [cB.obs.length, wB.__CLINE_ZH_OBS__ === cB.obs[2], cB.obs[1].disconnected]);
check('⑤ 再注入后带戳 timer 侧仍净 1',
  cB.intervals.length === 3 && cB.cleared.length === 1,
  [cB.intervals.length, cB.cleared.length]);

console.log('----------------------------------------');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' checks)' : 'FAILED: ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
