// 程序运行日志「人话」层（批次24）：把 actions.log 的 scope:action + detail 翻成一句中文。
// 口径来源 = 真实落盘的 scope/action（src/shared/actionLog.ts 定义格式，主进程 actionLog / 渲染层 uiLog 写入）。
// 诚实原则：字典只负责「翻译」，不改写事实；命中不了的 action 原样带出（作用域中文 + 原始动作名），绝不编「未知操作」。
import type { ProgramLogLine } from './programLog.ts';

/** 作用域中文（与 AGENTS.md §4 的 scope 口径一致） */
export const SCOPE_LABEL: Record<string, string> = {
  app: '应用', ui: '界面操作', host: '宿主桥', ipc: '主进程', home: '登录后端',
  onboarding: 'Agent 接入服务', backup: '备份', dataRoot: '数据目录', kernel: '记忆内核',
  mcp: 'MCP 服务', webhook: 'Webhook', collector: '采集器', log: '日志',
};

/** 精确到 scope:action 的中文说明（真实在用的动作；新增动作在此补，不要在页面复制规则） */
const ACTION_LABEL: Record<string, string> = {
  'app:bootstrap': '应用启动',
  'ui:click': '点击控件',
  'ui:submit': '提交表单',
  'ui:change': '修改输入',
  'ui:page_view': '进入页面',
  'ui:script_error': '页面脚本报错',
  'ui:unhandled_rejection': '页面未捕获的异步错误',
  'ui:program_log_copy': '复制诊断信息',
  'home:login': '登录请求',
  'home:login_ok': '登录成功',
  'home:login_fail': '登录失败',
  'home:logout': '退出登录',
  'home:origin_rejected': '拒绝未信任的页面来源',
  'home:http': '登录后端请求',
  'home:account': '账号变更',
  'home:mirror': '动作镜像入账本',
  'onboarding:http': '接入服务请求',
  'onboarding:auto-onboard': '登录后自动接入 Agent',
  'onboarding:scan': '本机 Agent 扫描',
  'mcp:client-wire': '写入 MCP 客户端配置',
  'mcp:recall': 'MCP 召回记忆',
  'mcp:write': 'MCP 写入记忆',
  'kernel:l0:migrate-backup': 'L0 迁移前备份',
  'kernel:l0:migrate-backup-fail': 'L0 迁移备份失败',
  'kernel:legacy:demote-backup': '清理遗留账本前备份',
  'kernel:legacy:demote-backup-fail': '清理遗留账本备份失败',
  'kernel:legacy:demote': '遗留账本清理完成',
  'backup:run': '执行备份',
  'backup:rotate': '清理过期备份',
  'dataRoot:change': '切换数据目录',
  'collector:batch': '采集一批会话',
  'webhook:push': '推送 Webhook',
};

/** IPC / 宿主桥通道（ipc:xxx、host:xxx 的 action 就是通道名）中文说明 */
const CHANNEL_LABEL: Record<string, string> = {
  'storage:putMemory': '保存记忆',
  'storage:getMemory': '读取记忆',
  'storage:listMemories': '列出记忆',
  'storage:deleteMemory': '删除记忆',
  'storage:appendAudit': '追加审计',
  'storage:queryAudit': '查询审计',
  'storage:location': '查询数据位置',
  'storage:openMemoryFile': '打开记忆文件',
  'hostScan:run': '本机扫描',
  'hostAgentDetect:run': '检测本机 Agent',
  'hostAgentDetect:config': '读取 Agent 配置',
  'mcp:clients': '扫描 MCP 客户端配置',
  'mcp:clientSnippet': '生成 MCP 接入片段',
  'mcp:clientWire': '写入 MCP 客户端配置',
  'collector:triggerNow': '立即采集',
  'collector:status': '查询采集状态',
  'backup:getConfig': '读取备份配置',
  'backup:saveConfig': '保存备份配置',
  'backup:chooseDir': '选择备份目录',
  'backup:runNow': '立即备份',
  'backup:list': '列出备份',
  'dataRoot:get': '读取数据目录',
  'dataRoot:open': '打开数据目录',
  'dataRoot:change': '切换数据目录',
  'dataRoot:restoreDefault': '恢复默认数据目录',
  'floatAttribution:detectClaude': '悬浮窗检测来源',
  'floatAttribution:setPosition': '悬浮窗移位',
  'floatAttribution:open': '打开悬浮窗',
  'floatAttribution:close': '关闭悬浮窗',
  'log:tail': '读取程序日志',
  'l0:status': 'L0 状态',
  'l0:setup': 'L0 初始化',
  'l0:changePassword': 'L0 改管理密码',
  'l0:requestAccess': '提交 L0 查阅申请',
  'l0:listRequests': '列出 L0 申请',
  'l0:listGrants': '列出 L0 授权',
  'l0:grant': '发放 L0 授权',
  'l0:deny': '驳回 L0 申请',
  'l0:revoke': '撤销 L0 授权',
  'l0:unlock': '解锁 L0 查阅',
  'l0:heartbeat': 'L0 会话续期',
  'l0:lock': '锁定 L0',
  'l0:writeUnlock': '解锁 L0 写密钥',
  'l0:writeLock': '锁定 L0 写密钥',
  'l0:seal': '加密 L0',
  'l0:decrypt': '解密 L0',
  'l0:sessionInfo': '查询 L0 会话',
  'l0:migrate': '迁移 L0 明文',
  'legacy:scan': '预览遗留账本脏行',
  'legacy:demote': '清理遗留账本（降级回 L1）',
};

