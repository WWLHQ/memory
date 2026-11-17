/**
 * 自研网页对话导出插件的纯逻辑层（无浏览器 API）。
 * 输出格式严格对齐记忆库 parseWebchatMd：## 用户 / ## 助手 + 元信息行。
 * 诚实边界：认不出角色就不产出消息；不把整页文本硬塞进 Markdown。
 */
(function (global) {
  'use strict';

  /** 站点域名按 2026-11-16 现查结果维护；选择器是兜底，优先读语义化 data-role。 */
  var SITES = [
    {
      key: 'deepseek',
      label: 'DeepSeek',
      hosts: ['chat.deepseek.com'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="human-message"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="ai-message"], [class*="bot-message"]' }
      ],
      // 2026-11-17 实测（webchat-verify 诊断）：DeepSeek 每条消息一个稳定的 .ds-message 容器，
      // 助手容器里有 .ds-markdown / assistant-message 标记，用户容器没有——它的正文是构建期
      // hash 类名（如 d29f3d7d），靠 class 关键词永远认不出。所以改用「容器 + 内容特征」判角色。
      containerRules: [
        {
          role: 'user',
          selector: '[class*="ds-message"]',
          excludeInside: ['[class*="assistant-message"]', '.ds-markdown'],
        },
      ],
    },
    {
      key: 'doubao',
      label: '豆包',
      hosts: ['www.doubao.com'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="human-message"], [data-testid*="user_message"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="ai-message"], [data-testid*="assistant_message"]' }
      ]
    },
    {
      key: 'yiyan',
      label: '文心一言',
      hosts: ['yiyan.baidu.com'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="question"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="answer"]' }
      ]
    },
    {
      key: 'qianwen',
      label: '千问',
      hosts: ['www.qianwen.com', 'chat.qwen.ai', 'qwen.ai'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="human-message"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="ai-message"], [class*="bot-message"]' }
      ]
    },
    {
      key: 'kimi',
      label: 'Kimi',
      hosts: ['www.kimi.ai', 'kimi.ai', 'kimi.moonshot.cn'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="human-message"], [data-testid*="user_message"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="ai-message"], [data-testid*="assistant_message"]' }
      ]
    },
    {
      key: 'chatglm',
      label: '智谱清言',
      hosts: ['chatglm.cn'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="question"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="answer"]' }
      ]
    },
    {
      key: 'mimo',
      label: '小米 MiMO',
      hosts: ['aistudio.xiaomimimo.com'],
      selectors: [
        { role: 'user', selector: '[class*="user-message"], [class*="message-user"], [class*="human-message"]' },
        { role: 'assistant', selector: '[class*="assistant-message"], [class*="message-assistant"], [class*="ai-message"], [class*="bot-message"]' }
      ]
    }
  ];

  var ROLE_USER_RE = /(^|[-_:\s])(user|human|self|question|prompt|用户|我的提问|提问)([-_:\s]|$)/i;
  var ROLE_ASSISTANT_RE = /(^|[-_:\s])(assistant|ai|bot|model|gpt|answer|response|reply|助手|回答|回复|模型)([-_:\s]|$)/i;
  var UNIVERSAL_SELECTORS = [
    '[data-message-role]',
    '[data-role]',
    '[data-chat-role]',
    '[data-testid*="message"], [data-testid*="Message"]',
    '[class*="message"], [class*="Message"]',
    '[class*="chat-item"], [class*="conversation-item"], [class*="bubble"]'
  ];

  function matchSite(url) {
    if (!url || typeof url !== 'string') return null;
    var host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    for (var i = 0; i < SITES.length; i++) {
      var site = SITES[i];
      for (var j = 0; j < site.hosts.length; j++) {
        var h = site.hosts[j].toLowerCase();
        if (host === h || host.endsWith('.' + h)) return site;
      }
    }
    return null;
  }

  function detectRole(el) {
    var strong = ['data-message-role', 'data-role', 'data-chat-role'];
    var weak = ['aria-label', 'data-testid', 'class', 'id'];
    var i;
    for (i = 0; i < strong.length; i++) {
      var v = String(el.getAttribute ? (el.getAttribute(strong[i]) || '') : '');
      if (ROLE_USER_RE.test(v)) return { role: 'user', rank: 3 };
      if (ROLE_ASSISTANT_RE.test(v)) return { role: 'assistant', rank: 3 };
    }
    for (i = 0; i < weak.length; i++) {
      var raw = i === 2 ? el.className : i === 3 ? el.id : (el.getAttribute ? el.getAttribute(weak[i]) : '');
      var w = String(raw || '');
      if (ROLE_USER_RE.test(w)) return { role: 'user', rank: 1 };
      if (ROLE_ASSISTANT_RE.test(w)) return { role: 'assistant', rank: 1 };
    }
    return null;
  }

  /** 需要换行的块级标签：不顺带补换行，整段回答会被压成一坨（实测 3000+ 字一行） */
  var BLOCK_TAGS = {
    DIV: 1, P: 1, LI: 1, UL: 1, OL: 1, TR: 1, TABLE: 1, THEAD: 1, TBODY: 1,
    SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, NAV: 1, ASIDE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, PRE: 1, BLOCKQUOTE: 1, FIGURE: 1,
    DL: 1, DT: 1, DD: 1, HR: 1,
  };

  /**
   * 代码块占位符：`<U+E000><n><U+E001>`（Unicode 私用区字符）。
   * 为什么必须占位：cleanText 的空白清理会把每行行首缩进整段剥掉，而代码里的缩进
   * 本身就是内容（Python 少一层缩进语义就变了）。所以代码块先进占位池、清完空白再放回来。
   * 为什么用私用区而不是 \u0000：U+0000 是控制字符，会触发静态检查（且不该出现在文本里）；
   * 私用区字符正常页面文本不会出现，同样不会跟正文撞车。
   */
  var CODE_SLOT_RE = /\uE000(\d+)\uE001/g;

  /**
   * 嵌套列表的缩进用 NBSP 而不是普通空格。
   * 理由同上：普通空格会被 `\n[ \t]+` 剥掉 → 子列表被拉平成同级，层级信息就丢了。
   * NBSP 不在 `[ \t]` 里，能活到清理之后再还原成空格。
   */
  var LIST_INDENT = '\u00a0\u00a0';

  function tagOf(node) {
    return String((node && node.tagName) || '').toUpperCase();
  }

  /** 逐字取文本（只把 BR 与块级边界换成 \n），不折叠任何空白——专供代码块 */
  function rawText(node) {
    var out = '';
    var kids = (node && node.childNodes) || [];
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (child.nodeType === 3) {
        out += child.nodeValue || '';
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = tagOf(child);
      if (tag === 'BR') {
        out += '\n';
        continue;
      }
      var inner = rawText(child);
      out += BLOCK_TAGS[tag] ? '\n' + inner + '\n' : inner;
    }
    return out;
  }

  /** 代码块语言标识：class="language-python" / "lang-js"（DeepSeek 用 language-*） */
  function codeLang(node) {
    var cls = '';
    try {
      cls = String((node && node.className) || (node && node.getAttribute && node.getAttribute('class')) || '');
    } catch {
      cls = '';
    }
    var m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls);
    return m ? m[1] : '';
  }

  /**
   * 把 <pre> 变成 ``` 围栏代码块。
   * 旧实现只给 PRE 补换行，围栏、语言标识全没有 → 导出的 md 里代码和正文糊在一起，
   * 入库后模型看到的是「一段普通文字」，缩进与语法高亮意图全丢（2026-11-17 用户审计发现）。
   */
  function preBlock(pre) {
    var codeEl = null;
    try {
      codeEl = pre.querySelector ? pre.querySelector('code') : null;
    } catch {
      codeEl = null;
    }
    var src = codeEl || pre;
    var text = String(src.textContent || '');
    // 有的站点一行一个 span + <br>，textContent 里一个 \n 都没有 → 退回逐字遍历
    if (text.indexOf('\n') < 0) text = rawText(src);
    text = text.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
    if (!text) return '';
    var lang = codeLang(codeEl) || codeLang(pre);
    // 围栏必须比内容里最长的一串反引号更长，否则代码里自带 ``` 会提前把块截断
    var fence = '```';
    var run = /`{3,}/g;
    var hit;
    while ((hit = run.exec(text))) {
      if (hit[0].length >= fence.length) fence = '`'.repeat(hit[0].length + 1);
    }
    return fence + lang + '\n' + text + '\n' + fence;
  }

  /** 行内代码：包反引号；内容自带反引号时用双反引号包（否则 markdown 会断开） */
  function inlineCodeText(node) {
    var text = String((node && node.textContent) || '').replace(/\r\n?/g, '\n').replace(/\n+/g, ' ');
    if (!text.trim()) return '';
    var fence = text.indexOf('`') >= 0 ? '``' : '`';
    return fence + text + fence;
  }

  /** 加粗 / 斜体：只包有内容的。图标常写成空的 <i>，包起来会产出 `****` 这种噪音 */
  function emphasisText(mark, node, state) {
    var inner = nodeText(node, state).trim();
    if (!inner) return '';
    if (inner.indexOf(mark) === 0) return inner; // 嵌套的同一标记会让 markdown 断开
    return mark + inner + mark;
  }

  /** 表格单元格：里面不能有换行，竖线要转义，否则会多切出一列 */
  function cellText(cell, state) {
    return nodeText(cell, state)
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\|/g, '\\|')
      .trim();
  }

  /**
   * <table> → 管道表格。
   * 旧实现只补换行，行列关系全靠空格猜；转成管道表后行列是可解析的结构。
   * markdown 表格必须有表头分隔行，所以第一行当表头——不这么做整张表会退化成纯文本。
   */
  function tableBlock(table, state) {
    var rows = [];
    try {
      rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    } catch {
      rows = [];
    }
    if (!rows.length) return nodeText(table, state);
    var grid = [];
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      // 嵌套表格的行属于内层表，不能被外层重复算一次
      try {
        if (tr.closest && tr.closest('table') !== table) continue;
      } catch {
        /* closest 不可用就按平铺处理 */
      }
      var cells = [];
      var kids = (tr && tr.children) || [];
      for (var c = 0; c < kids.length; c++) {
        var tag = tagOf(kids[c]);
        if (tag === 'TD' || tag === 'TH') cells.push(cellText(kids[c], state));
      }
      if (cells.length) grid.push(cells);
    }
    if (!grid.length) return '';
    var width = 0;
    for (var w = 0; w < grid.length; w++) {
      if (grid[w].length > width) width = grid[w].length;
    }
    if (width === 0) return '';
    var lines = [];
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r].slice();
      while (row.length < width) row.push('');
      lines.push('| ' + row.join(' | ') + ' |');
      if (r === 0) {
        var sep = [];
        for (var s = 0; s < width; s++) sep.push('---');
        lines.push('| ' + sep.join(' | ') + ' |');
      }
    }
    return lines.join('\n');
  }

  /** 列表容器：同层列表项之间只隔一个 \n（用块级换行会变成空行，markdown 会把列表切断） */
  function listBlock(list, state) {
    var items = [];
    var kids = (list && list.children) || [];
    for (var i = 0; i < kids.length; i++) {
      if (tagOf(kids[i]) === 'LI') items.push(listItemText(kids[i], state));
    }
    if (!items.length) return nodeText(list, state);
    return items.join('\n');
  }

  /**
   * <li> → markdown 列表项。
   * 旧实现靠 BLOCK_TAGS 只给 LI 补换行 → 导出的「要点一 / 要点二」变成一坨没有符号的
   * 文字，看不出是列表。现在按父级补 `- ` 或序号，并按嵌套层级缩进。
   */
  function listItemText(li, state) {
    var depth = state.depth || 0;
    var parent = li.parentElement;
    var marker = '- ';
    if (tagOf(parent) === 'OL') {
      var idx = 0;
      var sibs = (parent && parent.children) || [];
      for (var i = 0; i < sibs.length; i++) {
        if (tagOf(sibs[i]) === 'LI') idx++;
        if (sibs[i] === li) break;
      }
      var start = 1;
      try {
        var sv = Number(parent.getAttribute && parent.getAttribute('start'));
        if (Number.isFinite(sv) && sv > 0) start = sv; // <ol start="3"> 要从 3 数起
      } catch {
        start = 1;
      }
      marker = Math.max(1, start + idx - 1) + '. ';
    }
    // 列表项内部按普通块处理；子列表里的 LI 读到的是 depth+1，从而多一层缩进
    state.depth = depth + 1;
    var inner = nodeText(li, state);
    state.depth = depth;
    var indent = '';
    for (var d = 0; d < depth; d++) indent += LIST_INDENT;
    var lines = inner.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
    var out = indent + marker + lines[0];
    // 续行不加额外缩进：子列表的每一项自己带缩进，加了会缩两次
    for (var l = 1; l < lines.length; l++) out += '\n' + lines[l];
    return out;
  }

  /**
   * 取文本并保留结构。
   * 为什么不用 innerText：cleanText 里是 cloneNode 出来的游离节点，没挂到文档上，
   * innerText 拿不到渲染信息，会退化成 textContent——段落/列表/小标题的换行全丢，
   * 导出与入库都变成一整坨。这里显式按块级标签补 \n，并把列表/代码/强调/表格
   * 还原成对应的 markdown 写法（2026-11-17 审计发现「结构全丢」，只补换行不够）。
   */
  function nodeText(node, state) {
    var st = state || { codes: [], depth: 0 };
    var out = '';
    var kids = (node && node.childNodes) || [];
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (child.nodeType === 3) {
        out += child.nodeValue || '';
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = tagOf(child);
      if (tag === 'BR') {
        out += '\n';
        continue;
      }
      if (tag === 'PRE') {
        var block = preBlock(child);
        if (!block) continue;
        st.codes.push(block);
        out += '\n\uE000' + (st.codes.length - 1) + '\uE001\n';
        continue;
      }
      if (tag === 'TABLE') {
        out += '\n' + tableBlock(child, st) + '\n';
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        out += '\n' + listBlock(child, st) + '\n';
        continue;
      }
      if (tag === 'LI') {
        out += '\n' + listItemText(child, st) + '\n';
        continue;
      }
      // 走到这里的 CODE 都是行内代码（代码块里的 CODE 在 PRE 分支就被吃掉了）
      if (tag === 'CODE' || tag === 'KBD') {
        out += inlineCodeText(child);
        continue;
      }
      if (tag === 'STRONG' || tag === 'B') {
        out += emphasisText('**', child, st);
        continue;
      }
      if (tag === 'EM' || tag === 'I') {
        out += emphasisText('*', child, st);
        continue;
      }
      var inner = nodeText(child, st);
      out += BLOCK_TAGS[tag] ? '\n' + inner + '\n' : inner;
    }
    return out;
  }

  function cleanText(el) {
    var clone;
    try {
      clone = el.cloneNode(true);
    } catch {
      return '';
    }
    if (clone.querySelectorAll) {
      var drop = clone.querySelectorAll('button, svg, script, style, nav, aside, [aria-label*="复制"], [class*="copy"], [class*="toolbar"], [class*="action"]');
      for (var i = 0; i < drop.length; i++) {
        if (drop[i].remove) drop[i].remove();
      }
    }
    var state = { codes: [], depth: 0 };
    var text = nodeText(clone, state)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // NBSP → 普通空格必须放在「剥行首空白」之后：嵌套列表的缩进就是用 NBSP 写的，
    // 提前换成空格会被上一步整段剥掉，层级就没了。
    text = text.replace(/\u00a0/g, ' ');
    // 最后才把代码块放回来：这样代码里的空行与缩进一字不动
    return text.replace(CODE_SLOT_RE, function (_m, idx) {
      return state.codes[Number(idx)] || '';
    });
  }

  function collectElements(root, siteKey) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    var site = null;
    for (var s = 0; s < SITES.length; s++) {
      if (SITES[s].key === siteKey) { site = SITES[s]; break; }
    }
    var rules = UNIVERSAL_SELECTORS.slice();
    if (site) {
      for (var r = 0; r < site.selectors.length; r++) rules.push(site.selectors[r].selector);
    }
    var byElement = new Map();
    for (var i = 0; i < rules.length; i++) {
      var found;
      try {
        found = root.querySelectorAll(rules[i]);
      } catch {
        continue;
      }
      for (var k = 0; k < found.length; k++) {
        var el = found[k];
        if (byElement.has(el)) continue;
        if (el.nodeType !== 1) continue;
        if (el.matches && el.matches('textarea, input, script, style, button')) continue;
        if (el.closest && el.closest('textarea, [contenteditable="true"]')) continue;
        var detected = detectRole(el);
        var explicit = null;
        if (site) {
          for (var q = 0; q < site.selectors.length; q++) {
            var rule = site.selectors[q];
            var matched = false;
            try { matched = el.matches(rule.selector); } catch { matched = false; }
            if (matched) { explicit = rule.role; break; }
          }
        }
        var role = detected ? detected.role : explicit;
        if (!role) continue;
        var rank = detected ? detected.rank : explicit ? 2 : 1;
        var text = cleanText(el);
        if (!text || text.length > 20000) continue;
        byElement.set(el, { el: el, role: role, text: text, rank: rank });
      }
    }

    // 站点专用「消息容器」规则：容器稳定、但正文类名是构建期 hash 的站点（如 DeepSeek），
    // 改用「容器 + 内容特征」判角色——容器里不含 markdown/assistant 标记的那条就是用户提问。
    // 只对显式配了 containerRules 的站点生效，避免把别站的提示语误当消息。
    if (site && site.containerRules) {
      for (var cr = 0; cr < site.containerRules.length; cr++) {
        var ruleC = site.containerRules[cr];
        var foundC;
        try {
          foundC = root.querySelectorAll(ruleC.selector);
        } catch {
          continue;
        }
        for (var ci = 0; ci < foundC.length; ci++) {
          var cel = foundC[ci];
          if (cel.nodeType !== 1 || byElement.has(cel) || inChrome(cel)) continue;
          var isOther = false;
          var excludes = ruleC.excludeInside || [];
          for (var ei = 0; ei < excludes.length; ei++) {
            try {
              if (cel.querySelector(excludes[ei])) { isOther = true; break; }
            } catch {
              // 某个排除选择器不被支持就跳过它，不影响其它条件
            }
          }
          if (isOther) continue;
          var ctext = cleanText(cel);
          if (!ctext || ctext.length > 20000) continue;
          byElement.set(cel, { el: cel, role: ruleC.role, text: ctext, rank: 2 });
        }
      }
    }

    var all = Array.from(byElement.values());
    all.sort(function (a, b) {
      var pos = a.el.compareDocumentPosition ? a.el.compareDocumentPosition(b.el) : 0;
      if (pos & 4) return -1;
      if (pos & 2) return 1;
      return 0;
    });

    var kept = all.filter(function (candidate) {
      for (var i = 0; i < all.length; i++) {
        var other = all[i];
        if (other === candidate) continue;
        if (!other.el.contains || !other.el.contains(candidate.el)) continue;
        if (other.rank >= candidate.rank) return false;
      }
      return true;
    });

    return kept;
  }

  function extractMessages(root, siteKey) {
    var kept = collectElements(root, siteKey);
    var out = [];
    for (var n = 0; n < kept.length; n++) {
      var m = kept[n];
      var prev = out[out.length - 1];
      if (prev && prev.role === m.role && prev.text === m.text) continue;
      out.push({ role: m.role, text: m.text });
    }
    return out;
  }

  /** 只有「读到消息、但一条用户提问都没认出来」才值得诊断——这正是选择器失效的症状 */
  function needsDiagnostics(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i] && messages[i].role === 'user') return false;
    }
    return true;
  }

  function clip(text, max) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function describe(el, maxHead) {
    if (!el || el.nodeType !== 1) return null;
    var attr = function (name) {
      return el.getAttribute ? String(el.getAttribute(name) || '') : '';
    };
    return {
      tag: String(el.tagName || '').toLowerCase(),
      cls: clip(el.className, 120),
      dtid: clip(attr('data-testid'), 60),
      role: clip(attr('data-message-role') || attr('data-role'), 30),
      len: String(el.textContent || '').trim().length,
      head: clip(el.textContent, maxHead || 24)
    };
  }

  /**
   * 侧栏 / 导航 / 页头里的文字全是会话标题与按钮，会把诊断配额吃光（2026-11-17 实测：
   * 10 条孤儿候选全是左侧历史会话）。这些区域一律不当线索。
   */
  function inChrome(el) {
    return !!(el && el.closest && el.closest('aside, nav, header, footer, [role="navigation"]'));
  }

  // ─── 侧栏历史会话识别（0.4.0） ───────────────────────────────────────────
  //
  // 2026-11-17 真实事故（QQ 浏览器）：插件每 5 分钟都在正常跑（扩展 storage 日志实测
  // 15:29/15:34/15:39/15:44/15:49/15:56 各有一轮），但历史遍历恒定报
  // 「没在侧栏找到历史会话列表」，于是历史会话永远导不出来。
  // 根因不是浏览器、不是权限、不是 SW 没醒，而是**判据认不出 DeepSeek 的侧栏**：
  //   · 会话条目是 <div class="c08e6e93">（构建期 hash 类名、叶子节点）
  //   · 侧栏容器是 <div class="_77cdc67 _8a693f3">（同样是 hash，不含 sidebar/history 关键词）
  // 旧判据要求「a[href]/li/[role=button]」且「祖先是 aside/nav 或类名含
  // sidebar/session-list/history」——两重全落空 → 一条都找不到。
  //
  // 0.4.0 改成三路（按可靠性排序，前一路有结果就不再往后加）：
  //   ① 同类成组路：class 相同的一批短文本元素成组出现（≥3 条；同一父节点下有 ≥2 个更可信）
  //      ——hash 类名站点的历史列表必然长这样（同一组件同一个 hash 类名）
  //   ② 语义路：a[href] / li / [role=button] / [role=link]（部分站点用语义标签）
  //   ③ 几何路：位于视口左侧窄列的短文本行（容器完全不可知时的兜底）
  // 三路都明确排除对话正文区与「新建对话」类按钮。

  /** 「新建/新对话」按钮不是历史会话：点了会清空当前页面 */
  var NEW_CHAT_RE = /^(新(建|开|聊)?(对话|聊天|会话|主题)|开(始|启)?新(对话|聊天|会话)|new\s*chat|start\s*new)/i;

  /** 对话正文区容器：里面的东西一律不是历史会话 */
  var MESSAGE_AREA_SEL = [
    '.ds-message', '.ds-markdown', '[class*="ds-message"]',
    '[class*="message"]', '[class*="Message"]',
    '[class*="markdown"]', '[class*="Markdown"]',
    '[data-message-role]', '[data-chat-role]'
  ].join(', ');

  /** 语义侧栏容器（第二路用） */
  var SIDEBAR_SEL = [
    'aside', 'nav', 'header', 'footer', '[role="navigation"]',
    '[class*="sidebar"]', '[class*="side-bar"]', '[class*="sider"]',
    '[class*="session-list"]', '[class*="conversation-list"]',
    '[class*="chat-list"]', '[class*="history"]'
  ].join(', ');

  /** 是否落在对话正文区里（正文区的东西不是历史会话） */
  function isMessageArea(el) {
    try {
      return !!(el && el.closest && el.closest(MESSAGE_AREA_SEL));
    } catch {
      return false;
    }
  }

  /** 是否落在语义侧栏容器里 */
  function inSidebar(el) {
    try {
      return !!(el && el.closest && el.closest(SIDEBAR_SEL));
    } catch {
      return false;
    }
  }

  function classKeyOf(el) {
    var c = '';
    try {
      c = (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '') || '';
    } catch {
      c = '';
    }
    return String(c).replace(/\s+/g, ' ').trim();
  }

  function shortText(el) {
    var t = '';
    try {
      t = String(el.textContent || '');
    } catch {
      t = '';
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  /** 文档顺序比较（a 在 b 之前 → -1） */
  function docOrder(a, b) {
    var pos = a && a.compareDocumentPosition ? a.compareDocumentPosition(b) : 0;
    if (pos & 4) return -1;
    if (pos & 2) return 1;
    return 0;
  }

  /** 元素是否可见（display:none / visibility:hidden 不算）；取不到样式信息时一律当作可见 */
  function isVisible(el) {
    try {
      var view = el.ownerDocument && el.ownerDocument.defaultView;
      if (!view || !view.getComputedStyle) return true;
      var st = view.getComputedStyle(el);
      if (!st) return true;
      if (st.display === 'none') return false;
      if (st.visibility === 'hidden') return false;
    } catch {
      /* 取不到样式就当它可见，别漏掉真实条目 */
    }
    return true;
  }

  /**
   * 找侧栏里的历史会话条目（0.4.0）。
   * 返回 [{el, label}]，label 是会话标题（截断 40 字，供跨虚拟滚动去重）。
   * 过滤：文本 1..60 字、不在对话正文区、不是「新建对话」类按钮、不在表单里、可见。
   */
  function listSidebarItems(root, opts) {
    var o = opts || {};
    // 0.5.0：默认上限从 30 提到 200。原来 30 条一屏就满，而 74 个会话里
    // 只有 29 个能被导出（漏 70%）——「默认值太小」本身就是遗漏的根因之一，
    // 不能只靠调用方显式传 max。
    var maxItems = typeof o.max === 'number' && o.max > 0 ? o.max : 200;
    var out = [];
    var seen = new Set();

    function acceptable(el) {
      if (!el || seen.has(el)) return false;
      if (isMessageArea(el)) return false;
      try {
        if (el.closest && el.closest('textarea, input, form, [contenteditable="true"]')) return false;
      } catch {
        /* 查不到就当不在表单里 */
      }
      var t = shortText(el);
      if (!t || t.length > 60) return false;
      if (NEW_CHAT_RE.test(t)) return false;
      if (!isVisible(el)) return false;
      return true;
    }

    function take(el) {
      if (!acceptable(el)) return false;
      seen.add(el);
      out.push({ el: el, label: shortText(el).slice(0, 40) });
      return true;
    }

    var pool = [];
    try {
      pool = Array.prototype.slice.call(root.querySelectorAll('div, span, p, a, li'));
    } catch {
      pool = [];
    }

    // ① 同类成组路：class 相同的一批短文本元素成组出现
    var byClass = new Map();
    for (var i = 0; i < pool.length; i++) {
      var el = pool[i];
      if (!acceptable(el)) continue;
      var ck = classKeyOf(el);
      if (!ck) continue; // 无 class 的元素没有同类信号
      var arr = byClass.get(ck);
      if (!arr) { arr = []; byClass.set(ck, arr); }
      arr.push(el);
    }
    var groups = [];
    byClass.forEach(function (arr, ck) {
      if (arr.length < 3) return;
      // 同一父节点下的兄弟越多越可信；总数够多时同样可信
      var parentCount = new Map();
      for (var k = 0; k < arr.length; k++) {
        var p = arr[k].parentElement;
        var pk = p ? (p.tagName + '#' + classKeyOf(p)) : 'none';
        parentCount.set(pk, (parentCount.get(pk) || 0) + 1);
      }
      var maxSameParent = 0;
      parentCount.forEach(function (n) { if (n > maxSameParent) maxSameParent = n; });
      if (maxSameParent < 2 && arr.length < 5) return;
      groups.push({ cls: ck, arr: arr });
    });
    groups.sort(function (a, b) { return b.arr.length - a.arr.length; });
    for (var g = 0; g < groups.length; g++) {
      var bucket = groups[g].arr.slice().sort(docOrder);
      for (var b = 0; b < bucket.length; b++) {
        take(bucket[b]);
        if (out.length >= maxItems) return out;
      }
    }
    if (out.length) return out;

    // ② 语义路
    var semantic = [];
    try {
      semantic = Array.prototype.slice.call(root.querySelectorAll('a[href], li, [role="button"], [role="link"]'));
    } catch {
      semantic = [];
    }
    for (var s = 0; s < semantic.length; s++) {
      if (!inSidebar(semantic[s])) continue;
      take(semantic[s]);
      if (out.length >= maxItems) return out;
    }
    if (out.length) return out;

    // ③ 几何路：视口左侧窄列里的短文本行（容器类名完全不可知时的兜底）
    var vw = 1024;
    try {
      var view = root.defaultView;
      vw = (view && view.innerWidth) || 1024;
    } catch {
      vw = 1024;
    }
    var leftLimit = Math.min(320, Math.round(vw * 0.3));
    for (var gm = 0; gm < pool.length && out.length < maxItems; gm++) {
      var el3 = pool[gm];
      if (!acceptable(el3)) continue;
      var rect = null;
      try {
        rect = el3.getBoundingClientRect ? el3.getBoundingClientRect() : null;
      } catch {
        rect = null;
      }
      if (!rect || !rect.width || !rect.height) continue; // 无布局信息时这路不生效
      if (rect.left > leftLimit) continue;
      take(el3);
    }
    return out;
  }

  /**
   * 找元素往上第一个「真正能滚」的祖先（scrollHeight > clientHeight）。
   * 为什么要它：DeepSeek 的侧栏是虚拟列表，DOM 里只有当前可见的一屏；
   * 不滚动就永远只能导到眼前这十几条。
   * 注意：只看 scrollHeight/clientHeight 不可靠（内容没溢出时也是相等），
   * 所以额外要求有 overflow 样式是 auto/scroll —— 没有布局信息时按「可滚」处理。
   */
  function findScrollAncestor(el) {
    var cur = el && el.parentElement;
    for (var i = 0; i < 10 && cur; i++) {
      var canScroll = false;
      try {
        var view = cur.ownerDocument && cur.ownerDocument.defaultView;
        if (view && view.getComputedStyle) {
          var st = view.getComputedStyle(cur);
          var oy = st ? String(st.overflowY || '') : '';
          if (/auto|scroll|overlay/.test(oy)) canScroll = true;
        }
      } catch {
        /* 取不到样式就靠尺寸判断 */
      }
      var overflows = (cur.scrollHeight || 0) > (cur.clientHeight || 0) + 4;
      if (canScroll || overflows) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * 侧栏结构体检：历史遍历找不到条目时，把「页面上到底有什么」带出来，
   * 让人一眼看出是容器类名不可知、还是根本没有列表。
   */
  function describeSidebar(root) {
    var out = {
      semantic: 0,
      groupRows: 0,
      groups: [],
      anchors: [],
      messageAreaRows: 0
    };
    if (!root || typeof root.querySelectorAll !== 'function') return out;
    var semantic = [];
    try {
      semantic = Array.prototype.slice.call(root.querySelectorAll('a[href], li, [role="button"], [role="link"]'));
    } catch {
      semantic = [];
    }
    for (var i = 0; i < semantic.length; i++) {
      if (inSidebar(semantic[i])) out.semantic++;
    }
    var pool = [];
    try {
      pool = Array.prototype.slice.call(root.querySelectorAll('div, span, p, a, li'));
    } catch {
      pool = [];
    }
    var byClass = new Map();
    for (var j = 0; j < pool.length; j++) {
      var el = pool[j];
      var t = shortText(el);
      if (!t || t.length > 60) continue;
      if (isMessageArea(el)) { out.messageAreaRows++; continue; }
      var ck = classKeyOf(el);
      if (!ck) continue;
      var arr = byClass.get(ck);
      if (!arr) { arr = []; byClass.set(ck, arr); }
      arr.push(el);
    }
    byClass.forEach(function (arr, ck) {
      if (arr.length < 2) return;
      out.groupRows += arr.length;
      if (out.groups.length < 5) {
        out.groups.push({ cls: ck.slice(0, 40), count: arr.length, sample: shortText(arr[0]).slice(0, 24) });
      }
    });
    var anchors = [];
    try {
      anchors = Array.prototype.slice.call(root.querySelectorAll('a[href]'));
    } catch {
      anchors = [];
    }
    for (var a = 0; a < anchors.length && out.anchors.length < 5; a++) {
      var at = shortText(anchors[a]);
      if (!at || at.length > 60) continue;
      out.anchors.push({ href: String(anchors[a].getAttribute('href') || '').slice(0, 80), text: at.slice(0, 24) });
    }
    return out;
  }

  /** 从元素向上取祖先链：定位「消息列表容器」长什么样，比逐个猜 sibling 更直接 */
  function ancestorChain(el, depth) {
    var chain = [];
    var cur = el && el.parentElement;
    for (var i = 0; i < depth && cur; i++) {
      var d = describe(cur, 14);
      if (!d) break;
      d.childCount = cur.children ? cur.children.length : 0;
      chain.push(d);
      cur = cur.parentElement;
    }
    return chain;
  }

  /**
   * 采「为什么没认出用户提问」的现场线索：已识别元素长什么样、助手元素的父级兄弟结构、
   * 以及页面上有文字却被跳过的元素。只落在本机（应用写进 <数据根>/webchat-verify/），
   * 不进记忆库、不上传。文本一律截断，避免把整段对话搬进诊断文件。
   */
  function collectCandidates(root, siteKey, messages) {
    var out = {
      site: String(siteKey || ''),
      at: new Date().toISOString(),
      counted: { total: 0, user: 0, assistant: 0 },
      recognized: [],
      siblingShape: null,
      ancestors: [],
      messageLike: [],
      orphans: []
    };
    if (!root || typeof root.querySelectorAll !== 'function') return out;
    var list = Array.isArray(messages) ? messages : [];
    out.counted.total = list.length;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].role === 'user') out.counted.user++;
      else if (list[i] && list[i].role === 'assistant') out.counted.assistant++;
    }

    var kept = collectElements(root, siteKey);
    for (var r = 0; r < kept.length && out.recognized.length < 4; r++) {
      out.recognized.push(describe(kept[r].el));
    }

    // 用户气泡通常和助手气泡是兄弟节点：把助手元素的父级 children 结构记下来，
    // 一眼就能看出「用户那条用的什么 class」。
    var anchor = null;
    for (var a = 0; a < kept.length; a++) {
      if (kept[a].role === 'assistant') { anchor = kept[a].el; break; }
    }
    if (anchor && anchor.parentElement) {
      var parent = anchor.parentElement;
      var kids = parent.children || [];
      var shape = [];
      for (var c = 0; c < kids.length && shape.length < 10; c++) {
        var one = describe(kids[c], 18);
        if (one) shape.push(one);
      }
      out.siblingShape = { parent: describe(parent, 16), children: shape };
    }

    // 祖先链：从助手元素往上 6 层。消息列表容器（装着一轮轮消息的那个）必定在这条链上。
    if (anchor) out.ancestors = ancestorChain(anchor, 6);

    // 所有「像消息容器」的元素（class 或内部结构），排除侧栏。用户气泡若也用同一前缀，
    // 这里会直接把它暴露出来——这是本轮最需要的一条线索。
    var msgPool;
    try {
      msgPool = root.querySelectorAll('[class*="message"], [class*="Message"]');
    } catch {
      msgPool = [];
    }
    for (var mi = 0; mi < msgPool.length && out.messageLike.length < 20; mi++) {
      var mel = msgPool[mi];
      if (mel.nodeType !== 1 || inChrome(mel)) continue;
      var md = describe(mel, 20);
      if (!md) continue;
      md.childCount = mel.children ? mel.children.length : 0;
      md.hasMarkdown = !!(mel.querySelector && mel.querySelector('.ds-markdown, [class*="markdown"]'));
      md.hasAssistantMark = /assistant/i.test(String(mel.className || ''));
      out.messageLike.push(md);
    }

    var pool;
    try {
      pool = root.querySelectorAll('div, section, article, li');
    } catch {
      pool = [];
    }
    var scan = Math.min(pool.length, 600);
    for (var p = 0; p < scan && out.orphans.length < 15; p++) {
      var el = pool[p];
      if (inChrome(el)) continue;
      if ((el.textContent || '').trim().length < 20) continue;
      var skip = false;
      for (var k = 0; k < kept.length; k++) {
        var kEl = kept[k].el;
        // 自己被识别过、或在已识别元素内部（正文碎片）、或本身就是包住全部消息的容器 → 都不是线索
        if (kEl === el || (kEl.contains && kEl.contains(el)) || (el.contains && el.contains(kEl))) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      var d = describe(el, 24);
      d.childCount = el.children ? el.children.length : 0;
      out.orphans.push(d);
    }
    return out;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * 导出时间统一成本机时间 + 时区偏移（`2026-11-17T21:40:17.243+08:00`）。
   *
   * 为什么不能直接用 `toISOString()`（2026-11-17 用户指出）：它给的是 UTC，
   * 东八区用户在文件里看到 `13:40:17Z`、而文件名是 `20261117-214017`，
   * 同一份导出里两个时间差 8 小时，看着像「导错了一天」。
   * 保留 ISO 8601 是因为机器还要解析（`new Date()` 认偏移），同时人也能直接读本地时间。
   */
  function formatLocalIso(value) {
    var d = value === undefined || value === null || value === '' ? new Date() : new Date(value);
    if (Number.isNaN(d.getTime())) d = new Date();
    var off = -d.getTimezoneOffset(); // 分钟；东八区 = 480
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
      + '.' + String(d.getMilliseconds()).padStart(3, '0')
      + sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
  }

  function formatMarkdown(payload) {
    var messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
    var lines = [
      '# 网页对话导出',
      '',
      '- 站点：' + String((payload && payload.siteLabel) || payload.site || '网页 Agent'),
      '- 来源：' + String((payload && payload.url) || ''),
      '- 导出时间：' + formatLocalIso(payload && payload.exportedAt)
    ];
    if (payload && payload.title) lines.push('- 标题：' + String(payload.title).replace(/\s+/g, ' ').trim());
    lines.push('', '---', '');
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      lines.push('## ' + (m.role === 'user' ? '用户' : '助手'), '', String(m.text || '').trim(), '');
    }
    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  }

  function signature(messages) {
    if (!Array.isArray(messages)) return '';
    return messages.map(function (m) { return m.role + ':' + String(m.text || ''); }).join('\n\u001e');
  }

  /**
   * 内容指纹 → 短键（0.5.5，2026-11-17 豆包实测事故）。
   *
   * 事故形态：豆包 57 份导出里有 **42 份是同一个会话**（标题一模一样），
   * 同时其它会话一条都进不来。根因是 SPA 先改 URL 再渲染内容 →
   * 遍历点下第 N 条时抽到的还是第 N-1 条的内容，而记账键用的是 pathname（已经变成第 N 条了）
   * → 后台认为「这个路径没导过」→ 把旧内容又写一份。
   *
   * 所以除了「按路径记账」，还要有一层「按内容记账」：同一段对话，无论落在哪个路径上，
   * 只要内容一模一样，就只能落盘一次。sig 有几十 KB，不能当键名，这里取 djb2 短哈希。
   */
  function contentKey(site, sig) {
    var text = String(sig || '');
    if (!text) return '';
    var h1 = 5381;
    var h2 = 52711;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) >>> 0;       // djb2
      h2 = ((h2 << 5) + h2 ^ c) >>> 0;       // 变异一轮，降低碰撞
    }
    var hex = function (n) { return ('00000000' + n.toString(16)).slice(-8); };
    return 'webchatExporter:contentKey:v1:' + String(site || '') + ':' + hex(h1) + hex(h2) + ':' + text.length;
  }

  function safeSegment(value, max) {
    var text = String(value || '');
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var code = text.charCodeAt(i);
      out += (code < 32 || '<>:"/\\|?*'.indexOf(ch) >= 0) ? '_' : ch;
    }
    return out.replace(/\s+/g, '_').slice(0, max || 60);
  }

  function fileNameFor(payload) {
    var site = safeSegment((payload && payload.site) || 'webchat', 40);
    var raw = payload && payload.exportedAt ? new Date(payload.exportedAt) : new Date();
    var d = Number.isNaN(raw.getTime()) ? new Date() : raw;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var stamp = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate())
      + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    return 'chat-exports/' + site + '/' + stamp + '.md';
  }

  var TASK_KEY = 'webchatExporter:tasks:v1';
  var TASK_LIMIT = 6;
  var TASK_STALE_MS = 10 * 60 * 1000;

  function normalizeTasks(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(function (t) { return t && typeof t === 'object' && typeof t.id === 'string'; })
      .slice(0, TASK_LIMIT)
      .map(function (t) {
        return {
          id: t.id,
          kind: String(t.kind || 'current'),
          status: String(t.status || 'running'),
          startedAt: String(t.startedAt || ''),
          finishedAt: t.finishedAt ? String(t.finishedAt) : '',
          message: String(t.message || '')
        };
      });
  }

  function startTask(kind, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var workingText = kind === 'all' ? '正在导出所有已打开的对话…'
      : kind === 'history' ? '正在遍历侧栏历史会话（逐个打开导出）…'
        : kind === 'auto' ? '正在执行自动导出…'
          : '正在导出当前对话…';
    return {
      id: String(now) + '-' + Math.random().toString(36).slice(2, 8),
      kind: String(kind || 'current'),
      status: 'running',
      startedAt: new Date(now).toISOString(),
      finishedAt: '',
      message: workingText
    };
  }

  function upsertTask(tasks, task) {
    return [task].concat(normalizeTasks(tasks).filter(function (t) { return t.id !== task.id; })).slice(0, TASK_LIMIT);
  }

  function finishTask(tasks, id, patch, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    return normalizeTasks(tasks).map(function (t) {
      if (t.id !== id) return t;
      return {
        id: t.id,
        kind: t.kind,
        status: String((patch && patch.status) || 'done'),
        startedAt: t.startedAt,
        finishedAt: new Date(now).toISOString(),
        message: String((patch && patch.message) || '导出已完成。')
      };
    });
  }

  function runningTasks(tasks) {
    return normalizeTasks(tasks).filter(function (t) { return t.status === 'running'; });
  }

  function unfinishedNotice(tasks, nowMs) {
    var running = runningTasks(tasks);
    if (running.length === 0) return null;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var started = Date.parse(running[0].startedAt);
    if (!Number.isNaN(started) && now - started > TASK_STALE_MS) {
      return '上次导出任务状态未确认，可能浏览器被强制关闭。请重新导出一次确认，不要重复采集已入库内容。';
    }
    return running.length === 1
      ? '有 1 个未完成的导出任务：后台会继续写入，关闭窗口不会中断。'
      : '有 ' + running.length + ' 个未完成的导出任务：后台会继续写入，关闭窗口不会中断。';
  }

  global.WebchatExporterCore = Object.freeze({
    SITES: SITES,
    matchSite: matchSite,
    extractMessages: extractMessages,
    collectCandidates: collectCandidates,
    needsDiagnostics: needsDiagnostics,
    formatMarkdown: formatMarkdown,
    formatLocalIso: formatLocalIso,
    signature: signature,
    contentKey: contentKey,
    safeSegment: safeSegment,
    fileNameFor: fileNameFor,
    listSidebarItems: listSidebarItems,
    describeSidebar: describeSidebar,
    findScrollAncestor: findScrollAncestor,
    TASK_KEY: TASK_KEY,
    TASK_STALE_MS: TASK_STALE_MS,
    normalizeTasks: normalizeTasks,
    startTask: startTask,
    upsertTask: upsertTask,
    finishTask: finishTask,
    runningTasks: runningTasks,
    unfinishedNotice: unfinishedNotice
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
