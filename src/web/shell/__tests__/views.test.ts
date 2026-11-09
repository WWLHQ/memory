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

  it('主导航覆盖全部真实页面（login / setup 例外：深链兜底与首启向导不进主导航），且不包含演示通览 overview.html', () => {
    const pages = navPages();
    for (const key of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
      // 登录走壳层弹窗、首启设置由 Electron 向导直接打开：两者保留真实页面但不占主导航。
      if (key === 'login' || key === 'setup') {
        expect(pages.includes(key), `${key}.html 不应出现在主导航`).toBe(false);
        expect(PAGES[key].file).toBe(`${key}.html`);
        continue;
      }
      expect(pages.includes(key), `导航缺少 ${key}`).toBe(true);
    }
    expect(pages.some((p) => PAGES[p].file === 'overview.html')).toBe(false);
  });

  it('批次54：功能导航严格按参考图四组 17 项，名称、顺序与真实页面一一对应', () => {
    const groups = NAV.flatMap((e) => e.kind === 'group' ? [e.label] : []);
    expect(groups).toEqual(['工作台', '记忆', '连接', '治理']);

    const items = NAV.flatMap((e) => e.kind === 'item'
      ? [{ id: e.id, label: e.label, page: e.page }] : []);
    expect(items).toEqual([
      { id: 'home', label: '首页', page: 'home' },
      { id: 'write', label: '写入', page: 'write' },
      { id: 'retrieval', label: '检索', page: 'retrieval' },
      { id: 'monitor', label: '监控', page: 'monitor' },
      { id: 'memory-bank', label: '记忆库', page: 'memory' },
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
    ]);
    expect(items).toHaveLength(17);
    // 旧的可展开子树、演示通览与首启设置都不再出现在主导航里。
    expect(flattenNav().some((n) => n.children?.length)).toBe(false);
    expect(NAV.some((e) => e.kind === 'item' && e.id === 'setup')).toBe(false);
    expect(navPages()).not.toContain('login');
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
