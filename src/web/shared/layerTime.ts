// 层级生成时间口径（批次24 拍板：一条记忆只记一个「本组层内容生成时间」，不逐层记）。
// 历史记录没有这个字段 → 如实显示未记录，绝不拿入库时间冒充层级生成时间。
export const LAYER_GEN_UNRECORDED = '层级生成未记录';

export function fmtLayerGen(iso?: string, mode: 'full' | 'date' = 'full'): string {
  if (!iso) return LAYER_GEN_UNRECORDED;
  const d = new Date(iso);
  // 畸形时间串原样带出，不显示「Invalid Date」这种谁也看不懂的字
  if (Number.isNaN(d.getTime())) return `层级生成 ${iso}`;
  return `层级生成 ${mode === 'date' ? d.toLocaleDateString('zh-CN') : d.toLocaleString('zh-CN')}`;
}
