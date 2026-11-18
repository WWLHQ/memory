// MCP 客户端接入面板（批次15 建 / 批次21 交互收敛 / 批次23 一键适配全部 + 逐客户端接通指引）：
// 把「🧠 提示行 + 四段折叠明细」推广到所有已接入 Agent。
// 状态来自主进程读取本机配置与安装痕迹（mcp:clients）；只显示本机真实检出的客户端，
// 未安装的不占位。片段/一键写入需管理员（主进程二次校验）。
// 无法自动写入的客户端不再只显示「未连通/需配置」：按客户端给出设置菜单/配置文件/条目名/端点与修复步骤。
// 浏览器模式（无宿主桥）如实降级：只说明无法扫描，绝不伪造「已接入」或客户端列表。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { MCP_CLIENT_HEADER_NAME, MCP_ENDPOINT, specOfMcpClient, type McpWireState } from '../../agentOnboard/mcpClients.ts';
import type { BadgeClass } from '../../types/agentOnboard.ts';
import { currentSessionId, useSessionContext } from '../shared/session.ts';
import { MCP_MANUAL_HINT, MCP_SWITCH_POLL_MS } from '../shared/mcpSwitch.ts';
import { listMcpPending, markMcpPending, subscribeMcpPending } from '../shared/mcpPending.ts';

interface ClientRow {
  id: string;
  name: string;
  badge: BadgeClass;
  format: string;
  writable: boolean;
  displayPath: string | null;
  installed: boolean;
  state: McpWireState;
  hasAuth: boolean;
  /** 条目承载方式：stdio=配置里只有启动命令（令牌零维护）/ http=令牌抄在配置里（轮换需重写） */
  transport?: 'http' | 'stdio';
  /** 2026-11-18 实测连通：拿本客户端配置里的令牌真调一次 tools/list 的结果（无文件面时缺省） */
  live?: { ok: boolean; status: number; tools?: number; error?: string; at: number };
  /** 令牌与当前 mcp-token.txt 的关系；stale=配置里的令牌已失效（401） */
  tokenState?: 'live' | 'stale' | 'unknown';
  /** 批次41-X：配置里是否带显式身份头；false = 已接入但缺身份头（可点「补身份头」） */
  hasClientId?: boolean;
  /** 客户端应用内把本服务标成已禁用（显式 true 才有）；T3 接入页据此显示「客户端已关闭」 */
  disabled?: boolean;
  /** 客户端软件当前是否在运行（T6）；仅桌面客户端有值，CLI 无值 → 不显示 */
  running?: boolean;
  foundUrl?: string;
  rulesHint: string;
  note?: string;
  error?: string;
}

interface ScanReply {
  endpoint: string;
  home?: string;
  scannedAt?: number;
  clients: ClientRow[];
  /** 实测连通汇总：服务端自身的探测结果 + 探了几个、几个不通 */
  live?: {
    at: number; checked: number; failed: number;
    server?: { ok: boolean; status: number; tools?: number; error?: string; at: number };
  };
}

interface WireReply {
  ok: boolean;
  changed?: boolean;
  path?: string;
  backupPath?: string;
  error?: string;
}

const STATE_LABEL: Record<McpWireState, { text: string; cls: string }> = {
  wired: { text: '已接入', cls: 'pill on' },
  missing_auth: { text: '缺令牌（调用会 401）', cls: 'pill gold' },
  missing_entry: { text: '未配置本服务', cls: 'pill' },
  conflict: { text: '冲突：同名条目指向其它端点', cls: 'pill red' },
  invalid: { text: '配置无法解析', cls: 'pill red' },
  no_config: { text: '无配置文件（可新建）', cls: 'pill' },
  manual: { text: '需手工添加', cls: 'pill' },
};

/** 每个状态下一步该做什么（无法自动写入时也给出具体位置，避免用户猜） */
const STATE_HINT: Record<McpWireState, string> = {
  wired: '无需操作；重启该客户端后即可使用记忆提示',
  missing_auth: '补齐 Authorization 请求头（写前备份原文件）',
  missing_entry: '写入本服务条目（可自动写入，写前备份）',
  conflict: '同名条目指向其它端点：改成当前端点或删除该条目后刷新',
  invalid: '配置文件无法解析：先手工修复，再点「刷新状态」',
  no_config: '自动新建配置文件并写入本服务条目',
  manual: '无稳定配置路径：复制片段后按下方指引在客户端设置中粘贴',
};

/** 批次41-X：「已接入但缺显式身份头」——状态仍是 wired（调用能通），只是服务端认不出这是哪一家。
 *  这类行需要允许重新写入（补头），所以不能因 state==='wired' 就锁死按钮。 */
function needsClientId(row: ClientRow): boolean {
  return row.state === 'wired' && row.hasClientId === false;
}

/** 能否切到 stdio（零维护形态）：可写、配置没坏、且还不是 stdio */
function canStdio(row: ClientRow): boolean {
  return row.writable && row.transport !== 'stdio' && row.state !== 'conflict' && row.state !== 'invalid';
}

