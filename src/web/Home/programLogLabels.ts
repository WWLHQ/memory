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
  // 批次41-E：主窗口创建失败（此前只进 main.log、静默 return；现报错并退出）
  'app:bootstrap:window-failed': '主窗口创建失败，应用已报错并退出',
  // 批次41-U：MCP 机器令牌「就绪」此前只在 main.log，日志页查不到；补双写（值只有文件路径，无令牌明文）
  'app:bootstrap:mcp-token-ready': 'MCP 机器令牌已就绪（客户端接入前需配置该令牌）',
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
  // 批次41-R：明细页被点开过没有——此前只进 main.log，日志页（读 actions.log）看不到
  'mcp:recall_detail_view': '打开召回明细页（一次性链接）',
  'mcp:write': 'MCP 写入记忆',
  'llm:config-saved': '保存 LLM 引擎配置',
  'llm:test-engine': 'LLM 引擎连通拨测（真实 HTTP）',
  // 批次39 · L2–L6 后台补炼队列（正文不入日志：只有 mem_id、层名、计数）
  'kernel:refine:backfill-scan': '启动时把存量入队补炼',
  'kernel:refine:backfill-run': '手动把存量入队补炼完成',
  'kernel:refine:enqueue-collected': '新采集的行已排队待补炼',
  'kernel:refine:row': '补炼一行完成（产出层级见摘要）',
  'kernel:refine:set-enabled': '切换后台补炼开关',
  'kernel:refine:set-cap': '设置补炼每日额度（限额 / 不限额）',
  'kernel:refine:retry-failed': '失败行重新入队',
  'kernel:refine:tick-error': '补炼定时异常',
  'kernel:refine:start-error': '补炼队列启动失败',
  'kernel:refine:queue-reconciled': '删除的行里，同步摘掉了补炼队列的幽灵条目',
  'kernel:refine:queue-reconcile-error': '摘除补炼队列幽灵条目失败',
  'kernel:refine:queue-remove-error': '单条删除后摘补炼队列条目失败',
  // 批次41-U：遗忘周期跑完/报错此前只在 main.log，日志页查不到；补双写（值只有计数与原因码，无正文）
  'kernel:forgetting:cycle:done': '遗忘周期跑完一轮（层迁移/冷压缩/合并摘要）',
  'kernel:forgetting:cycle:error': '遗忘周期本轮报错',
  'kernel:l0:migrate-backup': 'L0 迁移前备份',
  'kernel:l0:migrate-backup-fail': 'L0 迁移备份失败',
  'kernel:legacy:demote-backup': '清理遗留账本前备份',
  'kernel:legacy:demote-backup-fail': '清理遗留账本备份失败',
  'kernel:legacy:demote': '遗留账本清理完成',
  'kernel:ledger:reset-backup': '清空记忆库前备份',
  'kernel:ledger:reset-backup-fail': '清空记忆库备份失败',
  'kernel:ledger:reset-rejected': '清空记忆库被拒（确认口令不符）',
  'kernel:ledger:reset-recollect': '记忆库清空并按新规则重采',
  'kernel:rules:rejudge-backup': '存量重判前备份',
  'kernel:rules:rejudge-backup-fail': '存量重判备份失败',
  'kernel:rules:rejudge-rejected': '存量重判被拒（确认口令不符）',
  'kernel:rules:rejudge-run': '存量按当前质量门重判完成',
  // 批次41-T：存量补齐 sha256 / 向量（只填两个空字段，不删行、不改正文）
  'kernel:ledger:fields-backup': '存量字段回填前备份',
  'kernel:ledger:fields-backup-fail': '存量字段回填备份失败',
  'kernel:ledger:fields-backfill': '存量补齐缺失的指纹与向量完成',
  'kernel:l0:store-corrupt': 'L0 原数据库读不动（原件已改名隔离，本次按空库启动）',
  // 批次41-A：审计搬出记忆库后，这四个键是「审计账本在哪、有没有迁过、有没有坏行」的唯一人话入口
  'kernel:audit:log-open': '内核审计账本已打开（独立追加文件，不再随记忆库整档读写）',
  'kernel:audit:log-migrated': '历史审计已从记忆库搬进审计账本',
  'kernel:audit:log-bad-lines': '审计账本里有解析不出来的行（只计数，不猜内容）',
  'kernel:audit:log-corrupt': '审计账本整档读不认（原件已改名隔离，本次按空账本继续）',
  'kernel:audit:log-backup': '搬移历史审计前的备份（记忆库 + L0 库 + 密钥环）',
  'kernel:audit:log-migrate-skipped': '本次没搬历史审计（备份没做成）——原样留在记忆库里，读与查照旧',
  'kernel:l0:split-backup': '存量拆分迁移前备份（记忆库 + L0 库 + 密钥环）',
  'kernel:l0:split-backup-fail': '存量拆分迁移备份失败',
  'kernel:l0:split-rejected': '存量拆分迁移被拒（口令不符或未解锁 L0 写密钥）',
  'kernel:l0:split-run': '存量 L0 原文搬入原数据库完成',
  'kernel:l0:rebuild-backup': '按 L0 重建前备份（记忆库 + L0 库 + 密钥环）',
  'kernel:l0:rebuild-backup-fail': '按 L0 重建备份失败',
  'kernel:l0:rebuild-rejected': '按 L0 重建被拒（口令不符或未解锁 L0 查阅会话）',
  'kernel:l0:rebuild-run': '按 L0 原文重建 L1–L6 完成',
  'kernel:l0:recovery-issued': 'L0 恢复码已生成（旧码当场作废）',
  'kernel:l0:recovery-exported': 'L0 恢复卡已导出到文件',
  'kernel:l0:recovery-export-canceled': 'L0 恢复卡未导出（用户取消保存）',
  'kernel:l0:recovery-export-fail': 'L0 恢复卡写入失败',
  // 批次37-B 首启向导（两库位置 / L0 管理密码 / 恢复卡导出）
  'dataRoot:setup:dirs-set': '已指定两个库的存放目录',
  'dataRoot:setup:dirs-canceled': '库位置未选择，已退出（向导不接受半配置）',
  'dataRoot:setup:library-adopted': '库文件已核对/补送到指定目录',
  'dataRoot:setup:l0-password-set': '首启已设置 L0 管理密码',
  'dataRoot:setup:set-password-denied': '首启设密码被拒（本机已设过 L0 管理密码）',
  'dataRoot:setup:wizard-open': '进入首启向导（设置尚未完成）',
  'dataRoot:setup:wizard-skipped': '首启设置已完成，直接进入主界面',
  'dataRoot:setup:done': '首启向导完成（恢复卡已导出）',
  'backup:run': '执行备份',
  'backup:rotate': '清理过期备份',
  'dataRoot:change': '切换数据目录',
  'collector:batch': '采集一批会话',
  // 批次41-D：采集器失败退避（值只有轮数/间隔/原因码，无正文）
  'collector:backoff': '采集器本轮没推进，退避后重试（指数间隔、封顶 2h）',
  'collector:backoff-auto-stopped': '采集器连续失败达上限，已停自动重试（点「立即采集」手动重跑可恢复）',
  'collector:backoff-recovered': '采集器失败后已恢复，退避归零',
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
  'l0:blobs': '回读 L0 原数据库（密文，只出条数不出正文）',
  'l0:splitPreview': '预览存量拆分迁移（L0 原文搬家）',
  'l0:splitRun': '存量拆分迁移（L0 原文搬入原数据库）',
  'l0:rebuildPreview': '预览按 L0 原文重建 L1–L6',
  'l0:rebuildRun': '按 L0 原文重建 L1–L6（覆盖现有正文，需备份 + 口令）',
  'l0:recoveryStatus': '查询 L0 恢复码状态（不回显码）',
  'l0:recoveryInit': '首启初始化 L0 并生成恢复码',
  'l0:recoveryIssue': '换发 L0 恢复码（旧码作废）',
  'l0:recover': '用恢复码找回 L0 并设新管理密码',
  'l0:recoveryExport': '导出 L0 恢复卡到文件',
  'setup:state': '读取首启向导进度（两库位置 / L0 密码 / 恢复卡）',
  'setup:reselectDirs': '改选两个库的存放目录（重启后生效）',
  'setup:setL0Password': '首启设置 L0 管理密码并生成恢复码',
  'setup:regenCode': '首启重新生成 L0 恢复码（需管理密码）',
  'setup:exportCard': '首启导出 L0 恢复卡',
  'setup:finish': '完成首启设置',
  'legacy:scan': '预览遗留账本脏行',
  'legacy:demote': '清理遗留账本（降级回 L1）',
  'ledger:resetPreview': '预览记忆库清空范围',
  'ledger:resetRecollect': '清空记忆库并按新规则重采',
  'rules:rejudgePreview': '预览存量重判范围',
  'rules:rejudgeRun': '按当前规则重判存量（删噪声行）',
  'ledger:fieldsPreview': '预览存量缺指纹/缺向量的行',
  'ledger:fieldsBackfill': '补齐存量缺失的指纹与向量',
  'refine:state': '读取 L2–L6 补炼队列状态',
  'refine:setEnabled': '开关 L2–L6 后台补炼',
  'refine:backfill': '把存量行入队补炼',
  'refine:retryFailed': '把补炼失败的行放回队列',
};

