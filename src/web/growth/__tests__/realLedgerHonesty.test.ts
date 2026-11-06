// 批次47 验收：生长页 KPI 必须来自真实内核审计，而不是「任何写入都算短路、有召回就 100%」。
// 这里用真实 createMemAgent 写/召回产生真实审计，再交给页面统计函数，验证数字来源。
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../../../core/memagent/agent.ts';
import { FakeLlmProvider } from '../../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../../core/memagent/vector.ts';
import { createTestVault } from '../../../core/memagent/__tests__/l0Kit.ts';
import { dedupStatsFromLedger, metricsFromLedger } from '../useGrowthReal.ts';
import type { Memory } from '../../../core/memagent/types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

async function make() {
  const storage = new InMemoryStorage();
  const { vault } = await createTestVault();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    l0: vault,
  });
  return { ma, storage };
}

describe('生长页指标来自真实内核审计（P1-6）', () => {

  it('短路数不再等于全部写入数；嫁接数取真实 graft；命中率按真实 hits 算', async () => {
    const { ma, storage } = await make();

    const text = '数据库连接池超时：把 maxWait 调整到 5000 毫秒并观察慢查询';
    await ma.write({ content: text, category: 'fact', project_id: 'P1' });
    // 同内容再写一次 → 命中查重后嫁接，内核会写 write(dedup='grafted') + graft 审计
    await ma.write({ content: text, category: 'fact', project_id: 'P1' });
    // 一条完全不同且未命中的写入 → 旧实现也会把它算成「短路」
    await ma.write({ content: '项目决策：前端统一使用 React 19 与 Vite 构建，不再引入第二套脚手架', category: 'decision', project_id: 'P1' });

    const audits = await storage.queryAudit({});
    const writes = audits.filter((a) => a.action === 'write').length;
    expect(writes).toBeGreaterThanOrEqual(3);

    const stats = dedupStatsFromLedger(audits);
    expect(stats.merged).toBeGreaterThanOrEqual(1);                    // 真实 graft 审计
    expect(stats.short_circuit_hits).toBeGreaterThanOrEqual(1);        // 至少 grafted 那条
    expect(stats.short_circuit_hits).toBeLessThan(writes);             // 关键：不是「全部写入数」

    // 批次48 A12：平均耗时来自内核 write 审计的真实 cost_ms 采样，不是固定 0
    const writeAudits = audits.filter((a) => a.action === 'write');
    const sampled = writeAudits.filter((a) => {
      const v = (a.detail as { cost_ms?: unknown }).cost_ms;
      return typeof v === 'number' && Number.isFinite(v) && v >= 0;
    });
    expect(sampled.length).toBe(writeAudits.length);                  // 每条 write 都带采样
    expect(stats.avg_cost_samples).toBe(sampled.length);
    expect(stats.avg_cost_ms).toBeGreaterThanOrEqual(0);
    expect(dedupStatsFromLedger([]).avg_cost_samples).toBe(0);        // 空账本 = 未采样，不冒充

    // 命中率：一次能命中；一次查到一个没有任何记忆的项目（真实 0 命中）→ 真实 50%
    await ma.recall({ query: '数据库连接池超时 maxWait', project_id: 'P1', user_id: 'u1', scope: 'project' } as never);
    await ma.recall({ query: '量子退火制冷机的液氦补充周期', project_id: 'P2', user_id: 'u1', scope: 'project' } as never);

    const audits2 = await storage.queryAudit({ action: 'recall' });
    expect(audits2.length).toBe(2);
    const hits = audits2.map((a) => (a.detail as { hits?: number }).hits ?? 0);
    expect(hits[0]).toBeGreaterThan(0);
    expect(hits[1]).toBe(0);

    const m = metricsFromLedger(await storage.listMemories({}), audits2);
    expect(m.hit_rate).toBe(0.5);
  });

  it('cost_ms 是真实耗时采样：人为 30ms IO 延迟必须被量到（不是常数 0）', async () => {
    class SlowStorage extends InMemoryStorage {
      override async putMemory(m: Memory): Promise<void> {
        await new Promise((r) => setTimeout(r, 30));
        return super.putMemory(m);
      }
    }
    const storage = new SlowStorage();
    const { vault } = await createTestVault();
    const ma = createMemAgent({
      form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      l0: vault,
    });
    await ma.write({ content: '项目决策：前端构建统一使用 React 19 与 Vite，禁止再引入第二套脚手架（耗时采样用例）', category: 'decision', project_id: 'P1' });
    const audits = await storage.queryAudit({ action: 'write' });
    expect(audits.length).toBe(1);
    expect((audits[0].detail as { dedup?: string }).dedup).toBe('new'); // 确认不是质量门拦截分支（那条不带 cost_ms）
    expect((audits[0].detail as { cost_ms?: number }).cost_ms).toBeGreaterThanOrEqual(20);
    expect(dedupStatsFromLedger(audits).avg_cost_ms).toBeGreaterThanOrEqual(20);
  });
});
