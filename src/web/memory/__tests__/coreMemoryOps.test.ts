// 批次10：手动编辑旁路收口——编辑内容与写入共用同一道 L0→L1 质量门（噪声/脱敏/指纹/向量）。
import { beforeEach, describe, expect, it } from 'vitest';
import { coreUpdateContent, getStorage, splitAgentIngest, toRecord } from '../coreMemoryOps.ts';
import { resetKernelForTests } from '../../kernel.ts';
import { sha256hex } from '../../../core/memagent/sync.ts';
import type { Memory } from '../../../core/memagent/types.ts';

const NOW = Date.now();

function mem(over: Partial<Memory> & Pick<Memory, 'mem_id' | 'content'>): Memory {
  return {
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', decay_class: 'hot',
    pinned: false, locked: false, version: 1, created_at: NOW, updated_at: NOW,
    ...over,
  } as Memory;
}

beforeEach(() => {
  resetKernelForTests();
});

describe('coreUpdateContent：手动编辑过 L0→L1 质量门', () => {
  it('噪声内容（助手自述）→ 拒绝写入 + 审计 filtered_l0_to_l1（source=manual_edit）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'm1', content: 'Redis 连接池需要预热后再放量' }));

    const r = await coreUpdateContent('m1', '你好，我是一个 AI 助手');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('质量门');

    const saved = await storage.getMemory('m1');
    expect(saved?.content).toBe('Redis 连接池需要预热后再放量');
    expect(saved?.version).toBe(1);
    const audits = await storage.queryAudit({ action: 'memory_op' });
    expect(audits[0].detail.action).toBe('filtered_l0_to_l1');
    expect(audits[0].detail.source).toBe('manual_edit');
  });

  it('含 PII 的编辑 → 落脱敏产物，重算 sha256 与 embedding，L0 密文不动', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({
      mem_id: 'm2', content: '旧内容', content_l1: '旧内容',
      embedding: [1, 0, 0, 0], content_l0_enc: '{"v":2,"alg":"AES-256-GCM","iv":"x","tag":"y","ct":"z"}',
    }));

    const r = await coreUpdateContent('m2', '新内容：数据库在 10.0.0.9，联系人：张三，登录失败要查连接池');
    expect(r.ok).toBe(true);

    const saved = await storage.getMemory('m2');
    expect(saved?.content).not.toContain('10.0.0.9');
    expect(saved?.content).not.toContain('张三');
    expect(saved?.content).toContain('[IP]');
    expect(saved?.content).toContain('[姓名]');
    expect(saved?.content_l1).toBe(saved?.content);
    expect(saved?.sha256).toBe(sha256hex(saved!.content));
    expect(saved?.embedding).toHaveLength(4);
    expect(saved?.version).toBe(2);
    expect(saved?.content_l0_enc).toContain('"v":2'); // 手动编辑不触碰 L0

    const audits = await storage.queryAudit({ action: 'memory_op' });
    expect(audits[0].detail.masked).toBe(true);
    expect(audits[0].detail.l0_unchanged).toBe(true);
    expect(audits[0].detail.embedding_recomputed).toBe(true);
  });

  it('批次28-C：stub 深层行编辑 → 归 L1（不再回写遗留深层字段），embedding 重算', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({
      mem_id: 'm3', layer: 'L3', content: '旧分析内容', content_l1: 'L1 内容',
      content_l3: '旧分析内容', embedding: [1, 0, 0, 0],
    }));

    const r = await coreUpdateContent('m3', '分析结论：连接池过小导致超时，需扩容至 50');
    expect(r.ok).toBe(true);

    const saved = await storage.getMemory('m3');
    expect(saved?.layer).toBe('L1');
    expect(saved?.content_l1).toBe('分析结论：连接池过小导致超时，需扩容至 50');
    expect(saved?.content_l3).toBeUndefined();
    expect(saved?.embedding).not.toEqual([1, 0, 0, 0]);
    const audits = await storage.queryAudit({ action: 'memory_op' });
    expect(audits[0].detail.embedding_recomputed).toBe(true);
  });

  it('真实 LLM 产物的深层行编辑 → 仍改写对应 content_lN，L1 与 embedding 保持不变', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({
      mem_id: 'm3b', layer: 'L3', content: '旧分析内容', content_l1: 'L1 内容',
      content_l3: '旧分析内容', refined_by: 'llm', embedding: [1, 0, 0, 0],
    }));

    const r = await coreUpdateContent('m3b', '分析结论：连接池过小导致超时，需扩容至 50');
    expect(r.ok).toBe(true);

    const saved = await storage.getMemory('m3b');
    expect(saved?.layer).toBe('L3');
    expect(saved?.content_l3).toBe('分析结论：连接池过小导致超时，需扩容至 50');
    expect(saved?.content_l1).toBe('L1 内容');
    expect(saved?.embedding).toEqual([1, 0, 0, 0]);
    const audits = await storage.queryAudit({ action: 'memory_op' });
    expect(audits[0].detail.embedding_recomputed).toBe(false);
  });

  it('locked 记录 → 拒绝编辑（G4 不变）', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'm4', content: '锁定内容', locked: true }));
    const r = await coreUpdateContent('m4', '试图改写一条足够长的正常技术内容');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('已锁定');
    expect((await storage.getMemory('m4'))?.content).toBe('锁定内容');
  });
});

