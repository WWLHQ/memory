// 工作台壳层的视图映射（批次48 S1）。
//
// 口径：壳只负责「导航 + 标签 + 面板框架」，中心区以 iframe 承载**已真实落地**的页面。
// - 每个导航项要么指向一个真实 HTML 页面，要么明确给出「程序暂无该视图」的原因；
//   绝不出现演示计数、编造读数或「—」占位。
// - overview.html 是可直达的演示通览，按 D3 不进主导航。
// - 个人记忆有真实独立存储（第一轮本机闭环）：静态导航只带入口，待确认计数由页面按真实内核回传

export type PageKey =
  | 'home' | 'login' | 'memory' | 'personal' | 'write' | 'retrieval'
  | 'lifecycle' | 'audit' | 'logs' | 'security' | 'growth' | 'models'
  | 'monitor' | 'sync' | 'params' | 'setup' | 'agent' | 'webonboard' | 'mcp'
  | 'layered' | 'dispute' | 'feedback' | 'assistant';

/** 真实页面清单（文件名与 vite.config.ts 的 rollupOptions.input 对齐） */
export const PAGES: Record<PageKey, { file: string; label: string; source: string }> = {
  home: { file: 'index.html', label: '概览页', source: 'getHomeFeed（单次账本读取）+ /api/health + llm:billing' },
  // login.html 为可直达兜底页（不进主导航）；主流程入口是壳层登录弹窗
  login: { file: 'login.html', label: '登录与会话页', source: 'POST /api/login · /api/me · session:realpage' },
  memory: { file: 'memory.html', label: '记忆管理六页签页', source: '账本清单 + 分层策略 + 冲突队列读数（批次57 精简六页签）' },
  personal: { file: 'personal.html', label: '个人记忆页', source: 'personal:snapshot 个人记忆真实快照（内核账本）' },
  write: { file: 'write.html', label: '写入页', source: 'ma.write 表单与回执' },
  retrieval: { file: 'retrieval.html', label: '检索页', source: '透明化召回' },
  lifecycle: { file: 'lifecycle.html', label: '生命周期页', source: '六态机 + 调参' },
  audit: { file: 'audit.html', label: '审计页', source: '统一审计 + request_id' },
  logs: { file: 'logs.html', label: '日志记录页', source: '全动作事件流' },
  security: { file: 'security.html', label: '账号与安全页', source: '密码策略 + 用户团队' },
  growth: { file: 'growth.html', label: '自我净化与生长页', source: '回归与生长配置' },
  models: { file: 'models.html', label: '模型与成本页', source: '引擎配置 + 余额视图' },
  monitor: { file: 'monitor.html', label: '监控仪表盘', source: '指标卡 + 告警时间线' },
  sync: { file: 'sync.html', label: '同步页', source: 'PgSyncHub 推拉与冲突' },
  params: { file: 'params.html', label: '全局参数页', source: '参数快照 + 记忆库管理' },
  setup: { file: 'setup.html', label: '首启设置页', source: 'setup:state / finish' },
  agent: { file: 'agentonboard.html', label: 'Agent 接入页', source: 'agentOnboard 接口' },
  webonboard: { file: 'webonboard.html', label: '网页端接入页', source: 'webchatAuto 状态/设置/采集/登录（宿主 IPC 真值）' },
  mcp: { file: 'mcp.html', label: 'MCP 接入页', source: 'mcp:clients 主进程真扫客户端配置与连通（宿主 IPC 真值）' },
  layered: { file: 'memory-layered.html', label: '记忆层级管理页', source: 'REQ-006 P8 · L0–L6 真实账本' },
  dispute: { file: 'dispute.html', label: '冲突裁决页', source: 'REQ-006 P7 · 内核真实 pending 冲突队列' },
  feedback: { file: 'feedback.html', label: '反馈页', source: 'REQ-006 P9 · 真实账本反馈' },
  assistant: { file: 'assistant.html', label: '记忆助手页', source: 'loadOverview 同源快照 · 问答只转述真实账本' },
};

export interface NavGroup {
  kind: 'group';
  label: string;
}

export interface NavItem {
  kind: 'item';
  id: string;
  label: string;
  icon: IconName;
  /** STRATUM 设计稿（1:1 复刻）规定导航图标用 emoji 原样；未给 emoji 的项回落 SVG 图标 */
  emoji?: string;
  /** 真实页面；缺省时必须给出 unavailable 原因 */
  page?: PageKey;
  /** 页面初值（D4）：`?status=archived` 或 `?tab=conflict`，由目标页自行解析并真正筛选/定位 */
  href?: string;
  /** 程序暂无该视图的诚实原因（不可用态：无计数、无回执） */
  unavailable?: string;
  /** 子项（缩进显示） */
  child?: boolean;
  /** 默认展开的父项 */
  children?: NavItem[];
  defaultOpen?: boolean;
}

export type NavEntry = NavGroup | NavItem;

