/*
 * Cline 中文汉化 —— 运行时注入引擎
 * 注入到 Cline 桌面版 WebView2 的页面中，把界面英文替换成中文。
 *
 * 设计原则：
 *  1. 只翻译「界面固定文案」，绝不翻译用户代码、模型回答、Markdown 正文。
 *  2. 跳过代码/编辑器/输入框/预格式文本等区域（见 SKIP_TAGS / SKIP_SELECTOR）。
 *  3. 通过 MutationObserver 持续生效，适应 React 重渲染。
 *
 * 依赖两个由 injector.js 预先注入的全局变量：
 *   window.__CLINE_ZH_DICT__   { "英文": "中文" }
 *   window.__CLINE_ZH_RULES__  [["正则", "替换"], ...]
 *
 * v1.1.1 变更（2026-09-19）：
 *  - 词库/规则改为从 window 实时读取，修复「注入器重新注入后新词条不生效」
 *
 * v1.1.0 变更（2026-09-19）：
 *  - 新增「内容容器」跳区：正文/模型输出/工具输入输出按 Cline 前端真实 class 名精确跳过
 *  - 属性翻译不再被 INPUT/TEXTAREA 标签挡住（输入框的 placeholder 现在能翻，输入值仍绝不触碰）
 *  - 兜底轮询 2.5s → 5s（MutationObserver 仍是实时路径），降低大页面开销
 *  - contenteditable 判断放宽为 [contenteditable]:not([contenteditable="false"])
 */
