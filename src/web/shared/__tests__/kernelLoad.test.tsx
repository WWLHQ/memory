import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../kernelLoad.tsx';

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

describe('kernelErrorText', () => {
  it('Error 取 message', () => {
    expect(kernelErrorText(new Error('宿主桥 3s 未回话'))).toBe('宿主桥 3s 未回话');
  });
  it('带 E_XXX 码时保留码（便于对照 actions.log）', () => {
    expect(kernelErrorText({ code: 'E_IPC_TIMEOUT', message: '宿主桥超时' })).toBe('E_IPC_TIMEOUT：宿主桥超时');
  });
  it('空异常不产出空字符串', () => {
    expect(kernelErrorText(undefined)).toBe('未知错误');
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

  it('内核不可达 → 错误态带真实原因，绝不表现为空数据', async () => {
    const load = () => Promise.reject(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'));
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('error'));
    expect(screen.getByTestId('kernel-error')).toBeInTheDocument();
    expect(screen.getByTestId('kernel-error-title')).toHaveTextContent('读取记忆账本失败：内核数据没读到');
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT 宿主桥 3s 未回话');
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
