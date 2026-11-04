// 批次38：安全页「L0 旧数据迁移卡」单测（从 L0AdminCard 拆出后单独覆盖）。
// 口径：这张卡只管**换封法**（行上明文 → v2 / 遗留 v1 → v2），不管搬库；
// 迁移要重新加密 → 写密钥没解锁就不给点；内核报错原样展示，绝不显示成功回执；
// 解不开的行只报「待处理」数量并警告，绝不假装删掉；旧密码传完即从输入框清空。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ status: vi.fn(), migrate: vi.fn() }));
vi.mock('../coreSecurity.ts', () => ({ coreL0Status: h.status, coreL0Migrate: h.migrate }));

import { L0MigrateCard } from '../L0MigrateCard.tsx';
import type { L0MigrationResult } from '../../../core/memagent/types.ts';

/** 实机 2026-11-02 21:03 UTC+08:00 的回显：库已拆干净，本轮无事可做 */
const NOOP: L0MigrationResult = {
  report: { scanned: 1642, migrated_orig: 0, migrated_v1: 0, pending: 0, skipped: 1642 },
  backup_dir: 'C:\\Users\\LHQ\\AppData\\Roaming\\MultiAgent Memory\\backups\\l0-migrate-2026-11-02T13-03-23-744Z',
};

function mockKernel(opts: { writeUnlocked?: boolean; statusFails?: boolean; result?: unknown } = {}) {
  h.status.mockImplementation(() =>
    opts.statusFails ? Promise.reject(new Error('主进程未注册 l0:status')) : Promise.resolve({ write_unlocked: opts.writeUnlocked ?? true }),
  );
  h.migrate.mockImplementation(() => Promise.resolve(opts.result ?? NOOP));
}

beforeEach(() => {
  h.status.mockReset();
  h.migrate.mockReset();
});

describe('L0MigrateCard（§4.4.6 旧数据迁移独立卡）', () => {
  it('非管理员：只给「需管理员」说明，不拉密钥环状态、不给执行入口', () => {
    mockKernel();
    render(<L0MigrateCard enabled={false} />);
    expect(screen.getByTestId('l0-migrate-need-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('l0-migrate-form')).toBeNull();
    expect(h.status).not.toHaveBeenCalled();
  });

  it('写密钥未解锁：按钮禁用并写明原因，点了不发迁移（绝不凭空重加密）', async () => {
    mockKernel({ writeUnlocked: false });
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate-need-write-key')).toBeInTheDocument());
    expect(screen.getByTestId('l0-migrate')).toBeDisabled();
    fireEvent.click(screen.getByTestId('l0-migrate'));
    expect(h.migrate).not.toHaveBeenCalled();
  });

  it('密钥环状态读不到：如实标注「读不到」并仍禁用，不按已解锁放行', async () => {
    mockKernel({ statusFails: true });
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate-need-write-key')).toHaveTextContent('本机读不到密钥环状态'));
    expect(screen.getByTestId('l0-migrate')).toBeDisabled();
    fireEvent.click(screen.getByTestId('l0-migrate'));
    expect(h.migrate).not.toHaveBeenCalled();
  });

  it('解锁后点迁移：逐字回显扫描/明文迁移/v1 迁移/待处理/跳过与备份目录（实机那条回执）', async () => {
    mockKernel();
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('l0-migrate'));
    await waitFor(() => expect(screen.getByTestId('l0-mig-report')).toBeInTheDocument());
    const text = screen.getByTestId('l0-mig-report').textContent ?? '';
    expect(text).toContain('扫描 1642');
    expect(text).toContain('明文迁移 0');
    expect(text).toContain('v1 迁移 0');
    expect(text).toContain('待处理 0');
    expect(text).toContain('跳过 1642');
    expect(text).toContain('l0-migrate-2026-11-02T13-03-23-744Z');
    expect(text).toContain('本轮无事可做');
    expect(h.migrate).toHaveBeenCalledWith(undefined);
  });

  it('填了旧 v1 密码：原样传给内核并当场清空输入框（密码不留在页面上）', async () => {
    mockKernel();
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate')).not.toBeDisabled());
    const input = screen.getByTestId('l0-mig-old-pw');
    fireEvent.change(input, { target: { value: 'legacy-v1-pass' } });
    fireEvent.click(screen.getByTestId('l0-migrate'));
    await waitFor(() => expect(h.migrate).toHaveBeenCalledWith('legacy-v1-pass'));
    await waitFor(() => expect((screen.getByTestId('l0-mig-old-pw') as HTMLInputElement).value).toBe(''));
    expect(screen.getByTestId('l0-mig-report').textContent).not.toContain('legacy-v1-pass');
  });

  it('有待处理行：点名还剩几条、并写明这些行一行没动（不是已删）', async () => {
    mockKernel({
      result: {
        report: { scanned: 1642, migrated_orig: 0, migrated_v1: 12, pending: 8, skipped: 1622 },
        backup_dir: 'D:\\backups\\l0-migrate-y',
      },
    });
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('l0-migrate'));
    await waitFor(() => expect(screen.getByTestId('l0-mig-report')).toBeInTheDocument());
    const text = screen.getByTestId('l0-mig-report').textContent ?? '';
    expect(text).toContain('v1 迁移 12');
    expect(text).toContain('仍有 8 条待迁移');
    expect(text).toContain('一行没动');
    expect(text).not.toContain('本轮无事可做');
  });

  it('内核抛错（未解锁 / 备份失败 / 旧密码不对）：原样显示原因，绝不出现成功回执', async () => {
    mockKernel();
    h.migrate.mockRejectedValueOnce(new Error('E_L0_LOCKED：写密钥未解锁'));
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('l0-migrate'));
    await waitFor(() => expect(screen.getByTestId('l0-migrate-error')).toHaveTextContent('E_L0_LOCKED：写密钥未解锁'));
    expect(screen.queryByTestId('l0-mig-report')).toBeNull();
    expect(screen.queryByTestId('l0-migrate-msg')).toBeNull();
  });

  it('解锁发生在别处（上方 L0 管理卡）：点「刷新写密钥状态」即重新判定并放行，不必刷新整页', async () => {
    mockKernel({ writeUnlocked: false });
    render(<L0MigrateCard enabled />);
    await waitFor(() => expect(screen.getByTestId('l0-migrate')).toBeDisabled());

    h.status.mockImplementation(() => Promise.resolve({ write_unlocked: true }));
    fireEvent.click(screen.getByTestId('l0-migrate-refresh'));
    await waitFor(() => expect(screen.getByTestId('l0-migrate')).not.toBeDisabled());
    expect(screen.queryByTestId('l0-migrate-need-write-key')).toBeNull();

    fireEvent.click(screen.getByTestId('l0-migrate'));
    await waitFor(() => expect(h.migrate).toHaveBeenCalledTimes(1));
  });
});