// 批次24 口径2：一条记忆只带一个「层级生成时间」（layers_generated_at），入库时间仍是 created_at。
describe('layers_generated_at：内核字段 → 页面映射与改写刷新', () => {
  it('toRecord：有值转 ISO；历史行缺字段保持 undefined（不拿 created_at 冒充）', () => {
    const stamped = toRecord(mem({ mem_id: 'm5', content: '连接池扩到 50 后超时消失', layers_generated_at: NOW }));
    expect(stamped.layers_generated_at).toBe(new Date(NOW).toISOString());
    expect(stamped.created_at).toBe(new Date(NOW).toISOString());

    const legacy = toRecord(mem({ mem_id: 'm6', content: '历史行没有层级生成时间' }));
    expect(legacy.layers_generated_at).toBeUndefined();
    expect(legacy.created_at).toBeDefined();
  });

  it('手动改写视为重新生成层级 → 层级生成时间刷新为本次操作时刻', async () => {
    const storage = getStorage();
    const OLD = NOW - 5 * 86_400_000;   // 五天前生成的层级
    await storage.putMemory(mem({
      mem_id: 'm7', content: '旧内容：连接池 5', content_l1: '旧内容：连接池 5', layers_generated_at: OLD,
    }));

    const r = await coreUpdateContent('m7', '新内容：连接池调到 50 后 P99 延时回到 80ms');
    expect(r.ok).toBe(true);

    const saved = (await storage.getMemory('m7'))!;
    expect(saved.layers_generated_at).toBeGreaterThan(OLD);
    expect(saved.layers_generated_at).toBeGreaterThanOrEqual(NOW);
    expect(toRecord(saved).layers_generated_at).toBe(new Date(saved.layers_generated_at!).toISOString());
  });
});

// 进库分流（用户 2026-11-10 定稿）：agent 的会话信息直接放行；agent 提取的记忆才进发件箱。
describe('进库分流：会话信息直接放行 / agent 记忆进发件箱', () => {
  it('带 session_id 的 agent 写入（会话信息）→ 直接放行，不进发件箱', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({
      mem_id: 's1', content: '本轮会话处理了 3 个工单', created_by_agent: '客服工作台', session_id: 'sess-abc',
    }));

    const split = await splitAgentIngest(new Set());
    expect(split.sessionInfoCount).toBe(1);
    // 会话信息不进候选（不打扰用户）
    expect(split.candidates.map((c) => c.id)).not.toContain('s1');
  });

  it('不带 session_id 的 agent 写入（agent 提取的记忆）→ 进发件箱待判定', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({
      mem_id: 'a1', content: '用户偏好：所有工单先给结论再给步骤', created_by_agent: '客服工作台',
    }));

    const split = await splitAgentIngest(new Set());
    expect(split.sessionInfoCount).toBe(0);
    expect(split.candidates.map((c) => c.id)).toContain('a1');
    const cand = split.candidates.find((c) => c.id === 'a1')!;
    expect(cand.sourceAgent).toBe('客服工作台');
    expect(cand.content).toContain('先给结论');
  });

  it('手动写入（无 created_by_agent）→ 既不放行也不进发件箱', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'man1', content: '我手动记的一条内容' }));

    const split = await splitAgentIngest(new Set());
    expect(split.sessionInfoCount).toBe(0);
    expect(split.candidates.map((c) => c.id)).not.toContain('man1');
  });

  it('已判定过的账本 ref（excludeRefIds）→ 不再重复进发件箱', async () => {
    const storage = getStorage();
    await storage.putMemory(mem({ mem_id: 'a2', content: '用户偏好：偏好深色主题', created_by_agent: 'cursor' }));

    const split = await splitAgentIngest(new Set(['a2']));
    expect(split.candidates.map((c) => c.id)).not.toContain('a2');
  });
});