/** 传输形态徽标：stdio = 配置里没有令牌（轮换零维护）；http = 令牌抄在配置里（轮换要重写） */
function transportBadge(row: ClientRow): { text: string; cls: string; title: string } | null {
  if (row.transport === 'stdio') {
    return {
      text: 'stdio 零维护', cls: 'pill on',
      title: '配置里只有启动命令（node <桥接脚本> <引导指针> <端点> <客户端id>），没有任何令牌。'
        + '桥接脚本每次调用现读数据根的 keys/mcp-token.txt：令牌轮换、数据根搬家都不需要改这份配置。',
    };
  }
  if (row.transport === 'http') {
    return {
      text: 'HTTP', cls: 'pill',
      title: '令牌（Bearer）被抄进了这份客户端配置：令牌一轮换它就会 401，必须重写配置。点「改用 stdio」可改成零维护形态。',
    };
  }
  return null;
}

/**
 * 实测连通徽标（2026-11-18）：只认 HTTP 状态码，不认"配置文件里看着像"。
 * 无文件面的客户端（Zcode/DSH 这类配置存应用内部）如实显示「—」，绝不拿现役令牌冒充它的连通性。
 */
function liveBadge(row: ClientRow): { text: string; cls: string; title: string } {
  const live = row.live;
  if (!live) {
    return {
      text: '实测 —', cls: 'pill',
      title: '该客户端没有稳定配置文件（或配置由客户端应用托管），读不到它自己的令牌、无法实测；用「复制片段」接入后以客户端日志为准',
    };
  }
  const when = `${formatClock(live.at)}（UTC+08:00）`;
  if (live.ok) {
    return {
      text: `实测 ✓ ${live.tools ?? '?'} 工具`, cls: 'pill on',
      title: `用本客户端配置里的令牌调用 tools/list：HTTP ${live.status}，返回 ${live.tools ?? '?'} 个工具 · ${when}`,
    };
  }
  const why = live.status === 401
    ? '令牌已失效（401）：配置里的令牌与当前 mcp-token.txt 不一致'
    : live.status === 0
      ? (live.error ?? '连接失败（服务未启动？）')
      : `HTTP ${live.status}${live.error ? `：${live.error}` : ''}`;
  return { text: `实测 ✗ ${live.status || '不可达'}`, cls: 'pill red', title: `${why} · ${when}` };
}

function specOf(id: string) {
  try {
    return specOfMcpClient(id);
  } catch {
    return null;
  }
}

/**
 * 逐客户端接通指引（批次23）：给出具体位置（设置菜单/配置文件）、条目名、端点与修复步骤。
 * 不自动写入的客户端也必须告诉用户在哪个设置里填什么，而不是只显示「需配置」。
 */
function guideFor(row: ClientRow, endpoint: string): string {
  const spec = specOf(row.id);
  const where = spec?.connectHint ?? row.displayPath ?? `${row.name} 设置`;
  const path = row.displayPath ?? '客户端设置（无稳定配置文件）';
  const key = spec?.serverKey ?? 'MultiAgent Memory';
  switch (row.state) {
    case 'wired':
      if (row.transport === 'stdio') {
        return '已用 stdio 零维护形态接入：配置里只有启动命令（令牌不在其中），桥接脚本每次调用现读令牌——令牌轮换、数据根搬家都不用改这份配置，重启客户端即生效';
      }
      if (!needsClientId(row)) {
        // 只在配置文件真读到该头时才声称「已写入」；无文件面的客户端（如审计证据升级来的 wired）无从判定，不谎报
        return row.hasClientId === true
          ? `${STATE_HINT.wired}（身份头 ${MCP_CLIENT_HEADER_NAME} 已在配置中确认）`
          : STATE_HINT.wired;
      }
      return row.writable
        ? `点本行「补身份头」：自动备份后给 ${where} 的 ${key} 条目补请求头 ${MCP_CLIENT_HEADER_NAME}: ${row.id}（写前备份，令牌与身份头都不落日志）`
        : `打开 ${where}，在 ${key} 条目补请求头 ${MCP_CLIENT_HEADER_NAME}: ${row.id}（点「复制片段」获取，保存后点「刷新状态」）`;
    case 'missing_auth':
      return row.writable
        ? `点本行「补齐令牌」：自动备份后写入 ${where} 的 Authorization 与身份头 ${MCP_CLIENT_HEADER_NAME}: ${row.id}（令牌一次性下传，不落日志）`
        : `打开 ${where}，在 ${key} 条目补请求头 Authorization: Bearer <令牌> 与 ${MCP_CLIENT_HEADER_NAME}: ${row.id}（点「复制片段」获取）`;
    case 'missing_entry':
    case 'no_config':
      return row.writable
        ? `点本行「一键接入」或顶部「⚡ 一键适配全部」：自动备份后写入 ${where}（条目 ${key}，端点 ${endpoint}，请求头含身份头 ${MCP_CLIENT_HEADER_NAME}: ${row.id}）`
        : `打开 ${where}，新增 HTTP MCP 服务器：名称 ${key}，URL ${endpoint}，请求头 Authorization: Bearer <令牌> 与 ${MCP_CLIENT_HEADER_NAME}: ${row.id}（点「复制片段」或「一键适配全部」生成）`;
    case 'conflict':
      return `打开 ${path}，把 ${key} 条的 URL 从 ${row.foundUrl ?? '其它端点'} 改成 ${endpoint}（或删除该条目），保存后点「刷新状态」，再点「一键接入」`;
    case 'invalid': {
      const kind = spec?.format === 'toml' ? 'TOML' : spec?.format === 'json' ? 'JSON' : '配置文件';
      return `打开 ${where} 修复 ${kind} 语法${row.error ? `（${row.error}）` : ''}，保存后点「刷新状态」；修复前系统拒绝写入，避免改坏配置`;
    }
    case 'manual':
    default:
      return `打开 ${where}，新增 HTTP MCP 服务器：名称 ${key}，URL ${endpoint}，请求头 Authorization: Bearer <令牌> 与 ${MCP_CLIENT_HEADER_NAME}: ${row.id}（点「复制片段」或「一键适配全部」生成片段）`;
  }
}

