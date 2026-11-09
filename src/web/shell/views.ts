// 工作台壳层的视图映射（批次48 S1）。
//
// 口径：壳只负责「导航 + 标签 + 面板框架」，中心区以 iframe 承载**已真实落地**的页面。
// - 每个导航项要么指向一个真实 HTML 页面，要么明确给出「程序暂无该视图」的原因；
//   绝不出现演示计数、编造读数或「—」占位。
// - overview.html 是可直达的演示通览，按 D3 不进主导航。
// - 个人记忆有真实独立存储（第一轮本机闭环）：静态导航只带入口，待确认计数由页面按真实内核回传

export type PageKey =
  | 'home' | 'login' | 'memory' | 'write' | 'retrieval'
  | 'lifecycle' | 'audit' | 'logs' | 'security' | 'growth' | 'models'
  | 'monitor' | 'sync' | 'params' | 'setup' | 'agent'
  | 'layered' | 'dispute' | 'feedback';

/** 真实页面清单（文件名与 vite.config.ts 的 rollupOptions.input 对齐） */
export const PAGES: Record<PageKey, { file: string; label: string; source: string }> = {
  home: { file: 'index.html', label: '概览页', source: 'getHomeFeed（单次账本读取）+ /api/health + llm:billing' },
  // login.html 为可直达兜底页（不进主导航）；主流程入口是壳层登录弹窗
  login: { file: 'login.html', label: '登录与会话页', source: 'POST /api/login · /api/me · session:realpage' },
  memory: { file: 'memory.html', label: '记忆管理六标签页', source: '账本清单 + 分层策略 + L0 会话 + 冲突队列' },
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
  layered: { file: 'memory-layered.html', label: '记忆层级管理页', source: 'REQ-006 P8 · L0–L6 真实账本' },
  dispute: { file: 'dispute.html', label: '冲突裁决页', source: 'REQ-006 P7 · 内核真实 pending 冲突队列' },
  feedback: { file: 'feedback.html', label: '用户反馈页', source: 'REQ-006 P9 · 真实账本反馈' },
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

/** 功能导航树：批次54 按用户参考图重排为四组 17 项；每项映射到真实 HTML，角标一律动态读真账本，不写死示例数。
 *  - 登录仍走壳层弹窗（login.html 只作深链兜底，不占主导航）；
 *  - 首启设置由 Electron 向导直接打开（setup.html），不在主导航露面；
 *  - 旧「记忆管理」可展开子树收敛为平铺入口，分层/冲突/反馈改指各自独立真实页面。
 */
export const NAV: NavEntry[] = [
  { kind: 'group', label: '工作台' },
  { kind: 'item', id: 'home', label: '首页', icon: 'spark', page: 'home' },
  { kind: 'item', id: 'write', label: '写入', icon: 'receipt', page: 'write' },
  { kind: 'item', id: 'retrieval', label: '检索', icon: 'search', page: 'retrieval' },
  { kind: 'item', id: 'monitor', label: '监控', icon: 'play', page: 'monitor' },
  { kind: 'group', label: '记忆' },
  { kind: 'item', id: 'memory-bank', label: '记忆库', icon: 'db', page: 'memory', href: '?tab=all' },
  { kind: 'item', id: 'layered', label: '层级管理', icon: 'layers', page: 'layered' },
  { kind: 'item', id: 'lifecycle', label: '生命周期', icon: 'clock', page: 'lifecycle' },
  { kind: 'item', id: 'growth', label: '净化生长', icon: 'layers', page: 'growth' },
  { kind: 'item', id: 'dispute', label: '冲突裁决', icon: 'warn', page: 'dispute' },
  { kind: 'group', label: '连接' },
  { kind: 'item', id: 'agent', label: 'Agent 接入', icon: 'agent', page: 'agent' },
  { kind: 'item', id: 'cost', label: '大模型配置', icon: 'chart', page: 'models' },
  { kind: 'item', id: 'sync', label: '同步中枢', icon: 'sync', page: 'sync' },
  { kind: 'group', label: '治理' },
  { kind: 'item', id: 'params', label: '全局参数', icon: 'gear', page: 'params' },
  { kind: 'item', id: 'security', label: '账号与安全', icon: 'shield', page: 'security' },
  { kind: 'item', id: 'logs', label: '日志记录', icon: 'list', page: 'logs' },
  { kind: 'item', id: 'audit', label: '审计日志', icon: 'book', page: 'audit' },
  { kind: 'item', id: 'feedback', label: '用户反馈', icon: 'pen', page: 'feedback' },
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

export interface RibbonItem {
  label: string;
  icon: IconName;
  /** 跳转到真实页面 */
  go?: PageKey;
  /** 页面初值（D4），与 go 同时使用 */
  href?: string;
  /** 壳层内动作（由 Workspace 实现） */
  action?: ShellAction;
  big?: boolean;
  kbd?: string;
  /** 程序无此能力时给出的诚实原因（同时禁用按钮） */
  unavailable?: string;
}

export interface RibbonGroup {
  label: string;
  items: RibbonItem[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

/** 壳层自己就能完成的动作（真实改变界面状态，不伪造业务结果） */
export type ShellAction =
  | 'toggleTaskPane' | 'foldRibbon' | 'toggleDock' | 'toggleStatus' | 'density'
  | 'zoom' | 'resetLayout' | 'refresh' | 'focusFilter';

/** 功能区：8 分页，视觉分组取自定稿；每条命令要么跳真实页面，要么明确「未接入」 */
export const RIBBON: RibbonTab[] = [
  {
    id: 'start', label: '开始', groups: [
      { label: '剪贴板', items: [{ label: '复制 ID', icon: 'copy', action: 'focusFilter' }] },
      {
        label: '记忆', items: [
          { label: '新建记忆', icon: 'plus', go: 'write', big: true, kbd: 'Ctrl+N' },
          { label: '打开回执', icon: 'receipt', go: 'write', big: true },
          { label: '归档（需登录）', icon: 'archive', go: 'memory', href: '?tab=all&status=archived' },
          { label: '锁定行（本地）', icon: 'lock', go: 'memory', href: '?tab=all' },
          { label: '解锁 L0', icon: 'key', go: 'memory', href: '?tab=l0' },
        ],
      },
      {
        label: '筛选', items: [
          { label: '仅冲突', icon: 'filter', go: 'memory', href: '?tab=conflict' },
          { label: '刷新', icon: 'refresh', action: 'refresh', kbd: 'F5' },
          { label: '在库中查找', icon: 'search', action: 'focusFilter', kbd: 'Ctrl+F' },
        ],
      },
      {
        label: '视图', items: [
          { label: '记忆列表', icon: 'list', go: 'memory', href: '?tab=all' },
          { label: '任务窗格', icon: 'panel', action: 'toggleTaskPane' },
          { label: '折叠功能区', icon: 'fold', action: 'foldRibbon' },
        ],
      },
      {
        label: '帮助', items: [
          { label: '快捷键', icon: 'help', unavailable: '程序未提供快捷键清单页' },
          { label: '限制说明', icon: 'info', unavailable: '程序未提供限制说明页' },
        ],
      },
    ],
  },
  {
    id: 'memory', label: '记忆', groups: [
      {
        label: '分层内容', items: [
          { label: '分层内容', icon: 'layers', go: 'memory', href: '?tab=layers', big: true },
          { label: '解锁 L0', icon: 'key', go: 'memory', href: '?tab=l0', big: true },
          { label: '查看 L1 注入', icon: 'eye', unavailable: '程序未提供 L1 注入明细视图' },
          { label: 'L0 密文说明', icon: 'lock', go: 'memory', href: '?tab=l0' },
        ],
      },
      {
        label: '生命周期', items: [
          { label: '归档（需登录）', icon: 'archive', go: 'memory', href: '?tab=all&status=archived', big: true },
          { label: '激活', icon: 'play', go: 'lifecycle' },
          { label: '转入休眠', icon: 'moon', go: 'lifecycle' },
        ],
      },
      {
        label: '写入与去重', items: [
          { label: '新建记忆', icon: 'plus', go: 'write', big: true },
          { label: '写入预检', icon: 'check', go: 'write' },
          { label: '去重策略', icon: 'scale', go: 'growth' },
        ],
      },
      {
        label: '审计', items: [
          { label: '查看审计', icon: 'book', go: 'audit', big: true },
          { label: '导出审计', icon: 'export', go: 'audit' },
          { label: '保留策略', icon: 'clock', go: 'params' },
        ],
      },
    ],
  },
  {
    id: 'retrieve', label: '检索与写入', groups: [
      {
        label: '检索', items: [
          { label: '运行检索', icon: 'search', go: 'retrieval', big: true, kbd: 'F6' },
          { label: '检索筛选', icon: 'filter', go: 'retrieval' },
        ],
      },
      {
        label: '写入', items: [
          { label: '新建记忆', icon: 'plus', go: 'write', big: true },
          { label: '写入预检', icon: 'check', go: 'write' },
        ],
      },
      {
        label: '接口', items: [
          { label: 'ma.read 快照', icon: 'db', go: 'home', big: true },
          { label: 'Agent 探针', icon: 'agent', go: 'agent' },
          { label: '检索结果导出', icon: 'export', go: 'retrieval' },
        ],
      },
    ],
  },
  {
    id: 'growth', label: '生长', groups: [
      {
        label: '回归', items: [
          { label: '运行回归', icon: 'play', go: 'growth', big: true },
          { label: '样本集', icon: 'db', go: 'growth', big: true },
          { label: '放行门槛', icon: 'check', go: 'params' },
          { label: '回归状态', icon: 'warn', go: 'growth' },
        ],
      },
      {
        label: '调度', items: [
          { label: '调度状态', icon: 'clock', go: 'monitor', big: true },
          { label: '宿主注册', icon: 'link', go: 'monitor' },
          { label: '下次到期', icon: 'clock', go: 'monitor' },
        ],
      },
      {
        label: '配置', items: [
          { label: '评估参数', icon: 'gear', go: 'params' },
          { label: '回归报告', icon: 'book', go: 'growth' },
        ],
      },
    ],
  },
  {
    id: 'cost', label: '成本', groups: [
      {
        label: '余额', items: [
          { label: '余额探测', icon: 'ring', go: 'models', big: true, kbd: 'F7' },
          { label: '手工兜底', icon: 'user', go: 'models' },
          { label: '本地推算', icon: 'scale', go: 'models' },
        ],
      },
      {
        label: '预算与账本', items: [
          { label: '成本台账', icon: 'chart', go: 'models', big: true },
          { label: 'cost_cap', icon: 'gear', go: 'models' },
          { label: '导出账本', icon: 'export', go: 'audit' },
        ],
      },
      {
        label: '口径', items: [{ label: '刷新时间', icon: 'refresh', go: 'models' }],
      },
    ],
  },
  {
    id: 'sync', label: '同步', groups: [
      {
        label: '节点', items: [
          { label: '立即同步', icon: 'sync', go: 'sync', big: true, kbd: 'F8' },
          { label: '同步检查', icon: 'play', go: 'sync' },
          { label: '冲突裁决', icon: 'warn', go: 'memory', href: '?tab=conflict' },
        ],
      },
      {
        label: '规则', items: [
          { label: 'L0 排除', icon: 'lock', go: 'sync', big: true },
          { label: '下行游标', icon: 'chev', go: 'sync' },
          { label: 'sha256 幂等', icon: 'check', go: 'sync' },
        ],
      },
      {
        label: '状态', items: [
          { label: '同步状态', icon: 'dot', go: 'sync' },
          { label: '冲突状态', icon: 'broken', go: 'sync' },
        ],
      },
    ],
  },
  {
    id: 'security', label: '安全', groups: [
      {
        label: '体检', items: [
          { label: '安全体检', icon: 'shield', go: 'security', big: true, kbd: 'F9' },
          { label: '会话守卫', icon: 'user', go: 'security' },
          { label: 'L0 密钥', icon: 'key', go: 'memory', href: '?tab=l0' },
        ],
      },
      {
        label: '审计与密钥', items: [
          { label: '审计导出', icon: 'export', go: 'audit', big: true },
          { label: '写密钥策略', icon: 'key', go: 'params' },
        ],
      },
    ],
  },
  {
    id: 'view', label: '视图', groups: [
      {
        label: '面板', items: [
          { label: '任务窗格', icon: 'panel', action: 'toggleTaskPane', big: true },
          { label: '折叠功能区', icon: 'fold', action: 'foldRibbon', big: true },
          { label: '底部面板', icon: 'panel', action: 'toggleDock' },
          { label: '重置布局', icon: 'refresh', action: 'resetLayout' },
        ],
      },
      {
        label: '显示', items: [
          { label: '状态栏', icon: 'list', action: 'toggleStatus' },
          { label: '紧凑密度', icon: 'table', action: 'density' },
          { label: '缩放', icon: 'gear', action: 'zoom' },
        ],
      },
    ],
  },
];

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
