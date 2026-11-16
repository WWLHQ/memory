import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KernelLoadError, humanErrorText, kernelErrorRaw, useKernelLoad } from '../kernelLoad.tsx';

function Probe({ load }: { load: () => Promise<number[]> }) {
  const { phase, data, error, retry } = useKernelLoad('probe', load);
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="count">{phase === 'ok' ? String(data?.length ?? '-') : '-'}</span>
      {phase === 'error' && <KernelLoadError what="读取记忆账本" error={error} onRetry={retry} />}
    </div>
  );
}

describe('humanErrorText（UI 只说人话，2026-11-16）', () => {
  it('Electron IPC 包装串翻成一句人话，方法名和 Error 前缀不上屏', () => {
    const raw = "Error invoking remote method 'storage:queryAudit': Error: 需要登录后操作（会话已过期或未登录）";
    expect(humanErrorText(new Error(raw))).toBe('请先登录，登录后即可查看');
    expect(humanErrorText(new Error(raw))).not.toMatch(/Error|storage:|E_/);
  });
  it('错误码与超时细节只进日志，不进 UI', () => {
    const e = { code: 'E_IPC_TIMEOUT', message: '宿主桥超时' };
    expect(kernelErrorRaw(e)).toBe('E_IPC_TIMEOUT：宿主桥超时');
    expect(humanErrorText(e)).toBe('本机服务响应超时，请重试');
  });
  it('账本锁定 / 写锁未开 / 未实现都给人话动作', () => {
    expect(humanErrorText(new Error('E_LEDGER_LOCKED'))).toBe('账本暂时被占用，请稍后重试');
    expect(humanErrorText(new Error('E_L0_LOCKED'))).toBe('写密钥未解锁，请先解锁');
    expect(humanErrorText(new Error('E_NOT_IMPLEMENTED'))).toBe('这个功能当前版本还没有提供');
  });
  it('本来就短的中文原因原样保留，不擅自改写成英文码', () => {
    expect(humanErrorText(new Error('程序日志尚未初始化'))).toBe('程序日志尚未初始化');
  });
  it('空异常 / 纯技术残片给统一兜底句', () => {
    expect(humanErrorText(undefined)).toBe('出了点问题，请稍后重试');
    expect(humanErrorText(new Error('{"code":"E_X","payload":{}}'))).toBe('出了点问题，请稍后重试');
  });
});

describe('useKernelLoad + KernelLoadError（批次25 P0-7）', () => {
  it('成功 → phase=ok 并交出数据', async () => {
    render(<Probe load={async () => [1, 2, 3]} />);
    expect(screen.getByTestId('phase').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ok'));
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
  });

  it('真账本为空 → ok + 空数组，仍然不是错误态', async () => {
    render(<Probe load={async () => []} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ok'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
  });

  it('内核不可达 → 错误态给人话原因，绝不表现为空数据、不露错误码', async () => {
    const load = () => Promise.reject(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('error'));
    expect(screen.getByTestId('kernel-error')).toBeInTheDocument();
    expect(screen.getByTestId('kernel-error-title')).toHaveTextContent('读取记忆账本失败：内核数据没读到');
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('本机服务响应超时，请重试');
    expect(screen.getByTestId('kernel-error-reason').textContent).not.toContain('E_IPC_TIMEOUT');
    expect(screen.getByTestId('count')).toHaveTextContent('-');
  });

  it('点重试 → 重新加载，成功后错误态消失', async () => {
    let fail = true;
    const load = async () => {
      if (fail) throw new Error('库被其它进程锁定');
      return [7];
    };
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('error'));
    fail = false;
    fireEvent.click(screen.getByTestId('kernel-retry'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ok'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.queryByTestId('kernel-error')).not.toBeInTheDocument();
  });
});
