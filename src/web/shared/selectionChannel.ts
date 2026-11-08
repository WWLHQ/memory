// 选中项回传通道（S4）：中心区真实页面把「用户当前选中的一条真实记录」回传给壳层属性检查器。
//
// 口径：
// - 只回传页面账本里真实存在的记录的既有字段，不做推断、不补默认值、不造演示读数；
// - 页面与壳同源，回包 targetOrigin 固定为自身 origin，绝不用 '*'；
// - 顶层窗口（非嵌入）调用为空操作，纯浏览器直开页面不受影响。

export interface SelectionField {
  k: string;
  /** 已格式化为字符串的真实值（空字符串表示真实为空） */
  v: string;
  mono?: boolean;
}

export interface SelectionPayload {
  v: 1;
  /** 回传页面文件名（memory.html / memory-layered.html / dispute.html …），壳用于校验来源 */
  page: string;
  title: string;
  subtitle?: string;
  fields: SelectionField[];
}

export const SELECTION_MSG = '__memagent_selection__';

const MAX_FIELDS = 24;
const MAX_TEXT = 2048;

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
}

/** 校验来自 postMessage 的 payload；形状不合法一律拒绝（不渲染半截数据） */
export function parseSelection(raw: unknown): SelectionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const page = text(o.page);
  const title = text(o.title);
  if (!page || !title) return null;
  let subtitle: string | undefined;
  if (o.subtitle !== undefined) {
    const s = text(o.subtitle);
    if (s === null) return null;
    subtitle = s;
  }
  if (!Array.isArray(o.fields) || o.fields.length === 0 || o.fields.length > MAX_FIELDS) return null;
  const fields: SelectionField[] = [];
  for (const f of o.fields) {
    if (!f || typeof f !== 'object') return null;
    const r = f as Record<string, unknown>;
    const k = text(r.k);
    const v = text(r.v);
    if (!k || v === null) return null;
    fields.push({ k, v, mono: r.mono === true });
  }
  return { v: 1, page, title, subtitle, fields };
}

/** 页面侧调用：把当前选中项（或 null = 取消选中）回传给父窗口壳层 */
export function publishSelection(payload: SelectionPayload | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.parent === window) return;
    window.parent.postMessage({ [SELECTION_MSG]: payload }, window.location.origin);
  } catch {
    /* 回传失败不影响页面自身功能 */
  }
}
