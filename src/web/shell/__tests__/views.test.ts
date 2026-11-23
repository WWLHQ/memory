// 壳层视图映射的静态约束（批次48 S1）：
// - 每个导航项都必须落到真实页面，或明确给出「程序暂无」的原因；
// - overview.html（演示通览）按 D3 不得进入主导航；
// - 导航项上不允许出现任何演示计数/假徽标字段。
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_TABS, CMDS, NAV, PAGES, PALETTE_GROUPS, QUICK_VIEWS, flattenNav, navPages,
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

  it('功能导航为五组 23 项，名称、顺序与真实页面一一对应（2026-11-21 新增「MCP 接入」进连接组、「个人记忆」进记忆管理组）', () => {
    const groups = NAV.flatMap((e) => e.kind === 'group' ? [e.label] : []);
    expect(groups).toEqual(['工作台', '记忆管理', '连接', '治理', '智能']);

    const items = NAV.flatMap((e) => e.kind === 'item'
      ? [{ id: e.id, label: e.label, page: e.page }] : []);
    expect(items).toEqual([
      { id: 'home', label: '首页', page: 'home' },
      { id: 'write', label: '写入', page: 'write' },
      { id: 'retrieval', label: '检索', page: 'retrieval' },
      // 批次54：反馈上移到工作台（检索下方）；批次55 改名「反馈」
      { id: 'feedback', label: '反馈', page: 'feedback' },
      { id: 'monitor', label: '监控', page: 'monitor' },
      { id: 'memory-bank', label: '记忆库', page: 'memory' },
      // 2026-11-21：个人记忆回到记忆管理组，直达独立整页 personal.html（导航名与页面标题/面包屑统一为「个人记忆」）
      { id: 'personal-memory', label: '个人记忆', page: 'personal' },
      { id: 'layered', label: '层级管理', page: 'layered' },
      { id: 'lifecycle', label: '生命周期', page: 'lifecycle' },
      { id: 'growth', label: '净化生长', page: 'growth' },
      { id: 'dispute', label: '冲突裁决', page: 'dispute' },
      { id: 'agent', label: 'Agent 接入', page: 'agent' },
      // 2026-11-21：MCP 客户端接入状态独立成页，进连接组
      { id: 'mcp-clients', label: 'MCP 接入', page: 'mcp' },
      { id: 'web-onboard', label: '网页端接入', page: 'webonboard' },
      { id: 'cost', label: '大模型配置', page: 'models' },
      { id: 'sync', label: '同步中枢', page: 'sync' },
      // T3（§14.1）：管理台复用 security.html 检查摘要页签；成员侧由 Workspace 过滤不渲染
      { id: 'admin-console', label: '管理台', page: 'security' },
      { id: 'params', label: '全局参数', page: 'params' },
      { id: 'security', label: '账号与安全', page: 'security' },
      { id: 'logs', label: '日志记录', page: 'logs' },
      { id: 'audit', label: '审计日志', page: 'audit' },
      { id: 'setup', label: '首启向导', page: 'setup' },
      { id: 'assistant', label: '记忆助手', page: 'assistant' },
    ]);
    expect(items).toHaveLength(23);
    // 旧的可展开子树、演示通览不再出现；首启向导已纳入治理组。
    // 记忆助手已由壳层浮窗改为独立整页 assistant.html（不再是 panel 触发项）。
    expect(flattenNav().some((n) => n.children?.length)).toBe(false);
    expect(navPages()).not.toContain('login');
    // 记忆助手已由壳层浮窗改为独立整页 assistant.html：全站不再有 panel 型导航项
    expect(flattenNav().every((n) => !('panel' in n))).toBe(true);
  });

  it('STRATUM：规格指定的导航项带 emoji 图标（原样复刻设计稿 §2 映射）', () => {
    const items = NAV.flatMap((e) => e.kind === 'item' ? [e] : []);
    const emojiOf = (id: string) => items.find((i) => i.id === id)?.emoji;
    expect(emojiOf('home')).toBe('🏠');
    expect(emojiOf('write')).toBe('✍️');
    expect(emojiOf('retrieval')).toBe('🔍');
    expect(emojiOf('monitor')).toBe('📡');
    expect(emojiOf('memory-bank')).toBe('🗄');
    expect(emojiOf('layered')).toBe('🧬');
    expect(emojiOf('lifecycle')).toBe('♻️');
    expect(emojiOf('growth')).toBe('🌱');
    expect(emojiOf('dispute')).toBe('⚖️');
    expect(emojiOf('agent')).toBe('🔌');
    expect(emojiOf('cost')).toBe('🧠');
    expect(emojiOf('sync')).toBe('🔄');
    expect(emojiOf('params')).toBe('⚙️');
    expect(emojiOf('security')).toBe('🛡');
    expect(emojiOf('logs')).toBe('📜');
    expect(emojiOf('audit')).toBe('🧾');
    expect(emojiOf('feedback')).toBe('💬');
    // 规格未指定的项不带 emoji（回落 SVG 图标）
    expect(emojiOf('web-onboard')).toBeUndefined();
  });

  it('记忆助手是真实整页：assistant.html 已登记为 vite 构建入口且有独立页面组件', () => {
    const vite = readFileSync(`${ROOT}/vite.config.ts`, 'utf8');
    expect(vite.includes("'assistant.html'")).toBe(true);
    expect(existsSync(`${ROOT}/assistant.html`)).toBe(true);
    expect(existsSync(`${ROOT}/src/web/assistant/AssistantPage.tsx`)).toBe(true);
    expect(PAGES.assistant.file).toBe('assistant.html');
  });

  it('2026-11-21：活跃/蛰伏休眠/已归档三子项不进主导航；个人记忆为独立页入口（personal.html），记忆页仍支持状态筛选', () => {
    for (const id of ['memory-active', 'memory-dormant', 'memory-archived']) {
      expect(flattenNav().some((n) => n.id === id), `${id} 不该再出现在主导航`).toBe(false);
    }
    // 个人记忆：导航唯一项 + 真实整页
    const personalNav = flattenNav().filter((n) => n.label === '个人记忆');
    expect(personalNav).toHaveLength(1);
    expect(personalNav[0].page).toBe('personal');
    expect(PAGES.personal.file).toBe('personal.html');
    expect(existsSync(`${ROOT}/personal.html`)).toBe(true);
    expect(existsSync(`${ROOT}/src/web/memory/personalEntry.tsx`)).toBe(true);
    // 记忆库全页仍支持真实状态筛选（入口变化不删能力）
    const filterSrc = readFileSync(`${ROOT}/src/web/memory/memoryFilter.ts`, 'utf8');
    expect(filterSrc).toContain('parseStatusParam');
  });

  it('「网页端接入」是真实整页：webonboard.html 已登记为构建入口，网页会话自动采集卡迁入该页且参数页不再持有', () => {
    const vite = readFileSync(`${ROOT}/vite.config.ts`, 'utf8');
    expect(vite.includes("'webonboard.html'")).toBe(true);
    expect(existsSync(`${ROOT}/webonboard.html`)).toBe(true);
    expect(existsSync(`${ROOT}/src/web/webonboard/WebOnboardPage.tsx`)).toBe(true);
    expect(PAGES.webonboard.file).toBe('webonboard.html');
    // 卡片真迁走了：新页持有、参数页摘除（防复发：不许再长回参数页）
    const page = readFileSync(`${ROOT}/src/web/webonboard/WebOnboardPage.tsx`, 'utf8');
    expect(page).toContain('WebchatAutoCard');
    const paramsPage = readFileSync(`${ROOT}/src/web/params/ParamsPage.tsx`, 'utf8');
    expect(paramsPage).not.toContain('WebchatAutoCard');
  });

  it('2026-11-21：MCP 接入独立成页并将客户端状态整块迁出 Agent 页；自带插件导出卡迁至网页端接入页', () => {
    const vite = readFileSync(`${ROOT}/vite.config.ts`, 'utf8');
    expect(vite.includes("'mcp.html'")).toBe(true);
    expect(existsSync(`${ROOT}/mcp.html`)).toBe(true);
    expect(existsSync(`${ROOT}/src/web/mcp/McpPage.tsx`)).toBe(true);
    expect(PAGES.mcp.file).toBe('mcp.html');
    // Agent 页不再渲染 MCP 面板与导出卡，只留指向新页的入口（不重复展示、不留死链）
    const agent = readFileSync(`${ROOT}/src/web/AgentOnboard/AgentOnboardPage.tsx`, 'utf8');
    expect(agent).not.toContain('<McpClientsPanel');
    expect(agent).not.toContain('WebChatExportCard');
    expect(agent).toContain('mcp-moved-entry');
    expect(agent).toContain("requestShellView('mcp-clients')");
    // 网页端接入页持有迁入的导出卡，且采集卡仍在（两张互补卡同页）
    const web = readFileSync(`${ROOT}/src/web/webonboard/WebOnboardPage.tsx`, 'utf8');
    expect(web).toContain('WebChatExportCard');
    expect(web).toContain('WebchatAutoCard');
  });

  it('导航项不得携带演示计数/徽标字段', () => {
    for (const item of flattenNav()) {
      expect(item, item.id).not.toHaveProperty('count');
      expect(item, item.id).not.toHaveProperty('badge');
      expect(item, item.id).not.toHaveProperty('ratio');
    }
  });

  it('上下文命令条（v5）：每个页面的命令都必须可解释：跳页 / 壳层动作；至少含「重读」刷新', () => {
    const keys = Object.keys(CMDS) as (keyof typeof CMDS)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      for (const cmd of CMDS[key] ?? []) {
        const explainable = Boolean(cmd.go || cmd.action);
        expect(explainable, `${key} / ${cmd.label} 没有落点`).toBe(true);
      }
      expect(CMDS[key]?.some((c) => c.action === 'refresh'), `${key} 缺少重读命令`).toBe(true);
    }
  });

  it('命令面板（v5）：五个分组齐备；Ctrl+1..8 快速视图都在主导航中', () => {
    expect([...PALETTE_GROUPS]).toEqual(['转到页面', '执行', '工具 · 诊断直达', '视图 · 布局', '帮助']);
    const navIds = flattenNav().map((n) => n.id);
    for (const id of QUICK_VIEWS) {
      expect(navIds, `快捷视图 ${id} 不在主导航`).toContain(id);
    }
    expect(QUICK_VIEWS).toHaveLength(8);
  });

  it('底部四标签齐备；终端页签已取消（无命令通道的占位不留）', () => {
    expect(BOTTOM_TABS.map((t) => t.id)).toEqual(['output', 'problems', 'audit', 'tasks']);
    expect(BOTTOM_TABS.some((t) => (t.id as string) === 'term' || t.label === '终端')).toBe(false);
  });
});