/** 用户可见时间统一 UTC+08:00（扫描时间戳是 epoch） */
function formatClock(ts: number): string {
  const d = new Date(ts + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function McpClientsPanel({ onInstalledCount }: { onInstalledCount?: (n: number) => void } = {}) {
  const session = useSessionContext();
  const capability = hostCapability();
  const [scan, setScan] = useState<ScanReply | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  /** ①待生效来自共享信号（首页/接入页/壳层同源），不再用本地 Record */
  const [pendingList, setPendingList] = useState<string[]>(() => listMcpPending());
  /** 手动打开提示的行内展开（提示就显示在该客户端按钮旁，不甩到页面最底部） */
  const [manualHintId, setManualHintId] = useState('');
  /** 循环检测：上一轮的实测失败数，用于"由好变坏"时提示一次（不至于每 12 秒刷屏） */
  const lastFailedRef = useRef(0);

  const refresh = useCallback((opts: { announce?: boolean; silent?: boolean } = {}) => {
    if (capability === 'none') return Promise.resolve();
    // silent = 后台轮询：不置 scanning，避免每 12 秒把按钮闪一次禁用态
    if (!opts.silent) setScanning(true);
    return hostCall<ScanReply>('mcp:clients', [currentSessionId()])
      .then((r) => {
        setScan(r);
        setScanError('');
        if (opts.announce) {
          const n = r.clients.filter((c) => c.installed).length;
          const at = typeof r.scannedAt === 'number' ? formatClock(r.scannedAt) : formatClock(Date.now());
          setMessage(`已重新扫描：检出 ${n} 个已安装客户端 · ${at}（UTC+08:00）`);
        }
        // 循环检测：实测失败数「由 0 变正」→ 主动提示（令牌轮换/服务未起都会走到这里；
        // 只有真调过 tools/list 才算数，state=已接入但 401 的历史坑就是靠这条暴露的）。
        const failed = r.live?.failed ?? 0;
        if (failed > 0 && lastFailedRef.current === 0) {
          const at = typeof r.live?.at === 'number' ? formatClock(r.live.at) : formatClock(Date.now());
          setMessage(`⚠ 实测连通异常（${at}，UTC+08:00）：${failed} 个客户端用自己配置里的令牌调不通`
            + `（服务端${r.live?.server?.ok ? '自身正常' : '也不通'}）——点该行「补齐令牌」或右上「⚡ 一键适配全部」修复`);
        }
        lastFailedRef.current = failed;
      })
      .catch((e) => {
        const reason = String((e as Error)?.message ?? e);
        setScan(null);
        setScanError(reason);
        if (opts.announce) setMessage(`重新扫描失败：${reason}`);
      })
      .finally(() => { if (!opts.silent) setScanning(false); });
  }, [capability]);

  useEffect(() => { void refresh(); }, [refresh]);

  // T3 落点② 同步：与首页/壳层同口径 12 秒静默轮询，避免「首页已红、接入页仍绿」的不一致
  useEffect(() => {
    if (capability === 'none') return;
    const t = setInterval(() => {
      void refresh({ silent: true });
      setPendingList(listMcpPending()); // ①过期待生效自动掉
    }, MCP_SWITCH_POLL_MS);
    return () => clearInterval(t);
  }, [capability, refresh]);

  // ①其它落点改了待生效信号 → 本页立刻跟上
  useEffect(() => subscribeMcpPending(() => setPendingList(listMcpPending())), []);

  /** 只展示本机真实检出（配置文件存在或安装痕迹命中）的客户端 */
  const rows = useMemo<ClientRow[]>(
    () => (scan ? scan.clients.filter((r) => r.installed) : []),
    [scan],
  );

  /** 页签计数 = 本机真实检出的已安装客户端数（未知/浏览器模式为 0，不冒充定稿的 6） */
  useEffect(() => { onInstalledCount?.(rows.length); }, [rows.length, onInstalledCount]);

  /** 七态总览：把 McpWireState 的七个真实状态全部列出（未出现的状态如实显示 0） */
  const stateCounts = useMemo<Record<McpWireState, number>>(() => {
    const init: Record<McpWireState, number> = {
      wired: 0, missing_auth: 0, missing_entry: 0, conflict: 0, invalid: 0, no_config: 0, manual: 0,
    };
    for (const r of rows) init[r.state] += 1;
    return init;
  }, [rows]);

  const copySnippet = (row: ClientRow) => {
    if (!session.sid) { setMessage('请先登录后再复制（HTTP 片段含令牌）'); return; }
    const id = row.id;
    // stdio 形态的片段里没有令牌，复制/外发都安全；http 形态仍是一次性展示的含令牌片段
    const stdio = row.transport === 'stdio';
    setBusy(`snippet:${id}`);
    hostCall<{ ok: boolean; snippet?: string; error?: string }>(
      'mcp:clientSnippet', stdio ? [id, session.sid, 'stdio'] : [id, session.sid],
    )
      .then(async (r) => {
        if (!r.ok || !r.snippet) { setMessage(`片段生成失败：${r.error ?? '未知原因'}`); return; }
        setSnippets((prev) => ({ ...prev, [id]: r.snippet! }));
        try {
          await navigator.clipboard.writeText(r.snippet);
          setMessage(stdio
            ? '已复制 stdio 启动命令片段（不含令牌，可安全转发）；粘贴到客户端配置后重启生效'
            : '已复制（含令牌，请勿外传）；粘贴到客户端配置后重启生效');
        } catch {
          setMessage('浏览器拒绝剪贴板：请在下方片段框中手动复制');
        }
      })
      .catch((e) => setMessage(`片段生成失败：${String((e as Error)?.message ?? e)}`))
      .finally(() => setBusy(''));
  };

  const wire = (row: ClientRow) => {
    if (!session.sid) { setMessage('请先登录后再写入配置'); return; }
    setBusy(`wire:${row.id}`);
    hostCall<WireReply>('mcp:clientWire', [row.id, session.sid])
      .then((r) => {
        if (!r.ok) { setMessage(`写入失败：${r.error ?? '未知原因'}`); return; }
        const headerOnly = row.state === 'wired';
        setMessage(r.changed
          ? `${headerOnly ? `已为 ${row.name} 补写身份头 ${MCP_CLIENT_HEADER_NAME}` : `已写入 ${row.name}`}${r.backupPath ? `（原文件已备份：${r.backupPath}）` : ''}；请重启该客户端后验证提示行`
          : `${row.name} 已是最新，未改动`);
        return refresh();
      })
      .catch((e) => setMessage(`写入失败：${String((e as Error)?.message ?? e)}`))
      .finally(() => setBusy(''));
  };

  /**
   * 改用 stdio（2026-11-18）：把配置从「令牌抄在配置里」改成「只写启动命令」。
   * 桥接脚本由主进程写到引导指针同目录（数据根搬家也不动），令牌每次现读 → 轮换零维护。
   * 与 HTTP 一键接入同一条写入路径：先备份原文件、冲突/无法解析一律拒绝。
   */
  const toStdio = async (row: ClientRow) => {
    if (!session.sid) { setMessage('请先登录后再写入配置'); return; }
    setBusy(`stdio:${row.id}`);
    try {
      const r = await hostCall<WireReply>('mcp:clientWire', [row.id, session.sid, 'stdio']);
      if (!r.ok) { setMessage(`改用 stdio 失败：${r.error ?? '未知原因'}`); return; }
      setMessage(r.changed
        ? `${row.name} 已改用 stdio 零维护形态${r.backupPath ? `（原配置已备份：${r.backupPath}）` : ''}：`
          + '配置里不再有令牌，令牌轮换/数据根搬家都不用重写；请重启该客户端后验证提示行'
        : `${row.name} 已是 stdio 形态，未改动`);
      await refresh();
    } catch (e) {
      setMessage(`改用 stdio 失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy('');
    }
  };

  /** 全部改用 stdio：对所有可写、且还不是 stdio 的客户端逐个改写（冲突/无法解析跳过并如实列出） */
  const toStdioAll = async () => {
    if (!session.sid) { setMessage('请先登录后再写入配置'); return; }
    const targets = rows.filter(canStdio);
    if (targets.length === 0) { setMessage('没有需要改写的客户端：可写的都已经是 stdio 形态了'); return; }
    setBusy('stdio-all');
    const failed: string[] = [];
    let changed = 0;
    let unchanged = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      setMessage(`⇄ 正在改用 stdio：${i + 1}/${targets.length} · ${row.name}…`);
      try {
        const r = await hostCall<WireReply>('mcp:clientWire', [row.id, session.sid, 'stdio']);
        if (!r.ok) failed.push(`${row.name}（${r.error ?? '未知原因'}）`);
        else if (r.changed) changed += 1;
        else unchanged += 1;
      } catch (e) {
        failed.push(`${row.name}（${String((e as Error)?.message ?? e)}）`);
      }
    }
    setMessage(
      `⇄ 改用 stdio 完成：改写 ${changed} 个 · 已是 stdio ${unchanged} 个`
      + (failed.length > 0 ? ` · 失败 ${failed.length} 个：${failed.join('；')}` : '')
      + '。请重启对应客户端后验证；此后令牌轮换无需再动任何客户端配置。',
    );
    setBusy('');
    await refresh();
  };

  const canWire = (row: ClientRow) =>
    row.writable
    && row.state !== 'conflict'
    && row.state !== 'invalid'
    && (row.state !== 'wired' || needsClientId(row));

  /**
   * 批次23：一键适配全部 —— 所有已安装客户端一次处理：
   *  · 可写客户端（JSON/TOML）自动备份后写入；
   *  · 无法自动写入的（冲突/无法解析/无稳定配置路径）自动生成含令牌片段，行内给出具体接通位置与步骤。
   * 每个写入仍由主进程二次校验管理员会话；冲突/无法解析一律拒绝覆盖。
   */
  const wireAll = async () => {
    if (!session.sid) { setMessage('请先登录后再写入配置'); return; }
    if (rows.length === 0) { setMessage('未检测到已安装的 MCP 客户端，无需适配'); return; }
    const targets = rows.filter(canWire);
    const pending = rows.filter((r) => !canWire(r) && (r.state !== 'wired' || needsClientId(r)));
    setBusy('wire-all');
    const failed: string[] = [];
    let written = 0;
    let unchanged = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      setMessage(`⚡ 一键适配中：自动写入 ${i + 1}/${targets.length} · ${row.name}…`);
      try {
        const r = await hostCall<WireReply>('mcp:clientWire', [row.id, session.sid]);
        if (!r.ok) failed.push(`${row.name}（${r.error ?? '未知原因'}）`);
        else if (r.changed) written += 1;
        else unchanged += 1;
      } catch (e) {
        failed.push(`${row.name}（${String((e as Error)?.message ?? e)}）`);
      }
    }
    let snippetsMade = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const row = pending[i];
      setMessage(`⚡ 一键适配中：生成配置片段 ${i + 1}/${pending.length} · ${row.name}…`);
      try {
        const r = await hostCall<{ ok: boolean; snippet?: string; error?: string }>(
          'mcp:clientSnippet', [row.id, session.sid],
        );
        if (r.ok && r.snippet) {
          setSnippets((prev) => ({ ...prev, [row.id]: r.snippet! }));
          snippetsMade += 1;
        } else {
          failed.push(`${row.name}（片段：${r.error ?? '未知原因'}）`);
        }
      } catch (e) {
        failed.push(`${row.name}（片段：${String((e as Error)?.message ?? e)}）`);
      }
    }
    if (targets.length === 0 && snippetsMade === 0 && failed.length === 0) {
      setMessage('⚡ 一键适配完成：所有已安装客户端均已接入，无需改动');
    } else {
      setMessage(
        `⚡ 一键适配完成：自动写入 ${written} 个 · 已是最新 ${unchanged} 个`
        + ` · 生成配置片段 ${snippetsMade} 份`
        + (failed.length > 0 ? ` · 失败 ${failed.length} 个：${failed.join('；')}` : '')
        + (snippetsMade > 0
          ? `。仅生成片段：${pending.map((r) => r.name).join('、')}（无稳定配置文件或配置由客户端应用托管，请按行内接通指引手工添加）`
          : '')
        + '；请重启对应客户端后验证记忆提示',
      );
    }
    setBusy('');
    await refresh();
  };

  const admin = session.role === 'admin';
  const disabledReason = session.loading ? '正在校验管理员身份…' : admin ? '' : '需管理员';

  /** T3 落点②：只清禁用标记并备份原配置；成功后显示「待生效」，绝不冒充已打开。 */
  const enableSwitch = (row: ClientRow) => {
    if (!session.sid) { setMessage('请先登录后再打开开关'); return; }
    setBusy(`enable:${row.id}`);
    hostCall<WireReply>('mcp:clientEnable', [row.id, session.sid])
      .then((r) => {
        if (!r.ok) { setMessage(`一键打开失败：${r.error ?? '未知原因'}`); return; }
        markMcpPending(row.id);
        setPendingList(listMcpPending());
        setMessage('已清除禁用标记并备份原配置。请在设置里手动打开开关，或重新打开软件后生效。');
      })
      .catch((e) => setMessage(`一键打开失败：${String((e as Error)?.message ?? e)}`))
      .finally(() => setBusy(''));
  };
  const scannedAt = scan && typeof scan.scannedAt === 'number' ? formatClock(scan.scannedAt) : '';
  const endpoint = scan?.endpoint ?? MCP_ENDPOINT;
  const wireTargets = rows.filter(canWire);
  const snippetTargets = rows.filter((r) => !canWire(r) && (r.state !== 'wired' || needsClientId(r)));
  const stdioTargets = rows.filter(canStdio);
  const batchLabel = wireTargets.length > 0
    ? `⚡ 一键适配全部（自动 ${wireTargets.length}${snippetTargets.length > 0 ? ` + 片段 ${snippetTargets.length}` : ''}）`
    : snippetTargets.length > 0
      ? `⚡ 一键适配全部（生成 ${snippetTargets.length} 份片段）`
      : '⚡ 一键适配全部';
  const batchTitle = capability === 'none'
    ? '浏览器模式无法写入本机配置'
    : disabledReason
      || (rows.length === 0
        ? '未检测到已安装客户端'
        : wireTargets.length > 0
          ? `自动为 ${wireTargets.length} 个可写客户端先备份再写入${snippetTargets.length > 0 ? `，并为 ${snippetTargets.length} 个客户端生成接通片段` : ''}`
          : snippetTargets.length > 0
            ? `没有可自动写入的客户端：为 ${snippetTargets.length} 个客户端生成含令牌片段与接通步骤`
            : '全部客户端已接入，点击可复核');

  return (
    <>
      <div className="section-title">MCP 客户端接入 · 把记忆提示推广到所有已接入 Agent（批次15/21）</div>
      <div className="card" id="mcpClients" data-testid="mcp-clients">
        <div className="top">
          <div className="agent-name">🧠 记忆库 MCP 接入状态</div>
          <span className="pill" data-testid="mcp-endpoint">{scan?.endpoint ?? 'http://127.0.0.1:8204/mcp'}</span>
          <span className="pill">{capability === 'none' ? '浏览器模式（只读说明）' : scanError ? '扫描失败' : scanning ? '扫描中…' : '本机配置真扫'}</span>
          {scannedAt && (
            <span className="pill" data-testid="mcp-scanned-at" title="最近一次真实扫描本机配置的时间（UTC+08:00）">
              上次扫描 {scannedAt}
            </span>
          )}
          {scan?.live?.server && (
            <span
              className={scan.live.server.ok ? 'pill on' : 'pill red'}
              data-testid="mcp-server-live"
              title={`用当前 mcp-token.txt 实测本机 MCP 端点：HTTP ${scan.live.server.status}${scan.live.server.error ? ` · ${scan.live.server.error}` : ''}（${formatClock(scan.live.server.at)} UTC+08:00）`}
            >
              {scan.live.server.ok ? `服务端 ✓ ${scan.live.server.tools ?? '?'} 工具` : `服务端 ✗ ${scan.live.server.status || '不可达'}`}
            </span>
          )}
          <button
            className="btn" type="button" data-act="mcp-refresh"
            disabled={capability === 'none' || scanning}
            title={capability === 'none' ? '浏览器模式无法读取本机配置' : '重新读取本机客户端配置与安装痕迹'}
            onClick={() => { setMessage(''); void refresh({ announce: true }); }}
          >
            {scanning ? '扫描中…' : '刷新状态'}
          </button>
          <button
            className="btn primary" type="button" data-act="mcp-wire-all" data-testid="mcp-wire-all"
            disabled={!admin || busy !== '' || scanning || capability === 'none' || rows.length === 0}
            title={batchTitle}
            onClick={() => { void wireAll(); }}
          >
            {busy === 'wire-all' ? '适配中…' : batchLabel}
          </button>
          <button
            className="btn" type="button" data-act="mcp-stdio-all" data-testid="mcp-stdio-all"
            disabled={!admin || busy !== '' || scanning || capability === 'none' || stdioTargets.length === 0}
            title={capability === 'none'
              ? '浏览器模式无法写入本机配置'
              : disabledReason
                || (stdioTargets.length === 0
                  ? '可写的客户端都已经是 stdio 零维护形态（或配置冲突/无法解析需先手工修正）'
                  : `把 ${stdioTargets.length} 个客户端改成 stdio 零维护形态：配置里不再有令牌，`
                    + '桥接脚本每次现读数据根的 keys/mcp-token.txt —— 此后令牌轮换 / 数据根搬家都不用重写配置（逐行备份原文件）')}
            onClick={() => { void toStdioAll(); }}
          >
            {busy === 'stdio-all' ? '改写中…' : `⇄ 全改 stdio（${stdioTargets.length}）`}
          </button>
        </div>
        <div className="sub">
          所有客户端共用同一端点与令牌；提示行（项目背景 / 命中记忆 / Token / 费用）与四段折叠明细由服务端返回，
          接入成功并重启客户端后即生效，无需各客户端单独改造。仅显示本机真实检出的客户端。
          <b>实测连通</b>（2026-11-18）：每行拿<b>该客户端配置里的令牌</b>真调一次 <code>tools/list</code>，用 HTTP 状态码说话——
          「已接入」只说明配置里写着条目，401 说明令牌过期，两者不是一回事；本面板每轮静默复检（循环检测），
          由好变坏时会主动提示。
        </div>
        <div className="sub" data-testid="mcp-actions-help">
          <b>复制片段</b>：生成含令牌的配置片段，任何客户端都可粘贴（令牌只在此处一次性展示）；
          <b>一键接入</b>：管理员专用，先备份再合并写入，支持 JSON（Qoder / Claude Code / Cursor / Gemini / Qwen）与 TOML（Codex）；
          <b>⚡ 一键适配全部</b>：一次处理所有已安装客户端——可写的自动备份写入，无法自动写入的自动生成片段并给出具体接通位置与步骤；
          配置冲突/无法解析时拒绝覆盖。
          <b>改用 stdio / ⇄ 全改 stdio</b>（2026-11-18）：把客户端配置改成「只写启动命令」
          <code>node &lt;桥接脚本&gt; &lt;引导指针&gt; &lt;端点&gt; &lt;客户端id&gt;</code>——
          配置里<b>不再有令牌</b>，桥接脚本每次调用现读数据根的 <code>keys/mcp-token.txt</code>，
          所以<b>令牌轮换、数据根搬家都不用重写任何客户端配置</b>（脚本落在引导指针同目录，路径本身也不随数据根漂移）。
          <b>补身份头</b>（批次41-X）：条目已接入但缺 <code>{MCP_CLIENT_HEADER_NAME}</code> 时出现——服务端据此认出「这次调用来自哪一家」，
          缺了就只能按 User-Agent 归并，多台客户端共用通用 UA（如 Node 的 <code>node</code>）时会把 A 的调用记成 B。
        </div>
        {capability === 'none' && (
          <div className="warn show" data-testid="mcp-browser-note">
            浏览器模式无法读取本机客户端配置，因此不列出任何客户端、也不显示「已接入」。请在桌面端打开本页并点「刷新状态」。
          </div>
        )}
        {scanError && (
          <div className="warn show" data-testid="mcp-scan-error">
            读取本机配置失败：{scanError}（下方不展示客户端状态，避免把未知当成「已接入」）
          </div>
        )}
        {!admin && capability !== 'none' && (
          <div className="warn show" data-testid="mcp-admin-gate">
            普通成员只读；复制含令牌片段与一键写入需管理员（主进程按登录会话二次校验）。
          </div>
        )}
        {scan?.live && scan.live.failed > 0 && (
          <div className="warn show" data-testid="mcp-live-alert">
            <b>⚠ 实测连通异常（{formatClock(scan.live.at)}，UTC+08:00）：</b>
            {scan.live.failed}/{scan.live.checked} 个客户端用<b>自己配置里的令牌</b>调 <code>tools/list</code> 失败——
            {scan.live.server?.ok
              ? `服务端本身正常（HTTP 200 · ${scan.live.server.tools ?? '?'} 个工具），是客户端配置里的令牌过期/路径不对。`
              : `服务端自己也不通（${scan.live.server?.error ?? '未探测'}），先看桌面端是否在运行、8204 是否被占用。`}
            点对应行的「补齐令牌」，或右上「⚡ 一键适配全部」统一重写；本面板每轮自动复检（循环检测）。
          </div>
        )}

        {rows.length > 0 && (
          <div className="note" data-testid="mcp-state-summary" style={{ margin: '6px 0' }}>
            <b>七态总览（本机真扫）：</b>
            {(Object.keys(STATE_LABEL) as McpWireState[]).map((s) => (
              <span key={s} style={{ marginLeft: 8, whiteSpace: 'nowrap' }} data-testid={`mcp-state-${s}`}>
                {STATE_LABEL[s].text} <b>{stateCounts[s]}</b>
              </span>
            ))}
          </div>
        )}

        <div id="mcp-client-rows">
          {rows.map((row) => {
            const disabledByClient = row.disabled === true;
            const switchPending = pendingList.includes(row.id);
            const label = switchPending
              ? { text: '已清除标记 · 待生效', cls: 'pill gold' }
              : disabledByClient
                ? { text: '客户端已关闭', cls: 'pill red' }
                : STATE_LABEL[row.state];
            const snippet = snippets[row.id];
            return (
              <div className="found" data-client={row.id} data-state={row.state}
                data-switch={switchPending ? 'pending' : disabledByClient ? 'off' : undefined} key={row.id}>
                <div className="found-head">
                  <span className={`badge ${row.badge}`}>{row.badge.toUpperCase()}</span>
                  <b>{row.name}</b>
                  <span className={label.cls} data-testid={`state-${row.id}`}>{label.text}</span>
                  {(() => {
                    const lv = liveBadge(row);
                    return (
                      <span className={lv.cls} data-testid={`live-${row.id}`} title={lv.title}>
                        {lv.text}
                      </span>
                    );
                  })()}
                  {(() => {
                    const tb = transportBadge(row);
                    return tb ? (
                      <span className={tb.cls} data-testid={`transport-${row.id}`} title={tb.title}>{tb.text}</span>
                    ) : null;
                  })()}
                  {row.running !== undefined && (
                    <span
                      className={row.running ? 'pill on' : 'pill red'}
                      data-testid={`run-${row.id}`}
                      title="客户端软件当前是否在运行（仅桌面客户端可判定）"
                    >
                      {row.running ? '已启动' : '未启动'}
                    </span>
                  )}
                  <span className="method mcp-path" title={row.displayPath ?? '无稳定配置路径'}>
                    {row.displayPath ?? '无稳定配置路径'}
                  </span>
                </div>
                <div className="found-meta">
                  <span className="method">触发规则：{row.rulesHint}</span>
                  {row.foundUrl && row.state === 'conflict' && (
                    <span className="method">当前指向：{row.foundUrl}</span>
                  )}
                  {row.note && <span className="method">{row.note}</span>}
                </div>
                <div className="found-meta">
                  <span className="method" data-hint={row.state} data-testid={`guide-${row.id}`}>
                    接通指引：{guideFor(row, endpoint)}
                  </span>
                </div>
                <div className="btns">
                  <button
                    className="btn" type="button" data-act="mcp-copy"
                    disabled={!admin || busy !== ''}
                    title={disabledReason || (row.transport === 'stdio'
                      ? '生成 stdio 启动命令片段（不含令牌，可安全转发）并复制'
                      : '生成含令牌的配置片段并复制（可手工粘贴）')}
                    onClick={() => copySnippet(row)}
                  >
                    复制片段
                  </button>
                  {row.writable && (
                    <button
                      className="btn primary" type="button" data-act="mcp-wire"
                      disabled={!admin || busy !== '' || !canWire(row)}
                      title={disabledReason
                        || (row.state === 'wired'
                          ? needsClientId(row)
                            ? `已接入但缺显式身份头 ${MCP_CLIENT_HEADER_NAME}：备份原文件后补写该头（服务端据此识别调用方，避免多客户端串号）`
                            : '已接入，无需重复写入'
                          : row.state === 'conflict' || row.state === 'invalid'
                            ? '配置冲突/无法解析：请先手工修正，系统不覆盖'
                            : '备份原文件后合并写入本服务条目（含身份头）')}
                      onClick={() => wire(row)}
                    >
                      {row.state === 'wired'
                        ? needsClientId(row) ? '补身份头' : '已接入'
                        : row.state === 'missing_auth' ? '补齐令牌' : '一键接入'}
                    </button>
                  )}
                  {canStdio(row) && (
                    <button
                      className="btn" type="button" data-act="mcp-stdio" data-testid={`stdio-${row.id}`}
                      disabled={!admin || busy !== ''}
                      title={disabledReason
                        || `把 ${row.name} 的配置从「令牌抄在配置里」改成「只写启动命令」：`
                          + '配置里不再有令牌，桥接脚本每次调用现读数据根的 keys/mcp-token.txt，'
                          + '此后令牌轮换 / 数据根搬家都不用重写这份配置（写前备份原文件）'}
                      onClick={() => { void toStdio(row); }}
                    >
                      {busy === `stdio:${row.id}` ? '改写中…' : '改用 stdio'}
                    </button>
                  )}
                  {disabledByClient && !switchPending && row.format === 'json' && (
                    <button
                      className="btn primary" type="button" data-act="mcp-enable"
                      disabled={!session.sid || busy !== ''}
                      title={'备份原配置后只清掉禁用标记；客户端不会实时重读配置，仍需手动打开或重新打开软件'}
                      onClick={() => enableSwitch(row)}
                    >
                      一键打开
                    </button>
                  )}
                  {disabledByClient && !switchPending && row.format !== 'json' && (
                    <span className="method">该客户端配置不是 JSON，请到设置中手动打开开关</span>
                  )}
                  {switchPending && (
                    <button className="btn" type="button" data-act="mcp-manual"
                      onClick={() => setManualHintId(row.id)}>
                      去设置手动打开
                    </button>
                  )}
                </div>
                {manualHintId === row.id && (
                  <div
                    className="warn show"
                    data-testid={`manual-hint-${row.id}`}
                    style={{ marginTop: 8 }}
                    ref={(el) => { el?.scrollIntoView?.({ block: 'nearest' }); }}
                  >
                    <b>手动打开位置：</b>{MCP_MANUAL_HINT}
                  </div>
                )}
                {row.error && <div className="errbox show">{row.error}</div>}
                {snippet && (
                  <pre className="inject" data-testid={`snippet-${row.id}`} style={{ width: '100%', overflow: 'auto' }}>
                    {snippet}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        {capability !== 'none' && !scanError && scan && rows.length === 0 && (
          <div className="warn show" data-testid="mcp-empty">
            未检测到已安装的 MCP 客户端：安装并启动一次客户端后，点「刷新状态」重新扫描。未安装的客户端不再占位显示。
          </div>
        )}

        {message && (
          <div className="warn show" data-testid="mcp-message">{message}</div>
        )}
        <div className="note">
          安全说明：片段中的 Authorization 令牌只在此处一次性展示，绝不写入日志/审计；一键写入支持结构稳定的
          JSON（Qoder CN / Claude Code / Cursor / Gemini / Qwen / Trae CN / WorkBuddy）与 TOML（Codex）客户端，
          写入前自动备份原文件，同名条目指向其它端点时拒绝覆盖。deepseek harness 随宿主 Qoder 下发（对宿主一键接入即自动接通）；
          Zcode 的配置存应用内部存储（表单 / JSON 两种方式，无文件面不代写），「复制片段」输出的 mcpServers JSON 可整段粘贴进其 JSON 标签页，保存即接通。
          服务端召回审计会记录调用方（client），可在审计页按 Agent 核验是否真的调用了记忆库。
          stdio 形态下配置里没有凭据：桥接脚本按「引导指针 → 数据根 → keys/mcp-token.txt」现查令牌，
          指针与脚本同放 <code>%APPDATA%\MultiAgent Memory</code>（跨数据根迁移不变），所以迁移/轮换都不需要再动客户端。
        </div>
      </div>
    </>
  );
}

export default McpClientsPanel;
