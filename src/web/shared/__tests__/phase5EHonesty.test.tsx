// 阶段5-E / B9+B10+B11 诚实边界契约（变异杀手）
// B9：知识库策略表接真到内核 policyFor() 单一真源，消除第二套演示数值与编造分类。
// B10：内核写路径只有四种自动裁决结果，不存在用户可选三模式（C 类诚实重标注）。
// B11：wired=false 固定诚实标注，账本审计时间不得冒充云端对账时间（C 类诚实重标注）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import {
  CATEGORIES, isCategory, type AuditRecord, type Memory, type StorageBackend,
} from '../../../core/memagent/types.ts';
import { policyFor } from '../../../core/memagent/forgetting.ts';
import { DEDUP_THRESHOLDS } from '../../../core/memagent/layerRules.ts';
import { CATEGORY_LABEL, DEFAULT_KB_POLICIES, kernelKbPolicies } from '../../params/defaults.ts';
import { KbPolicyTable } from '../../params/KbPolicyTable.tsx';
import { DedupCard } from '../../write/DedupCard.tsx';
import type { DedupResult } from '../../write/types.ts';
import { getHomeFeed } from '../../Home/coreHome.ts';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const makeDedup = (over: Partial<DedupResult> = {}): DedupResult => ({
  score: 0.86, threshold: DEDUP_THRESHOLDS.L1, layer: 'L1', is_duplicate: true, ...over,
});

const memA = {
  mem_id: 'mem_a', project_id: 'p1', enterprise_id: 'e1', team_id: 't1',
  category: 'fact', layer: 'L1', content: 'desktop authored note',
  decay_class: 'hot', pinned: false, locked: false,
  access_count: 0, created_at: 0, updated_at: 0,
} as unknown as Memory;

function fakeStorage(audits: AuditRecord[]): StorageBackend {
  return {
    putMemory: async () => {},
    getMemory: async () => null,
    listMemories: async () => [memA],
    deleteMemory: async () => {},
    appendAudit: async () => {},
    queryAudit: async () => audits,
    // ── 批次46-D6：项目注册表（本测试不覆盖，给占位实现以满足 StorageBackend 契约）──
    createProject: async () => ({ project_id: 'x', kind: 'general', created_at: 0, created_by: 'u' }),
    getProject: async () => null,
    listProjects: async () => [],
  };
}

