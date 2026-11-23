// 底部「输出 / 问题」面板的人话翻译层（2026-11-22）：
// 用户只看「发生了什么 / 对我有什么影响 / 要不要处理」，原始 scope:action 与 JSON 正文收进可展开的「技术详情」。
// 原则：人话行绝不拼接 scope:action、字段名或 JSON；映射不到的动作也只给中文类别名，不泄漏内部标识。
import type { ProgramLogLine } from '../Home/programLog.ts';

/** action = 需要用户动手；notice = 只是提醒；info = 正常动作，仅输出页展示 */
export type HumanSeverity = 'action' | 'notice' | 'info';

export interface HumanLogLine {
  severity: HumanSeverity;
  /** 发生了什么（一句中文，不含内部字段） */
  title: string;
  /** 对用户的影响；info 行为空 */
  effect: string;
  /** 要不要处理；info 行为空 */
  todo: string;
  /** 技术详情正文（原始 scope:action + 原始 detail），只在折叠区出现 */
  tech: string;
  /** 是否包含可展开的技术详情 */
  hasTech: boolean;
}

type LineLike = Pick<ProgramLogLine, 'level' | 'scope' | 'action' | 'message'>;

/** 已知动作 → 中文名（输出页与问题页共用；未知动作只给类别名，不显示内部标识） */
const ACTION_LABEL: Record<string, string> = {
  'refine:state': '查看补炼队列',
  'refine:backfill-scan': '整理补炼队列',
  'refine:enqueue': '补炼队列入列',
  'mcp:clients': '检查本机 AI 客户端',
  'l0:status': '检查 L0 会话',
  'l0:writeUnlocked': '检查写密钥',
  'l0:pendingWrites': '检查待写内容',
  'storage:location': '查询账本位置',
  'collector:status': '检查后台采集',
  'collector:retry': '后台采集重试',
  'backend_param_rejected': '校正页面启动地址',
  'kernel:invoke': '读写记忆账本',
};

/** 中文类别（映射不到时用，绝不回退到 scope:action） */
function fallbackLabel(scope: string): string {
  if (scope === 'bootstrap') return '应用启动';
  if (scope === 'ui') return '页面加载';
  if (scope === 'ipc') return '本机后台调用';
  if (scope === 'storage' || scope === 'kernel') return '记忆账本读写';
  if (scope === 'l0') return 'L0 原文库';
  if (scope === 'mcp') return 'AI 客户端接入';
  if (scope === 'refine') return '补炼队列';
  if (scope === 'collector') return '后台采集';
  if (scope === 'llm' || scope === 'gateway') return '大模型调用';
  if (scope === 'schedule' || scope === 'cron') return '定时任务';
  return '后台动作';
}

/** 输出页的一行中文动作名（不出现 scope:action 原文） */
export function humanActionLabel(scope: string, action: string): string {
  return ACTION_LABEL[`${scope}:${action}`] ?? ACTION_LABEL[action] ?? fallbackLabel(scope);
}

function techOf(line: LineLike): string {
  const code = [`${line.scope}:${line.action}`.replace(/^:/, ''), line.message.trim()].filter(Boolean).join(' · ');
  return code || '（这行日志没有附带细节）';
}

/** 是否属于「没登录」这一类预期状态（不是故障，不该吓用户） */
function isNoSession(text: string): boolean {
  return /no_session|未登录|not logged in|unauthorized|E_AUTH_SESSION/i.test(text);
}

function make(
  severity: HumanSeverity,
  title: string,
  effect: string,
  todo: string,
  line: LineLike,
): HumanLogLine {
  const tech = techOf(line);
  return { severity, title, effect, todo, tech, hasTech: true };
}

/**
 * 把一条真实程序日志翻成用户能读懂的三段：发生了什么 / 影响 / 要不要处理。
 * info 级别（正常动作）只给中文动作名，不带影响与处理建议。
 */
export function humanizeLogLine(line: LineLike): HumanLogLine {
  const key = `${line.scope}:${line.action}`;
  const text = `${line.action} ${line.message}`;

  // 1) 未登录导致的只读/拒绝：预期状态，不是故障
  if (isNoSession(text) && (line.level === 'warn' || line.level === 'error')) {
    return make(
      'notice',
      '本机还没登录，这一项暂时只读',
      '只是这一项被挡了一下，已有记忆和你看到的数据都不受影响',
      '不用处理：登录后会自动恢复',
      line,
    );
  }

  // 2) 页面启动地址参数不合法（已自动兜底，功能不受影响）
  if (key === 'ui:backend_param_rejected') {
    return make(
      'notice',
      '启动地址参数没对上，已自动改用本机地址',
      '只是这次启动多走了一次备用地址，功能不受影响',
      '不用处理；排查问题时可在技术详情里看到原始参数',
      line,
    );
  }

  // 3) 本机 AI 客户端检查超时（首页/接入页会重试）
  if (key === 'ipc:mcp:clients' || key === 'mcp:clients') {
    return make(
      'notice',
      '检查本机 AI 客户端时没等到回应',
      '只是这次没查完，客户端接入状态可能显示得慢一点',
      '不用处理；想立刻看结果可到「MCP 接入」页手动刷新',
      line,
    );
  }

  // 4) 写密钥 / L0 锁定类
  if (line.scope === 'l0' || /写密钥|锁定|unlock/i.test(text)) {
    const unlocked = /unlock|解锁/i.test(text) && line.level === 'info';
    if (unlocked) return make('info', '写密钥已解锁', '', '', line);
    return make(
      'action',
      '写密钥状态没读上来',
      '查看已有记忆不受影响，只有需要写入时才会用到写密钥',
      '需要写入时点首页提示里的「去解锁」',
      line,
    );
  }

  // 5) 账本读写异常
  if (/storage|kernel|memory/i.test(key)) {
    return make(
      'action',
      '读写记忆账本时遇到一个异常',
      '这一项读数可能暂时为空，已有数据没有被改动',
      '稍后会自动重试；连续出现时把技术详情发给支持',
      line,
    );
  }

  // 6) 其它：给中文类别名，原始字段只进技术详情
  const label = humanActionLabel(line.scope, line.action);
  return make(
    line.level === 'error' ? 'action' : 'notice',
    `${label}时遇到一个异常`,
    '这一项可能显示不全，已有数据不受影响',
    line.level === 'error' ? '建议留意；反复出现时把技术详情发给支持' : '多数会自动重试，可先不处理',
    line,
  );
}

/** 问题页头部人话说明（替代「校验与错误告警 · 由最近的动作日志派生」） */
export function problemsIntro(total: number, actionable: number): string {
  if (total === 0) return '最近这段时间没有发现问题：没有错误，也没有需要提醒的事。';
  if (actionable === 0) return `最近共 ${total} 条提醒，都不需要你处理；下面写清了每条发生了什么。`;
  return `最近共 ${total} 条，其中 ${actionable} 条需要你处理；每条都写明了影响和建议。`;
}
