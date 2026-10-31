// 审计写形状校验（批次26-B P1-2 建 / 批次28-A 抽共享供 HTTP 数据面复用）：
// 内核合法自报的 request_id（ulid/req_* 关联键，P0-2 依赖）放行，伪造的超长/非法字符 id、
// 缺 action/ts 的记录整条拒绝 —— 不做语义猜测，只挡注入面。主进程 IPC 与 home server 数据面同口径。
export function validateAuditRecord(a: unknown): void {
  const rec = a as { request_id?: unknown; action?: unknown; ts?: unknown; detail?: unknown } | null;
  if (!rec || typeof rec !== 'object') throw new Error('审计记录形状非法（须为对象）');
  if (typeof rec.action !== 'string' || rec.action.length === 0 || rec.action.length > 40) {
    throw new Error('审计记录缺少合法 action');
  }
  if (typeof rec.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(rec.request_id)) {
    throw new Error('审计记录 request_id 非法（仅允许字母数字下划线连字符，≤64 字符）');
  }
  if (typeof rec.ts !== 'number' || !Number.isFinite(rec.ts)) {
    throw new Error('审计记录缺少合法 ts');
  }
  if (rec.detail !== undefined && (typeof rec.detail !== 'object' || rec.detail === null)) {
    throw new Error('审计记录 detail 须为对象');
  }
}
