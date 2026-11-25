// P2-8 原型 §3.1–3.4 交互锁定测试：二元分段 / 必填校验 / 项目默认 / 倾向预览 / 模式反馈真落盘。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryBar, type QueryBarValue } from '../QueryBar.tsx';
import { ModeFeedbackCard } from '../ModeFeedbackCard.tsx';
import { coreSubmitModeFeedback } from '../coreModeFeedback.ts';
import { getKernelWithSeed, getKernelStorage, resetKernelForTests } from '../../kernel.ts';
import type { ModeBannerData } from '../types.ts';

const base: QueryBarValue = { query: '查项目架构决策', scene: 'default', mode: null };
const noop = () => {};

afterEach(() => resetKernelForTests());

describe('P2-8 §3.1 模式二元分段', () => {
  it('默认自动档：显示自动说明，手动面板不展开', () => {
    render(<QueryBar value={base} onChange={noop} onSubmit={noop} loading={false} />);
    expect(screen.getByTestId('mode-auto-note')).toHaveTextContent('由系统按场景与关键词自动判断模式');
    expect(screen.getByTestId('mode-panel')).not.toHaveClass('show');
  });
  it('点手动档 → 未选模式时检索被拦截且给中文提示', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<QueryBar value={base} onChange={onChange} onSubmit={onSubmit} loading={false} />);
    fireEvent.click(screen.getByTestId('mode-seg-manual'));
    expect(screen.getByTestId('mode-panel')).toHaveClass('show');
    fireEvent.click(screen.getByTestId('q-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(expect.anything(), '手动档需先选定具体模式（§3.1）');
  });
  it('手动选模式 → onSubmit 放行；critical 下极简仍禁用', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <QueryBar value={{ ...base, mode: 'fact_first' }} onChange={noop} onSubmit={onSubmit} loading={false} />,
    );
    fireEvent.click(screen.getByTestId('q-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(<QueryBar value={{ ...base, scene: 'critical', mode: 'fact_first' }} onChange={noop} onSubmit={onSubmit} loading={false} />);
    expect(screen.getByTestId('mode-minimal')).toBeDisabled();
  });
  it('§3.3 设为项目默认 / 重置为自动', () => {
    const onChange = vi.fn();
    const value = { ...base, mode: 'event_replay' as const };
    render(<QueryBar value={value} onChange={onChange} onSubmit={noop} loading={false} />);
    fireEvent.click(screen.getByTestId('mode-set-default'));
    expect(screen.getByTestId('mode-project-default')).toHaveTextContent('事件复盘');
    fireEvent.click(screen.getByTestId('mode-reset-auto'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: null }), '已重置为自动（全局默认）');
  });
  it('§3.2 history_query 自动档显示倾向预览，手动档不显示', () => {
    const { rerender } = render(
      <QueryBar value={{ ...base, scene: 'history_query' }} onChange={noop} onSubmit={noop} loading={false} />,
    );
    expect(screen.getByTestId('mode-tendency')).toHaveTextContent('事件复盘');
    rerender(<QueryBar value={{ ...base, scene: 'history_query', mode: 'fact_first' }} onChange={noop} onSubmit={noop} loading={false} />);
    expect(screen.queryByTestId('mode-tendency')).toBeNull();
  });
});

const banner: ModeBannerData = {
  scene: 'default', mode: 'fact_first', fallback: false, hit_keywords: [], request_id: 'req_modefb_test_1',
};

describe('P2-8 §3.4 模式反馈真实审计', () => {
  it('👍 提交写一条 mode_feedback，字段含模式/裁决/来源', async () => {
    getKernelWithSeed();
    const storage = getKernelStorage();
    const onToast = vi.fn();
    render(<ModeFeedbackCard data={banner} onToast={onToast} />);
    fireEvent.click(screen.getByTestId('mode-fb-up'));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('已记录：这次模式选对了。'));
    const rows = await storage.queryAudit({ request_id: banner.request_id, action: 'mode_feedback' });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ mode: 'fact_first', verdict: 'up', source: 'auto' });
  });
  it('👎 先展开原因再提交，原因进审计；写入失败不冒充成功', async () => {
    getKernelWithSeed();
    const onToast = vi.fn();
    render(<ModeFeedbackCard data={banner} onToast={onToast} />);
    fireEvent.click(screen.getByTestId('mode-fb-down'));
    fireEvent.change(screen.getByTestId('mode-fb-reason'), { target: { value: '模式选错' } });
    fireEvent.click(screen.getByTestId('mode-fb-submit'));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('已记录：模式选错（模式选错）。'));
    const rows = await getKernelStorage().queryAudit({ request_id: banner.request_id, action: 'mode_feedback' });
    expect(rows[0].detail).toMatchObject({ verdict: 'down', reason: '模式选错' });
  });
  it('审计写失败时如实报错，不显示「已记录」', async () => {
    const storage = getKernelStorage();
    const spy = vi.spyOn(storage, 'appendAudit').mockRejectedValueOnce(new Error('账本不可写'));
    const r = await coreSubmitModeFeedback({ request_id: 'req_fail', mode: 'auto', verdict: 'up', source: 'auto' });
    expect(r).toEqual({ ok: false, error: '账本不可写' });
    spy.mockRestore();
  });
});
