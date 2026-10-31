// MCP 客户端接入面板（批次15 建 / 批次21 交互收敛 / 批次23 一键适配全部 + 逐客户端接通指引）：
// 把「🧠 提示行 + 四段折叠明细」推广到所有已接入 Agent。
// 状态来自主进程读取本机配置与安装痕迹（mcp:clients）；只显示本机真实检出的客户端，
// 未安装的不占位。片段/一键写入需管理员（主进程二次校验）。
// 无法自动写入的客户端不再只显示「未连通/需配置」：按客户端给出设置菜单/配置文件/条目名/端点与修复步骤。
// 浏览器模式（无宿主桥）如实降级：只说明无法扫描，绝不伪造「已接入」或客户端列表。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { MCP_ENDPOINT, specOfMcpClient, type McpWireState } from '../../agentOnboard/mcpClients.ts';
import type { BadgeClass } from '../../types/agentOnboard.ts';
import { useSessionContext } from '../shared/session.ts';

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
      return STATE_HINT.wired;
    case 'missing_auth':
      return row.writable
        ? `点本行「补齐令牌」：自动备份后写入 ${where} 的 Authorization（令牌一次性下传，不落日志）`
        : `打开 ${where}，在 ${key} 条目补请求头 Authorization: Bearer <令牌>（点「复制片段」获取）`;
    case 'missing_entry':
    case 'no_config':
      return row.writable
        ? `点本行「一键接入」或顶部「⚡ 一键适配全部」：自动备份后写入 ${where}（条目 ${key}，端点 ${endpoint}）`
        : `打开 ${where}，新增 HTTP MCP 服务器：名称 ${key}，URL ${endpoint}，请求头 Authorization: Bearer <令牌>（点「复制片段」或「一键适配全部」生成）`;
    case 'conflict':
      return `打开 ${path}，把 ${key} 条的 URL 从 ${row.foundUrl ?? '其它端点'} 改成 ${endpoint}（或删除该条目），保存后点「刷新状态」，再点「一键接入」`;
    case 'invalid': {
      const kind = spec?.format === 'toml' ? 'TOML' : spec?.format === 'json' ? 'JSON' : '配置文件';
      return `打开 ${where} 修复 ${kind} 语法${row.error ? `（${row.error}）` : ''}，保存后点「刷新状态」；修复前系统拒绝写入，避免改坏配置`;
    }
    case 'manual':
    default:
      return `打开 ${where}，新增 HTTP MCP 服务器：名称 ${key}，URL ${endpoint}，请求头 Authorization: Bearer <令牌>（点「复制片段」或「一键适配全部」生成片段）`;
  }
}

