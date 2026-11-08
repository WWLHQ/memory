// 壳层视图映射的静态约束（批次48 S1）：
// - 每个导航项都必须落到真实页面，或明确给出「程序暂无」的原因；
// - overview.html（演示通览）按 D3 不得进入主导航；
// - 导航项上不允许出现任何演示计数/假徽标字段。
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_TABS, PAGES, RIBBON, flattenNav, navPages,
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

  it('主导航覆盖全部真实页面，且不包含演示通览 overview.html', () => {
    const pages = navPages();
    for (const key of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
      expect(pages.includes(key), `导航缺少 ${key}`).toBe(true);
    }
    expect(pages.some((p) => PAGES[p].file === 'overview.html')).toBe(false);
  });

  it('个人记忆在记忆管理内以标签打开：静态导航只带入口，计数由页面按真实内核回传', () => {
    const personal = flattenNav().find((n) => n.id === 'ledger-personal');
    expect(personal).toBeTruthy();
    expect(personal?.page).toBe('memory');
    expect(personal?.href).toBe('?tab=personal');
    expect(personal).not.toHaveProperty('unavailable');
    expect(personal).not.toHaveProperty('count');
    expect(personal).not.toHaveProperty('badge');
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
