// tests-merge.cjs —— 验证 zh-cn.js 的「相邻文本节点合并匹配」（v1.1.6）
// 零依赖：node:vm + 最小 DOM stub，真实执行 zh-cn.js（IIFE）。
// 跑法: node tests-merge.cjs   （全绿时打印 ALL PASS）
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

// ---------- 最小 DOM stub ----------
function text(v) {
  return { nodeType: 3, nodeValue: v, parentElement: null, nextSibling: null, previousSibling: null };
}
function el(tag, kids, opts) {
  const e = {
    nodeType: 1, tagName: tag, childNodes: kids || [],
    _skipZone: !!(opts && opts.skipZone),
    // SKIP_SELECTOR 命中与否只看 _skipZone 标记（含祖先链），其余选择器一律不命中
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

function makeWorld(dict, rules, body) {
  const document = {
    readyState: 'complete',
    title: 'Cline',
    body,
    documentElement: body,
    addEventListener() {},
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
    addEventListener() {},
    __CLINE_ZH_DICT__: dict,
    __CLINE_ZH_RULES__: rules
  };
  const sandbox = {
    window, document,
    NodeFilter: NF,
    MutationObserver: class { constructor(cb) {} observe() {} disconnect() {} },
    setInterval() { return 1; },
    setTimeout() { return 1; },
    console: { log() {} },
    location: { href: 'http://test.local/' }
  };
  vm.runInNewContext(SRC, sandbox);   // readyState=complete → 脚本末尾 boot() 已自动跑过一次 run()
  return window;
}

// 测试词库 + 测试规则（规则走 __CLINE_ZH_RULES__ 热读取通道，格式同 injector 注入）
const dict = { 'Open Settings': '打开设置' };
const rules = [['^([0-9]+) MCP servers?$', '$1 个 MCP 服务器']];

// ---------- ① 三相邻文本节点 "0" / " MCP server" / "s" 合并命中 ----------
{
  const t1 = text('0'), t2 = text(' MCP server'), t3 = text('s');
  const body = el('BODY', [el('DIV', [t1, t2, t3])]);
  const w = makeWorld(dict, rules, body);
  console.log('① 合并后节点值:', JSON.stringify([t1.nodeValue, t2.nodeValue, t3.nodeValue]));
  check('①a 合并命中→首节点为译文', t1.nodeValue === '0 个 MCP 服务器', t1.nodeValue);
  check('①b 合并命中→其余置空', t2.nodeValue === '' && t3.nodeValue === '', [t2.nodeValue, t3.nodeValue]);

  // ---------- ④ 幂等：连续再跑两次 __clineZhRun()，结果一致 ----------
  const snap1 = [t1.nodeValue, t2.nodeValue, t3.nodeValue];
  w.__clineZhRun();
  const snap2 = [t1.nodeValue, t2.nodeValue, t3.nodeValue];
  w.__clineZhRun();
  const snap3 = [t1.nodeValue, t2.nodeValue, t3.nodeValue];
  console.log('④ 三次快照:', JSON.stringify(snap1), JSON.stringify(snap2), JSON.stringify(snap3));
  check('④a 幂等（第二次与第一次一致）', JSON.stringify(snap2) === JSON.stringify(snap1), snap2);
  check('④b 幂等（第三次与前两次一致）', JSON.stringify(snap3) === JSON.stringify(snap1), snap3);
}

// ---------- ② 单节点词库命中（快路径，行为与改前一致） ----------
{
  const t = text('Open Settings');
  const body = el('BODY', [el('DIV', [t])]);
  makeWorld(dict, rules, body);
  console.log('② 单节点词库命中:', JSON.stringify(t.nodeValue));
  check('② 单节点命中词库', t.nodeValue === '打开设置', t.nodeValue);
}

// ---------- ③ 未命中文本原样保留 ----------
{
  const t = text('Hello world');
  const body = el('BODY', [el('DIV', [t])]);
  makeWorld(dict, rules, body);
  console.log('③ 未命中节点值:', JSON.stringify(t.nodeValue));
  check('③ 未命中→原样保留', t.nodeValue === 'Hello world', t.nodeValue);
}

// ---------- ⑤ 中间隔元素节点 → 不合并、不误伤 ----------
{
  const t1 = text('0'), mid = el('B', [text('x')]), t2 = text(' MCP server'), t3 = text('s');
  const body = el('BODY', [el('DIV', [t1, mid, t2, t3])]);
  makeWorld(dict, rules, body);
  console.log('⑤ 被元素隔断:', JSON.stringify([t1.nodeValue, t2.nodeValue, t3.nodeValue]));
  check('⑤ 跨元素不合并（全部原样）',
    t1.nodeValue === '0' && t2.nodeValue === ' MCP server' && t3.nodeValue === 's',
    [t1.nodeValue, t2.nodeValue, t3.nodeValue]);
}

// ---------- ⑥ 跳过区（SKIP_SELECTOR 命中）内不处理 ----------
{
  const t1 = text('0'), t2 = text(' MCP server'), t3 = text('s');
  const body = el('BODY', [el('DIV', [t1, t2, t3], { skipZone: true })]);
  makeWorld(dict, rules, body);
  check('⑥ 跳过区内不合并',
    t1.nodeValue === '0' && t2.nodeValue === ' MCP server' && t3.nodeValue === 's',
    [t1.nodeValue, t2.nodeValue, t3.nodeValue]);
}

// ---------- 附加：超长相邻组（>8 节点）→ 放弃合并 ----------
{
  const kids = [];
  for (let i = 0; i < 9; i++) kids.push(text('x' + i + ' '));
  const vals = kids.map(k => k.nodeValue);
  const body = el('BODY', [el('DIV', kids)]);
  makeWorld(dict, rules, body);
  check('附加1 超 8 节点上限→放弃合并',
    kids.every((k, i) => k.nodeValue === vals[i]),
    kids.map(k => k.nodeValue));
}

// ---------- 附加：合并路径也认词库（不只认规则） ----------
{
  const t1 = text('Open'), t2 = text(' Settings');
  const body = el('BODY', [el('DIV', [t1, t2])]);
  makeWorld(dict, rules, body);
  check('附加2 合并命中词库词条',
    t1.nodeValue === '打开设置' && t2.nodeValue === '',
    [t1.nodeValue, t2.nodeValue]);
}

console.log('----------------------------------------');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' checks)' : 'FAILED: ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