/** 功能导航树：批次54 按用户参考图重排、批次52 起「记忆管理」组去掉活跃/蛰伏休眠/已归档/个人记忆四子项（状态筛选留在记忆页内），每项映射到真实 HTML，角标一律动态读真账本，不写死示例数。
 *  - 登录仍走壳层弹窗（login.html 只作深链兜底，不占主导航）；
 *  - 首启设置由 Electron 向导直接打开（setup.html），不在主导航露面；
 *  - 个人记忆库作为记忆管理组独立入口进主导航，直达真实整页 personal.html；记忆库 Tab 与状态栏常驻面板保留；
 */
export const NAV: NavEntry[] = [
  { kind: 'group', label: '工作台' },
  { kind: 'item', id: 'home', label: '首页', icon: 'spark', emoji: '🏠', page: 'home' },
  { kind: 'item', id: 'write', label: '写入', icon: 'receipt', emoji: '✍️', page: 'write' },
  { kind: 'item', id: 'retrieval', label: '检索', icon: 'search', emoji: '🔍', page: 'retrieval' },
  // 批次54：反馈上移到工作台（检索下方），不再放治理组；批次55 「用户反馈」改名「反馈」
  { kind: 'item', id: 'feedback', label: '反馈', icon: 'pen', emoji: '💬', page: 'feedback' },
  { kind: 'item', id: 'monitor', label: '监控', icon: 'play', emoji: '📡', page: 'monitor' },
  { kind: 'group', label: '记忆管理' },
  { kind: 'item', id: 'memory-bank', label: '记忆库', icon: 'db', emoji: '🗄', page: 'memory', href: '?tab=all' },
  { kind: 'item', id: 'personal-memory', label: '个人记忆库', icon: 'user', emoji: '👤', page: 'personal' },
  { kind: 'item', id: 'layered', label: '层级管理', icon: 'layers', emoji: '🧬', page: 'layered' },
  { kind: 'item', id: 'lifecycle', label: '生命周期', icon: 'clock', emoji: '♻️', page: 'lifecycle' },
  { kind: 'item', id: 'growth', label: '净化生长', icon: 'layers', emoji: '🌱', page: 'growth' },
  { kind: 'item', id: 'dispute', label: '冲突裁决', icon: 'warn', emoji: '⚖️', page: 'dispute' },
  { kind: 'group', label: '连接' },
  { kind: 'item', id: 'agent', label: 'Agent 接入', icon: 'agent', emoji: '🔌', page: 'agent' },
  { kind: 'item', id: 'mcp-clients', label: 'MCP 接入', icon: 'agent', emoji: '🧩', page: 'mcp' },
  { kind: 'item', id: 'web-onboard', label: '网页端接入', icon: 'link', page: 'webonboard' },
  { kind: 'item', id: 'cost', label: '大模型配置', icon: 'chart', emoji: '🧠', page: 'models' },
  { kind: 'item', id: 'sync', label: '同步中枢', icon: 'sync', emoji: '🔄', page: 'sync' },
  { kind: 'group', label: '治理' },
  /**
   * T3（管理员与成员权限设计 §14.1）：「管理台」复用 security.html 的「检查摘要」页签，
   * 不新增第 23 个 HTML 入口。仅管理员可见（成员侧由 Workspace 过滤），管理员登录后默认落该视图。
   */
  { kind: 'item', id: 'admin-console', label: '管理台', icon: 'system', page: 'security', href: '?tab=overview' },
  { kind: 'item', id: 'params', label: '全局参数', icon: 'gear', emoji: '⚙️', page: 'params' },
  { kind: 'item', id: 'security', label: '账号与安全', icon: 'shield', emoji: '🛡', page: 'security' },
  { kind: 'item', id: 'logs', label: '日志记录', icon: 'list', emoji: '📜', page: 'logs' },
  { kind: 'item', id: 'audit', label: '审计日志', icon: 'book', emoji: '🧾', page: 'audit' },
  { kind: 'item', id: 'setup', label: '首启向导', icon: 'gear', page: 'setup' },
  { kind: 'group', label: '智能' },
  { kind: 'item', id: 'assistant', label: '记忆助手', icon: 'spark', page: 'assistant' },
];

/** 扁平化（父项 + 子项），供按 id 查找 */
export function flattenNav(entries: NavEntry[] = NAV): NavItem[] {
  const out: NavItem[] = [];
  for (const e of entries) {
    if (e.kind !== 'item') continue;
    out.push(e);
    if (e.children) out.push(...flattenNav(e.children));
  }
  return out;
}

export function findNav(id: string): NavItem | undefined {
  return flattenNav().find((n) => n.id === id);
}