(function () {
  if (window.__clineZhInstalled) return;
  window.__clineZhInstalled = true;
  window.__clineZhVersion = "1.1.1";

  // 词库与规则都从 window 上「实时」读取：
  // 注入器重注入时只会就地合并/替换这两个全局量，引擎必须能感知到更新。
  // （v1.1.1：修复「重注入后新词条不生效」——此前引擎把字典对象缓存在闭包里。）
  function liveDict() { return window.__CLINE_ZH_DICT__ || {}; }
  var RULES = [], RULES_KEY = '';
  function ensureRules() {
    var raw = window.__CLINE_ZH_RULES_RAW__ || window.__CLINE_ZH_RULES__ || [];
    var key = raw.length + '|' + JSON.stringify(raw);
    if (key !== RULES_KEY) {
      RULES_KEY = key;
      RULES = [];
      for (var i = 0; i < raw.length; i++) {
        try { RULES.push([new RegExp(raw[i][0]), raw[i][1]]); } catch (e) { /* 跳过坏规则 */ }
      }
    }
    return RULES;
  }

  // 标签级：这些标签的文本节点一律不翻（INPUT/SELECT/OPTION 的内容不翻；其 placeholder 走属性通道）
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, KBD: 1, SAMP: 1,
    NOSCRIPT: 1, CANVAS: 1, SVG: 1, MATH: 1, IFRAME: 1, INPUT: 1, SELECT: 1, OPTION: 1
  };

  // 容器级：绝不翻译的子树。
  // cline-* 系列是 Cline 前端真实使用的语义化 class（取自前端 bundle），
  // 覆盖 Markdown 正文、消息内容、思考/推理内容、工具调用输入输出、工作区内容与流式输出。
  var SKIP_SELECTOR = [
    '.monaco-editor', '.cm-editor', '.xterm', '.view-lines',
    '[contenteditable]:not([contenteditable="false"])',
    '[data-cline-zh-skip]',
    '[class*="cline-markdown"]',
    '[class*="cline-chat-message-content"]',
    '[class*="cline-chat-reasoning-content"]',
    '[class*="cline-chat-thinking-content"]',
    '[class*="cline-chat-tool-content"]',
    '[class*="cline-chat-tool-details"]',
    '[class*="cline-chat-tool-code"]',
    '[class*="cline-chat-tool-diff"]',
    '[class*="cline-chat-work-content"]',
    '[class*="cline-chat-streaming-title"]'
  ].join(',');

  // 属性通道的标签级跳过（比文本通道宽松：允许 INPUT/TEXTAREA/SELECT 的 placeholder 被翻译）
  var ATTR_SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CANVAS: 1, SVG: 1, MATH: 1, IFRAME: 1
  };

  function inSkippedContainer(el) {
    try {
      return !!(el.closest && el.closest(SKIP_SELECTOR));
    } catch (e) { return false; }
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return true;
    if (SKIP_TAGS[el.tagName]) return true;
    return inSkippedContainer(el);
  }

  function isSkippedForAttr(el) {
    if (!el || el.nodeType !== 1) return true;
    if (ATTR_SKIP_TAGS[el.tagName]) return true;
    return inSkippedContainer(el);
  }

  function lookup(core) {
    var D = liveDict();
    if (Object.prototype.hasOwnProperty.call(D, core)) return D[core];
    var rules = ensureRules();
    for (var i = 0; i < rules.length; i++) {
      var re = rules[i][0];
      if (re.test(core)) {
        var out = core.replace(re, rules[i][1]);
        if (out && out !== core) return out;
      }
    }
    return null;
  }

  // 保留首尾空白，只翻译核心文本
  function translateWhole(s) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m) return null;
    var core = m[2];
    if (!core || core.length > 400) return null;
    var zh = lookup(core);
    if (zh == null) return null;
    return m[1] + zh + m[3];
  }

  function doTextNode(node) {
    var cur = node.nodeValue;
    if (!cur || !cur.trim()) return;
    if (node.__clineZh === cur) return;      // 已是我们的产物
    var out = translateWhole(cur);
    if (out != null && out !== cur) {
      node.nodeValue = out;
      node.__clineZh = out;
    }
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label', 'data-placeholder'];

  function doAttrs(root) {
    if (!root.querySelectorAll) return;
    var sel = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
    var els;
    try { els = root.querySelectorAll(sel); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (isSkippedForAttr(el)) continue;
      for (var j = 0; j < ATTRS.length; j++) {
        var a = ATTRS[j];
        if (!el.hasAttribute(a)) continue;
        var v = el.getAttribute(a);
        if (!v || !v.trim() || el.__clineZhAttr === v) continue;
        var zh = translateWhole(v);
        if (zh != null && zh !== v) {
          el.setAttribute(a, zh);
          el.__clineZhAttr = zh;
        }
      }
    }
  }

  function doTexts(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (isSkipped(n.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var batch = [], n;
    while ((n = walker.nextNode())) batch.push(n);
    for (var i = 0; i < batch.length; i++) doTextNode(batch[i]);
  }

  function translateDocumentTitle() {
    var t = document.title;
    if (!t || document.__clineZhTitle === t) return;
    var zh = translateWhole(t);
    if (zh != null && zh !== t) {
      document.title = zh;
      document.__clineZhTitle = zh;
    }
  }

  var stats = { runs: 0 };

  function run() {
    try {
      stats.runs++;
      ensureRules();
      if (document.body) {
        doTexts(document.body);
        doAttrs(document.body);
      }
      translateDocumentTitle();
      window.__clineZhStats = stats;
    } catch (e) {
      // 静默失败，绝不干扰客户端
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; run(); }, 100);
  }

  function boot() {
    run();
    try {
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ATTRS
      });
    } catch (e) { /* ignore */ }
    // 兜底：React 整树重渲染时 MutationObserver 可能漏掉，低频补一遍
    try { setInterval(run, 5000); } catch (e) { /* ignore */ }
    try { window.addEventListener('focus', schedule, true); } catch (e) { /* ignore */ }
    try { document.addEventListener('visibilitychange', schedule, true); } catch (e) { /* ignore */ }
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } catch (e) {
    // 即使初始化异常也不能影响宿主页面
  }

  // 供 injector 主动触发
  window.__clineZhRun = run;
  window.__clineZhInfo = function () {
    var D = liveDict();
    return {
      version: window.__clineZhVersion,
      dictSize: Object.keys(D).length,
      ruleCount: ensureRules().length,
      runs: stats.runs,
      sample: (function () {
        var k = Object.keys(D).slice(0, 5), o = {};
        for (var i = 0; i < k.length; i++) o[k[i]] = D[k[i]];
        return o;
      })()
    };
  };
})();
