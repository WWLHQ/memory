// 批次39 · L2–L6 后台补炼队列的渲染层桥：状态读（需会话）/ 开关与补炼与重试失败行（仅管理员）。
// 浏览器模式无主进程 → available()=false，页面如实显示「不可用」，绝不用页面内存对象冒充真队列。
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';

export interface RefineQueueSummary {
  enabled: boolean;
  pending: number;
  done: number;
  failed: number;
  skipped: number;
  /** 记账日（UTC+08:00）与当日已用/上限 */
  day: string;
  day_rows: number;
  day_limit: number;
  day_left: number;
  max_engines_per_call: number;
  /** 批次40-C：阶梯停在哪个原因码的行数分布（回答「为什么这一行只炼到 L2」） */
  stop_codes: Record<string, number>;
  updated_at: number | null;
  queue_path: string;
}

export interface RefineQueueView {
  summary: RefineQueueSummary;
  /** 网关侧实况：没加载 / 不可用时队列会排队但不干活，页面必须说清是哪一种 */
  engine: { loaded: boolean; usable: boolean };
}

export interface RefineEnqueueReport {
  added: number;
  already_queued: number;
  settled: number;
  protected_skipped: number;
  not_eligible: number;
  /** 批次40-C：L1 短到没有料炼摘要 → 当场记 skipped，不起活不占额度 */
  thin_skipped?: number;
}

/**
 * 阶梯停下来的原因码 → 人话（批次40-C）。
 * 码是内核 `LAYER_STOP_CODES` 的稳定英文标识（改中文文案不换码），这里只做展示映射；
 * 遇到不认识的新码原样显示，绝不把未知原因粉饰成「正常」。
 */
export const REFINE_STOP_LABELS: Record<string, string> = {
  empty: '模型交白卷',
  too_short: '压得太狠（低于本层下限）',
  too_long: '没压缩（超上限或比源文还长）',
  missing_keyword: '丢了源文关键词',
  bad_prefix: '没按格式契约开头',
  bad_json: 'L6 索引不是合法 JSON',
  refine_error: '引擎调用失败',
  no_llm: '没有可用引擎',
  no_source: '这一行没有 L1',
  protected: 'pinned/locked 受保护',
  thin: 'L1 太短，没有料炼摘要',
};

export const refineStopLabel = (code: string): string => REFINE_STOP_LABELS[code] ?? code;

/** 停层码按行数从多到少排（UI 展示顺序稳定） */
export function refineStopRows(stopCodes: Record<string, number> | undefined): { code: string; label: string; count: number }[] {
  return Object.entries(stopCodes ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ code, label: refineStopLabel(code), count }));
}

export function refineQueueAvailable(): boolean {
  const cap = hostCapability();
  return cap === 'native' || cap === 'bridge';
}

/** 主进程回执形状：`{ok:true, summary, engine}`，backfill / retryFailed 另带自己的附加计数 */
interface RefineReply {
  ok?: boolean;
  error?: string;
  summary?: RefineQueueSummary;
  engine?: { loaded: boolean; usable: boolean };
  report?: RefineEnqueueReport;
  retried?: number;
}

export interface RefineResult {
  ok: boolean;
  view: RefineQueueView | null;
  error: string | null;
  /** 只有「把存量入队补炼」回执里有 */
  report?: RefineEnqueueReport;
  /** 只有「重试失败行」回执里有 */
  retried?: number;
}

const noHost = '当前不是桌面宿主环境：补炼队列由主进程维护，浏览器模式没有它';

function toResult(r: RefineReply | null | undefined, action: string): RefineResult {
  if (!r) return { ok: false, view: null, error: `${action}：主进程没有回执（宿主桥可能不可用）` };
  if (r.ok !== true || !r.summary || !r.engine) {
    return { ok: false, view: null, error: r.error ?? `${action}失败（需要管理员权限？）` };
  }
  return {
    ok: true,
    view: { summary: r.summary, engine: r.engine },
    error: null,
    ...(r.report ? { report: r.report } : {}),
    ...(typeof r.retried === 'number' ? { retried: r.retried } : {}),
  };
}

type RefineMethod = 'refine:state' | 'refine:setEnabled' | 'refine:backfill' | 'refine:retryFailed';

async function call(method: RefineMethod, args: unknown[], action: string): Promise<RefineResult> {
  if (!refineQueueAvailable()) return { ok: false, view: null, error: noHost };
  try {
    return toResult(await hostCall<RefineReply>(method, [...args, getStoredSessionId()]), action);
  } catch (e) {
    return { ok: false, view: null, error: String((e as Error)?.message ?? e) };
  }
}

export const refineQueueState = (): Promise<RefineResult> =>
  call('refine:state', [], '读取补炼队列');

export const refineQueueSetEnabled = (enabled: boolean): Promise<RefineResult> =>
  call('refine:setEnabled', [enabled], '切换补炼开关');

export const refineQueueBackfill = (): Promise<RefineResult> =>
  call('refine:backfill', [], '把存量补炼行入队');

export const refineQueueRetryFailed = (): Promise<RefineResult> =>
  call('refine:retryFailed', [], '重试失败行');
