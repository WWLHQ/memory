// 工作台壳层的视图映射（批次48 S1）。
//
// 口径：壳只负责「导航 + 标签 + 面板框架」，中心区以 iframe 承载**已真实落地**的页面。
// - 每个导航项要么指向一个真实 HTML 页面，要么明确给出「程序暂无该视图」的原因；
//   绝不出现演示计数、编造读数或「—」占位。
// - overview.html 是可直达的演示通览，按 D3 不进主导航。
// - 个人记忆按 D2 标为不可用（程序无该数据模型），不显示任何计数。

export type PageKey =
  | 'home' | 'memory' | 'layered' | 'dispute' | 'write' | 'retrieval'
  | 'lifecycle' | 'audit' | 'logs' | 'security' | 'growth' | 'models'
  | 'monitor' | 'sync' | 'params' | 'setup' | 'agent';

/** 真实页面清单（文件名与 vite.config.ts 的 rollupOptions.input 对齐） */
export const PAGES: Record<PageKey, { file: string; label: string; source: string }> = {
  home: { file: 'index.html', label: '首页 + 登录卡片', source: 'getHomeFeed / health / me' },
  memory: { file: 'memory.html', label: '记忆库管理页', source: '账本清单 + 单条操作' },
  layered: { file: 'memory-layered.html', label: '记忆层级管理页', source: 'L0–L6 分层查阅' },
  dispute: { file: 'dispute.html', label: '冲突裁决页', source: '同步冲突队列 + 三模式裁决' },
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
  /** 页面初值（D4）：`?status=archived` 或 `#l0bar`，由目标页自行解析并真正筛选/定位 */
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

/** 功能导航树：视觉与信息架构取自定稿，数据面一律以真实页面为准 */
export const NAV: NavEntry[] = [
  { kind: 'group', label: '工作区' },
  { kind: 'item', id: 'home', label: '概览', icon: 'spark', page: 'home' },
  { kind: 'group', label: '记忆' },
  {
    kind: 'item', id: 'ledger', label: '记忆管理', icon: 'db', defaultOpen: true, children: [
      { kind: 'item', id: 'ledger-all', label: '全部记忆', icon: 'table', page: 'memory', child: true },
      {
        kind: 'item', id: 'ledger-personal', label: '个人记忆', icon: 'user', child: true,
        unavailable: '程序暂无个人记忆数据模型：没有个人/团队双窗，也没有确认流与计数，故不提供入口读数。',
      },
      { kind: 'item', id: 'ledger-layers', label: '分层 L1–L6', icon: 'layers', page: 'layered', child: true },
      { kind: 'item', id: 'ledger-conflict', label: '冲突待裁决', icon: 'warn', page: 'dispute', child: true },
      { kind: 'item', id: 'ledger-l0', label: 'L0 密文（需解锁）', icon: 'lock', page: 'layered', href: '#l0bar', child: true },
    ],
  },
  { kind: 'item', id: 'write', label: '写入', icon: 'receipt', page: 'write' },
  { kind: 'item', id: 'retrieval', label: '检索', icon: 'search', page: 'retrieval' },
  { kind: 'item', id: 'lifecycle', label: '生命周期', icon: 'clock', page: 'lifecycle' },
  { kind: 'group', label: '治理' },
  { kind: 'item', id: 'audit', label: '审计与日志', icon: 'book', page: 'audit' },
  { kind: 'item', id: 'logs', label: '日志记录', icon: 'list', page: 'logs' },
  { kind: 'item', id: 'security', label: '安全与账号', icon: 'shield', page: 'security' },
  { kind: 'group', label: '智能' },
  { kind: 'item', id: 'growth', label: '生长与自进化', icon: 'layers', page: 'growth' },
  { kind: 'item', id: 'cost', label: '模型与成本', icon: 'chart', page: 'models' },
  { kind: 'group', label: '运行' },
  { kind: 'item', id: 'monitor', label: '监控', icon: 'play', page: 'monitor' },
  { kind: 'item', id: 'sync', label: '同步', icon: 'sync', page: 'sync' },
  { kind: 'item', id: 'params', label: '参数', icon: 'gear', page: 'params' },
  { kind: 'item', id: 'setup', label: '首启设置', icon: 'gear', page: 'setup' },
  { kind: 'item', id: 'agent', label: 'Agent 接入', icon: 'agent', page: 'agent' },
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
  | 'unlock' | 'eye' | 'broken' | 'ring' | 'system' | 'sun' | 'moon' | 'terminal'
  | 'chev' | 'caret' | 'x' | 'folder' | 'link' | 'dot';

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
          { label: '归档（需登录）', icon: 'archive', go: 'memory', href: '?status=archived' },
          { label: '锁定行（本地）', icon: 'lock', go: 'memory' },
          { label: '解锁 L0', icon: 'key', go: 'layered', href: '#l0bar' },
        ],
      },
      {
        label: '筛选', items: [
          { label: '仅冲突', icon: 'filter', go: 'dispute' },
          { label: '刷新', icon: 'refresh', action: 'refresh', kbd: 'F5' },
          { label: '在库中查找', icon: 'search', action: 'focusFilter', kbd: 'Ctrl+F' },
        ],
      },
      {
        label: '视图', items: [
          { label: '记忆列表', icon: 'list', go: 'memory' },
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
          { label: '分层内容', icon: 'layers', go: 'layered', big: true },
          { label: '解锁 L0', icon: 'key', go: 'layered', href: '#l0bar', big: true },
          { label: '查看 L1 注入', icon: 'eye', unavailable: '程序未提供 L1 注入明细视图' },
          { label: 'L0 密文说明', icon: 'lock', go: 'layered', href: '#l0bar' },
        ],
      },
      {
        label: '生命周期', items: [
          { label: '归档（需登录）', icon: 'archive', go: 'memory', href: '?status=archived', big: true },
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
          { label: '检索结果导出', icon: 'export', unavailable: '检索页未提供导出能力' },
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
          { label: '冲突裁决', icon: 'warn', go: 'dispute' },
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
          { label: 'L0 密钥', icon: 'key', go: 'layered', href: '#l0bar' },
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

/** 底部五标签：与定稿一致；每页在 S1 先给诚实「未接入」说明，S6 再逐个接真实数据源 */
export const BOTTOM_TABS: BottomTab[] = [
  { id: 'output', label: '输出', icon: 'receipt', unavailable: '动作日志通道（主进程 log:tail）尚未接入本面板。' },
  { id: 'problems', label: '问题', icon: 'warn', unavailable: '程序暂无统一的「问题」聚合数据源。' },
  { id: 'audit', label: '审计', icon: 'book', unavailable: '审计请在「审计与日志」页查看；本面板尚未接入。' },
  { id: 'tasks', label: '任务', icon: 'clock', unavailable: '程序暂无调度运行记录的持久化存储，无法列出任务。' },
  { id: 'term', label: '终端', icon: 'terminal', unavailable: '程序未提供终端命令通道，本标签不可用。' },
];

/** 判断某页是否在导航中可达（供测试与 D3 校验） */
export function navPages(): PageKey[] {
  return flattenNav()
    .map((n) => n.page)
    .filter((p): p is PageKey => Boolean(p));
}
