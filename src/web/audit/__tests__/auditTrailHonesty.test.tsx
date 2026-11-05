// 阶段5-A / A15+A16：审计行「跳检索页上下文」接真 + 过时文案纠正的契约与变异杀手。
// 覆盖：URL 契约 → 检索页真查账本 → 页面级挂载 → 源码声明不回流。
// 源码断言走 resolve(process.cwd(), ...) 字符串路径（node-brokered-fs-shim 不接受 file: URL）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RETRIEVAL_CONTEXT_PAGE, readTrailRequestId, retrievalContextHref, trailEntries,
} from '../auditLink.ts';
import { AuditTable } from '../AuditTable.tsx';
import { AuditTrailCard } from '../../retrieval/AuditTrailCard.tsx';
import { RetrievalPage } from '../../retrieval/RetrievalPage.tsx';
import { resetKernelForTests } from '../../kernel.ts';
import { seedAuditLedger, SEED_AUDIT } from './fixtures.ts';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const goto = (search: string) => window.history.replaceState({}, '', `/retrieval.html${search}`);

describe('阶段5-A · 审计链路跳转与检索页上下文（真接真）', () => {
  beforeEach(async () => {
    localStorage.clear();
    resetKernelForTests();
    await seedAuditLedger();
    goto('');
  });
  afterEach(() => {
    cleanup();
    goto('');
  });

  it('① 跳转 URL 是真实检索页 + 编码后的 request_id，绝不再指向 /overview.html', () => {
    expect(RETRIEVAL_CONTEXT_PAGE).toBe('/retrieval.html');
    expect(retrievalContextHref('req_a1')).toBe('/retrieval.html?request_id=req_a1');
    expect(retrievalContextHref('req a&b')).toBe('/retrieval.html?request_id=req%20a%26b');
    expect(retrievalContextHref('x')).not.toContain('/overview.html');
  });

  it('② readTrailRequestId：缺失/空白 → null，有值才返回，不回落伪造默认链路', () => {
    expect(readTrailRequestId('')).toBeNull();
    expect(readTrailRequestId('?request_id=%20%20')).toBeNull();
    expect(readTrailRequestId('?scene=default')).toBeNull();
    expect(readTrailRequestId('?scene=default&request_id=req_a1')).toBe('req_a1');
  });

  it('③ trailEntries 只回放该 id 的真实审计行（时间升序），查无此 id → 空数组', () => {
    const rows = trailEntries(SEED_AUDIT, 'req_a1');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.action)).toEqual(['recall', 'mode_dispatch', 'cold_recall']);
    expect(trailEntries(SEED_AUDIT, 'req_不存在')).toEqual([]);
    expect(trailEntries(SEED_AUDIT, null)).toEqual([]);
    expect(trailEntries(SEED_AUDIT, 'req_a1').every((r) => r.request_id === 'req_a1')).toBe(true);
  });

  it('④ 审计表行末链接与 helper 同源，title 无「占位」', () => {
    render(<AuditTable entries={[SEED_AUDIT[0]]} activeRequestId={null} onToggleChain={() => {}} />);
    const link = screen.getByTestId('jump-req_a1-0');
    expect(link).toHaveAttribute('href', retrievalContextHref('req_a1'));
    expect(link.getAttribute('title')).not.toContain('占位');
  });

  it('⑤ 检索页卡片真查内核账本：命中 3 条真实审计行，含真实动作与资源', async () => {
    render(<AuditTrailCard search="?request_id=req_a1" />);
    await waitFor(() => expect(screen.getByTestId('trail-rows')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^trail-row-/)).toHaveLength(3);
    expect(screen.getByTestId('trail-row-0')).toHaveTextContent('召回');
    expect(screen.getByTestId('trail-row-1')).toHaveTextContent('模式分流');
    expect(screen.getByTestId('trail-row-0')).toHaveTextContent('memory/mem_001');
    expect(screen.getByTestId('audit-trail-card')).toHaveTextContent('request_id=req_a1');
  });

  it('⑥ 账本查无此 id → 如实显示空，不生成任何模拟检索结果', async () => {
    render(<AuditTrailCard search="?request_id=req_不存在" />);
    await waitFor(() => expect(screen.getByTestId('trail-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('trail-rows')).toBeNull();
    expect(screen.getByTestId('trail-empty')).toHaveTextContent('账本中无该 request_id 的审计记录');
  });

  it('⑦ 无 request_id 参数 → 不渲染链路卡（不凭空造上下文）', () => {
    render(<AuditTrailCard search="" />);
    expect(screen.queryByTestId('audit-trail-card')).toBeNull();
  });

  it('⑧ 页面级：带 ?request_id 打开检索页 → 卡片出现，且检索状态仍是 IDLE（不伪造召回结果）', async () => {
    goto('?request_id=req_a1');
    render(<RetrievalPage />);
    await waitFor(() => expect(screen.getByTestId('audit-trail-card')).toBeInTheDocument());
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.queryByTestId('empty-panel')).toBeNull();
    expect(screen.getByTestId('q-submit')).toBeDisabled();
  });

  it('⑨ 页面级：直接打开检索页（无参数）→ 无链路卡，不注入上下文', () => {
    render(<RetrievalPage />);
    expect(screen.getByTestId('retrieval-page')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-trail-card')).toBeNull();
  });

  it('⑩ 源码声明：AuditTable 不再有 /overview.html 假链接与「占位」标题', () => {
    const s = src('src/web/audit/AuditTable.tsx');
    expect(s).not.toMatch(/\/overview\.html/);
    expect(s).not.toMatch(/跳检索页上下文（占位）/);
    expect(s).not.toMatch(/跳检索页占位/);
    expect(s).toContain('retrievalContextHref(e.request_id)');
  });

  it('⑪ 源码声明：AuditPage 不再宣称「暂无 audit 端点 / REQ-012 待实现 / 跳检索页为占位」', () => {
    const s = src('src/web/audit/AuditPage.tsx');
    expect(s).not.toMatch(/home server 暂无 audit 端点/);
    expect(s).not.toMatch(/检索页 REQ-012 待实现/);
    expect(s).not.toMatch(/跳检索页为占位/);
    expect(s).toContain('/api/mirror/audit');
    expect(s).toContain('真实审计链路上下文');
  });

  it('⑫ 源码声明：useAuditMirror 不再自述 safe-noop / 无端点 / 预留空钩子', () => {
    const s = src('src/web/audit/useAuditMirror.ts');
    expect(s).not.toMatch(/暂无 audit 端点/);
    expect(s).not.toMatch(/当前 safe-noop/);
    expect(s).not.toMatch(/预留：未来 home server/);
    expect(s).toContain('/api/mirror/audit');
    expect(s).toContain("mirrorReport('audit', action)");
  });

  it('⑬ 源码声明：检索页真挂载链路卡 + 卡片真读内核账本（无演示数据）', () => {
    const page = src('src/web/retrieval/RetrievalPage.tsx');
    const card = src('src/web/retrieval/AuditTrailCard.tsx');
    expect(page).toContain('<AuditTrailCard');
    expect(card).toContain('coreLoadAudit()');
    expect(card).toContain('trailEntries(all, requestId)');
    expect(card).not.toMatch(/占位/);
    expect(card).toContain('不模拟召回');
  });
});