/** 摘要优先展示的关键字段（越靠前越能解释「发生了什么」） */
const NOTE_KEYS = [
  'error', 'reason', 'message', 'origin', 'status', 'method', 'path', 'denied', 'rejected',
  'page', 'testid', 'text', 'trigger', 'agent', 'client', 'count', 'lines', 'hits', 'tokens',
  'durationMs', 'ms', 'dir', 'mem_id', 'memory_id', 'request_id', 'copied', 'ok', 'result',
];

/** k 为空串表示「这个字段的值本身就是一句话」（error/reason/message/text），不再挂前缀 */
const kv = (k: string, v: string): string => (k ? `${k}=${v}` : v);

/** 从 detail 文本里抽关键字段拼成人话摘要；对截断的 JSON 同样有效（日志正文已脱敏） */
export function detailNote(detail: string, max = 160): string {
  const text = detail.trim();
  if (!text) return '';
  const pairs: Array<[string, string]> = [];
  const re = /"([a-zA-Z_][\w.-]*)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const rawVal = m[2].replace(/^"|"$/g, '').replace(/\\"/g, '"');
    if (!rawVal) continue;
    pairs.push([key, rawVal]);
  }
  if (pairs.length === 0) {
    // 不是 {"k":v} 结构（如纯文本错误输出）→ 原样带出，不加工
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
  const picked: string[] = [];
  const used = new Set<string>();
  for (const key of NOTE_KEYS) {
    const hit = pairs.find(([k]) => k === key);
    if (!hit || used.has(hit[0])) continue;
    used.add(hit[0]);
    picked.push(kv(key === 'text' || key === 'message' || key === 'error' || key === 'reason' ? '' : hit[0], hit[1]));
  }
  if (picked.length === 0) {
    for (const [k, v] of pairs.slice(0, 4)) picked.push(kv(k, v));
  }
  const joined = picked.filter(Boolean).join(' · ');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

/** 一句人话标题：优先精确字典，其次 IPC 通道字典，最后「作用域中文 + 原始动作名」 */
export function actionTitle(scope: string, action: string): string {
  const scopeCn = SCOPE_LABEL[scope] ?? (scope || '日志');
  const exact = ACTION_LABEL[`${scope}:${action}`];
  if (exact) return exact;
  const ch = CHANNEL_LABEL[action];
  if (ch) return `${scopeCn}：${ch}`;
  if (action.startsWith('bootstrap')) return `${scopeCn}：应用启动`;
  return `${scopeCn}：${action}`;
}

export const LEVEL_LABEL: Record<ProgramLogLine['level'], string> = {
  info: '运行',
  warn: '提醒',
  error: '错误',
  unknown: '日志',
};

export interface HumanLogLine {
  /** 中文动作说明 */
  title: string;
  /** 关键字段摘要（已截断） */
  note: string;
  /** 级别中文 */
  level: string;
  /** 原始 scope:action（便于对照与反馈维护者） */
  code: string;
}

/** 把一行程序日志翻译成人话（纯函数，单测覆盖正常/未收录/畸形三种路径） */
export function humanizeProgramLog(line: ProgramLogLine): HumanLogLine {
  if (!line.scope && !line.action) {
    return { title: '未格式化输出', note: line.message, level: LEVEL_LABEL.unknown, code: '' };
  }
  return {
    title: actionTitle(line.scope, line.action),
    note: detailNote(line.message),
    level: LEVEL_LABEL[line.level],
    code: `${line.scope}:${line.action}`,
  };
}
