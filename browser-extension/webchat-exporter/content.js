/**
 * 内容脚本：只在 manifest 声明的站点运行。
 * 读取当前页面已渲染的对话，不调用站点私有接口、不上传内容。
 *
 * 0.3.0 新增「历史对话遍历」（EXPORT_HISTORY）：在侧栏里找历史会话入口，逐个点击打开、
 * 等消息渲染、提取后立即交给后台交付——边遍历边交付，中途导航/被打断也不丢已导出的。
 * 每个会话失败跳过并带原因，绝不因为一条会话读不到就整轮停掉。
 *
 * 0.4.0 三处修正（2026-11-17 QQ 浏览器实测事故，根因见 shared/core.js 的说明）：
 *   ① 侧栏识别下沉到 core.listSidebarItems：旧判据（a/li/role + aside/nav 或
 *      sidebar/history 类名）在 DeepSeek 上恒定 0 命中 —— 它的会话条目是 hash 类名
 *      的叶子 div（class="c08e6e93"），侧栏容器也是 hash（class="_77cdc67 _8a693f3"）。
 *   ② 增量签名不再由内容脚本提前写 localStorage：改成「后台交付成功后才记账」。
 *      旧写法在投递失败时已经把签名记成「已见」，导致那段内容永远导不出来。
 *   ③ 历史遍历会滚动侧栏加载更多条目：DeepSeek 侧栏是虚拟列表，DOM 里只有当前可见的
 *      十几条，不滚动就只能导到眼前这一屏。
 */