describe('5-E / B9 知识库策略表接真到内核单一真源', () => {
  it('kernelKbPolicies() 六行逐一等于 policyFor(category)', () => {
    const rows = kernelKbPolicies();
    expect(rows).toHaveLength(CATEGORIES.length);
    for (const cat of CATEGORIES) {
      const p = policyFor(cat);
      expect(rows.find((r) => r.kb === cat)).toMatchObject({
        kb: cat,
        half_life_days: p.half_life_days,
        archive_days: p.auto_archive_days,
        merge_on: p.auto_merge === true,
      });
    }
  });

  it('DEFAULT_KB_POLICIES 就是内核派生值，页面没有第二份策略表', () => {
    expect(DEFAULT_KB_POLICIES).toEqual(kernelKbPolicies());
    expect(DEFAULT_KB_POLICIES).toHaveLength(6);
  });

  it('六个 kb 键全是内核合法 Category 且与 CATEGORIES 集合相等（旧中文分类不回流）', () => {
    const keys = DEFAULT_KB_POLICIES.map((r) => r.kb);
    expect(keys.every(isCategory)).toBe(true);
    expect(new Set(keys)).toEqual(new Set<string>(CATEGORIES));
    expect(keys.every((k) => isCategory(k) && k in CATEGORY_LABEL)).toBe(true);
  });

  it('表格只读渲染：六行、数值来自内核、零输入框', () => {
    const { container } = render(<KbPolicyTable />);
    expect(screen.getAllByTestId(/^kb-row-/)).toHaveLength(6);
    const fact = policyFor('fact'); // CATEGORIES[0]
    expect(screen.getByTestId('kb-hl-0')).toHaveTextContent(String(fact.half_life_days));
    expect(screen.getByTestId('kb-ar-0')).toHaveTextContent(String(fact.auto_archive_days));
    expect(screen.getByTestId('kb-hl-0').tagName).toBe('TD');
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('表格诚实说明：policyFor 单一真源 / 归档阈值内核未使用 / 只读', () => {
    render(<KbPolicyTable />);
    const note = screen.getByTestId('kb-honesty-note');
    expect(note).toHaveTextContent('内核未使用该值');
    expect(note).toHaveTextContent('cautious');
    expect(screen.getByTestId('kb-table')).toHaveTextContent('policyFor(category)');
    expect(screen.getByTestId('kb-table')).toHaveTextContent('只读');
  });

  it('源码声明杀手：旧中文分类 / 旧数值 / 快照回填 kbs / 旧未接线措辞均不回流', () => {
    const defaults = src('src/web/params/defaults.ts');
    const table = src('src/web/params/KbPolicyTable.tsx');
    const page = src('src/web/params/ParamsPage.tsx');
    for (const legacy of ['项目知识', '决策知识', '偏好知识', '流程知识', '事实知识', '上下文知识']) {
      expect(defaults).not.toContain(legacy);
      expect(table).not.toContain(legacy);
    }
    expect(defaults).not.toMatch(/half_life_days:\s*(?:30|60|90|45|14|7),\s*archive_days/);
    expect(defaults).toMatch(/policyFor\(kb\)/);
    expect(table).not.toMatch(/尚未接入遗忘\/归档执行/);
    expect(page).not.toMatch(/setKbs\(saved\.kbs\)/);
    expect(page).toMatch(/<KbPolicyTable\s*\/>/);
  });
});

describe('5-E / B10 内核写路径四种真实结果（C 类诚实重标注）', () => {
  it('内核 dedup.action 联合只含 new/grafted/duplicated/filtered', () => {
    expect(src('src/core/memagent/types.ts')).toMatch(/action:\s*'new' \| 'grafted' \| 'duplicated' \| 'filtered'/);
  });

  it('Web 侧两个 dedup_action 类型收敛为四种，不再挂 merge/overwrite', () => {
    for (const f of ['src/web/write/coreWrite.ts', 'src/web/write/types.ts']) {
      const s = src(f);
      expect(s).toMatch(/dedup_action:\s*'create' \| 'graft' \| 'keep' \| 'filtered'/);
      expect(s).not.toMatch(/dedup_action:[^;]*'merge'/);
      expect(s).not.toMatch(/dedup_action:[^;]*'overwrite'/);
    }
    expect(src('src/web/write/coreWrite.ts')).toMatch(/r\.dedup\.action === 'duplicated' \? 'keep'/);
  });

  it('WritePage 不再有永不命中的 merge toast 分支', () => {
    const s = src('src/web/write/WritePage.tsx');
    expect(s).not.toMatch(/dedup_action === 'merge'/);
    expect(s).not.toContain('已合并写入');
    expect(s).toMatch(/dedup_action === 'keep'/);
    expect(src('src/web/write/logic.ts')).not.toMatch(/dedupAction === 'merge'/);
  });

  it('DedupCard note 明写四种真实结果，且不留待办式旧措辞', () => {
    render(<DedupCard result={makeDedup()} />);
    const note = screen.getByTestId('dedup-note');
    for (const v of ['new', 'grafted', 'duplicated', 'filtered']) expect(note).toHaveTextContent(v);
    expect(note).toHaveTextContent('全部由内核自动裁决');
    expect(note).toHaveTextContent('不存在用户可选的');
    expect(note).not.toHaveTextContent('尚未接入写路径');
  });

  it('DedupCard 不渲染三模式按钮，源码也无 op-merge/overwrite/keep 与旧措辞', () => {
    render(<DedupCard result={makeDedup()} />);
    for (const id of ['op-merge', 'op-overwrite', 'op-keep']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    const s = src('src/web/write/DedupCard.tsx');
    expect(s).not.toMatch(/op-(?:merge|overwrite|keep)/);
    expect(s).not.toMatch(/尚未接入写路径|三模式尚未接入/);
  });
});

describe('5-E / B11 wired=false 诚实边界（C 类诚实重标注）', () => {
  it('coreHome 固定 wired:false（含 emptySync），源码无 wired:true 伪造', () => {
    const s = src('src/web/Home/coreHome.ts');
    expect(s.match(/wired:\s*false/g)).toHaveLength(2);
    expect(s).not.toMatch(/wired:\s*true/);
  });

  it('TopBar 只有 wired===true 分支才渲染 formatAgo(lastReconcileAt)', () => {
    const s = src('src/web/Home/TopBar.tsx');
    const branch = s.slice(s.indexOf('const syncText'), s.indexOf('const syncText') + 400);
    expect(branch).toMatch(/sync\?\.wired === true/);
    expect(branch).toMatch(/formatAgo\(sync\.lastReconcileAt\)/);
    expect(branch).toMatch(/同步未实现（本版本不提供云端同步）/);
    expect(s).toMatch(/wired=false 时即使 lastReconcileAt 非零也不渲染 formatAgo/);
  });

  it('账本有 sync_up 审计 → lastReconcileAt 非零，但 wired 仍为 false', async () => {
    const now = Date.now();
    const feed = await getHomeFeed(fakeStorage([
      { request_id: 'r1', action: 'sync_up', ts: now - 1000, detail: { applied: 1 } },
    ]));
    expect(feed.sync.lastReconcileAt).toBe(now - 1000);
    expect(feed.sync.wired).toBe(false); // 本地/历史审计时间不是云端同步已接通的证据
  });

  it('只有 implemented:false 的 sync 审计 → lastReconcileAt=0 · wired=false', async () => {
    const now = Date.now();
    const feed = await getHomeFeed(fakeStorage([
      { request_id: 'r1', action: 'sync', ts: now - 500, detail: { implemented: false } },
    ]));
    expect(feed.sync.lastReconcileAt).toBe(0);
    expect(feed.sync.wired).toBe(false);
  });

  it('源码声明杀手：4-H「引擎已实现、未接入 API」结论不得被翻案', () => {
    const files = ['src/web/Home/coreHome.ts', 'src/web/Home/TopBar.tsx'].map(src).join('\n');
    expect(files).not.toMatch(/wired:\s*true/);
    expect(files).toMatch(/E_NOT_IMPLEMENTED|未接入内核 API/);
    expect(src('src/core/memagent/__tests__/syncL0Honesty.test.ts')).toMatch(/E_NOT_IMPLEMENTED/);
  });
});
