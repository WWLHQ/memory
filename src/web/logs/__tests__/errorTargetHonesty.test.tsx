// 阶段5-B / A17+A19：异常聚合「占位 toast」接真 + 顶栏原型注释清理的契约与变异杀手。
// 判据：有真实落地页的分类必须是真 <a href>；确无对应页的分类只给诚实说明，绝不伪造跳转。
// 源码断言走 resolve(process.cwd(), ...) 字符串路径（node-brokered-fs-shim 不接受 file: URL）。
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ERROR_TARGET, ERROR_TARGET_ROUTE, aggrErrors } from '../logic.ts';
import { ErrorAggr } from '../LogCards.tsx';
import type { ErrorKind, LogEntry } from '../types.ts';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTE_KINDS = Object.keys(ERROR_TARGET_ROUTE) as ErrorKind[];

/** 六类 error 全覆盖（classifyError 按 extra.kind 关键字判别） */
const ALL_ERRORS: LogEntry[] = (['熔断', '同步', '额度', 'L0', '向量', '冲突'] as const).map((k, i) => ({
  ts: new Date(Date.now() - i * 1000).toISOString(),
  level: 'error',
  form: 'desktop',
  action: 'recall',
  request_id: `req_err_${i}`,
  message: `${k}异常`,
  extra: { kind: k },
}));

const EXPECTED_ROUTES: Record<string, string> = {
  breaker_open: '/agentonboard.html',
  quota_exceed: '/models.html',
  conflict_pending: '/dispute.html',
};

describe('阶段5-B · 异常处置入口接真（A17）+ 顶栏原型文案清理（A19）', () => {
  it('① 六类异常全部有路由判定，且恰好 3 类有真页面、3 类如实置 null', () => {
    expect(ROUTE_KINDS).toHaveLength(6);
    expect(ROUTE_KINDS.sort()).toEqual(Object.keys(ERROR_TARGET).sort());
    const real = ROUTE_KINDS.filter((k) => ERROR_TARGET_ROUTE[k].href !== null);
    expect(real.sort()).toEqual(Object.keys(EXPECTED_ROUTES).sort());
    for (const [k, href] of Object.entries(EXPECTED_ROUTES)) {
      expect(ERROR_TARGET_ROUTE[k as ErrorKind].href).toBe(href);
    }
    expect(ROUTE_KINDS.filter((k) => ERROR_TARGET_ROUTE[k].href === null)).toHaveLength(3);
  });

  it('② 三个真路由都指向仓库里真实存在的全小写 html 入口', () => {
    for (const href of Object.values(EXPECTED_ROUTES)) {
      expect(href).toMatch(/^\/[a-z-]+\.html$/);
      expect(existsSync(resolve(process.cwd(), href.slice(1)))).toBe(true);
    }
  });

  it('③ 无对应处置页的三类都带诚实说明，且说明不为空/不写「占位」', () => {
    for (const k of ROUTE_KINDS) {
      const r = ERROR_TARGET_ROUTE[k];
      if (r.href === null) {
        expect(r.note).toBeTruthy();
        expect(r.note).not.toContain('占位');
      } else {
        expect(r.note).toBeNull();
      }
    }
    expect(ERROR_TARGET_ROUTE.sync_fail.note).toContain('未接入内核 API');
    expect(ERROR_TARGET_ROUTE.l0_decrypt_fail.note).toContain('本页');
  });

  it('④ aggrErrors 六类都带 href/note，target 文案保持不变（不回归既有断言）', () => {
    const aggr = aggrErrors(ALL_ERRORS);
    expect(aggr).toHaveLength(6);
    for (const a of aggr) {
      expect(a.href).toBe(ERROR_TARGET_ROUTE[a.kind].href);
      expect(a.note).toBe(ERROR_TARGET_ROUTE[a.kind].note);
      expect(a.target).toBe(ERROR_TARGET[a.kind]);
      expect(a.count).toBe(1);
    }
    expect(aggr.find((a) => a.kind === 'conflict_pending')?.target).toContain('P8');
  });

  it('⑤ 无 error 日志 → 不渲染异常聚合卡', () => {
    expect(aggrErrors([])).toEqual([]);
    render(<ErrorAggr logs={[{ ...ALL_ERRORS[0], level: 'info' }]} />);
    expect(screen.queryByTestId('error-aggr')).toBeNull();
  });

  it('⑥ 有处置页的分类渲染真 <a href>，无对应页的分类是不可点的 <span> 且无 href', () => {
    render(<ErrorAggr logs={ALL_ERRORS} />);
    for (const [k, href] of Object.entries(EXPECTED_ROUTES)) {
      const el = screen.getByTestId(`aggr-${k}`);
      expect(el.tagName).toBe('A');
      expect(el).toHaveAttribute('href', href);
    }
    for (const k of ['sync_fail', 'l0_decrypt_fail', 'vector_error']) {
      const el = screen.getByTestId(`aggr-${k}`);
      expect(el.tagName).toBe('SPAN');
      expect(el).not.toHaveAttribute('href');
    }
  });

  it('⑦ 卡片显示诚实说明与「打开处置页」，全卡无「占位」字样', () => {
    render(<ErrorAggr logs={ALL_ERRORS} />);
    const card = screen.getByTestId('error-aggr');
    expect(card).toHaveTextContent('同步引擎已实现但未接入内核 API');
    expect(card).toHaveTextContent('请在本页「L0 授权」卡片重新解锁');
    expect(card).toHaveTextContent('打开处置页');
    expect(card.textContent).not.toContain('占位');
  });

  it('⑧ 源码声明：LogsPage 不再传 onJump / 不再弹占位 toast', () => {
    const s = src('src/web/logs/LogsPage.tsx');
    expect(s).not.toMatch(/onJump/);
    expect(s).not.toMatch(/跳转处置/);
    expect(s).not.toMatch(/（占位）/);
    expect(s).toContain('<ErrorAggr logs={shown} />');
  });

  it('⑨ 源码声明：LogCards 的 ErrorAggr 不再有 onJump 回调，真渲染 href', () => {
    const s = src('src/web/logs/LogCards.tsx');
    expect(s).not.toMatch(/onJump/);
    expect(s).not.toMatch(/占位 toast/);
    expect(s).toContain('href={a.href}');
    expect(s).toContain('不伪造跳转');
  });

  it('⑩ 源码声明：logic.ts 路由表在位，旧假跳转提示不回流', () => {
    const s = src('src/web/logs/logic.ts');
    expect(s).toContain('ERROR_TARGET_ROUTE');
    expect(s).toContain("'/dispute.html'");
    expect(s).not.toMatch(/跳转处置/);
    expect(s).not.toMatch(/（占位）/);
  });

  it('⑪ 源码声明：TopBar 注释不再写死示例账号/团队名，改为真实会话口径', () => {
    const s = src('src/web/Home/TopBar.tsx');
    expect(s).not.toMatch(/user_001/);
    expect(s).not.toMatch(/team_001/);
    expect(s).toContain('useTenant');
    expect(s).toContain('真实会话');
  });
});
