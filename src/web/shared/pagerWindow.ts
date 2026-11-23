// v5 pager 数字窗口（批次 B）：把「当前页 / 总页数」折叠成 ‹ 1 … 4 5 6 … 257 › 的按钮序列。
// 纯函数，无 DOM 依赖；记忆库 / 审计页共用同一份，窗口口径一致。
// 规则：首尾页常驻；当前页 ±1 常驻；缺口渲染 '…'（占位，不可点）。

export type PagerCell = number | '…';

export function pagerWindow(page: number, totalPages: number): PagerCell[] {
  const last = Math.max(1, totalPages);
  const cur = Math.min(Math.max(1, page), last);
  // 小页数：全部直接平铺
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const wanted = new Set<number>([1, last, cur - 1, cur, cur + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out: PagerCell[] = [];
  let prev = 0;
  for (const n of pages) {
    if (prev && n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}
