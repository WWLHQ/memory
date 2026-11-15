// 客户端 MCP 开关状态 · 三处 UI 的单一真源（T3 展示层）。
// 原型唯一事实来源：design/ui/客户端MCP开关状态_原型.html（结构 / 样式类名 / 文案 / 交互）。
// 整页只说人话：不渲染配置原文、不写字段名与英文枚举；判定不到一律「未知」，不冒充已连接。
import { hostCall } from '../../desktop/hostBridge.ts';
import { currentSessionId } from './session.ts';

export type McpSwitchView = 'off' | 'ok' | 'down' | 'pending' | 'unknown';

export interface McpSwitchInput {
  /** 本机服务健康检查（首页 /api/health；壳层用同一口径） */
  healthOk: boolean;
  /** 客户端配置扫描是否成功；false = 读不到，不能据此判「已连接」 */
  mcpOk: boolean;
  /** 客户端列表：name 用于把「哪个客户端被禁用」如实写进标题，缺省时退回泛称 */
  clients: readonly { id: string; name?: string; disabled?: boolean }[];
  /** 一键打开成功后、客户端尚未重新读取配置的待生效标记（单值，旧口径） */
  pending?: boolean;
  /** 待生效的客户端 id 列表（①三处一致）：来自共享信号，任一非空即「待生效」；
   *  与 pending 等价并向上兼容（保留 pending 供既有调用/测试）。 */
  pendingIds?: readonly string[];
}

export interface McpSwitchState {
  view: McpSwitchView;
  /** 状态点/徽标用的短标签 */
  label: string;
  /** 提示条主文案（人话，不含字段名） */
  title: string;
  detail: string;
  footnote: string;
  /** 只有「服务端在线 + 确读到已禁用 + 不在待生效」才允许一键打开 */
  canEnable: boolean;
  /** 需要打开的那个客户端 id；null = 无可操作目标 */
  enableId: string | null;
}

/** 与壳层状态卡的 12 秒轮询同口径；首页 MCP 面板只轻量复核这一路，不整页重读账本 */
export const MCP_SWITCH_POLL_MS = 12_000;

export const MCP_SWITCH_LABEL: Record<McpSwitchView, string> = {
  off: '客户端已关闭',
  ok: '已接入',
  down: '服务端未启动',
  pending: '待生效',
  unknown: '未知',
};

const TEXT: Record<McpSwitchView, Pick<McpSwitchState, 'title' | 'detail' | 'footnote'>> = {
  off: {
    // 泛称兜底：真实客户端名由 deriveMcpSwitch 用 clients[].name 动态补上，绝不再硬编码成某一家
    title: '客户端 MCP 开关已关闭',
    detail: '记忆服务端在线，但客户端不会挂载召回工具，本轮回答用不上记忆库。',
    footnote: '清除禁用标记后需重新打开软件才生效：客户端不会实时重读配置。',
  },
  pending: {
    title: '已清除禁用标记，待生效',
    detail: '原配置已备份。请在设置里手动打开开关，或重新打开软件。',
    footnote: '状态保持待生效，不冒充已连接；12 秒后复核仍为待生效时会继续提示。',
  },
  down: {
    title: '记忆服务端未启动',
    detail: '本机服务连不上，这不是客户端开关问题。',
    footnote: '桌面端启动后状态卡会自动复核；此时不显示「一键打开」，避免误导。',
  },
  unknown: {
    title: '客户端 MCP 开关状态未知',
    detail: '本机客户端配置没读到，不能据此判断开关是否打开。',
    footnote: '点「重读」重新读取真实状态。',
  },
  ok: { title: '', detail: '', footnote: '' },
};

/** 纯派生：优先级 = 服务端离线 > 读不到配置 > 待生效 > 已禁用 > 正常。 */
export function deriveMcpSwitch(input: McpSwitchInput): McpSwitchState {
  const offClient = input.clients.find((c) => c.disabled === true) ?? null;
  const pendingIds = input.pendingIds ?? [];
  // 待生效：旧口径 pending=true，或共享信号里有待生效客户端；若还有别的客户端被禁用，则仅当禁用者就是待生效者才算
  const pendingHit = input.pending === true
    || (offClient ? pendingIds.includes(offClient.id) : pendingIds.length > 0);

  let view: McpSwitchView;
  if (!input.healthOk) view = 'down';
  else if (!input.mcpOk) view = 'unknown';
  else if (pendingHit) view = 'pending';
  else if (offClient) view = 'off';
  else view = 'ok';

  const enableId = view === 'off' ? (offClient?.id ?? null) : null;
  // 标题必须点名「真被禁用/刚清掉的那一家」；查不到名字才退回泛称，绝不写死成 WorkBuddy
  const offName = typeof offClient?.name === 'string' ? offClient.name.trim() : '';
  const pendingClient = pendingIds.length > 0
    ? (input.clients.find((c) => c.id === pendingIds[0]) ?? null)
    : null;
  const pendingName = typeof pendingClient?.name === 'string' ? pendingClient.name.trim() : '';
  let title = TEXT[view].title;
  if (view === 'off' && offName) title = `${offName} 的 MCP 开关已关闭`;
  else if (view === 'pending' && pendingName) title = `${pendingName} 已清除禁用标记，待生效`;

  return {
    view,
    label: MCP_SWITCH_LABEL[view],
    title,
    detail: TEXT[view].detail,
    footnote: TEXT[view].footnote,
    canEnable: view === 'off' && enableId !== null,
    enableId,
  };
}

/** 一键打开：只清禁用标记并备份原配置；主进程 requireAdmin 会二次校验。
 *  成功 != 客户端已打开，调用方必须切到「待生效」态，不得跳绿。 */
export async function requestEnableMcpSwitch(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await hostCall<{ ok: boolean; error?: string }>('mcp:clientEnable', [id, currentSessionId()]);
    return { ok: r?.ok === true, ...(r?.error ? { error: r.error } : {}) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 去设置手动打开的提示（客户端不会热重读配置，必须同时给这两条出路） */
export const MCP_MANUAL_HINT = '请在 WorkBuddy → 设置 → MCP 服务管理 中打开 MultiAgent Memory 开关；或重新打开软件。';
/** 服务端离线时的提示 */
export const MCP_LAUNCH_HINT = '请启动 MultiAgent Memory 桌面端，状态卡会在 12 秒内自动复核。';
