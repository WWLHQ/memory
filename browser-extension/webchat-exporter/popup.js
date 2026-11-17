(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var hostEl = document.getElementById('host');
  var lastAutoEl = document.getElementById('lastAuto');
  var verEl = document.getElementById('ver');
  var currentBtn = document.getElementById('exportCurrent');
  var allBtn = document.getElementById('exportAll');
  var historyBtn = document.getElementById('exportHistory');
  var resetBtn = document.getElementById('resetExports');
  var noteEl = document.getElementById('note');
  var hasRunningTask = false;
  var WARN_TEXT = '有未完成的导出任务：后台会继续写入，关闭窗口不会中断。确定关闭吗？';
  /**
   * 「清空旧导出」是破坏性操作（会删磁盘上的 md）：不给二次确认就一键执行，迟早出事。
   * 弹窗里不用 confirm()（部分浏览器对扩展弹窗的模态框处理不一致），改成「再点一次」，
   * 8 秒内不点就自动撤销——比一句「确定吗？」更不容易误触发。
   */
  var RESET_LABEL = '清空旧导出并重新导出全部';
  var RESET_ARM_MS = 8000;
  var resetArmedAt = 0;

  // 直接问浏览器要「当前真正加载的版本」。
  // 为什么需要：改完文件点「重新加载」是否生效，光看扩展页的版本号分不出来，
  // 结果只能靠「弹窗长什么样」猜——这一步把猜测换成一行明确文字。
  (function showVersion() {
    if (!verEl) return;
    var v = '';
    try {
      v = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    } catch {
      v = '';
    }
    verEl.textContent = v ? '插件版本 v' + v : '插件版本读取失败（扩展未重新加载）';
  })();

  /**
   * 把「本机接收服务能不能用」直接摆出来。
   * 为什么必须有：以前只在导出失败后说一句「本机服务不可用（未知原因）」，
   * 用户只能看到文件跑进了下载目录，分不清是应用没开、插件缺权限，还是文件没生成。
   */
  function showHost(host) {
    if (!hostEl) return;
    if (!host) {
      hostEl.className = 'dim';
      hostEl.textContent = '本机接收服务：状态未知（扩展后台没返回探测结果）';
      return;
    }
    if (host.ok) {
      hostEl.className = 'good';
      hostEl.textContent = '本机接收服务：可用（127.0.0.1:' + host.port + '）—— 导出会直接写进应用的「导出和同步目录」';
      return;
    }
    var where = host.step === 'permission' ? '扩展缺 127.0.0.1 访问权限'
      : host.step === 'runtime' ? '读不到 runtime.json'
        : '连不上 127.0.0.1:' + (host.port || '');
    hostEl.className = 'bad';
    hostEl.textContent = '本机接收服务：不可用（' + where + '）—— ' + (host.reason || '未知原因')
      + '。本次导出会兜底存到浏览器下载目录。';
  }

  function refreshHost() {
    return call({ type: 'GET_STATUS' }).then(function (res) {
      if (res && res.ok) { showHost(res.host); showLastAuto(res.lastAuto, res.idle); }
    }).catch(function () {
      showHost(null);
    });
  }

  /**
   * A（0.5.5）：把「最近一次自动检查」摆出来。
   * 为什么必须有：只显示「最近一次导出 21:59」时，用户分不清「插件停了」和
   * 「跑了但没新增」——2026-11-17 就为这个白排查了一轮。
   */
  function clockOf(ms) {
    var d = new Date(ms);
    var p = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function agoOf(ms) {
    var diff = Date.now() - ms;
    if (diff < 0) return '刚刚';
    var min = Math.floor(diff / 60000);
    if (min < 1) return '不到 1 分钟前';
    if (min < 60) return min + ' 分钟前';
    var hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    return Math.floor(hour / 24) + ' 天前';
  }

  function showLastAuto(rec, idle) {
    if (!lastAutoEl) return;
    var idleText = idle === 'idle' ? '当前空闲（可以补跑历史）'
      : idle === 'active' ? '当前有操作（不会补跑历史）'
        : idle === null || idle === undefined ? '这个浏览器不支持空闲检测，历史只补首轮'
          : '当前状态：' + idle;
    if (!rec || !rec.at) {
      lastAutoEl.className = 'dim';
      lastAutoEl.textContent = '最近检查：还没跑过（插件刚装好，或还没到第一个自动同步周期）'
        + '。空闲补跑：' + idleText + '。';
      return;
    }
    var parts = [];
    if (rec.exported > 0) parts.push('导出 ' + rec.exported + ' 份');
    if (rec.skipped > 0) parts.push('无新增跳过 ' + rec.skipped + ' 份');
    if (rec.historyExported > 0) parts.push('历史补跑 ' + rec.historyExported + ' 份');
    if (rec.failed > 0) parts.push('失败 ' + rec.failed + ' 份');
    var detail = parts.length > 0 ? parts.join(' · ')
      : '没有新增内容（已连续 ' + (rec.idleRounds || 1) + ' 轮）';
    lastAutoEl.className = rec.failed > 0 ? 'bad' : 'dim';
    lastAutoEl.textContent = '最近检查：' + clockOf(rec.at) + '（' + agoOf(rec.at) + '）· ' + detail
      + '。' + (rec.source === 'idle' ? '这一轮是空闲补跑。' : '') + '空闲补跑：' + idleText + '。';
  }

  function call(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (res) {
        // 后台没起来 / 抛异常时，真正的原因只在 lastError 里；不看它就只能给一句「未响应」
        var lastError = chrome.runtime.lastError;
        if (lastError) { reject(new Error(lastError.message || '扩展后台未响应')); return; }
        resolve(res);
      });
    });
  }

  function say(text) {
    statusEl.textContent = text;
  }

  function busy(yes) {
    currentBtn.disabled = yes;
    allBtn.disabled = yes;
    if (historyBtn) historyBtn.disabled = yes;
    if (resetBtn) resetBtn.disabled = yes;
  }

  window.addEventListener('beforeunload', function (event) {
    if (!hasRunningTask) return undefined;
    event.preventDefault();
    event.returnValue = WARN_TEXT;
    return WARN_TEXT;
  });

  async function run(message, workingText) {
    hasRunningTask = true;
    busy(true);
    say(workingText);
    try {
      var res = await call(message);
      say(res && res.message ? res.message : '导出未成功：请确认当前页是支持的对话页。');
    } catch (e) {
      say('导出未成功：扩展后台未响应（' + ((e && e.message) || '未知原因') + '）。可在扩展管理页点「重新加载」后重试。');
    } finally {
      hasRunningTask = false;
      busy(false);
      // 导出后再探一次：成功说明服务可用，失败则把真因摆到顶部，不用让用户复述弹窗文字
      void refreshHost();
    }
  }

  currentBtn.addEventListener('click', function () {
    void run({ type: 'EXPORT_CURRENT', force: true }, '正在读取当前对话…');
  });

  allBtn.addEventListener('click', function () {
    void run({ type: 'EXPORT_ALL', force: false }, '正在导出已打开的对话…');
  });

  if (historyBtn) {
    historyBtn.addEventListener('click', function () {
      // 历史遍历要逐个打开侧栏会话，慢是正常的：页面会自己跳，别关对话页
      void run({ type: 'EXPORT_HISTORY' }, '正在遍历侧栏历史会话（页面会自动切换，请勿关闭此页）…');
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      var now = Date.now();
      if (now - resetArmedAt > RESET_ARM_MS) {
        resetArmedAt = now;
        resetBtn.textContent = '再点一次确认：会删掉已导出的 md';
        say('清空是破坏性操作：会删掉导出目录里本插件的 md 与审计快照，并重置去重记录，然后重新遍历一遍历史会话。'
          + '8 秒内再点一次即执行；不点则自动撤销。');
        return;
      }
      resetArmedAt = 0;
      resetBtn.textContent = RESET_LABEL;
      void run({ type: 'RESET_EXPORTS' }, '正在清空旧导出并重新遍历历史会话（页面会自动切换，请勿关闭此页）…');
    });
  }

  void call({ type: 'GET_STATUS' }).then(function (res) {
    if (!res || !res.ok) { say('读取插件状态失败：请重新安装插件。'); showHost(null); showLastAuto(null, null); return; }
    var names = Array.isArray(res.sites) ? res.sites.join('、') : '';
    noteEl.textContent = '支持站点：' + names + '。自动同步每 ' + res.autoMinutes
      + ' 分钟执行一次，只在你保持对应网页打开时有效；页面关闭后浏览器读不到页面内容。'
      + '历史会话会在插件重载后的第一轮自动遍历一次（之后只导新增）；'
      + '另外每 ' + (res.refreshMinutes || 60) + ' 分钟检查一次，发现你已 ' + (res.idleSeconds || 60)
      + ' 秒没操作、且该站点距上次补跑超过 ' + (res.refreshMinGapHours || 6) + ' 小时，会自动补跑一遍历史'
      + '（补跑时页面会自己切换）。想立刻再遍历一遍就点「导出全部历史对话」。';
    hasRunningTask = res.runningCount > 0;
    showHost(res.host);
    showLastAuto(res.lastAuto, res.idle);
    say(res.notice || '准备就绪。点上面「导出当前对话」即可。');
  }).catch(function (e) {
    say('读取插件状态失败：' + ((e && e.message) || '扩展后台未响应') + '（在扩展管理页点「重新加载」可恢复）');
  });
})();
