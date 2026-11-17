/**
 * Service worker：每 5 分钟对已打开的受支持网页做一次增量导出（0.3.0 起，原 15 分钟）。
 *
 * 落点分两级（2026-11-16 改）：
 *   ① 首选「本机接收端」：POST 到应用写的 runtime.json 里的 127.0.0.1:端口，
 *      由应用自己写进「导出和同步目录」→ 采集器必然扫到。
 *      为什么不再以浏览器下载目录为主：QQ 浏览器把 chrome.downloads 的
 *      `chat-exports/<站点>/` 子目录整个剥掉、文件甩进 %TEMP%（其下载记录
 *      qb_file_dl_record_v1.db 可查），应用扫 Downloads\chat-exports 永远采 0 条。
 *   ② 兜底「浏览器下载目录」：本机服务不可用时仍能导出（内容不丢），并在弹窗里
 *      如实说明「为什么没走本机」+ 文件落在哪（QQ 浏览器下这个落点不可控，仅供保底）。
 *
 * 0.3.0 放宽的三道旧门槛（2026-11-17 用户反馈「条条框框太多，一条不满足就停」）：
 *   ① 内容脚本没注入 → 先用 chrome.scripting 程序化注入再重试，不再要求用户刷新页面；
 *   ② 自动轮询失败 → 落一条任务记录，弹窗打开就能看到，不再完全静默；
 *   ③ alarm 每次启动都重建 → 升级插件后旧 15 分钟周期自动换成 5 分钟，不用手动清。
 *
 * 新增「导出全部历史对话」：遍历侧栏里的历史会话逐个打开导出（content.js 实现），
 * 只在用户点按钮时执行——自动轮询绝不自动点击页面，避免打断正在聊天的用户。
 *
 * 不调站点接口、不上传内容；页面关闭后扩展读不到页面内容，这是浏览器硬边界。
 */
importScripts('shared/core.js');

var core = globalThis.WebchatExporterCore;
var AUTO_ALARM = 'webchat-exporter-auto-v1';
var AUTO_MINUTES = 5;
/**
 * 0.5.5（A）：每轮自动巡检写一条「最近检查」账，全部无新增也写。
 * 为什么：不写的话，用户只看到「最近一次导出 21:59」，无法区分
 * 「插件没跑」和「跑了但没新增」——2026-11-17 实测就为此排查了一轮。
 */
var LAST_AUTO_KEY = 'webchatExporter:lastAutoAt:v1';
/**
 * 0.5.5（B）：空闲补跑历史会话。
 * 0.5.4 之前 `historyDoneAt:v2:<站点>` 一置上就再也不会遍历，新会话（不打开就不导）
 * 只能靠用户点弹窗按钮。现在加一支独立 alarm：只在**系统空闲**时补跑，
 * 每站点至少隔 6 小时才补一次，避免频繁切换页面。
 */
var HISTORY_REFRESH_ALARM = 'webchat-exporter-history-refresh';
var HISTORY_REFRESH_MINUTES = 60;
var HISTORY_REFRESH_MIN_GAP_MS = 6 * 60 * 60 * 1000;
/** 判定「用户无操作」的空闲阈值：60 秒。chrome.idle 不可用时不补跑（宁可不跑，不打断用户）。 */
var IDLE_SECONDS = 60;
var REFRESH_KEY_PREFIX = 'webchatExporter:historyRefreshAt:v1:';
/** data: URL 单条长度上限（约 1.9M 字符 ≈ 1.4MB 原文）：超过就别硬塞，提前说人话 */
var MAX_DATA_URL_LENGTH = 1900000;
var SITES_HINT = 'DeepSeek / 豆包 / 文心一言 / 千问 / Kimi / 智谱 / 小米 MiMO';
/** runtime.json 缓存：应用改端口/令牌后最多 30 秒生效；读不到时只缓存 5 秒，方便应用刚启动就重试 */
var RUNTIME_TTL_MS = 30000;
var RUNTIME_MISS_TTL_MS = 5000;
var runtimeCache = { at: 0, value: null };
var HOST_POST_TIMEOUT_MS = 15000;
/** 探测 /ping 的超时：弹窗打开时会跑一次，不能让人等着 */
var PROBE_TIMEOUT_MS = 4000;
/** 历史对话遍历：单会话等待渲染的上限（毫秒），超时就跳过该条，由 content.js 落原因 */
var HISTORY_WAIT_MS = 8000;
/**
 * 最近一次 runtime.json 读取失败的真实原因。
 * 为什么留着：readRuntime 失败原本被静默吞成 null，弹窗只能笼统说「本机服务不可用」，
 * 用户和排查者都不知道是「文件没生成」还是「浏览器不让读扩展包内文件」。
 */
var lastRuntimeError = '';

/**
 * 每次启动都重建 alarm：同名覆盖，periodInMinutes 改了也会生效。
 * 为什么不再「存在就跳过」：0.2.x 装的旧 alarm 是 15 分钟，只查存在性会永远沿用旧周期。
 */
async function ensureAlarm() {
  if (!chrome.alarms || !chrome.alarms.create) return;
  try {
    chrome.alarms.create(AUTO_ALARM, { delayInMinutes: AUTO_MINUTES, periodInMinutes: AUTO_MINUTES });
  } catch {
    /* 建不了 alarm 就没有自动导出，手动导出不受影响；弹窗能看到任务记录再排查 */
  }
}

/**
 * 0.5.5（B）：空闲补跑的独立 alarm。
 * 与 5 分钟自动巡检分开：补跑历史会话要来回切页面，只能在没有用户操作时做，
 * 所以单独一个 1 小时的 alarm，到点只问一句「用户现在在不在动」，不在动才动手。
 */
async function ensureHistoryRefreshAlarm() {
  if (!chrome.alarms || !chrome.alarms.create) return;
  try {
    chrome.alarms.create(HISTORY_REFRESH_ALARM, {
      delayInMinutes: HISTORY_REFRESH_MINUTES,
      periodInMinutes: HISTORY_REFRESH_MINUTES
    });
  } catch {
    /* 建不了就只靠「首轮一次性遍历」+ 弹窗按钮；不影响增量导出 */
  }
}

function refreshAtKey(siteKey) {
  return REFRESH_KEY_PREFIX + siteKey;
}

