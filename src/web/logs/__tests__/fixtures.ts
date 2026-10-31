// 日志页单测夹具（仅测试用；页面数据真相 = 内核审计账本）。
import type { LogEntry } from '../types.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';
import { getKernel, getKernelStorage, setKernelL0ForTests } from '../../kernel.ts';
import { createTestVault, TEST_ADMIN_ID, TEST_ADMIN_PW } from '../../../core/memagent/__tests__/l0Kit.ts';

// 时间戳相对当前时间（避免硬编码日期随时间推移超出筛选时间窗）
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const SEED_LOGS: LogEntry[] = [
  { ts: AGO(25), level: 'error', form: 'desktop', action: 'conflict_resolve', request_id: 'req_l10', message: '冲突自动裁决失败，转人工', extra: { conflict: 'mem_020 vs mem_021', kind: '冲突挂起' } },
  { ts: AGO(33), level: 'error', form: 'web', action: 'sync_fail', request_id: 'req_l09', message: '同步失败：对账不一致', extra: { reason: 'hash mismatch', kind: '同步失败' } },
  { ts: AGO(45), level: 'error', form: 'desktop', action: 'recall', request_id: 'req_l08', message: '主通道连续失败≥5，熔断 OPEN', extra: { agent: 'coder-01', kind: '熔断 OPEN' } },
  { ts: AGO(55), level: 'warn', form: 'mac', action: 'llm_fallback', request_id: 'req_l07', message: '反代理额度超限，已回退', extra: { quota: '20/20', kind: '额度超限' } },
  { ts: AGO(63), level: 'info', form: 'desktop', action: 'recall', request_id: 'req_l01', message: '召回命中 3 条（mode=事实优先）', extra: { hits: 3, payload: 1240 } },
  { ts: AGO(65), level: 'info', form: 'desktop', action: 'write', request_id: 'req_l02', message: '写入 mem_070（L3）', extra: { tokens: 210 } },
  { ts: AGO(70), level: 'info', form: 'web', action: 'sync_down', request_id: 'req_l03', message: 'web 端拉取增量 12 条', extra: { count: 12 } },
  { ts: AGO(72), level: 'info', form: 'web', action: 'sync_up', request_id: 'req_l04', message: 'web 端上传变更 3 条' },
  { ts: AGO(74), level: 'info', form: 'cli', action: 'login', request_id: 'req_l05', message: 'CLI 登录成功（系统密钥）' },
  { ts: AGO(79), level: 'info', form: 'desktop', action: 'team_assign', request_id: 'req_l06', message: 'user_002 分配至 team_001' },
  { ts: AGO(84), level: 'info', form: 'desktop', action: 'gc', request_id: 'req_l11', message: 'GC 归档 4 条冷记忆' },
  { ts: AGO(89), level: 'info', form: 'desktop', action: 'l0_view', request_id: 'req_l12', message: '管理员查阅 L0（已记审计）', extra: { memory_id: 'mem_005' } },
  { ts: AGO(94), level: 'warn', form: 'desktop', action: 'rerank_fallback', request_id: 'req_l13', message: '重排失败，回退第二层' },
  { ts: AGO(99), level: 'info', form: 'mobile', action: 'recall', request_id: 'req_l14', message: '移动端召回 1 条' },
  // 无 request_id 样本（R-LOG2：前端补 n/a + 告警）
  { ts: AGO(109), level: 'warn', form: 'linux', action: 'auto_bind', request_id: '', message: 'Agent 自动绑定（日志缺审计链，严重 bug 演示）' },
];

/** 用例夹具：日志条目写进真实内核审计账本（页面 coreLoadLogs 回放） */
export async function seedLogsLedger(entries: LogEntry[] = SEED_LOGS): Promise<void> {
  const storage = getKernelStorage();
  for (const e of entries) {
    await storage.appendAudit({
      request_id: e.request_id,
      action: e.action as AuditRecord['action'],
      form: e.form,
      ts: Date.parse(e.ts),
      detail: { message: e.message, level: e.level, extra: e.extra ?? {} },
    });
  }
}

/** 用例夹具：真实 L0Vault（写密钥已解锁）+ 真实 v2 加密 L0 记忆，供连续会话解密 */
export async function seedL0Memory(password = 'l0pass-1') {
  const { vault } = await createTestVault();
  await vault.changeAdminPassword(TEST_ADMIN_PW, password, TEST_ADMIN_ID);
  setKernelL0ForTests({ l0: vault, l0Admin: vault });
  await getKernel()._seedMemory({
    content: 'tcp://prod-db:5432/app',
    category: 'fact',
    project_id: 'P1',
    l0: true,
  });
  return { vault };
}