(function () {
  'use strict';

  var core = globalThis.WebchatExporterCore;
  if (!core) return;

  /** 增量签名的记账键：站点 + 会话路径（同一站点不同会话互不干扰） */
  function signatureKey(siteKey) {
    return 'webchatExporter:sig:v2:' + siteKey + ':' + location.pathname;
  }

  /**
   * 0.3.0 时代的旧记账键：指纹写在**页面 localStorage** 里。
   * 0.4.0 改成写在扩展 storage，键名也从 v1 换成 v2 —— 于是升级后第一轮
   * 「旧账读不到」→ 所有老会话被当成新增 → 整份重导一遍（实测：豆包多 1 份、
   * DeepSeek 多 30 份）。0.5.0 把旧账读回来交给后台迁移。
   */
  function legacySignatureKey(siteKey) {
    return 'webchatExporter:sig:v1:' + siteKey + ':' + location.pathname;
  }

  function readLegacySig(siteKey) {
    try {
      var v = window.localStorage.getItem(legacySignatureKey(siteKey));
      return typeof v === 'string' ? v : '';
    } catch {
      return ''; // 隐私模式等场景读不到 localStorage，不影响导出
    }
  }

  /**
   * 读出当前页的消息与增量签名。
   * 注意：这里**不写**任何存储——「有没有新增」由后台在交付成功后统一判定，
   * 否则投递失败的那一轮会把签名提前记成「已见」，内容就再也导不出来了。
   */
  function readMessages(site) {
    var messages = core.extractMessages(document, site.key);
    if (!messages.length) {
      return {
        ok: false,
        reason: '没读到对话消息：请先登录并打开一段对话，把页面滚动到消息处后重试。'
      };
    }
    var payload = {
      ok: true,
      site: site.key,
      siteLabel: site.label,
      title: document.title,
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages: messages,
      // 增量判定用的指纹与记账键：由后台在交付成功后写入
      sig: core.signature(messages),
      sigKey: signatureKey(site.key),
      // 0.5.0：把 0.3.0 写在页面 localStorage 里的旧指纹一并带回去，
      // 后台用它兜住「升级后第一轮重导」，并顺手把旧账迁到 v2。
      legacySig: readLegacySig(site.key),
      legacySigKey: legacySignatureKey(site.key),
      // 审计用：原对话快照（DOM 抽取结果）。与导出文档一起落盘，
      // 才能逐条回答「导全了没有、有没有遗漏、正确率多少」。
      auditSource: messages.map(function (m) { return { role: m.role, text: m.text }; })
    };
    // 一条用户提问都没认出来 → 这是选择器失效的症状，附上页面结构线索。
    // 由应用写到本机 <数据根>/webchat-verify/，不进记忆库、不外传。
    if (core.needsDiagnostics(messages)) {
      payload.diag = core.collectCandidates(document, site.key, messages);
      payload.diag.url = location.href;
      payload.diag.title = document.title;
    }
    return payload;
  }

  // ─── 历史对话遍历（0.3.0，0.4.0 修侧栏识别 + 滚动加载） ─────────────────────

  function currentMessagesSig() {
    var site = core.matchSite(location.href);
    if (!site) return '';
    var messages = core.extractMessages(document, site.key);
    return messages.length ? core.signature(messages) : '';
  }

  /**
   * 轮询等页面切换。
   *
   * 0.5.5 修正（2026-11-17 豆包实测事故，真根因）：
   * 旧实现「URL 变了 **或** 消息签名变了」就立刻返回 true，而 SPA 是**先改 URL 再渲染内容**的。
   * 于是点下第 N 条时 URL 已经变成第 N 条、内容还是第 N-1 条 →
   *   · 抽到旧内容，却记到新路径的账上（sigKey 用 pathname）→ 后台认为没导过 → 再落一份；
   *   · 结果：豆包 57 份里有 42 份是**同一个会话**，而其它会话一条都没抽到。
   * 现在要求：URL 变了之后必须**再等内容也变**（等不到就如实返回 'url_only'，由调用方跳过这一条），
   * 宁可不导，也不要把上一个会话的内容冒充成这一个。
   *
   * 返回 'content'（内容真的换了）/ 'url_only'（地址变了但内容没跟上）/ 'none'（完全没动静）。
   */
  function waitForChange(before, waitMs) {
    var deadline = Date.now() + Math.max(2000, Math.min(30000, waitMs || 15000));
    /** URL 变了之后至少等这么久，让 SPA 把内容渲染出来 */
    var SETTLE_MS = 800;
    /** 最多再等这么久要内容变化；等不到就认定渲染没跟上 */
    var CONTENT_WAIT_MS = 2500;
    var urlChangedAt = 0;
    return new Promise(function (resolve) {
      var timer = setInterval(function () {
        if (location.href !== before.url && !urlChangedAt) urlChangedAt = Date.now();
        if (urlChangedAt) {
          var sig = '';
          try { sig = currentMessagesSig(); } catch { sig = ''; }
          var settled = Date.now() - urlChangedAt >= SETTLE_MS;
          if (settled && (!before.sig || (sig && sig !== before.sig))) {
            clearInterval(timer);
            resolve('content');
            return;
          }
          if (Date.now() - urlChangedAt >= CONTENT_WAIT_MS) {
            clearInterval(timer);
            resolve('url_only');
            return;
          }
        }
        if (Date.now() > deadline) {
          clearInterval(timer);
          resolve(urlChangedAt ? 'url_only' : 'none');
        }
      }, 300);
    });
  }

  function sendToBackground(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (res) {
          var lastError = chrome.runtime.lastError;
          if (lastError) { reject(new Error(lastError.message || '后台未响应')); return; }
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * 遍历历史会话：逐个点击 → 等切换 → 提取 → 立即交后台交付。
   * 任何一条失败只记原因继续下一条；全部做完尝试回到原会话。
   *
   * 0.4.0 追加：侧栏是虚拟列表（DeepSeek 用 ds-virtual-list），DOM 里只有当前可见的
   * 一屏。每处理完一屏就把侧栏往下滚一屏，再取新条目，直到滚不出新条目为止。
   *
   * 0.5.1 追加「分轮 + 断点续采」（2026-11-17 实测事故）：
   *   190 个会话一口气点完要 4 分钟以上，MV3 的 Service Worker 撑不到那么久，
   *   于是「每 5 分钟起一轮、每轮都跑不完」—— 浏览器日志里连续 6 条 status=running
   *   的 history 任务、一条都没结束；而 autoRound 是串行等站点，DeepSeek 不返回，
   *   **豆包那一轮压根没开始**（所以豆包永远只有手动导的那 2 份）。
   *   现在：单轮只处理 maxItems 条（默认 25），回执 more=true 让后台过一会儿接着跑；
   *   skipLabels 是后台记下的「已经处理过的标题」，续采时直接跳过、不再点。
   */
  async function exportHistory(waitMs, opts) {
    var o = opts || {};
    /**
     * 已经处理过的标题 → 剩余可跳过**次数**（多重集，0.5.5）。
     *
     * 为什么不是 Set：豆包侧栏里 42 个不同会话的标题完全一样（标题按首问截断）。
     * 用 Set 判「这个标题处理过」→ 同名会话全被永久跳过 → 现场表现就是
     * 「豆包历史会话没全部导出」。改成计数器后，处理过 3 个同名会话就只跳 3 次，
     * 第 4 个同名会话照样会被打开导出。
     */
    var skipBudget = new Map();
    var skipList = Array.isArray(o.skipLabels) ? o.skipLabels : [];
    for (var sl = 0; sl < skipList.length; sl++) {
      skipBudget.set(skipList[sl], (skipBudget.get(skipList[sl]) || 0) + 1);
    }
    var maxItems = typeof o.maxItems === 'number' && o.maxItems > 0 ? o.maxItems : 25;
    /**
     * 单轮时间预算（0.5.2，2026-11-17 实测事故）：
     * 只按条数分批是不够的——每条最多等 waitMs，条数一乘就超过 MV3 SW 的 5 分钟上限，
     * 每轮都在半路被杀 → 断点写不进去 → 下一轮从头点。到点必须主动收工。
     */
    var budgetMs = typeof o.budgetMs === 'number' && o.budgetMs > 0 ? o.budgetMs : 20000;
    var startedAt = Date.now();
    /** 本轮真正处理（点击过）的条数；到上限就收工，交给下一轮 */
    var handled = 0;
    var processedLabels = [];
    var more = false;
    var items = core.listSidebarItems(document, { max: 500 });
    if (!items.length) {
      // 找不到就带上「页面上到底有什么」的体检结果，别只丢一句「没找到」
      var probe = core.describeSidebar(document);
      return {
        ok: false,
        reason: '没在侧栏找到历史会话列表：'
          + '（可点语义条目 ' + probe.semantic + ' 个 / 同类成组条目 ' + probe.groupRows + ' 个）。'
          + '展开侧栏后重试；若站点结构特殊，可先打开对应会话再用「导出当前对话」。',
        sidebarProbe: probe
      };
    }
    var originalUrl = location.href;
    var delivered = 0, viaHost = 0, viaDl = 0;
    /** 0.5.0：内容此前已导出过、被后台跳过的条数（升级后兜住「重复下载」） */
    var duplicated = 0;
    var skipped = [];
    var seenSigs = new Set();
    /**
     * 已处理过的会话**元素**（不是标题）。
     * 0.5.0 修正：原来用标题去重（seenLabels）→ **同名会话会被直接丢掉**，
     * 这就是「DeepSeek 有遗漏」的第二个真因（用户不同会话可能同名）。
     * 元素身份在真实站点里是稳定的（React 按 key 复用 DOM 节点），
     * 所以按元素去重既能去掉「重复的同一个会话」，又不会误伤同名会话。
     */
    var seenEls = new Set();
    /**
     * 0.5.5：本轮在侧栏**识别到的最大条目数**，随回执带回后台。
     *
     * 为什么需要这个数：用户问「历史会话是不是没导全」时，只有「导出了几份」根本答不了——
     * 缺的是分母。有了它就能对账：「侧栏识别到 200 条 / 已交付 200 份」= 到头了；
     * 「识别到 340 条 / 已交付 200 份」= 确实漏了（上限或滚动没到底）。
     */
    var maxSidebarItems = 0;
    /** 同一标题最多按几个不同会话处理（防重渲染导致无限重复点击） */
    var LABEL_REPEAT_CAP = 200;
    var labelCounts = new Map();
    /** 已处理过的会话路径（比标题可靠：同名会话也区分得开） */
    var seenPaths = new Set();
    /**
     * 0.5.0 上限调整：原来 MAX_ITEMS=40、MAX_SCROLL_PAGES=12，而
     * listSidebarItems 默认只给 30 条 → 侧栏一屏就满 → 74 个会话只导了 29 个。
     *
     * 0.5.5 修正（2026-11-17 用户质疑「DeepSeek 历史会话没全部导出」，实测 200 份恰好整数）：
     * MAX_ITEMS 原来是**总交付上限**，而且到顶时直接 break、**没有置 more=true** →
     * 后台收到 more=false → 认定「本站点已遍历完」→ 写 `historyDoneAt:v2:<站点>` →
     * 从那一刻起这个站点再也不会自动遍历。于是「到底有没有第 201 个会话」永远没人知道。
     * 现在：MAX_ITEMS 只当**单轮熔断丝**（防同一轮无限循环），到顶必须 more=true 交续采；
     * 识别上限也从 200 提到 500（否则第 201 条根本列不出来，更谈不上导）。
     */
    var MAX_ITEMS = 600;
    var MAX_SCROLL_PAGES = 40;

    for (var page = 0; page < MAX_SCROLL_PAGES; page++) {
      // 预算用完就收工（含「只在滚动、没点新条目」的空转）：把剩余交给下一轮续采
      if (handled > 0 && Date.now() - startedAt >= budgetMs) { more = true; break; }
      items = core.listSidebarItems(document, { max: 500 });
      if (items.length > maxSidebarItems) maxSidebarItems = items.length;
      var fresh = [];
      for (var i = 0; i < items.length; i++) {
        if (seenEls.has(items[i].el)) continue;
        // 同一标题已处理过多次 → 认定是同一个会话的重复渲染，跳过（但同名不同会话仍能过）
        var labelKey = items[i].label;
        var cnt = labelCounts.get(labelKey) || 0;
        if (cnt >= LABEL_REPEAT_CAP) continue;
        fresh.push(items[i]);
      }
      // 本屏看过的元素都记下来（下次再列出来时不再重复点）
      for (var s = 0; s < items.length; s++) seenEls.add(items[s].el);
      /**
       * 0.5.0：原来「这一屏没有新条目」就直接 break，导致虚拟列表还没滚完就收工。
       * 现在改成：没有新条目时先试一次滚动，滚不动才算到底。
       */
      if (!fresh.length) {
        if (!scrollSidebarOnce(items)) break;
        await sleep(700);
        continue;
      }
      for (var f = 0; f < fresh.length; f++) {
        // 单轮熔断丝（不是总上限）：到顶必须交续采，不能静默收工
        if (delivered + skipped.length >= MAX_ITEMS) { more = true; break; }
        var item = fresh[f];
        // 上一轮已经处理过的会话 → 跳过（同名会话按剩余次数逐个消耗，不是一刀切）
        var budget = skipBudget.get(item.label) || 0;
        if (budget > 0) { skipBudget.set(item.label, budget - 1); continue; }
        if (handled >= maxItems || Date.now() - startedAt >= budgetMs) { more = true; break; }
        handled++;
        processedLabels.push(item.label);
        labelCounts.set(item.label, (labelCounts.get(item.label) || 0) + 1);
        var before = { url: location.href, sig: '' };
        try { before.sig = currentMessagesSig(); } catch { before.sig = ''; }
        try {
          item.el.click();
        } catch (e) {
          skipped.push({ title: item.label, reason: '点击失败：' + (e && e.message ? e.message : '未知') });
          continue;
        }
        var changed = await waitForChange(before, waitMs);
        if (changed === 'none') {
          skipped.push({ title: item.label, reason: '点击后页面没有切换（可能不是会话入口）' });
          continue;
        }
        /**
         * 0.5.5：地址变了、内容还是上一个会话 → **绝不能拿旧内容当这条交付**。
         * 这是「同一个会话被导出 42 份」的唯一成因（见 waitForChange 注释）。
         * 记一条原因并留给下一轮补跑，比落一份错内容更有价值。
         */
        if (changed === 'url_only') {
          skipped.push({ title: item.label, reason: '点击后地址变了但内容还是上一个会话（页面渲染没跟上），这条留给下次补跑' });
          continue;
        }
        // 0.5.0：用会话路径去重（同名会话不会互相顶掉）
        var pathKey = location.pathname;
        if (seenPaths.has(pathKey)) continue;
        seenPaths.add(pathKey);
        var site = core.matchSite(location.href);
        var messages = site ? core.extractMessages(document, site.key) : [];
        if (!messages.length) {
          skipped.push({ title: item.label, reason: '打开后没读到对话消息' });
          continue;
        }
        var sig = core.signature(messages);
        if (seenSigs.has(sig)) continue; // 同一段内容（比如点回了原会话）不重复交付
        seenSigs.add(sig);
        var itemPayload = {
          site: site.key,
          siteLabel: site.label,
          /** 0.5.2：后台据此「每条一落断点」，SW 被杀也不丢进度 */
          label: item.label,
          title: document.title,
          url: location.href,
          exportedAt: new Date().toISOString(),
          messages: messages,
          // 交付成功后由后台记账：这条会话以后不会再被当成「新增」重复导
          sig: sig,
          sigKey: 'webchatExporter:sig:v2:' + site.key + ':' + location.pathname,
          /**
           * 0.5.5：内容级去重键（同一段对话无论落在哪个路径上只落盘一次）。
           * 路径键挡不住「旧内容被记到新路径上」，这个键能挡——见 core.contentKey 注释。
           */
          contentKey: core.contentKey(site.key, sig),
          // 0.5.0：把 0.3.0 写在页面 localStorage 里的旧指纹一并带回去。
          // 历史遍历原本完全不判增量 → 升级后每轮都重导全部历史会话
          //（实测：DeepSeek 多 30 份、豆包多 1 份 = 用户看到的「豆包 2 个重复下载」）。
          // 后台拿它兜住「升级后第一轮」，见过就跳过。
          legacySig: readLegacySig(site.key),
          legacySigKey: legacySignatureKey(site.key),
          // 审计用：原对话快照
          auditSource: messages.map(function (m) { return { role: m.role, text: m.text }; })
        };
        /**
         * 0.5.4：历史遍历也要带诊断线索。
         * 2026-11-17 实测：豆包 41 份历史导出里有 10 份「只有助手、没有用户提问」，
         * 而诊断文件一份都没有——因为这条路径没接 `payload.diag`，
         * 于是「哪条消息认不出」永远没有现场证据，只能靠猜选择器。
         */
        if (core.needsDiagnostics(messages)) {
          itemPayload.diag = core.collectCandidates(document, site.key, messages);
          itemPayload.diag.url = location.href;
          itemPayload.diag.title = document.title;
        }
        try {
          var ack = await sendToBackground({
            type: 'EXPORT_HISTORY_ITEM',
            payload: itemPayload
          });
          if (ack && ack.ok) {
            delivered++;
            if (ack.via === 'host') viaHost++; else viaDl++;
          } else if (ack && ack.duplicate) {
            // 0.5.0：内容已导出过 → 后台跳过，没落盘。计入 duplicated，不算失败。
            duplicated++;
          } else {
            skipped.push({ title: item.label, reason: '交付失败：' + ((ack && ack.reason) || '未知原因') });
          }
        } catch (e) {
          skipped.push({ title: item.label, reason: '交付失败：' + (e && e.message ? e.message : '未知原因') });
        }
      }
      if (delivered + skipped.length >= MAX_ITEMS) { more = true; break; }
      // 本轮配额用完：立刻收工（不滚、不等），交给后台过一会儿续采
      if (more) break;
      // 侧栏往下滚一屏，看看还有没有没见过的会话（虚拟列表才会露出来）
      if (!scrollSidebarOnce(items)) break;
      await sleep(700);
    }

    // 回到原会话：SPA 里用 history.back 比硬跳 URL 更不打断应用状态；失败就算了，不阻塞结果
    try {
      if (location.href !== originalUrl) history.back();
    } catch {
      /* 回不去就停在最后一条，不影响导出结果 */
    }
    var hostSite = core.matchSite(location.href);
    return {
      ok: true,
      delivered: delivered,
      viaHost: viaHost,
      viaDl: viaDl,
      duplicated: duplicated,
      skipped: skipped,
      /** 本轮处理过的会话标题（后台记为断点，下一轮直接跳过） */
      processedLabels: processedLabels,
      /** 0.5.5：侧栏识别到的最大条目数（对账用的分母，见 maxSidebarItems 注释） */
      sidebarItems: maxSidebarItems,
      /** true = 侧栏还有没处理完的会话，需要下一轮接着采 */
      more: more,
      handled: handled,
      siteLabel: hostSite ? hostSite.label : ''
    };
  }

  /**
   * 把侧栏往下滚一屏。返回 true 表示确实滚动了（可能还有新条目），
   * false 表示没有可滚动的侧栏（到底了）。
   */
  function scrollSidebarOnce(items) {
    for (var i = 0; i < items.length; i++) {
      var scroller = core.findScrollAncestor(items[i].el);
      if (!scroller) continue;
      try {
        var before = scroller.scrollTop;
        scroller.scrollTop = before + Math.max(200, Math.floor((scroller.clientHeight || 400) * 0.8));
        if (scroller.scrollTop !== before) return true;
      } catch {
        /* 滚动失败就当到底了 */
      }
    }
    return false;
  }

  /**
   * 清掉 0.3.0 写在页面 localStorage 里的 v1 旧指纹（0.5.3）。
   * 为什么必须清：后台判「无新增」时会比对 legacySig —— 不清的话，重导那一轮
   * 直接命中旧账判「没新增」，用户点了「清空并重新导出」却什么也没导出来。
   */
  function clearLegacySigs() {
    var removed = 0;
    try {
      // 倒序遍历：removeItem 会让后面的下标前移，正序会漏掉一半键
      for (var i = window.localStorage.length - 1; i >= 0; i--) {
        var k = window.localStorage.key(i);
        if (typeof k !== 'string' || k.indexOf('webchatExporter:sig:v1:') !== 0) continue;
        window.localStorage.removeItem(k);
        removed++;
      }
    } catch {
      /* 隐私模式读不到 localStorage：当没有旧账 */
    }
    return removed;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return false;
    if (msg.type === 'CLEAR_LEGACY_SIG') {
      sendResponse({ ok: true, cleared: clearLegacySigs() });
      return false;
    }
    if (msg.type === 'EXPORT_NOW') {
      try {
        var site = core.matchSite(location.href);
        if (!site) {
          sendResponse({ ok: false, reason: '当前网站不在支持列表：请打开 DeepSeek / 豆包 / 文心一言 / 千问 / Kimi / 智谱 / 小米 MiMO 的对话页。' });
          return false;
        }
        sendResponse(readMessages(site));
      } catch {
        sendResponse({ ok: false, reason: '读取当前页面失败：请刷新对话页后重试。' });
      }
      return false;
    }
    if (msg.type === 'EXPORT_HISTORY') {
      void (async function () {
        try {
          sendResponse(await exportHistory(msg.waitMs, {
            skipLabels: msg.skipLabels,
            budgetMs: msg.budgetMs,
            maxItems: msg.maxItems
          }));
        } catch (e) {
          sendResponse({ ok: false, reason: '历史对话遍历失败：' + (e && e.message ? e.message : '未知错误') });
        }
      })();
      return true; // 异步回执
    }
    return false;
  });
})();