export type IconName =
  | 'spark' | 'db' | 'table' | 'user' | 'layers' | 'warn' | 'lock' | 'receipt'
  | 'search' | 'clock' | 'book' | 'list' | 'shield' | 'chart' | 'play' | 'sync'
  | 'gear' | 'agent' | 'plus' | 'refresh' | 'export' | 'filter' | 'panel' | 'fold'
  | 'copy' | 'archive' | 'key' | 'check' | 'scale' | 'play2' | 'info' | 'help'
  | 'unlock' | 'eye' | 'eye-off' | 'broken' | 'ring' | 'system' | 'sun' | 'moon' | 'terminal'
  | 'chev' | 'caret' | 'x' | 'folder' | 'link' | 'dot' | 'save' | 'undo' | 'more' | 'pen';

/** 壳层自己就能完成的动作（真实改变界面状态，不伪造业务结果） */
export type ShellAction =
  | 'toggleTaskPane' | 'toggleNav' | 'toggleDock' | 'toggleStatus' | 'density'
  | 'zoom' | 'resetLayout' | 'refresh' | 'openPalette' | 'theme';

/** 上下文命令（v5 命令条）：当前视图的高频命令；只收壳层真实能力（跳转 / 壳层动作），不伪造业务结果 */
export interface CmdItem {
  label: string;
  icon: IconName;
  go?: PageKey;
  href?: string;
  action?: ShellAction;
  kbd?: string;
  primary?: boolean;
}

const REREAD: CmdItem = { label: '重读', icon: 'refresh', action: 'refresh', kbd: 'F5' };

/** 44px 上下文命令条的每视图命令（v5）：跳转与壳层动作都是真实能力；页面内操作留在页面内 */
export const CMDS: Partial<Record<PageKey, CmdItem[]>> = {
  home: [
    { label: '写入记忆', icon: 'plus', go: 'write', primary: true },
    REREAD,
  ],
  memory: [
    { label: '写入记忆', icon: 'plus', go: 'write', primary: true },
    { label: '已归档', icon: 'archive', go: 'memory', href: '?tab=all&status=archived' },
    { label: '冲突裁决', icon: 'warn', go: 'dispute' },
    REREAD,
  ],
  personal: [
    { label: '记忆库', icon: 'db', go: 'memory', href: '?tab=all' },
    REREAD,
  ],
  write: [
    { label: '检索', icon: 'search', go: 'retrieval', kbd: 'F6' },
    REREAD,
  ],
  retrieval: [
    { label: '写入记忆', icon: 'plus', go: 'write', primary: true },
    REREAD,
  ],
  layered: [
    { label: '记忆库', icon: 'db', go: 'memory', href: '?tab=all' },
    REREAD,
  ],
  dispute: [
    { label: '记忆库', icon: 'db', go: 'memory', href: '?tab=all' },
    REREAD,
  ],
  lifecycle: [REREAD],
  audit: [REREAD],
  logs: [REREAD],
  security: [REREAD],
  growth: [REREAD],
  models: [REREAD],
  monitor: [REREAD],
  sync: [REREAD],
  params: [REREAD],
  agent: [REREAD],
  mcp: [REREAD],
  webonboard: [REREAD],
  feedback: [REREAD],
  assistant: [REREAD],
  setup: [REREAD],
};

/** Ctrl+1..8 快速切换的前 8 个视图（v5 快捷键表；id 为导航项 id） */
export const QUICK_VIEWS: string[] = ['home', 'memory-bank', 'write', 'retrieval', 'cost', 'security', 'audit', 'logs'];

/** 命令面板分组顺序（v5）：原菜单 + Ribbon 全量命令收进面板，禁用项带原因 */
export const PALETTE_GROUPS = ['转到页面', '执行', '工具 · 诊断直达', '视图 · 布局', '帮助'] as const;

/** 命令面板条目：run 由 Workspace 注入（依赖壳层状态）；禁用项必须给出原因 */
export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  icon: IconName;
  desc?: string;
  kbd?: string;
  disabled?: boolean;
  reason?: string;
  run?: () => void;
}

export type BottomTabId = 'output' | 'problems' | 'audit' | 'tasks' | 'term';

export interface BottomTab {
  id: BottomTabId;
  label: string;
  icon: IconName;
  /** 程序暂无该数据源时的诚实说明 */
  unavailable?: string;
}

/**
 * 底部五标签（S6）：输出/问题/审计/任务接真实数据源（见 dock.ts），
 * 终端仍为不可用（程序确实没有命令通道）。运行期不可用（如浏览器模式）由面板正文给原因，不预置假数字。
 */
export const BOTTOM_TABS: BottomTab[] = [
  { id: 'output', label: '输出', icon: 'receipt' },
  { id: 'problems', label: '问题', icon: 'warn' },
  { id: 'audit', label: '审计', icon: 'book' },
  { id: 'tasks', label: '任务', icon: 'clock' },
  { id: 'term', label: '终端', icon: 'terminal', unavailable: '程序未提供终端命令通道，本标签不可用。' },
];

/** 判断某页是否在导航中可达（供测试与 D3 校验） */
export function navPages(): PageKey[] {
  return flattenNav()
    .map((n) => n.page)
    .filter((p): p is PageKey => Boolean(p));
}