async function readRefreshAt(siteKey) {
  if (!siteKey) return 0;
  try {
    var key = refreshAtKey(siteKey);
    var stored = await chrome.storage.local.get(key);
    var v = stored && stored[key];
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

async function markRefreshAt(siteKey) {
  if (!siteKey) return;
  try {
    var value = {};
    value[refreshAtKey(siteKey)] = Date.now();
    await chrome.storage.local.set(value);
  } catch {
    /* 记不上最坏是下次再多补跑一次，不丢数据 */
  }
}

/**
 * 问浏览器「用户现在在不在操作」。
 * 返回 'idle' / 'active' / 'locked' / null；**null = 这个浏览器没有 chrome.idle（或没授 idle 权限）**。
 * 返回 null 时不补跑——宁可不跑，也不要因为读不到状态就去抢用户正在用的页面。
 */
function queryIdleState() {
  return new Promise(function (resolve) {
    try {
      if (!chrome.idle || !chrome.idle.queryState) { resolve(null); return; }
      chrome.idle.queryState(IDLE_SECONDS, function (state) { resolve(state || null); });
    } catch {
      resolve(null);
    }
  });
}

/** 读「最近一轮巡检」的账；没跑过返回 null（不冒充「刚刚查过」） */
async function readLastAuto() {
  try {
    var stored = await chrome.storage.local.get(LAST_AUTO_KEY);
    var v = stored && stored[LAST_AUTO_KEY];
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * A（0.5.5）：每轮巡检都写一条可见账，**包括全部无新增的那一轮**。
 *
 * 为什么必须写：只记「有导出」时，用户看到「最近一次导出 21:59」根本分不清
 * 「插件停了」和「跑了但没新增」——2026-11-17 就为这个白排查了一整轮。
 * idleRounds = 连续「什么都没做」的轮次数：界面据此说「已连续 N 轮无新增」，
 * 而不是每轮都像刚跑过一样。
 */
async function noteAutoRound(info) {
  var prev = await readLastAuto();
  var exported = Number(info && info.exported) || 0;
  var failed = Number(info && info.failed) || 0;
  var historyExported = Number(info && info.historyExported) || 0;
  var idle = exported === 0 && failed === 0 && historyExported === 0;
  var rec = {
    at: Date.now(),
    source: (info && info.source) || 'alarm',
    tabs: Number(info && info.tabs) || 0,
    exported: exported,
    failed: failed,
    skipped: Number(info && info.skipped) || 0,
    historyExported: historyExported,
    historyPending: Number(info && info.historyPending) || 0,
    historySites: Number(info && info.historySites) || 0,
    idleRounds: idle ? (Number(prev && prev.idleRounds) || 0) + 1 : 0
  };
  try {
    var value = {};
    value[LAST_AUTO_KEY] = rec;
    await chrome.storage.local.set(value);
  } catch {
    /* 记不上只是界面上少一行字，不影响导出本身 */
  }
  return rec;
}

async function readTasks() {
  try {
    var stored = await chrome.storage.local.get(core.TASK_KEY);
    return core.normalizeTasks(stored && stored[core.TASK_KEY]);
  } catch {
    return [];
  }
}

async function writeTasks(tasks) {
  try {
    var value = {};
    value[core.TASK_KEY] = core.normalizeTasks(tasks);
    await chrome.storage.local.set(value);
  } catch {
    /* 任务状态写不进去不影响导出本身，只是关闭后看不到进度 */
  }
}

async function beginTask(kind) {
  var task = core.startTask(kind);
  await writeTasks(core.upsertTask(await readTasks(), task));
  return task;
}

async function endTask(id, status, message) {
  await writeTasks(core.finishTask(await readTasks(), id, { status: status, message: message }));
}

function errText(e) {
  if (!e) return '未知原因';
  var text = e.message || String(e);
  // chrome.* 的失败原因常挂在 lastError 上，message 只有一句 "Unknown error" 时以它为准
  try {
    if (chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) {
      text = chrome.runtime.lastError.message;
    }
  } catch {
    /* 读不到就用 e.message */
  }
  return text;
}

/**
 * UTF-8 → base64。为什么要自己拼：Service Worker 里没有 `URL.createObjectURL`（MV3 已移除），
 * 拿不到 blob: 地址，`chrome.downloads.download` 只能吃 url/data url。
 * 用 base64（不是百分号编码）是因为中文占 3 字节 → base64 只 4 字符，百分号编码要 9 字符。
 */
function toBase64Utf8(text) {
  var bytes = new TextEncoder().encode(text);
  var binary = '';
  var CHUNK = 0x8000; // 分块拼，避免 apply 参数过多爆栈
  for (var i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 读应用写入的 runtime.json（端口 + 令牌）。
 * 扩展包内文件可以用 fetch(chrome.runtime.getURL(...)) 读到，不需要额外权限。
 * 读不到就返回 null —— 调用方据此回退到浏览器下载目录，绝不让导出整体失败。
 */
async function readRuntime() {
  var now = Date.now();
  if (runtimeCache.value && now - runtimeCache.at < RUNTIME_TTL_MS) return runtimeCache.value;
  if (!runtimeCache.value && runtimeCache.at && now - runtimeCache.at < RUNTIME_MISS_TTL_MS) return null;
  try {
    var res = await fetch(chrome.runtime.getURL('runtime.json'), { cache: 'no-store' });
    if (!res.ok) throw new Error('runtime.json 读取返回 HTTP ' + res.status);
    var j = await res.json();
    if (!j || typeof j.port !== 'number' || typeof j.token !== 'string' || !j.token) {
      throw new Error('runtime.json 内容不完整（缺 port 或 token）');
    }
    runtimeCache = { at: now, value: { port: j.port, token: j.token } };
    lastRuntimeError = '';
    return runtimeCache.value;
  } catch (e) {
    lastRuntimeError = errText(e);
    runtimeCache = { at: now, value: null };
    return null;
  }
}

/**
 * 探测「能不能直推本机」。分三步报，失败时一眼能看出卡在哪：
 *   ① 权限：manifest 的 host_permissions 是否真的授上了 —— 旧装升级后最常见的坑
 *   ② runtime.json：应用有没有把端口与令牌写进插件目录
 *   ③ /ping：127.0.0.1:端口 到底连不连得上
 * 只要任一步失败就回退下载，但原因必须能被人看到，不许再吞成「未知原因」。
 */
async function probeHost() {
  var hasPerm = true;
  try {
    if (chrome.permissions && chrome.permissions.contains) {
      hasPerm = await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] });
    }
  } catch {
    hasPerm = true; // 查不到就别误报，交给后面的步骤定性
  }
  if (!hasPerm) {
    return {
      ok: false,
      step: 'permission',
      reason: '扩展还没有「访问 127.0.0.1」的权限：在扩展管理页把插件关掉再打开（或点「重新加载」）一次即可授权'
    };
  }
  var rt = await readRuntime();
  if (!rt) {
    return { ok: false, step: 'runtime', reason: lastRuntimeError || '插件目录里没有 runtime.json' };
  }
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, PROBE_TIMEOUT_MS) : null;
  try {
    var res = await fetch('http://127.0.0.1:' + rt.port + '/ping', {
      headers: { Authorization: 'Bearer ' + rt.token },
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) {
      return { ok: false, step: 'ping', port: rt.port, reason: '本机服务返回 HTTP ' + res.status };
    }
    return { ok: true, step: 'ok', port: rt.port };
  } catch (e) {
    return {
      ok: false,
      step: 'ping',
      port: rt.port,
      reason: errText(e) + '（连不上 127.0.0.1:' + rt.port + '：应用没在运行，或浏览器拦了扩展对本机地址的请求）'
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 把 Markdown 直推给本机接收端；失败返回原因（由调用方决定是否回退下载） */
async function postToHost(payload, markdown) {
  var rt = await readRuntime();
  if (!rt) {
    return {
      ok: false,
      reason: '读不到 runtime.json：' + (lastRuntimeError || '插件目录里没有这个文件')
        + '（应用没启动过，或插件目录不是应用同步出来的那个）'
    };
  }
  var inner = {
    site: payload.site,
    title: payload.title || '',
    url: payload.url || '',
    exportedAt: payload.exportedAt || Date.now(),
    markdown: markdown
  };
  // 诊断线索（只在「没认出用户提问」时才有）随导出一起送，由应用写到本机独立目录，
  // 不进导出目录、不污染记忆库。
  if (payload.diag) inner.diag = payload.diag;
  // 审计快照：原对话（DOM 抽取结果）。应用据此逐条比对「导出文档 vs 原对话」，
  // 回答「导全了没有、有没有遗漏、正确率多少」。不带这块就只能知道「导出了几份」，
  // 不知道「导全了没有」——2026-11-17 用户诉求。
  if (payload.auditSource && Array.isArray(payload.auditSource)) inner.auditSource = payload.auditSource;
  var body = JSON.stringify(inner);
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, HOST_POST_TIMEOUT_MS) : null;
  try {
    var res = await fetch('http://127.0.0.1:' + rt.port + '/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + rt.token },
      body: body,
      signal: ctrl ? ctrl.signal : undefined
    });
    var j = null;
    try { j = await res.json(); } catch { j = null; }
    if (res.ok && j && j.ok) return { ok: true, path: j.path, diagPath: j.diagPath };
    return { ok: false, reason: (j && j.error) || ('本机接收端返回 HTTP ' + res.status) };
  } catch (e) {
    return { ok: false, reason: errText(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 兜底：写进浏览器下载目录（data URL，SW 里没有 URL.createObjectURL） */
async function downloadToBrowser(payload, markdown) {
  var filename = core.fileNameFor(payload);
  var url = 'data:text/markdown;charset=utf-8;base64,' + toBase64Utf8(markdown);
  // data: URL 走的是「一次下载一条地址」，浏览器对单条地址有长度上限（约 2MB 量级）。
  // 超了必失败且报错很难懂，这里提前说人话，别让用户对着 net::ERR_ 猜。
  if (url.length > MAX_DATA_URL_LENGTH) {
    throw new Error('本次对话内容过大（约 ' + Math.ceil(url.length / 1024 / 1024 * 3 / 4) + ' MB）：'
      + '浏览器一次下载放不下这么大的单条内容。请换一条较短的对话先导出，或把这条对话另存后手动放进 chat-exports。');
  }
  try {
    await chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
  } catch (e) {
    // 带出真实原因（下载目录不可写 / 策略拦截等），不再用一句「可能有变化」盖住
    throw new Error('写入浏览器下载目录失败：' + errText(e) + '（文件约 ' + Math.ceil(url.length / 1024) + ' KB）');
  }
  return filename;
}

/**
 * 交付一份导出：本机接收端优先，浏览器下载兜底。
 * 返回 {via:'host'|'downloads', file, fallbackReason?} —— UI 据此说清「文件到底在哪」。
 */
async function deliverMarkdown(payload) {
  var markdown = core.formatMarkdown(payload);
  var host = await postToHost(payload, markdown);
  if (host.ok) return { via: 'host', file: host.path, diagFile: host.diagPath, markdown: markdown };
  var filename = await downloadToBrowser(payload, markdown);
  return { via: 'downloads', file: filename, fallbackReason: host.reason, markdown: markdown };
}

/**
 * 内容脚本没注入（页面在扩展加载前就开着）→ 程序化注入一次再重试。
 * 这是 0.3.0 拆掉的第三道旧门槛：以前只能让用户「刷新对话页」，现在能自动修的自动修。
 * 注入失败（浏览器不支持 scripting / 权限没授上）→ 原样给出可执行动作，不做静默降级。
 */
async function injectContentScript(tabId) {
  if (!chrome.scripting || !chrome.scripting.executeScript) {
    return { ok: false, reason: '这个对话页还没装好插件（安装/更新插件后需要刷新页面一次）：刷新对话页后重试。' };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['shared/core.js', 'content.js']
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: '自动注入内容脚本失败：' + errText(e)
        + '（常见于浏览器没授 scripting 权限——在扩展管理页把插件关掉再打开一次，或刷新对话页后重试。）'
    };
  }
}

function isReceivingEndError(text) {
  return /Receiving end does not exist|Could not establish connection/i.test(String(text || ''));
}

/** 给内容脚本发消息：没注入就先注入再重试一次；其余失败一律转成「人话原因」 */
async function askTab(tabId, message) {
  try {
    var res = await chrome.tabs.sendMessage(tabId, message);
    return { ok: true, res: res };
  } catch (e) {
    var text = errText(e);
    if (isReceivingEndError(text)) {
      var injected = await injectContentScript(tabId);
      if (!injected.ok) return { ok: false, reason: injected.reason };
      try {
        var res2 = await chrome.tabs.sendMessage(tabId, message);
        return { ok: true, res: res2 };
      } catch (e2) {
        return { ok: false, reason: '读取对话页失败（注入后仍失败）：' + errText(e2) };
      }
    }
    return { ok: false, reason: '读取对话页失败：' + text };
  }
}

/**
 * 增量签名（0.4.0 改由后台记账）。
 *
 * 旧实现在内容脚本里：读到消息就把指纹写进页面 localStorage。于是**投递失败的那一轮
 * 也把指纹记成了「已见」**，下一轮判「无新增」跳过 → 那段内容永远导不出来。
 * 现在改成：内容脚本只把指纹带回来（payload.sig / payload.sigKey），
 * 由后台在**交付成功之后**才写进扩展 storage。
 */

async function readStoredSig(sigKey) {
  if (!sigKey) return '';
  try {
    var stored = await chrome.storage.local.get(sigKey);
    var v = stored && stored[sigKey];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

async function writeStoredSig(sigKey, sig) {
  if (!sigKey || !sig) return;
  try {
    var value = {};
    value[sigKey] = sig;
    await chrome.storage.local.set(value);
  } catch {
    /* 记不上指纹的后果只是下次再导一次（重复入库会被去重），不能因此让导出失败 */
  }
}

/**
 * 判断「这次是不是没有新增」。
 * 判据：内容脚本带回的指纹 与 上次**成功交付**的指纹 完全一致 → 没有新增。
 * force=true（用户手动点导出）→ 一律当作有新增，强制导出。
 *
 * 兼容旧内容脚本（页面没刷新，仍在跑 0.3.0 的 content.js）：它自己回 unchanged=true，
 * 这种情况照旧尊重——但注意旧版把指纹记在页面 localStorage，投递失败也会误判，
 * 所以只有当内容脚本没给 sig 时才走这个兼容分支。
 *
 * 0.5.0 新增「旧账兜底」：0.3.0 把指纹写在**页面 localStorage**（键 sig:v1），
 * 0.4.0 改写扩展 storage（键 sig:v2）→ 升级后第一轮旧账读不到 → 整份重导
 * （实测：豆包多 1 份、DeepSeek 多 30 份）。现在内容脚本会把旧账一起带回来
 * （legacySig），判「无新增」时一并比对；命中旧账就当作已见过，并在交付后
 * 把这笔账迁到 v2，之后就再也不会重导。
 */
async function isUnchanged(res, force) {
  if (force === true) return false;
  if (res && typeof res.sig === 'string' && res.sig) {
    var prev = await readStoredSig(res.sigKey);
    if (prev && prev === res.sig) return true;
    // 旧账兜底：0.3.0 写在页面 localStorage 的指纹
    if (res.legacySig && res.legacySig === res.sig) return true;
    return false;
  }
  return !!(res && res.unchanged === true);
}

/**
 * 这条内容**之前导过没有**（不依赖 force）。
 * 判据二选一命中即算「见过」：
 *   ① 扩展 storage 里的 v2 指纹（0.4.0+ 交付成功后写入）
 *   ② 0.3.0 写在页面 localStorage 里的 v1 旧指纹（升级兜底）
 *
 * 为什么历史遍历也要查：0.3.0 → 0.5.0 升级后，扩展 storage 里一把旧账都没有，
 * 而历史遍历**不看** v2 账（它本就不判增量）→ 每轮都把全部历史会话重导一遍
 * （实测：DeepSeek 多 30 份、豆包多 1 份，用户看到「豆包 2 个重复下载」）。
 * 现在历史条目也先查旧账，见过就跳过不交付。
 */
async function seenSigAlready(sigKey, sig, legacySig) {
  if (!sig) return false;
  var prev = await readStoredSig(sigKey);
  if (prev && prev === sig) return true;
  if (legacySig && legacySig === sig) return true;
  return false;
}

/** 旧账迁移：0.3.0 的页面 localStorage 指纹 → 0.4.0+ 的扩展 storage 指纹 */
async function migrateLegacySig(res) {
  if (!res || !res.sig || !res.legacySig || res.legacySig !== res.sig) return;
  if (!res.sigKey) return;
  await writeStoredSig(res.sigKey, res.sig);
}

async function exportOneTab(tabId, force) {
  var sent = await askTab(tabId, { type: 'EXPORT_NOW', force: force === true });
  if (!sent.ok) return { exported: false, reason: sent.reason };
  var res = sent.res;
  if (!res || !res.ok) return { exported: false, reason: res && res.reason ? res.reason : '页面未响应（可刷新对话页后重试）' };
  if (await isUnchanged(res, force)) {
    // 命中旧账也要把账迁到 v2 —— 否则每次都要靠「旧账还在」才判得出无新增，
    // 一旦页面 localStorage 被清（换浏览器/清缓存），又会把老会话当新增重导一遍。
    await migrateLegacySig(res);
    return { exported: false, unchanged: true };
  }
  try {
    var out = await deliverMarkdown(res);
    // 只有真的交付成功（落盘/下载都算）才记账；失败不记账，下一轮还会重来
    await writeStoredSig(res.sigKey, res.sig);
    // 旧账（0.3.0 页面 localStorage 里的指纹）顺手迁到新键，之后不再重导
    await migrateLegacySig(res);
    return {
      exported: true,
      file: out.file,
      via: out.via,
      fallbackReason: out.fallbackReason,
      diagFile: out.diagFile,
      siteLabel: res.siteLabel
    };
  } catch (e) {
    return { exported: false, reason: errText(e) };
  }
}

async function exportCurrentTab(force) {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs && tabs[0];
  if (!tab || !tab.id) return { ok: false, message: '没有可导出的当前网页。' };
  if (!core.matchSite(tab.url || '')) {
    return { ok: false, message: '当前网站不在支持列表：请打开 ' + SITES_HINT + ' 的对话页。' };
  }
  var task = await beginTask('current');
  try {
    var out = await exportOneTab(tab.id, force);
    var result;
    if (out.exported) {
      if (out.via === 'host') {
        var okMsg = '已写入 ' + out.file + '（应用自己落盘，采集器一定扫到）。打开记忆库点「立即采集」即可入库。';
        if (out.diagFile) {
          okMsg += ' 注意：这次没认出页面上的「你的提问」，已把页面结构诊断另存到 ' + out.diagFile
            + '（只用于修复抓取，不会进记忆库）。';
        }
        result = { ok: true, message: okMsg };
      } else {
        // 兜底路径必须说清「为什么没走本机」+「文件到底在哪」，否则用户又会对着空目录找文件
        result = {
          ok: true,
          message: '本机接收服务当前不可用（' + (out.fallbackReason || '未知原因') + '），已改存到浏览器下载目录：'
            + out.file + '。请启动一次应用后重新导出，文件就会直接写进「导出和同步目录」。'
        };
      }
    } else if (out.unchanged) {
      result = { ok: true, unchanged: true, message: '对话没有新增内容，已跳过，避免重复导出。' };
    } else {
      result = { ok: false, message: out.reason || '本次没有导出文件。' };
    }
    await endTask(task.id, result.ok ? 'done' : 'failed', result.message);
    return result;
  } catch (e) {
    // 兜底：把真实异常带出来，用户与日志都能看出是哪一步坏的
    var failed = { ok: false, message: '导出未成功：' + errText(e) };
    await endTask(task.id, 'failed', failed.message);
    return failed;
  }
}

async function exportOpenTabs(force, tracked) {
  var result = { ok: true, exported: 0, host: 0, downloads: 0, skipped: 0, failed: 0, scanned: 0, message: '', reasons: [] };
  var task = tracked === true ? await beginTask('all') : null;
  var tabs = await chrome.tabs.query({});
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    if (!tab.id || !core.matchSite(tab.url || '')) continue;
    result.scanned++;
    try {
      var out = await exportOneTab(tab.id, force);
      if (out.exported) {
        result.exported++;
        if (out.via === 'host') result.host++;
        else result.downloads++;
      } else if (out.unchanged) result.skipped++;
      else {
        // 「没新增」才算跳过；「读不到 / 写不进」属于失败，别混进跳过数里让人以为正常
        result.failed++;
        if (out.reason && result.reasons.length < 3) result.reasons.push(out.reason);
      }
    } catch (e) {
      result.failed++;
      if (result.reasons.length < 3) result.reasons.push(errText(e));
    }
  }
  result.message = '已打开对话中导出 ' + result.exported + ' 份（直写应用 ' + result.host
    + ' 份 / 存到下载目录 ' + result.downloads + ' 份）；无新增跳过 ' + result.skipped
    + ' 份；读取失败 ' + result.failed + ' 份。';
  if (result.downloads > 0) {
    result.message += ' 存到下载目录的那几份是「本机接收服务不可用」时的兜底，可能采不到，请启动应用后重新导出。';
  }
  if (result.failed > 0 && result.reasons.length > 0) {
    result.message += ' 原因：' + result.reasons.join('；');
  }
  if (task) await endTask(task.id, result.failed > 0 ? 'failed' : 'done', result.message);
  return result;
}

/**
 * 自动轮询（alarm 每 5 分钟）：
 *   · 第一轮（扩展重载/浏览器启动后）自动做一次「历史会话全量遍历」——
 *     用户不用记得点按钮，历史对话也能进库；重复内容入库时自动去重，多做无害。
 *     之后每轮只增量导当前页（遍历要来回切页面，绝不在每轮自动跑，避免打断聊天）。
 *   · 有导出或有失败 → 落一条 kind='auto' 的任务记录，弹窗打开就能看到；
 *     全部「无新增」跳过 → 不记（无事发生，别让记录每 5 分钟刷屏）。
 *
 * 0.4.0 修正：「首轮」标志改存扩展 storage。
 * 旧实现用 SW 内存变量 historyRoundPending —— MV3 的 Service Worker 空闲就被杀，
 * 内存变量随之归零，于是「首轮」实际上变成**每 5 分钟一轮**（QQ 浏览器实测：
 * 15:29/15:34/15:39/15:44/15:49/15:56 每轮都有一条 history 任务）。
 * 侧栏识别修好之后，这就变成每 5 分钟点一遍整个侧栏、会反复劫持用户正在聊的页面。
 * 现在标志存在 storage 里：SW 被杀、浏览器重启都不丢；真要再跑一次，
 * 用户在弹窗点「导出全部历史对话」即可（那条路径不受这个标志限制）。
 * 0.5.0 修正：标志从「全局一个」改成「**按站点一个**」。
 * 全局标志的漏洞：先跑了 DeepSeek 就把标志置上，用户之后再打开豆包标签页时
 * 永远不会自动遍历——正是「豆包只有当前那 1 份」这类现象的来源之一。
 * 现在每个站点各记各的，新开哪个站点都能补上首轮历史。
 */
var HISTORY_DONE_PREFIX = 'webchatExporter:historyDoneAt:v2:';
/** 0.5.1 之前写的是 v1 单键。升级后必须认旧账，否则「已完成」失效 → 整站重跑。 */
var HISTORY_DONE_LEGACY_PREFIX = 'webchatExporter:historyDoneAt:';

function historyDoneKey(siteKey) {
  return HISTORY_DONE_PREFIX + siteKey;
}

function historyDoneLegacyKey(siteKey) {
  return HISTORY_DONE_LEGACY_PREFIX + siteKey;
}

async function isSiteHistoryDone(siteKey) {
  if (!siteKey) return false;
  try {
    var key = historyDoneKey(siteKey);
    /**
     * 只用单键 get：`chrome.storage.local.get(['a','b'])` 虽然浏览器支持，
     * 但任何只实现了字符串入参的封装/测试替身都会静默返回 {} →
     * 「已完成」判定永远 false → 每 5 分钟重跑整站历史（正是停不下来的形态之一）。
     */
    var stored = await chrome.storage.local.get(key);
    if (stored && stored[key]) return true;
    /**
     * v1 → v2 迁移（0.5.2）：0.5.0 写的是 `historyDoneAt:<site>`，
     * 0.5.1 升级后只认 v2 → 旧完成标记全部失效 → 整站重跑。认旧账并顺手迁到 v2。
     */
    var legacyKey = historyDoneLegacyKey(siteKey);
    var legacyStore = await chrome.storage.local.get(legacyKey);
    if (legacyStore && legacyStore[legacyKey]) {
      await markSiteHistoryDone(siteKey);
      return true;
    }
    return false;
  } catch {
    // 读不到就当没跑过：最坏是多遍历一次，不会丢数据
    return false;
  }
}

async function markSiteHistoryDone(siteKey) {
  if (!siteKey) return;
  try {
    var value = {};
    value[historyDoneKey(siteKey)] = Date.now();
    await chrome.storage.local.set(value);
  } catch {
    /* 写不上就当没跑过：下轮再来一次，最坏是多跑一次遍历，不会丢数据 */
  }
}

/**
 * 历史遍历的「分轮 + 断点续采」（0.5.1，2026-11-17 实测事故）。
 *
 * 事故形态：190 个会话一口气点完要 4 分钟以上，MV3 的 Service Worker 撑不住，
 * 结果是扩展日志里连续 6 条 history 任务全卡在 status=running、一条都没结束；
 * 而 autoRound 是**串行**等站点返回，DeepSeek 不返回 → 豆包那一轮压根没开始
 * （所以豆包永远只有用户手动导的那 2 份，而且两份内容一模一样）。
 *
 * 现在的做法：
 *   · 单轮最多处理 HISTORY_BATCH 条 → 每轮几十秒内必然返回，SW 不会被杀；
 *   · 返回值里带 processedLabels / more，后台记成断点，下一轮直接跳过已处理的；
 *   · 还有剩（more=true）→ 30 秒后再来一轮，直到遍历完才记「该站点已完成」；
 *   · 每个站点一个「正在跑」标记，避免上一轮没回来时又叠一轮（叠起来会互相抢页面）。
 */
var HISTORY_BATCH = 8;
/**
 * 单轮**时间预算**（0.5.2，2026-11-17 实测事故的真根因）。
 *
 * 0.5.1 只按条数分批（25 条），但每条最多等 15 秒（HISTORY_WAIT_MS），
 * 25 × 15 = 375 秒 > MV3 Service Worker 的 5 分钟硬上限 →
 * **每一轮都在半路被杀**：断点写不进去、完成标记也写不进去，
 * 下一轮又从第 1 条开始 → 导出永远跑不完、还每 5 分钟叠一轮抢页面。
 * 现在改成按时间剪枝：到点就收工返回，把「还有剩」交给续采。
 */
var HISTORY_BUDGET_MS = 20000;
/** 连续多少轮「零新增」就认定该站点已采完，不再续采（防无限循环的熔断丝）。 */
var HISTORY_MAX_IDLE_ROUNDS = 3;
var HISTORY_STREAK_PREFIX = 'webchatExporter:historyStreak:v1:';
var HISTORY_PROGRESS_PREFIX = 'webchatExporter:historyProgress:v1:';
/** 断点最多存多少个标题（多重集，同名会话各占一格；200+ 会话的站点也够用） */
var PROGRESS_LIMIT = 5000;
var HISTORY_RUNNING_PREFIX = 'webchatExporter:historyRunning:v1:';
/** 超过这个时间还挂着「正在跑」→ 认为上一轮已经死了（SW 被杀/页面关了），允许重来 */
var HISTORY_RUNNING_STALE_MS = 5 * 60 * 1000;
var HISTORY_CONTINUE_ALARM = 'webchat-exporter-history-continue';

function progressKey(siteKey) {
  return HISTORY_PROGRESS_PREFIX + siteKey;
}

function runningKey(siteKey) {
  return HISTORY_RUNNING_PREFIX + siteKey;
}

async function readHistoryProgress(siteKey) {
  if (!siteKey) return { labels: [] };
  try {
    var key = progressKey(siteKey);
    var stored = await chrome.storage.local.get(key);
    var v = stored && stored[key];
    if (v && Array.isArray(v.labels)) return { labels: v.labels.slice(0, PROGRESS_LIMIT) };
    return { labels: [] };
  } catch {
    return { labels: [] };
  }
}

async function writeHistoryProgress(siteKey, labels) {
  if (!siteKey) return;
  try {
    var value = {};
    value[progressKey(siteKey)] = { labels: labels.slice(0, PROGRESS_LIMIT), at: Date.now() };
    await chrome.storage.local.set(value);
  } catch {
    /* 记不上断点最坏是下一轮重采一遍（去重会挡住重复落盘），不丢数据 */
  }
}

async function clearHistoryProgress(siteKey) {
  if (!siteKey) return;
  try {
    var value = {};
    // 用「空 labels」而不是 remove：调用方可能只实现了 get/set（单测环境），
    // 少一个 API 就整段失败不值当。
    value[progressKey(siteKey)] = { labels: [], at: Date.now(), cleared: true };
    await chrome.storage.local.set(value);
  } catch {
    /* 清不掉也无害：下次判断 done 时不会再看它 */
  }
}

/**
 * 断点**逐条追加**（0.5.2，2026-11-17 实测事故）。
 *
 * 0.5.1 只在轮末把 processedLabels 整批写进断点——但那一轮常在半路被 SW 杀掉，
 * 于是「点了 8 条」全白记，下一轮又从头点。每交付一条就落一次，SW 被杀也不丢。
 *
 * 0.5.5 修正（2026-11-17 豆包实测）：断点原来是**按标题去重**的集合，
 * 而豆包侧栏里 42 个不同会话的标题完全一样（「让agent优先读自建记忆库的方法」是按首问截断的）。
 * 集合去重 → 同名会话被当成「已处理过」永久跳过 → 表现为「历史没全部导出」。
 * 现在改成**多重集**：处理过几次就记几次，内容脚本按出现次数逐个消耗配额，
 * 第 N+1 个同名会话照样能被处理。
 */
async function appendHistoryProgress(siteKey, label) {
  if (!siteKey || !label) return;
  try {
    var key = progressKey(siteKey);
    var stored = await chrome.storage.local.get(key);
    var v = stored && stored[key];
    var labels = v && Array.isArray(v.labels) ? v.labels.slice() : [];
    labels.push(label);
    var value = {};
    value[key] = { labels: labels.slice(0, PROGRESS_LIMIT), at: Date.now() };
    await chrome.storage.local.set(value);
  } catch {
    /* 记不上最坏是多采一遍，去重会挡住重复落盘 */
  }
}

function streakKey(siteKey) {
  return HISTORY_STREAK_PREFIX + siteKey;
}

/** 连续「零新增」轮次 +1，返回新值（用于熔断判断）。 */
async function bumpHistoryStreak(siteKey) {
  if (!siteKey) return 0;
  try {
    var key = streakKey(siteKey);
    var stored = await chrome.storage.local.get(key);
    var n = Number(stored && stored[key]) || 0;
    n += 1;
    var value = {};
    value[key] = n;
    await chrome.storage.local.set(value);
    return n;
  } catch {
    return 0;
  }
}

async function clearHistoryStreak(siteKey) {
  if (!siteKey) return;
  try {
    var value = {};
    value[streakKey(siteKey)] = 0;
    await chrome.storage.local.set(value);
  } catch {
    /* 清不掉最坏是多跑一轮，熔断下轮还会再判 */
  }
}

async function markHistoryRunning(siteKey) {
  if (!siteKey) return;
  try {
    var value = {};
    value[runningKey(siteKey)] = Date.now();
    await chrome.storage.local.set(value);
  } catch {
    /* 记不上就可能叠一轮，但每轮都是有限批次，不会无限堆 */
  }
}

async function clearHistoryRunning(siteKey) {
  if (!siteKey) return;
  try {
    var value = {};
    value[runningKey(siteKey)] = 0;
    await chrome.storage.local.set(value);
  } catch {
    /* 同上 */
  }
}

async function isHistoryRunning(siteKey) {
  if (!siteKey) return false;
  try {
    var key = runningKey(siteKey);
    var stored = await chrome.storage.local.get(key);
    var at = stored && stored[key];
    if (typeof at !== 'number' || at <= 0) return false;
    return Date.now() - at < HISTORY_RUNNING_STALE_MS;
  } catch {
    return false;
  }
}

function scheduleHistoryContinue() {
  try {
    if (!chrome.alarms || !chrome.alarms.create) return;
    chrome.alarms.create(HISTORY_CONTINUE_ALARM, { delayInMinutes: 0.5 });
  } catch {
    /* 建不了就等下一轮 5 分钟自动巡检 */
  }
}

/**
 * 找「受支持站点」的已打开 tab 当历史遍历的宿主。
 * 0.5.0：原来只返回**第一个**匹配 tab → DeepSeek 排在前面时，豆包标签页
 * 从来没被遍历过（实测：豆包历史会话导出 0 份，只有当前打开的那 1 份）。
 * 现在返回**所有**受支持站点的 tab（按 tab 去重），逐个站点各遍历一次。
 */
async function findSupportedTabs() {
  var tabs = await chrome.tabs.query({});
  var out = [];
  var seen = new Set();
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    if (!t || !t.id || seen.has(t.id)) continue;
    if (!core.matchSite(t.url || '')) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/**
 * 逐个站点推进历史遍历（每站点一轮有上限条数，见 HISTORY_BATCH）。
 * 自动巡检与「续采」alarm 共用这一份逻辑，避免两处口径分叉。
 *
 * opts.ignoreDone（0.5.5 · B 用）：不因「这个站点已跑完」而跳过。
 *   首轮一次性遍历之后 `historyDoneAt:v2:<site>` 会永久生效，用户不开某个会话
 *   就永远导不到（正是「历史会话没全部导出」的形态）。空闲补跑必须绕过它。
 * opts.respectRefreshGap（0.5.5 · B 用）：每站点至少隔 HISTORY_REFRESH_MIN_GAP_MS
 *   才补跑一次，且**开始补跑时就记时间**——失败也不在 6 小时内反复点侧栏。
 */
async function runHistorySites(opts) {
  var options = opts || {};
  var hostTabs = await findSupportedTabs();
  var messages = [];
  var exported = 0;
  var pending = 0;
  for (var h = 0; h < hostTabs.length; h++) {
    var hostTab = hostTabs[h];
    if (!hostTab || !hostTab.id) continue;
    var tabSite = core.matchSite(hostTab.url || '');
    if (!tabSite) continue;
    if (!options.ignoreDone && await isSiteHistoryDone(tabSite.key)) continue;
    if (options.respectRefreshGap) {
      var lastRefresh = await readRefreshAt(tabSite.key);
      if (lastRefresh && Date.now() - lastRefresh < HISTORY_REFRESH_MIN_GAP_MS) continue;
    }
    /**
     * 上一轮还没回来（正在跑）→ 这一轮直接跳过这个站点。
     * 不跳过的话，每 5 分钟会叠一轮新的，两轮同时点同一个侧栏、互相抢页面 →
     * 谁都跑不完（2026-11-17 实测：连续 6 条 history 任务全卡在 running）。
     */
    if (await isHistoryRunning(tabSite.key)) { pending += 1; continue; }
    if (options.respectRefreshGap) await markRefreshAt(tabSite.key);
    try {
      var hist = await exportHistory(hostTab.id, tabSite.key);
      if (hist.message) messages.push(hist.message);
      exported += Number(hist.deliveredCount) || 0;
      /**
       * 只有**这个站点真的遍历完**才记它「跑过」。
       * 不能用 ok 判断：ok 只代表「有产出」，全被去重跳过时 delivered=0 但遍历是成功的；
       * 反过来「没认出侧栏」这种真失败必须留着重试，不能烧掉首轮机会。
       */
      if (hist.traversed) {
        await markSiteHistoryDone(tabSite.key);
        await clearHistoryStreak(tabSite.key);
      } else if (hist.more) {
        /**
         * 熔断丝（0.5.2）：连续多轮「零新增」说明剩下的都是已导过的内容，
         * 再续采只会无限点侧栏（2026-11-17 实测：停不下来）。
         * 只要有一轮真的有新增就清零重来，不冤枉还在进新会话的站点。
         */
        var deliveredNow = Number(hist.deliveredCount) || 0;
        if (deliveredNow > 0) {
          await clearHistoryStreak(tabSite.key);
          pending += 1;
        } else {
          var idle = await bumpHistoryStreak(tabSite.key);
          if (idle >= HISTORY_MAX_IDLE_ROUNDS) {
            await markSiteHistoryDone(tabSite.key);
            await clearHistoryProgress(tabSite.key);
            await clearHistoryStreak(tabSite.key);
            messages.push('连续 ' + idle + ' 轮没有新增内容，认定历史会话已采完，已停止续采。');
          } else {
            pending += 1;
          }
        }
      }
    } catch {
      /* 历史遍历失败不影响本轮增量导出；弹窗任务记录里有原因 */
    }
  }
  return { messages: messages, exported: exported, pending: pending, sites: hostTabs.length };
}

async function autoRound() {
  var r = await exportOpenTabs(false, false);
  /**
   * 0.5.0：逐个站点看「这个站点的首轮遍历跑过没有」，跑过的站点跳过、没跑过的补上。
   * 遍历所有受支持站点的已打开 tab（原来只跑第一个 → 豆包标签页从来没被遍历）。
   * 0.5.1：每站点每轮只采一批，没采完的 30 秒后由续采 alarm 接着跑。
   */
  var hist = await runHistorySites();
  r.exported += hist.exported;
  r.historyMessage = hist.messages.join(' ');
  if (hist.pending > 0) scheduleHistoryContinue();
  /**
   * A（0.5.5）：不管有没有产出都留一条账。
   * 「全部无新增」也要写——用户要能区分「插件没跑」和「跑了但没新增」。
   */
  await noteAutoRound({
    source: 'alarm',
    tabs: r.scanned,
    exported: r.exported,
    failed: r.failed,
    skipped: r.skipped,
    historyExported: hist.exported,
    historyPending: hist.pending,
    historySites: hist.sites
  });
  if (r.exported === 0 && r.failed === 0 && !r.historyMessage) return r;
  var task = await beginTask('auto');
  var msg = '自动导出：' + r.message + (r.historyMessage ? ' ' + r.historyMessage : '');
  await endTask(task.id, r.failed > 0 ? 'failed' : 'done', msg);
  return r;
}

/**
 * B（0.5.5）：用户无操作时补跑历史会话。
 *
 * 解决什么问题：0.5.4 之前每个站点只自动遍历**一次**，之后 `historyDoneAt:v2:<站点>`
 * 永久生效 → 用户不主动打开某个会话，它就永远进不了库
 * （2026-11-17 用户质疑「DeepSeek 历史会话没全部导出」的来源之一）。
 *
 * 三道约束（缺一条就会变成「凭空劫持用户页面」）：
 *   ① 只在 `chrome.idle` 报 idle（连续 60 秒无操作）时跑；
 *   ② 每个站点至少隔 6 小时才补一次；
 *   ③ `chrome.idle` 不可用（老内核 / 没授 idle 权限）→ **一律不补跑**，宁可不跑。
 */
async function refreshHistoryWhenIdle() {
  var state = await queryIdleState();
  if (state === null) return { ok: false, skipped: 'no_idle_api' };
  if (state !== 'idle') return { ok: false, skipped: 'not_idle', state: state };
  var hist = await runHistorySites({ ignoreDone: true, respectRefreshGap: true });
  if (hist.pending > 0) scheduleHistoryContinue();
  await noteAutoRound({
    source: 'idle',
    historyExported: hist.exported,
    historyPending: hist.pending,
    historySites: hist.sites
  });
  return { ok: true, exported: hist.exported, pending: hist.pending, messages: hist.messages };
}

/**
 * 导出全部历史对话（对全部支持站点生效：DeepSeek / 豆包 / Kimi / 千问等通用遍历逻辑）：
 * content script 遍历侧栏会话逐个打开提取，每条经 EXPORT_HISTORY_ITEM 边遍历边交付
 * （直推优先、下载兜底）——中途导航被打断也不丢已导出的。
 * hostTabId 可选：自动轮传首轮会指定一个已打开的受支持 tab 当宿主；
 * 不传时用当前活跃 tab（弹窗按钮场景）。跳过的每一条都带原因，不静默。
 */
async function exportHistory(hostTabId, siteKeyHint) {
  var tab = null;
  if (typeof hostTabId === 'number') {
    var tabs = await chrome.tabs.query({});
    for (var t = 0; t < tabs.length; t++) {
      if (tabs[t] && tabs[t].id === hostTabId) { tab = tabs[t]; break; }
    }
    if (!tab || !core.matchSite(tab.url || '')) {
      return { ok: false, traversed: false, message: '指定的对话页不在支持列表。' };
    }
  } else {
    var activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTabs && activeTabs[0];
  }
  if (!tab || !tab.id) return { ok: false, traversed: false, message: '没有可导出的对话页：请先打开一个受支持站点的对话页。' };
  var tabSite = core.matchSite(tab.url || '');
  if (!tabSite) {
    return { ok: false, message: '当前网站不在支持列表：请打开 ' + SITES_HINT + ' 的对话页。' };
  }
  var siteKey = siteKeyHint || tabSite.key;
  // 断点：上一轮已经处理过的会话标题（这一轮直接跳过，不再点开）
  var progress = await readHistoryProgress(siteKey);
  await markHistoryRunning(siteKey);
  var task = await beginTask('history');
  try {
    var sent = await askTab(tab.id, {
      type: 'EXPORT_HISTORY',
      waitMs: HISTORY_WAIT_MS,
      budgetMs: HISTORY_BUDGET_MS,
      skipLabels: progress.labels,
      maxItems: HISTORY_BATCH
    });
    if (!sent.ok) {
      await endTask(task.id, 'failed', sent.reason);
      return { ok: false, traversed: false, message: sent.reason };
    }
    var res = sent.res;
    if (!res || !res.ok) {
      var msg = res && res.reason ? res.reason : '历史对话读取失败（页面未响应，可刷新后重试）。';
      await endTask(task.id, 'failed', msg);
      return { ok: false, traversed: false, message: msg };
    }
    var delivered = Number(res.delivered) || 0;
    var viaHost = Number(res.viaHost) || 0;
    var viaDl = Number(res.viaDl) || 0;
    var duplicated = Number(res.duplicated) || 0;
    var skipped = Array.isArray(res.skipped) ? res.skipped : [];
    var siteLabel = res.siteLabel || '';
    var processed = Array.isArray(res.processedLabels) ? res.processedLabels : [];
    var more = res.more === true;
    /**
     * 0.5.5：侧栏本轮识别到的会话条目数。这是「导全了没有」的**分母**——
     * 只报「导出 N 份」永远答不了「是不是漏了」，用户 2026-11-17 质疑的正是这件事。
     */
    var sidebarItems = Number(res.sidebarItems) || 0;
    // 续采断点：把本轮处理过的标题并进进度，下一轮跳过它们
    if (more) {
      // 0.5.5：断点是**多重集**（同名会话各占一格），所以这里直接接上，不能再按标题去重
      var merged = progress.labels.concat(processed);
      await writeHistoryProgress(siteKey, merged);
    } else {
      await clearHistoryProgress(siteKey);
    }
    var message = (siteLabel ? siteLabel + ' ' : '') + '历史对话导出 ' + delivered + ' 份（直写应用 ' + viaHost
      + ' 份 / 下载目录 ' + viaDl + ' 份）；遍历跳过 ' + skipped.length + ' 条';
    if (skipped.length > 0 && skipped[0] && skipped[0].reason) {
      message += '（如：「' + (skipped[0].title || '无标题') + '」' + skipped[0].reason + '）';
    }
    // 0.5.0：内容已见过就跳过（不重复落盘）。跳过的条数要报出来，别让用户以为漏导了。
    if (duplicated > 0) {
      message += '；其中 ' + duplicated + ' 条内容此前已导出过，本次跳过';
    }
    // 0.5.5：把「分母」报出来，用户才能自己判断有没有漏
    if (sidebarItems > 0) {
      message += '；本轮侧栏识别到 ' + sidebarItems + ' 条会话（已处理 ' + processed.length + ' 条）';
    }
    // 0.5.1：分批采（每轮 HISTORY_BATCH 条），剩下的 30 秒后接着来，别让 SW 撑不住
    if (more) {
      message += '；本轮处理 ' + processed.length + ' 条，还有未采完的会话，30 秒后自动接着采';
    } else {
      message += '。历史导出不判增量，重复内容入库时自动去重。';
    }
    await endTask(task.id, delivered > 0 || more ? 'done' : 'failed', message);
    /**
     * ok / traversed / more 三者含义不同，别混：
     *   · ok        = 这一趟有产出（用户看「导出了几份」）
     *   · traversed = 侧栏**整个遍历完了**（不是只采了一批）
     *   · more      = 还有没采完的，30 秒后接着来
     * 不区分的话，「全都被去重跳过 → delivered 0」会被当成失败 → 自动轮询
     * 每 5 分钟重跑一遍遍历，正是旧版本「反复劫持用户页面」的复现路径。
     */
    return {
      ok: delivered > 0,
      traversed: !more,
      more: more,
      message: message,
      deliveredCount: delivered,
      duplicatedCount: duplicated
    };
  } catch (e) {
    var failedMsg = '历史对话导出未成功：' + errText(e);
    await endTask(task.id, 'failed', failedMsg);
    return { ok: false, traversed: false, message: failedMsg, deliveredCount: 0 };
  } finally {
    // 不管成功失败都要摘掉「正在跑」标记，否则这个站点会被自己挡 3 分钟
    await clearHistoryRunning(siteKey);
  }
}

// ─── 清空旧导出并重新导出（0.5.3） ────────────────────────────────────────────
//
// 为什么必须「先清空」（2026-11-17 用户明确要求）：
//   · 抽取层补上结构（列表符号 / 代码围栏 / 表格 / 行内标记）之后，同一段对话抽出来的
//     文本变了 → 内容指纹（sig）也变了 → 去重账全部对不上 → 重导会在导出目录里
//     再落一份（时间戳不同、内容不同）→ 用户看到「一个会话几份文件」。
//   · 只清插件去重账，文件会越堆越多；只清文件，插件又认为「导过了」不再导出。
// 所以清空是一次原子动作：应用侧删旧 md + 插件侧重置去重账与历史进度。

/** 需要一起重置的账本键前缀（漏一个就会出现「清了文件但插件记得导过」的错位） */
var SIG_ACCOUNT_PREFIXES = [
  'webchatExporter:sig:v2:',
  'webchatExporter:historyDoneAt:',   // 同时覆盖 v1 与 v2（v2 前缀包含在内）
  'webchatExporter:historyProgress:v1:',
  'webchatExporter:historyStreak:v1:',
  'webchatExporter:historyRunning:v1:',
  // 0.5.5：不清这一项，重置后 6 小时内空闲补跑会被节流挡住
  'webchatExporter:historyRefreshAt:v1:',
  // 0.5.5：内容级去重账（不清的话「清空并重新导出」会被它整批挡成跳过）
  'webchatExporter:contentKey:v1:'
];
var CLEAR_TIMEOUT_MS = 15000;

/** 让应用把导出目录里的旧 md 删掉。失败就中止整件事——只清账不清文件必然产生重复文件。 */
async function callHostClear() {
  var rt = await readRuntime();
  if (!rt) {
    return {
      ok: false,
      reason: '读不到 runtime.json：' + (lastRuntimeError || '插件目录里没有这个文件')
        + '（应用没启动过，或插件目录不是应用同步出来的那个）'
    };
  }
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CLEAR_TIMEOUT_MS) : null;
  try {
    var res = await fetch('http://127.0.0.1:' + rt.port + '/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + rt.token },
      body: JSON.stringify({ audit: true }),
      signal: ctrl ? ctrl.signal : undefined
    });
    var j = null;
    try { j = await res.json(); } catch { j = null; }
    if (res.ok && j && j.ok) {
      return {
        ok: true,
        deleted: Number(j.deleted) || 0,
        deletedAudit: Number(j.deletedAudit) || 0,
        sites: Array.isArray(j.sites) ? j.sites : []
      };
    }
    return { ok: false, reason: (j && j.error) || ('本机接收端返回 HTTP ' + res.status) };
  } catch (e) {
    return { ok: false, reason: errText(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 重置扩展 storage 里的去重账。
 * 用「写空值」而不是 remove()：任何只实现 get/set 的环境（含单测替身）都能跑，
 * 而所有读口判的都是真值（`if (stored && stored[key])`），空值等价于「没记过」。
 */
async function clearExportAccounts() {
  var cleared = 0;
  try {
    var all = await chrome.storage.local.get(null);
    if (!all || typeof all !== 'object') return 0;
    var patch = {};
    for (var k in all) {
      if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
      var hit = false;
      for (var i = 0; i < SIG_ACCOUNT_PREFIXES.length; i++) {
        if (k.indexOf(SIG_ACCOUNT_PREFIXES[i]) === 0) { hit = true; break; }
      }
      if (!hit) continue;
      patch[k] = k.indexOf(HISTORY_PROGRESS_PREFIX) === 0 ? { labels: [], at: Date.now(), cleared: true } : '';
      cleared += 1;
    }
    if (cleared > 0) await chrome.storage.local.set(patch);
  } catch {
    /* 读不到整本账就当没清：调用方会把条数报成 0，不假装清过 */
  }
  return cleared;
}

/** 清掉 0.3.0 写在页面 localStorage 里的 v1 旧指纹（不清会命中「无新增」而跳过重导） */
async function clearPageLegacySig() {
  var tabs = await findSupportedTabs();
  var removed = 0;
  for (var i = 0; i < tabs.length; i++) {
    try {
      var sent = await askTab(tabs[i].id, { type: 'CLEAR_LEGACY_SIG' });
      var res = sent && sent.ok ? sent.res : null;
      if (res && res.ok && typeof res.cleared === 'number') removed += res.cleared;
    } catch {
      /* 某个站点页读不到 localStorage 不影响其它站点 */
    }
  }
  return removed;
}

/**
 * 清空旧导出 → 重置去重账 → 立刻重新遍历历史会话。
 * 三步缺一不可：缺第一步会留重复文件，缺第二步重导不出来，缺第三步用户还得再点一次。
 */
async function resetExportsAndReexport() {
  var cleared = await callHostClear();
  if (!cleared.ok) {
    return {
      ok: false,
      message: '没有清空旧导出：' + (cleared.reason || '未知原因')
        + '。为避免「只清账不清文件」导致重导出重复文件，本次已中止——请启动应用后重试。'
    };
  }
  var accounts = await clearExportAccounts();
  var legacy = await clearPageLegacySig();
  var hist = await runHistorySites();
  var msg = '已清空旧导出 ' + cleared.deleted + ' 份（' + cleared.sites.length + ' 个站点目录）'
    + (cleared.deletedAudit > 0 ? '、审计快照 ' + cleared.deletedAudit + ' 份' : '')
    + '；已重置去重账 ' + accounts + ' 项、页面旧指纹 ' + legacy + ' 条。';
  if (hist.exported > 0) msg += ' 已重新导出 ' + hist.exported + ' 份。';
  if (hist.messages.length > 0) msg += ' ' + hist.messages.join(' ');
  if (hist.pending > 0) {
    scheduleHistoryContinue();
    msg += ' 还有未采完的会话，30 秒后自动接着采（页面会自己切换，别关对话页）。';
  }
  return { ok: true, message: msg };
}

/** 续采：上一轮没采完的站点，30 秒后接着跑（由 alarm 触发） */
async function continueHistory() {
  try {
    var hist = await runHistorySites();
    if (hist.pending > 0) scheduleHistoryContinue();
  } catch {
    /* 续采失败不影响任何已导出的内容，下一轮 5 分钟巡检会再试 */
  }
}

chrome.runtime.onInstalled.addListener(function () { void ensureAlarm(); void ensureHistoryRefreshAlarm(); });
chrome.runtime.onStartup.addListener(function () { void ensureAlarm(); void ensureHistoryRefreshAlarm(); });
void ensureAlarm();
void ensureHistoryRefreshAlarm();

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (!alarm) return;
  if (alarm.name === HISTORY_CONTINUE_ALARM) { void continueHistory(); return; }
  // B：每小时问一次「用户在不在动」，在动就什么都不做
  if (alarm.name === HISTORY_REFRESH_ALARM) { void refreshHistoryWhenIdle(); return; }
  if (alarm.name !== AUTO_ALARM) return;
  void autoRound();
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return false;
  if (msg.type === 'GET_STATUS') {
    void (async function () {
      var tasks = await readTasks();
      // 顺带探一次本机接收端：弹窗一打开就能看到「这次导出会不会直写成功」，
      // 不用等导出失败后再猜原因
      var host = await probeHost();
      // A：把「最近一轮巡检」的账一起带回去，弹窗据此显示「最近检查 22:20 · 无新增」
      var lastAuto = await readLastAuto();
      var idle = await queryIdleState();
      sendResponse({
        ok: true,
        autoMinutes: AUTO_MINUTES,
        refreshMinutes: HISTORY_REFRESH_MINUTES,
        refreshMinGapHours: Math.round(HISTORY_REFRESH_MIN_GAP_MS / 3600000),
        idleSeconds: IDLE_SECONDS,
        idle: idle,
        lastAuto: lastAuto,
        sites: core.SITES.map(function (s) { return s.label; }),
        tasks: tasks,
        runningCount: core.runningTasks(tasks).length,
        notice: core.unfinishedNotice(tasks),
        host: host
      });
    })();
    return true;
  }
  if (msg.type === 'EXPORT_CURRENT') {
    void exportCurrentTab(msg.force === true).then(sendResponse);
    return true;
  }
  if (msg.type === 'EXPORT_ALL') {
    void exportOpenTabs(msg.force === true, true).then(function (r) {
      sendResponse({ ok: r.ok, message: r.message });
    });
    return true;
  }
  if (msg.type === 'EXPORT_HISTORY') {
    void exportHistory().then(sendResponse);
    return true;
  }
  if (msg.type === 'RESET_EXPORTS') {
    // 只有这一个入口会删文件：清空导出目录里的旧 md + 重置去重账 + 立刻重导
    void resetExportsAndReexport().then(sendResponse);
    return true;
  }
  if (msg.type === 'EXPORT_HISTORY_ITEM') {
    // 历史遍历中每条会话的交付：直推优先、下载兜底，回执 {ok, via, file, reason}
    void (async function () {
      var payload = msg.payload;
      if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
        sendResponse({ ok: false, reason: '这条会话没有可交付的内容' });
        return;
      }
      try {
        /**
         * 0.5.5：内容级去重（先查这个，再查路径键）。
         *
         * 2026-11-17 豆包实测：57 份导出里 42 份是同一个会话。
         * 路径键（sigKey 用 pathname）挡不住它——旧内容被记到了新路径上，
         * 后台一看「这个路径没导过」就又落一份。内容键与路径无关，同内容只落一次。
         */
        if (payload.contentKey && await readStoredSig(payload.contentKey)) {
          if (payload.label) await appendHistoryProgress(payload.site, payload.label);
          sendResponse({ ok: true, via: 'skip', duplicate: true, file: '' });
          return;
        }
        /**
         * 0.5.0：先查「见过没有」，见过就跳过不交付。
         * 为什么历史遍历也要查：0.3.0 → 0.5.0 升级后扩展 storage 里没有旧账，
         * 而历史遍历本来就不判增量 → 每轮都把全部历史会话重导一遍
         * （实测：DeepSeek 多 30 份、豆包多 1 份，用户看到「豆包 2 个重复下载」）。
         * 查 v2 账（0.4.0+ 交付成功后写的）能挡住重复轮次；
         * 查 v1 旧账（0.3.0 页面 localStorage）能挡住「升级后第一轮」。
         */
        if (await seenSigAlready(payload.sigKey, payload.sig, payload.legacySig)) {
          // 旧账命中 → 顺手迁到 v2，之后连旧账都不用再读
          if (payload.legacySig && payload.legacySig === payload.sig && payload.sigKey) {
            await writeStoredSig(payload.sigKey, payload.sig);
          }
          // 0.5.2：已见也把这条记进断点，下一轮不再点它
          if (payload.label) await appendHistoryProgress(payload.site, payload.label);
          sendResponse({ ok: true, via: 'skip', duplicate: true, file: '' });
          return;
        }
        var out = await deliverMarkdown(payload);
        // 交付成功才记账：这条会话以后不会被当成「新增」再导一遍
        await writeStoredSig(payload.sigKey, payload.sig);
        // 0.5.5：内容键一起记（同一段对话换了路径也不会再落一份）
        if (payload.contentKey) await writeStoredSig(payload.contentKey, '1');
        // 0.5.2：断点逐条落盘——这是「SW 被杀也不丢进度」的唯一保证。
        // 只在成功后记：失败的那条必须留着重试，不能提前判「已处理」。
        if (payload.label) await appendHistoryProgress(payload.site, payload.label);
        sendResponse({ ok: true, via: out.via, file: out.file, fallbackReason: out.fallbackReason });
      } catch (e) {
        sendResponse({ ok: false, reason: errText(e) });
      }
    })();
    return true;
  }
  return false;
});
