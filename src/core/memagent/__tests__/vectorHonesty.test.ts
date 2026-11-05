// 批次42 阶段4（B2）：向量后端的「真实现」与「诚实声明」契约。
// 侦察判定：JsVectorBackend 是生产唯一后端（真实 hash bag-of-words + cosine 全表扫描），
// 基线 B2 的问题不是「演示算法」，而是注释自称演示 + 把未实现的 Rust/WASM 后端写成现状。
// 故按诚实重标注处理；本测试锁住两件事：行为是真实现、声明不回流成假现状。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VECTOR_DIM, JsVectorBackend, cosine, embedSync, tokenize } from '../vector.ts';

describe('B2：JsVectorBackend 是真实后端（非演示代码）', () => {
  it('embedSync 真算且确定性：归一化、不同文本不同向量、非法维度拒绝', () => {
    const a = embedSync('deploy docker guide', DEFAULT_VECTOR_DIM);
    const b = embedSync('deploy docker guide', DEFAULT_VECTOR_DIM);
    const c = embedSync('redis cluster failover', DEFAULT_VECTOR_DIM);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.sqrt(a.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 6);
    expect(() => embedSync('x', 0)).toThrow();
  });

  it('tokenize 中文按 2-gram（整句单 token 会让向量失去区分力）', () => {
    expect(tokenize('部署脚本')).toEqual(['部署', '署脚', '脚本']);
  });

  it('cosine 维度不一致返回 0（不产生 NaN 污染排序）', () => {
    expect(cosine(embedSync('a', 64), embedSync('a', 32))).toBe(0);
  });

  it('upsert/search/remove 真实生效：filter 过滤 + 相似度排序 + top-k', async () => {
    const v = new JsVectorBackend();
    await v.upsert('m1', 'deploy docker guide', { project_id: 'P1', layer: 'L1' });
    await v.upsert('m2', 'redis cluster failover', { project_id: 'P1', layer: 'L2' });
    await v.upsert('m3', 'deploy docker guide', { project_id: 'P2', layer: 'L1' });
    const q = embedSync('deploy docker guide', v.dim);

    const all = await v.search(q, 10, {});
    expect(all).toHaveLength(3);
    expect(all[0].score).toBeGreaterThan(all[2].score); // 相似文本排在无关文本前
    expect((await v.search(q, 10, { project_id: 'P2' })).map((h) => h.mem_id)).toEqual(['m3']);
    expect(await v.search(q, 1, {})).toHaveLength(1);

    await v.remove('m1');
    expect((await v.search(q, 10, {})).map((h) => h.mem_id)).not.toContain('m1');
  });
});

/**
 * Gate C 变异杀手：B2 是诚实重标注（无行为差异），因此用源码级声明契约验证。
 * 把旧注释重新注入 vector.ts，下面两例必红。
 */
describe('B2：源码声明不得自称演示或把未实现后端写成现状', () => {
  // 用 cwd 字符串路径：本机 fs shim 不接受 vitest 转换后的 URL 对象（要求 file: scheme）
  const src = readFileSync(resolve(process.cwd(), 'src/core/memagent/vector.ts'), 'utf8');

  it('杀手①：不出现「演示用内存倒排」/「演示可替换性」等过时自称', () => {
    expect(src).not.toMatch(/演示用内存倒排/);
    expect(src).not.toMatch(/契约级用 JS 实现演示可替换性/);
    expect(src).not.toMatch(/演示用/);
  });

  it('杀手②：不把 RustWasmVectorBackend 写成已存在的性能层', () => {
    expect(src).not.toMatch(/RustWasmVectorBackend 为性能层/);
    expect(src).not.toMatch(/切换无感/);
    // 源码里确实没有这个实现；将来真落地了应改为验证接口同构，而不是悄悄删掉本断言
    expect(src).not.toMatch(/class RustWasmVectorBackend\b/);
    // 诚实标注必须存在，防止「删掉整段说明」式假绿
    expect(src).toMatch(/规划的 Rust\/WASM 性能层尚未实现/);
  });
});
