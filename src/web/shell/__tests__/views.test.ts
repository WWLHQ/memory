// 壳层视图映射的静态约束（批次48 S1）：
// - 每个导航项都必须落到真实页面，或明确给出「程序暂无」的原因；
// - overview.html（演示通览）按 D3 不得进入主导航；
// - 导航项上不允许出现任何演示计数/假徽标字段。
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_TABS, NAV, PAGES, RIBBON, flattenNav, navPages,
} from '../views.ts';

const ROOT = process.cwd();

describe('壳层导航映射', () => {
  it('每个页面都指向仓库根目录的真实 HTML，且已登记为 vite 构建入口', () => {
    const vite = readFileSync(`${ROOT}/vite.config.ts`, 'utf8');
    for (const [key, page] of Object.entries(PAGES)) {
      expect(existsSync(`${ROOT}/${page.file}`), `${key} → ${page.file} 不存在`).toBe(true);
      expect(vite.includes(`'${page.file}'`), `${page.file} 未登记为构建入口`).toBe(true);
      expect(page.source.length, `${key} 缺少数据来源说明`).toBeGreaterThan(0);
    }
  });

  it('主导航覆盖全部真实页面（login 例外：走壳层弹窗不进主导航；首启向导已纳入治理组），且不包含演示通览 overview.html', () => {
    const pages = navPages();
    for (const key of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
      // 登录走壳层弹窗：保留真实页面但不占主导航。
      if (key === 'login') {
        expect(pages.includes(key), `${key}.html 不应出现在主导航`).toBe(false);
        expect(PAGES[key].file).toBe(`${key}.html`);
        continue;
      }
      expect(pages.includes(key), `导航缺少 ${key}`).toBe(true);
    }
    expect(pages.some((p) => PAGES[p].file === 'overview.html')).toBe(false);
  });

  it('功能导航为五组 20 项，名称、顺序与真实页面一一对应（记忆助手已是独立整页 assistant.html）', () => {
    const groups = NAV.flatMap((e) => e.kind === 'group' ? [e.label] : []);
    expect(groups).toEqual(['工作台', '记忆管理', '连接', '治理', '智能']);

    const items = NAV.flatMap((e) => e.kind === 'item'
      ? [{ id: e.id, label: e.label, page: e.page }] : []);
    expect(items).toEqual([
      { id: 'home', label: '首页', page: 'home' },
      { id: 'write', label: '写入', page: 'write' },
      { id: 'retrieval', label: '检索', page: 'retrieval' },
      { id: 'monitor', label: '监控', page: 'monitor' },
      { id: 'memory-bank', label: '记忆库', page: 'memory' },
      { id: 'personal', label: '个人记忆', page: 'memory' },
      { id: 'layered', label: '层级管理', page: 'layered' },
      { id: 'lifecycle', label: '生命周期', page: 'lifecycle' },
      { id: 'growth', label: '净化生长', page: 'growth' },
      { id: 'dispute', label: '冲突裁决', page: 'dispute' },
      { id: 'agent', label: 'Agent 接入', page: 'agent' },
      { id: 'cost', label: '大模型配置', page: 'models' },
      { id: 'sync', label: '同步中枢', page: 'sync' },
      { id: 'params', label: '全局参数', page: 'params' },
      { id: 'security', label: '账号与安全', page: 'security' },
      { id: 'logs', label: '日志记录', page: 'logs' },
      { id: 'audit', label: '审计日志', page: 'audit' },
      { id: 'feedback', label: '用户反馈', page: 'feedback' },
      { id: 'setup', label: '首启向导', page: 'setup' },
      { id: 'assistant', label: '记忆助手', page: 'assistant' },
    ]);
    expect(items).toHaveLength(20);
    // 旧的可展开子树、演示通览不再出现；首启向导已纳入治理组。
    // 记忆助手已由壳层浮窗改为独立整页 assistant.html（不再是 panel 触发项）。
    expect(flattenNav().some((n) => n.children?.length)).toBe(false);
    expect(navPages()).not.toContain('login');
    // 记忆助手已由壳层浮窗改为独立整页 assistant.html：全站不再有 panel 型导航项
    expect(flattenNav().every((n) => !('panel' in n))).toBe(true);
  });

  it('记忆助手是真实整页：assistant.html 已登记为 vite 构建入口且有独立页面组件', () => {
    const vite = readFileSync(`${ROOT}/vite.config.ts`, 'utf8');
    expect(vite.includes("'assistant.html'")).toBe(true);
    expect(existsSync(`${ROOT}/assistant.html`)).toBe(true);
    expect(existsSync(`${ROOT}/src/web/assistant/AssistantPage.tsx`)).toBe(true);
    expect(PAGES.assistant.file).toBe('assistant.html');
  });

  it('「个人记忆」是记忆库全页的个人记忆 Tab（不是壳层面板），点击即打开该页', () => {
    const personal = flattenNav().find((n) => n.id === 'personal');
    expect(personal?.page).toBe('memory');
    expect(personal?.href).toBe('?tab=personal');
    // 记忆库全页确实支持 personal 这个真实 Tab（不是编造参数）
    const memPage = readFileSync(`${ROOT}/src/web/memory/MemoryManagementPage.tsx`, 'utf8');
    expect(memPage).toContain("'all' | 'personal' | 'layers' | 'conflict' | 'review' | 'l0'");
  });

  it('导航项不得携带演示计数/徽标字段', () => {
    for (const item of flattenNav()) {
      expect(item, item.id).not.toHaveProperty('count');
      expect(item, item.id).not.toHaveProperty('badge');
      expect(item, item.id).not.toHaveProperty('ratio');
    }
  });

  it('功能区每条命令都必须可解释：跳页 / 壳层动作 / 明确不可用', () => {
    for (const tab of RIBBON) {
      expect(tab.groups.length, tab.label).toBeGreaterThan(0);
      for (const group of tab.groups) {
        for (const item of group.items) {
          const explainable = Boolean(item.go || item.action || item.unavailable);
          expect(explainable, `${tab.label} / ${group.label} / ${item.label} 没有落点`).toBe(true);
          if (item.unavailable) expect(item.unavailable.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('底部五标签齐备；终端明确不可用而非伪装可用', () => {
    expect(BOTTOM_TABS.map((t) => t.id)).toEqual(['output', 'problems', 'audit', 'tasks', 'term']);
    const term = BOTTOM_TABS.find((t) => t.id === 'term');
    expect(term?.unavailable).toContain('未提供终端命令通道');
  });
});
