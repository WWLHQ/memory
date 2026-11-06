// 批次48 A26：检索页项目范围。默认「全部项目」不得静默丢弃其它项目命中；单项目场景行为不变。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryBar } from '../QueryBar.tsx';
import { ALL_PROJECTS_SCOPE, coreEngine } from '../coreEngine.ts';
import { getKernelWithSeed, resetKernelForTests } from '../../kernel.ts';
import { listProjectIds } from '../../shared/kernelProjects.ts';

const A = { content: '缓存 TTL 设为 300s（P-a 生产默认）', category: 'fact', project_id: 'P-a' } as const;
const B = { content: '缓存 TTL 设为 600s（P-b 灰度默认）', category: 'fact', project_id: 'P-b' } as const;

describe('A26 coreEngine 项目范围', () => {
  beforeEach(() => resetKernelForTests());

  it('默认「全部项目」：两个项目的命中都返回，不静默丢弃', async () => {
    await getKernelWithSeed()._seedMemory(A);
    await getKernelWithSeed()._seedMemory(B);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_a26_all');
    const text = r.hits.map((h) => h.content).join('\n');
    expect(text).toContain('300s');
    expect(text).toContain('600s');
  });

  it('显式项目范围（非首个项目）：只返回该项目命中', async () => {
    await getKernelWithSeed()._seedMemory(A);
    await getKernelWithSeed()._seedMemory(B);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_a26_pb', 'P-b');
    const text = r.hits.map((h) => h.content).join('\n');
    expect(text).toContain('600s');
    expect(text).not.toContain('300s');
  });

  it('单项目场景：默认 all 与显式选择该项目结果一致', async () => {
    await getKernelWithSeed()._seedMemory(A);
    const all = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_a26_single_all');
    const one = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_a26_single_one', 'P-a');
    expect(all.hits.map((h) => h.memory_id)).toEqual(one.hits.map((h) => h.memory_id));
  });

  it('项目清单排除内部 P_SYSTEM（不进选择器）', async () => {
    await getKernelWithSeed()._seedMemory(A);
    await getKernelWithSeed()._seedMemory({ content: 'params:v1:{}', category: 'preference', project_id: 'P_SYSTEM' });
    expect(await listProjectIds()).toEqual(['P-a']);
  });
});

describe('A26 QueryBar 项目选择器', () => {
  const base = { query: '', scene: 'default' as const, mode: null };

  it('默认选中「全部项目」，选项来自真实项目清单', () => {
    render(
      <QueryBar value={base} projects={['P-a', 'P-b']} onChange={() => {}} onSubmit={() => {}} loading={false} />,
    );
    const sel = screen.getByTestId('q-project') as HTMLSelectElement;
    expect(sel.value).toBe(ALL_PROJECTS_SCOPE);
    expect([...sel.options].map((o) => o.textContent)).toEqual(['全部项目', 'P-a', 'P-b']);
  });

  it('切到单项目 → onChange 带上 project', () => {
    const onChange = vi.fn();
    render(<QueryBar value={base} projects={['P-a']} onChange={onChange} onSubmit={() => {}} loading={false} />);
    fireEvent.change(screen.getByTestId('q-project'), { target: { value: 'P-a' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ project: 'P-a' }), null);
  });
});