/** 摘要优先展示的关键字段（越靠前越能解释「发生了什么」） */
const NOTE_KEYS = [
  'error', 'reason', 'message', 'origin', 'status', 'method', 'path', 'denied', 'rejected',
  'page', 'testid', 'text', 'trigger', 'agent', 'client', 'count', 'lines', 'hits', 'tokens',
  'durationMs', 'ms', 'dir', 'logPath', 'mem_id', 'memory_id', 'request_id', 'copied', 'ok', 'result',
  // 批次40-C：补炼一行「停在哪、为什么停」在人话视图里也要看得见（值只有层名与英文码，无正文）
  'to_layer', 'stop_layer', 'stop_code', 'refined_by',
  // 批次41-A：审计账本的位置与计数（全是数字与路径，无审计正文）——「迁了多少、坏了几行」要一眼看见
  'rows', 'bytes', 'migrated_rows', 'legacy_rows', 'legacy_rows_in_ledger', 'archived_rows', 'archive_files', 'skipped_lines',
  // 批次41-C：删除行的通道同步摘补炼队列幽灵条目——摘了多少条、为什么触发（值只有计数与原因，无正文）
  'pruned', 'pruned_ghosts', 'why',
  // 批次41-D：采集器失败退避——退避到第几轮、等多久、恢复前累计几轮（值只有数字与原因码，无正文）
  'fails', 'delayMs', 'prevFails', 'capMs',
  // 批次41-W：采集器本轮没推进时「其中多少是写密钥锁定」——恒 ≤ failed，是「输密码就能解」还是「写 bug」的分界（值只有计数，无正文）
  'failed_l0_locked',
  // 批次41-R：明细页查看事件（值只有 ok/miss，一次性 id 与正文都不落）
  'outcome',
  // 批次41-T：存量字段回填——补了几行指纹/向量、进了多少索引、几行填不了（值只有计数与路径，无正文）
  'total', 'fillable_rows', 'sha256_filled', 'embedding_filled', 'indexed',
  'protected_rows', 'unfillable_sha256', 'unfillable_embedding', 'failed',
  // 批次41-U：遗忘周期跑完一轮的计数（全是数字，无记忆正文）——「迁了几层、合了几条摘要」要一眼看见
  'freshness_updated', 'summaries_created', 'summaries_filtered', 'merged_originals', 'compressed', 'migrated',
  // 批次41-I 后续：补炼每日额度切换（值只有布尔与行数，无正文）——「限额几行 / 不限额」要一眼看见
  'cap_enabled', 'cap_rows',
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
