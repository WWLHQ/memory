// 阶段4-F / B5：向量「连通测试」结论层诚实化。
// coreVectorProbe 的算法本身是诚实的（云端如实「未验证」、本地真跑 embed 且注明权重未加载），
// 但 UI 曾把 ok=true 包装成「连通测试通过」——所选模型的权重/云端通道其实根本没接入。
// 本套件锁住：结论前缀、按钮/说明文案、上游口径，以及源码中不实声明不回流。
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VectorCard } from '../VectorCard.tsx';
import { coreVectorProbe } from '../coreModels.ts';
import type { VectorModelKey } from '../types.ts';

const OK_PREFIX = '本地 hash 后端可用（非所选模型连通）';
const FAIL_PREFIX = '模型连通未验证';

function renderCard(opts: {
  key?: VectorModelKey;
  probe?: () => Promise<{ ok: boolean; message: string }>;
} = {}) {
  const key = opts.key ?? 'st';
  let toast = '';
  render(
    <VectorCard
      value={key}
      onChange={() => {}}
      count={0}
      onToast={(m) => { toast = m; }}
      onProbe={opts.probe ?? (() => coreVectorProbe(key, ''))}
    />,
  );
  return {
    click: () => fireEvent.click(screen.getByTestId('vector-ping')),
    toast: () => toast,
  };
}

describe('向量探测结论层诚实化（阶段4-F / B5 变异杀手）', () => {
  it('本地档真实探测：toast 明确「非所选模型连通」且注明权重未加载，绝不出现「连通测试通过」', async () => {
    const c = renderCard();
    c.click();
    await waitFor(() => expect(c.toast()).toContain(OK_PREFIX));
    expect(c.toast()).toContain('权重尚未加载');
    expect(c.toast()).toContain('JsVectorBackend');
    expect(c.toast()).not.toContain('连通测试通过');
  });

  it('云端档填了 Key 也只报「模型连通未验证」，不得出现通过/后端可用结论', async () => {
    const c = renderCard({ key: 'ds', probe: () => coreVectorProbe('ds', 'sk-demo') });
    c.click();
    await waitFor(() => expect(c.toast()).toContain(FAIL_PREFIX));
    expect(c.toast()).toContain('云端嵌入通道尚未接入');
    expect(c.toast()).not.toContain('本地 hash 后端可用');
    expect(c.toast()).not.toContain('连通测试通过');
  });

  it('按钮与说明不再宣称「连通测试」，明确探测对象只是内核 hash 后端', () => {
    renderCard();
    expect(screen.getByTestId('vector-ping')).toHaveTextContent('探测本地后端');
    expect(screen.queryByText(/连通测试/)).toBeNull();
    expect(screen.getByTestId('vector-card')).toHaveTextContent('不代表所选模型权重已加载或云端通道已连通');
  });

  it('上游 ok=true 且自称模型连通时，UI 结论前缀仍否定「所选模型连通」', async () => {
    const c = renderCard({
      probe: async () => ({ ok: true, message: 'sentence-transformers 模型连通通过（伪造上游）' }),
    });
    c.click();
    await waitFor(() => expect(c.toast()).toContain(OK_PREFIX));
    expect(c.toast().startsWith(OK_PREFIX)).toBe(true);
    expect(c.toast()).toContain('非所选模型连通');
  });

  it('coreVectorProbe 口径不回退：本地注明 hash 起步 / 权重未加载，云端恒 ok=false', async () => {
    const local = await coreVectorProbe('st', '');
    expect(local.ok).toBe(true);
    expect(local.message).toContain('hash 起步实现');
    expect(local.message).toContain('权重尚未加载');
    expect(local.message).not.toContain('模型连通通过');
    expect((await coreVectorProbe('ds', '')).ok).toBe(false);
    expect((await coreVectorProbe('ds', 'sk-demo')).ok).toBe(false);
  });

  it('源码声明契约：旧「连通测试通过 / 连通测试按钮 / 旧探测注释」不得回流', () => {
    const card = readFileSync(resolve(process.cwd(), 'src/web/models/VectorCard.tsx'), 'utf8');
    const core = readFileSync(resolve(process.cwd(), 'src/web/models/coreModels.ts'), 'utf8');
    expect(card).not.toMatch(/连通测试通过/);
    expect(card).not.toMatch(/'连通测试'/);
    expect(card).toMatch(/非所选模型连通/);
    expect(card).toMatch(/探测本地后端/);
    expect(core).not.toMatch(/向量连通测试（Phase C3 诚实版）/);
    expect(core).toMatch(/不等于模型连通/);
    expect(core).toMatch(/ok: false,\s*message: apiKey\.trim\(\)/);
  });
});