/** 用户可见时间统一 UTC+08:00（扫描时间戳是 epoch） */
function formatClock(ts: number): string {
  const d = new Date(ts + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function McpClientsPanel() {
  const session = useSessionContext();
  const capability = hostCapability();
  const [scan, setScan] = useState<ScanReply | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback((opts: { announce?: boolean } = {}) => {
    if (capability === 'none') return Promise.resolve();
    setScanning(true);
    return hostCall<ScanReply>('mcp:clients')
      .then((r) => {
        setScan(r);
        setScanError('');
        if (opts.announce) {
          const n = r.clients.filter((c) => c.installed).length;
          const at = typeof r.scannedAt === 'number' ? formatClock(r.scannedAt) : formatClock(Date.now());
          setMessage(`已重新扫描：检出 ${n} 个已安装客户端 · ${at}（UTC+08:00）`);
        }
      })
      .catch((e) => {
        const reason = String((e as Error)?.message ?? e);
        setScan(null);
        setScanError(reason);
        if (opts.announce) setMessage(`重新扫描失败：${reason}`);
      })
      .finally(() => setScanning(false));
  }, [capability]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** 只展示本机真实检出（配置文件存在或安装痕迹命中）的客户端 */
  const rows = useMemo<ClientRow[]>(
    () => (scan ? scan.clients.filter((r) => r.installed) : []),
    [scan],
  );

  const copySnippet = (id: string) => {
    if (!session.sid) { setMessage('请先登录后再复制（片段含令牌）'); return; }
    setBusy(`snippet:${id}`);
    hostCall<{ ok: boolean; snippet?: string; error?: string }>('mcp:clientSnippet', [id, session.sid])
      .then(async (r) => {
        if (!r.ok || !r.snippet) { setMessage(`片段生成失败：${r.error ?? '未知原因'}`); return; }
        setSnippets((prev) => ({ ...prev, [id]: r.snippet! }));
        try {
          await navigator.clipboard.writeText(r.snippet);
          setMessage('已复制（含令牌，请勿外传）；粘贴到客户端配置后重启生效');
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
        setMessage(r.changed
          ? `已写入 ${row.name}${r.backupPath ? `（原文件已备份：${r.backupPath}）` : ''}；请重启该客户端后验证提示行`
          : `${row.name} 已是最新，未改动`);
        return refresh();
      })
      .catch((e) => setMessage(`写入失败：${String((e as Error)?.message ?? e)}`))
      .finally(() => setBusy(''));
  };

  const canWire = (row: ClientRow) =>
    row.writable && row.state !== 'wired' && row.state !== 'conflict' && row.state !== 'invalid';

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
    const pending = rows.filter((r) => r.state !== 'wired' && !canWire(r));
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
  const scannedAt = scan && typeof scan.scannedAt === 'number' ? formatClock(scan.scannedAt) : '';
  const endpoint = scan?.endpoint ?? MCP_ENDPOINT;
  const wireTargets = rows.filter(canWire);
  const snippetTargets = rows.filter((r) => r.state !== 'wired' && !canWire(r));
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
        </div>
        <div className="sub">
          所有客户端共用同一端点与令牌；提示行（项目背景 / 命中记忆 / Token / 费用）与四段折叠明细由服务端返回，
          接入成功并重启客户端后即生效，无需各客户端单独改造。仅显示本机真实检出的客户端。
        </div>
        <div className="sub" data-testid="mcp-actions-help">
          <b>复制片段</b>：生成含令牌的配置片段，任何客户端都可粘贴（令牌只在此处一次性展示）；
          <b>一键接入</b>：管理员专用，先备份再合并写入，支持 JSON（Qoder / Claude Code / Cursor / Gemini / Qwen）与 TOML（Codex）；
          <b>⚡ 一键适配全部</b>：一次处理所有已安装客户端——可写的自动备份写入，无法自动写入的自动生成片段并给出具体接通位置与步骤；
          配置冲突/无法解析时拒绝覆盖。
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

        <div id="mcp-client-rows">
          {rows.map((row) => {
            const label = STATE_LABEL[row.state];
            const snippet = snippets[row.id];
            return (
              <div className="found" data-client={row.id} data-state={row.state} key={row.id}>
                <div className="found-head">
                  <span className={`badge ${row.badge}`}>{row.badge.toUpperCase()}</span>
                  <b>{row.name}</b>
                  <span className={label.cls} data-testid={`state-${row.id}`}>{label.text}</span>
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
                    title={disabledReason || '生成含令牌的配置片段并复制（可手工粘贴）'}
                    onClick={() => copySnippet(row.id)}
                  >
                    复制片段
                  </button>
                  {row.writable && (
                    <button
                      className="btn primary" type="button" data-act="mcp-wire"
                      disabled={!admin || busy !== '' || !canWire(row)}
                      title={disabledReason
                        || (row.state === 'wired' ? '已接入，无需重复写入'
                          : row.state === 'conflict' || row.state === 'invalid'
                            ? '配置冲突/无法解析：请先手工修正，系统不覆盖'
                            : '备份原文件后合并写入本服务条目')}
                      onClick={() => wire(row)}
                    >
                      {row.state === 'wired' ? '已接入' : row.state === 'missing_auth' ? '补齐令牌' : '一键接入'}
                    </button>
                  )}
                </div>
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
          JSON（Qoder CN / Claude Code / Cursor / Gemini / Qwen）与 TOML（Codex）客户端，写入前自动备份原文件，
          同名条目指向其它端点时拒绝覆盖。无稳定配置文件的客户端（Trae CN / WorkBuddy / Zcode / deepseek harness）
          会给出具体设置位置与字段，需在客户端内粘贴一次。服务端召回审计会记录调用方（client），可在审计页按 Agent 核验是否真的调用了记忆库。
        </div>
      </div>
    </>
  );
}

export default McpClientsPanel;
