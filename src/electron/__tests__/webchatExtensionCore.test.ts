// 自研网页对话导出插件的纯逻辑测试：
// A 影响面：插件输出的 Markdown 必须能被记忆库 parseWebchatMd 正确解析；
// B 效果：7 站点匹配、角色提取、嵌套去重、增量签名与文件名安全；
// C 变异：若把站点/角色/输出标题写坏，这里必须红灯。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-ignore - 浏览器扩展的纯 JS 逻辑，无需 TS 声明
import '../../../browser-extension/webchat-exporter/shared/core.js';
import { parseWebchatMd } from '../../core/memagent/sessionCollector.ts';
import { auditExport } from '../../core/memagent/webchatAudit.ts';

const core = (globalThis as unknown as { WebchatExporterCore: any }).WebchatExporterCore;

const manifestPath = resolve(process.cwd(), 'browser-extension/webchat-exporter/manifest.json');

describe('自研网页对话导出插件 · 纯逻辑', () => {
  it('覆盖用户确认的 7 个站点及其主对话域名', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      content_scripts: Array<{ matches: string[] }>;
      host_permissions: string[];
    };
    const declared = [...manifest.content_scripts[0].matches, ...manifest.host_permissions].join('\n');
    for (const host of [
      'chat.deepseek.com', 'www.doubao.com', 'yiyan.baidu.com',
      'www.qianwen.com', 'chat.qwen.ai', 'www.kimi.ai', 'kimi.moonshot.cn',
      'chatglm.cn', 'aistudio.xiaomimimo.com',
    ]) {
      expect(declared, `缺少站点 ${host}`).toContain(host);
    }
    expect(core.SITES.map((s: { key: string }) => s.key)).toEqual([
      'deepseek', 'doubao', 'yiyan', 'qianwen', 'kimi', 'chatglm', 'mimo',
    ]);
  });

  it('按域名识别站点，陌生网站诚实返回 null', () => {
    expect(core.matchSite('https://chat.deepseek.com/s/abc')?.key).toBe('deepseek');
    expect(core.matchSite('https://aistudio.xiaomimimo.com/chat')?.key).toBe('mimo');
    expect(core.matchSite('https://example.com/chat')).toBeNull();
    expect(core.matchSite('not a url')).toBeNull();
  });

  it('读取语义角色与站点类名，忽略输入框和复制按钮', () => {
    document.body.innerHTML = `
      <div class="chat">
        <div data-message-role="user"><span>第一问</span><button>复制</button></div>
        <div class="assistant-message">第一答</div>
        <textarea>草稿不应入库</textarea>
      </div>`;
    expect(core.extractMessages(document, 'deepseek')).toEqual([
      { role: 'user', text: '第一问' },
      { role: 'assistant', text: '第一答' },
    ]);
  });

  it('嵌套的消息节点只保留更精确的一层，不重复导出', () => {
    document.body.innerHTML = `
      <div class="assistant-message">
        <div data-message-role="assistant">最终答案</div>
      </div>`;
    expect(core.extractMessages(document, 'deepseek')).toEqual([
      { role: 'assistant', text: '最终答案' },
    ]);
  });

  it('导出的 Markdown 能被记忆库解析器读成完整对话（用户 + 助手）', () => {
    const md = core.formatMarkdown({
      site: 'deepseek',
      siteLabel: 'DeepSeek',
      url: 'https://chat.deepseek.com/s/demo',
      exportedAt: '2026-11-16T10:00:00.000Z',
      title: '导出验收',
      messages: [
        { role: 'user', text: '请总结这段对话。' },
        { role: 'assistant', text: '好的，这是摘要。' },
      ],
    });
    expect(md).toContain('## 用户');
    expect(md).toContain('## 助手');
    const parsed = parseWebchatMd(md, 'webchat-export');
    expect(parsed.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(parsed[0].content).toContain('请总结这段对话。');
    expect(parsed[1].content).toContain('好的，这是摘要。');
  });

  it('增量签名随消息变化；下载文件名不含系统非法字符', () => {
    const first = core.signature([{ role: 'user', text: 'A' }]);
    const second = core.signature([
      { role: 'user', text: 'A' },
      { role: 'assistant', text: 'B' },
    ]);
    expect(second).not.toBe(first);
    expect(core.signature([{ role: 'user', text: 'A' }])).toBe(first);
    const name = core.fileNameFor({
      site: 'deepseek',
      exportedAt: '2026-11-16T10:00:00.000Z',
    });
    expect(name).toMatch(/^chat-exports\/deepseek\/\d{8}-\d{6}\.md$/);
    expect(core.safeSegment('a/b:c*d')).toBe('a_b_c_d');
  });

  it('导出任务：进行中提示未完成；完成后不再提示；超时按状态未确认提示', () => {
    const running = core.startTask('current', 1_700_000_000_000);
    const tasks = core.upsertTask([], running);
    expect(core.runningTasks(tasks)).toHaveLength(1);
    expect(core.unfinishedNotice(tasks, 1_700_000_000_000)).toContain('未完成的导出任务');

    const done = core.finishTask(tasks, running.id, { status: 'done', message: '已导出' }, 1_700_000_001_000);
    expect(core.runningTasks(done)).toHaveLength(0);
    expect(core.unfinishedNotice(done, 1_700_000_001_000)).toBeNull();

    const stale = core.unfinishedNotice(tasks, 1_700_000_000_000 + core.TASK_STALE_MS + 1);
    expect(stale).toContain('状态未确认');
    expect(stale).toContain('重新导出一次确认');
  });
});

// 2026-11-17 实测事故：DeepSeek 页面上导出成功，但 md 里 `## 用户` 0 段、`## 助手` 2 段
// —— 用户气泡用的是构建期 hash 类名（如 fbb737a4），detectRole 认不出就整段丢了。
// 这里钉住「能不能自己发现这个症状、并把定位所需的结构线索带出来」。
describe('抓取自检与页面结构诊断', () => {
  const HASH_SITE_HTML = `
    <div class="chat-root">
      <div class="fbb737a4">我想问个问题：一个人做的记忆系统怎么变现？</div>
      <div class="ds-assistant-message"><div class="markdown">路径一、路径二、路径三。</div></div>
      <div class="fbb737a4">那多 Agent 的记忆系统怎么定价？</div>
      <div class="ds-assistant-message">按 Agent 数量分层收费。</div>
    </div>`;

  it('只在「读到消息却一条用户提问都没有」时才判为需要诊断', () => {
    expect(core.needsDiagnostics([])).toBe(false);
    expect(core.needsDiagnostics([{ role: 'user', text: 'q' }])).toBe(false);
    expect(core.needsDiagnostics([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }])).toBe(false);
    expect(core.needsDiagnostics([{ role: 'assistant', text: 'a' }])).toBe(true);
  });

  it('复现真实症状：hash 类名的用户气泡被丢弃，只有助手消息留下', () => {
    document.body.innerHTML = HASH_SITE_HTML;
    const messages = core.extractMessages(document, 'deepseek');
    expect(messages.every((m: { role: string }) => m.role === 'assistant')).toBe(true);
    expect(messages).toHaveLength(2);
    expect(core.needsDiagnostics(messages)).toBe(true);
  });

  it('诊断带上定位所需三样：已识别元素、助手父级兄弟结构、被跳过的候选', () => {
    document.body.innerHTML = HASH_SITE_HTML;
    const messages = core.extractMessages(document, 'deepseek');
    const diag = core.collectCandidates(document, 'deepseek', messages);

    expect(diag.site).toBe('deepseek');
    expect(diag.counted).toEqual({ total: 2, user: 0, assistant: 2 });

    // 1) 已识别元素长什么样
    expect(diag.recognized[0].cls).toContain('ds-assistant-message');

    // 2) 用户气泡跟助手是兄弟：这条能直接告诉我们它用什么 class
    const siblingClasses = diag.siblingShape.children.map((c: { cls: string }) => c.cls);
    expect(siblingClasses.some((c: string) => c.includes('fbb737a4'))).toBe(true);

    // 3) 被跳过的候选里能读到用户那段文字（截断），但不含整页/正文容器
    const orphans = diag.orphans.map((o: { cls: string; head: string }) => o);
    expect(orphans.some((o: { cls: string }) => o.cls.includes('fbb737a4'))).toBe(true);
    expect(orphans.some((o: { head: string }) => o.head.includes('怎么变现'))).toBe(true);
    expect(orphans.some((o: { cls: string }) => o.cls.includes('chat-root'))).toBe(false);
    expect(orphans.some((o: { cls: string }) => o.cls.includes('markdown'))).toBe(false);
    // 文本一律截断，别把整段对话搬进诊断文件
    for (const o of orphans) expect(o.head.length).toBeLessThanOrEqual(25);
  });

  it('诊断带上祖先链与「像消息容器」清单，且侧栏噪音被排除', () => {
    // 这里刻意用一个「用户容器不是 .ds-message」的页面：模拟容器规则也没救回来的极端情况，
    // 诊断必须仍能给出祖先链与消息容器清单，让选择器可以再修。
    document.body.innerHTML = `
      <div class="ds-chat-list">
        <div class="msg-row m1"><div class="fbb737a4">用户问题一：怎么变现？</div></div>
        <div class="ds-message m2">
          <div class="_74c0879">已思考（用时 3 秒）</div>
          <div class="ds-markdown ds-assistant-message-main-content">助手回答一</div>
        </div>
      </div>
      <aside class="side">
        <div class="sidebar-message">历史会话标题不该进诊断，这条属于侧栏噪音</div>
      </aside>`;
    const messages = core.extractMessages(document, 'deepseek');
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');

    const diag = core.collectCandidates(document, 'deepseek', messages);

    // 1) 祖先链里能找到装消息的列表容器
    expect(diag.ancestors.some((a: { cls: string }) => a.cls.includes('ds-chat-list'))).toBe(true);

    // 2) 助手容器进了「像消息容器」清单，并标出 hasMarkdown（据此可反推用户容器）
    expect(
      diag.messageLike.some((x: { cls: string; hasMarkdown: boolean }) => x.cls.includes('ds-message') && x.hasMarkdown),
    ).toBe(true);

    // 3) 侧栏（aside）里的东西一个都不能混进线索
    expect(JSON.stringify(diag)).not.toContain('历史会话标题不该进诊断');
  });
});

// 2026-11-17 用 webchat-verify 诊断拿到的真实 DeepSeek 结构：
// 每条消息一个 .ds-message 容器；助手容器里有 .ds-markdown（还带「已思考」块），
// 用户容器的正文是纯 hash 类名（d29f3d7d），此前整段被丢弃。
describe('DeepSeek 消息容器规则（用户提问必须被导出）', () => {
  const DEEPSEEK_HTML = `
    <div class="ds-virtual-list-visible-items">
      <div class="d29f3d7d ds-message _63c77b1"><div class="fbb737a4">个人做的记忆系统怎么变现</div></div>
      <div class="ds-message _63c77b1">
        <div class="_74c0879">已思考（用时 3 秒）用户想了解个人记忆系统的变现路径</div>
        <div class="ds-markdown ds-assistant-message-main-content">第一条回答正文</div>
        <div class="f93f59e4">37 个网页</div>
      </div>
      <div class="d29f3d7d ds-message _63c77b1"><div class="fbb737a4">多agent记忆系统怎么变现？</div></div>
      <div class="ds-message _63c77b1">
        <div class="_74c0879">已思考（用时 5 秒）用户想知道多 Agent 的定价</div>
        <div class="ds-markdown ds-assistant-message-main-content">第二条回答正文</div>
      </div>
    </div>`;

  it('用户提问与助手回答按真实顺序成对导出，且不含「已思考」块', () => {
    document.body.innerHTML = DEEPSEEK_HTML;
    expect(core.extractMessages(document, 'deepseek')).toEqual([
      { role: 'user', text: '个人做的记忆系统怎么变现' },
      { role: 'assistant', text: '第一条回答正文' },
      { role: 'user', text: '多agent记忆系统怎么变现？' },
      { role: 'assistant', text: '第二条回答正文' },
    ]);
  });

  it('用户提问里引用了 .ds-markdown 块也不丢（2026-11-19 首条用户丢失真因）', () => {
    // 真机事故：导出文件首条是 ## 助手，用户提问整条消失。
    // 根因是 excludeInside 用泛指的 .ds-markdown，把「用户引用了上一轮回答/搜索卡片」
    // 的用户容器也当成助手丢掉。助手正文的真正标志是 .ds-assistant-message-main-content。
    document.body.innerHTML = `
      <div class="ds-virtual-list-visible-items">
        <div class="d29f3d7d ds-message _63c77b1">
          <div class="fbb737a4">请总结 Function Call 的注册方式</div>
          <div class="ds-markdown quote-ref">引用：上一轮的回答</div>
        </div>
        <div class="ds-message _63c77b1">
          <div class="ds-markdown ds-assistant-message-main-content">这是助手回答</div>
        </div>
      </div>`;
    expect(core.extractMessages(document, 'deepseek')).toEqual([
      { role: 'user', text: '请总结 Function Call 的注册方式\n\n引用：上一轮的回答' },
      { role: 'assistant', text: '这是助手回答' },
    ]);
    const md = core.formatMarkdown({
      site: 'deepseek', siteLabel: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/demo',
      exportedAt: '2026-11-19T00:00:00.000Z', title: 'demo',
      messages: core.extractMessages(document, 'deepseek'),
    });
    // 首条必须是用户，不再是助手
    expect(md.split('\n').find((l: string) => l.startsWith('## '))).toBe('## 用户');
  });

  it('真助手容器（含 ds-assistant-message-main-content）仍不会被误认成用户', () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list-visible-items">
        <div class="ds-message _63c77b1">
          <div class="ds-markdown ds-assistant-message-main-content">只有助手，没有用户提问</div>
        </div>
      </div>`;
    const msgs = core.extractMessages(document, 'deepseek');
    // 助手被 containerRules 排除，universal selector 仍会认成 assistant（不会被记成 user）
    expect(msgs.every((m: { role: string }) => m.role !== 'user')).toBe(true);
  });

  it('导出后不再触发「缺用户提问」诊断，Markdown 里 用户/助手 各 2 段', () => {
    document.body.innerHTML = DEEPSEEK_HTML;
    const messages = core.extractMessages(document, 'deepseek');
    expect(core.needsDiagnostics(messages)).toBe(false);

    const md = core.formatMarkdown({
      site: 'deepseek',
      siteLabel: 'DeepSeek',
      url: 'https://chat.deepseek.com/a/chat/s/demo',
      exportedAt: '2026-11-17T00:00:00.000Z',
      title: '变现路径',
      messages,
    });
    expect((md.match(/^## 用户$/gm) ?? []).length).toBe(2);
    expect((md.match(/^## 助手$/gm) ?? []).length).toBe(2);
    const parsed = parseWebchatMd(md, 'webchat-export');
    expect(parsed.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(parsed[0].content).toContain('怎么变现');
  });

  it('容器规则只对配置了它的站点生效，不影响其它站点', () => {
    document.body.innerHTML = DEEPSEEK_HTML;
    // 同样的 DOM 给豆包：没有 containerRules，仍然只认出助手（不误判用户）
    expect(core.extractMessages(document, 'doubao')).toEqual([
      { role: 'assistant', text: '第一条回答正文' },
      { role: 'assistant', text: '第二条回答正文' },
    ]);
  });

  it('多段落回答保留换行，不再压成一整行', () => {
    // 实测事故：3000+ 字的回答被压成一行。根因是 cloneNode 未挂到文档，
    // innerText 退化成 textContent，块级换行全丢。这里钉死「块级标签要补换行」。
    document.body.innerHTML = `
      <div class="assistant-message">
        <p>第一段：结论。</p>
        <ul><li>要点一</li><li>要点二</li></ul>
        <p>第二段：补充。</p>
      </div>`;
    const messages = core.extractMessages(document, 'deepseek');
    expect(messages).toHaveLength(1);
    const text = messages[0].text as string;
    expect(text).toContain('第一段：结论。');
    expect(text).toContain('要点二');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(4);
    // 但空行不许堆叠（清理规则要生效）
    expect(text).not.toMatch(/\n{3,}/);
  });
});

// 2026-11-17 QQ 浏览器实测事故（0.4.0 修复）：插件每 5 分钟都在正常跑（扩展 storage 日志
// 实测 15:29/15:34/15:39/15:44/15:49/15:56 各有一轮），但历史遍历恒定报
// 「没在侧栏找到历史会话列表」，历史会话永远导不出来。
// 根因是**判据认不出 DeepSeek 的侧栏**：会话条目是 hash 类名的叶子 div（c08e6e93），
// 侧栏容器也是 hash（_77cdc67 _8a693f3），旧的「a/li/role + aside/nav 或 sidebar/history
// 类名」两重判据全部落空。这里用真实诊断文件（webchat-verify/20261117-080557.json）
// 里的 DOM 结构钉死修复后的行为。
describe('侧栏历史会话识别（DeepSeek hash 类名实测结构）', () => {
  // 结构取自真实诊断：侧栏容器 div._77cdc67._8a693f3 → 分组容器 div._3098d02 → 条目 div.c08e6e93
  const DEEPSEEK_SIDEBAR_HTML = `
    <div class="_77cdc67 _8a693f3">
      <div class="_3098d02">
        <div class="c08e6e93">Claude Code binary error</div>
        <div class="c08e6e93">Claude Code配置DeepSeek</div>
        <div class="c08e6e93">2026-10 Win11选MSI安装包</div>
        <div class="c08e6e93">SolidWorks</div>
      </div>
    </div>
    <div class="ds-virtual-list-visible-items">
      <div class="d29f3d7d ds-message _63c77b1"><div class="fbb737a4">当前这一轮的用户提问</div></div>
      <div class="ds-message _63c77b1"><div class="ds-markdown ds-assistant-message-main-content">助手回答</div></div>
    </div>`;

  it('hash 类名的侧栏条目能被认出来（旧判据恒定 0 命中）', () => {
    document.body.innerHTML = DEEPSEEK_SIDEBAR_HTML;
    const labels = core.listSidebarItems(document).map((i: { label: string }) => i.label);
    expect(labels).toContain('Claude Code binary error');
    expect(labels).toContain('Claude Code配置DeepSeek');
    expect(labels).toContain('SolidWorks');
  });

  it('对话正文区（ds-message）里的内容绝不能被当成历史会话', () => {
    document.body.innerHTML = DEEPSEEK_SIDEBAR_HTML;
    const labels = core.listSidebarItems(document).map((i: { label: string }) => i.label);
    expect(labels).not.toContain('当前这一轮的用户提问');
    expect(labels).not.toContain('助手回答');
  });

  it('「开启新对话」按钮被排除（点了会清空当前页面）', () => {
    document.body.innerHTML = `
      <div class="_77cdc67 _8a693f3">
        <div class="_3098d02">
          <div class="c08e6e93">开启新对话</div>
          <div class="c08e6e93">会话一</div>
          <div class="c08e6e93">会话二</div>
          <div class="c08e6e93">会话三</div>
        </div>
      </div>`;
    const labels = core.listSidebarItems(document).map((i: { label: string }) => i.label);
    expect(labels).not.toContain('开启新对话');
    expect(labels).toContain('会话一');
  });

  it('语义站点（a[href] + aside 容器）仍然认得出——修复不能把老路径弄坏', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <ul>
          <li><a href="/chat/1">历史会话一</a></li>
          <li><a href="/chat/2">历史会话二</a></li>
          <li><a href="/chat/3">历史会话三</a></li>
        </ul>
      </aside>`;
    const labels = core.listSidebarItems(document).map((i: { label: string }) => i.label);
    expect(labels).toContain('历史会话一');
    expect(labels).toContain('历史会话三');
  });

  it('侧栏体检能说明「页面上到底有什么」，不再只丢一句「没找到」', () => {
    document.body.innerHTML = DEEPSEEK_SIDEBAR_HTML;
    const probe = core.describeSidebar(document);
    expect(probe.groupRows).toBeGreaterThan(0);
    expect(probe.groups.some((g: { cls: string }) => g.cls.includes('c08e6e93'))).toBe(true);
  });
});

// 2026-11-17 用户审计发现：导出正确率 100%，但**结构全丢了**——
// 列表没有符号、代码块没有围栏、行内代码没有反引号、粗体星号没有、表格行列关系没了。
// 根因是 nodeText() 只按块级标签补 \n，从不生成任何 markdown 标记。
// 这一组用例把「抽取层必须还原结构」钉死；同时钉住「结构保真不许把审计口径弄坏」。
describe('抽取层保留结构（列表 / 代码块 / 行内标记 / 表格）', () => {
  function textOf(html: string): string {
    document.body.innerHTML = html;
    const messages = core.extractMessages(document, 'deepseek');
    expect(messages).toHaveLength(1);
    return messages[0].text as string;
  }

  it('无序列表补 `- `，有序列表补序号', () => {
    expect(textOf('<div class="assistant-message"><ul><li>要点一</li><li>要点二</li></ul></div>')).toBe('- 要点一\n- 要点二');
    expect(textOf('<div class="assistant-message"><ol><li>第一步</li><li>第二步</li></ol></div>')).toBe('1. 第一步\n2. 第二步');
  });

  it('嵌套列表按层级缩进（缩进不能被空白清理吃掉）', () => {
    const text = textOf(
      '<div class="assistant-message"><ul><li>父项<ul><li>子项</li></ul></li></ul></div>',
    );
    expect(text).toContain('- 父项');
    // 子项前面必须有缩进：被拉平成同级就说明缩进被剥掉了
    expect(text).toMatch(/\n {2}- 子项/);
  });

  it('代码块补 ``` 围栏，保留语言标识与代码缩进', () => {
    const text = textOf(
      '<div class="assistant-message"><p>示例：</p>'
      + '<pre><code class="language-python">def f():\n    return 1</code></pre></div>',
    );
    expect(text).toContain('```python');
    expect(text).toContain('    return 1'); // 缩进是代码内容，剥掉语义就变了
    expect((text.match(/```/g) ?? []).length).toBeGreaterThanOrEqual(2); // 有开有合
  });

  it('代码块里的空行原样保留（不被 \\n{3,} 折叠规则吃掉）', () => {
    const text = textOf(
      '<div class="assistant-message"><pre><code>line1\n\n\nline4</code></pre></div>',
    );
    expect(text).toContain('line1\n\n\nline4');
  });

  it('行内代码补反引号；内容自带反引号时用双反引号', () => {
    expect(textOf('<div class="assistant-message"><p>先跑 <code>npm test</code> 再提交</p></div>')).toBe(
      '先跑 `npm test` 再提交',
    );
    expect(textOf('<div class="assistant-message"><p><code>a`b</code></p></div>')).toContain('``a`b``');
  });

  it('粗体 / 斜体补星号；空图标标签不产出 `****` 噪音', () => {
    expect(textOf('<div class="assistant-message"><p><strong>结论</strong>与<em>补充</em></p></div>')).toBe(
      '**结论**与*补充*',
    );
    expect(textOf('<div class="assistant-message"><p>正文<i class="icon"></i></p></div>')).toBe('正文');
  });

  it('表格转管道表：第一行当表头并补分隔行，竖线被转义', () => {
    const text = textOf(
      '<div class="assistant-message"><table>'
      + '<tr><th>方案</th><th>成本</th></tr>'
      + '<tr><td>A|B</td><td>低</td></tr>'
      + '</table></div>',
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('| 方案 | 成本 |');
    expect(lines[1]).toBe('| --- | --- |');
    expect(lines[2]).toBe('| A\\|B | 低 |');
  });

  it('结构保真不许把审计口径弄坏：带列表/代码/表格的对话仍判 100% 一致', () => {
    const html = '<div class="assistant-message"><p>看这里：</p>'
      + '<ul><li>要点一</li><li>要点二</li></ul>'
      + '<pre><code class="language-js">const a = 1;</code></pre>'
      + '<table><tr><th>列</th></tr><tr><td>值</td></tr></table></div>';
    document.body.innerHTML = html;
    const messages = core.extractMessages(document, 'deepseek');
    const md = core.formatMarkdown({
      site: 'deepseek',
      siteLabel: 'DeepSeek',
      url: 'https://chat.deepseek.com/s/structured',
      exportedAt: '2026-11-17T00:00:00.000Z',
      title: '结构保真',
      messages,
    });
    // 导出文档里确实带上了结构标记（否则「100% 一致」只是两边一起丢格式的自证）
    expect(md).toContain('- 要点一');
    expect(md).toContain('```js');
    expect(md).toContain('| 列 |');
    const audit = auditExport(
      messages.map((m: { role: 'user' | 'assistant'; text: string }) => ({ role: m.role, text: m.text })),
      md,
    );
    expect(audit.accuracy).toBe(1);
    expect(audit.rewritten).toBe(0);
    expect(audit.truncated).toBe(0);
  });
});

// ── 2026-11-17 用户指出：导出时间写法与文件名时间对不上 ────────────────────────
// 现象：md 里写 `2026-11-17T13:40:17.243Z`（UTC），文件名却是 `20261117-214017`（本机时间），
// 同一份导出里两个时间差 8 小时，看着像导错了。修法：正文统一「本机时间 + 时区偏移」。
describe('导出时间的写法', () => {
  const mdOf = (exportedAt: unknown) => core.formatMarkdown({
    site: 'doubao',
    siteLabel: '豆包',
    url: 'https://www.doubao.com/chat/1',
    exportedAt,
    title: '时间写法',
    messages: [{ role: 'assistant', text: '好的' }],
  }) as string;
  const timeLineOf = (md: string) => (md.match(/^- 导出时间：(.+)$/m) ?? [])[1] ?? '';
  const pad = (n: number) => String(n).padStart(2, '0');

  it('用「本机时间 + 时区偏移」，不再是 UTC 的 Z 写法', () => {
    const line = timeLineOf(mdOf('2026-11-17T13:40:17.243Z'));
    expect(line).not.toBe('');
    expect(line.endsWith('Z')).toBe(false);
    expect(line).toMatch(/[+-]\d{2}:\d{2}$/);
    // 只换表示法，时刻本身不能变
    expect(new Date(line).getTime()).toBe(Date.parse('2026-11-17T13:40:17.243Z'));
  });

  it('正文时间和文件名时间同源（否则又出现「文件 21:40 / 正文 13:40」）', () => {
    const iso = '2026-11-17T13:40:17.243Z';
    const d = new Date(iso);
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
      + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    expect(timeLineOf(mdOf(iso)))
      .toContain(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    expect(core.fileNameFor({ site: 'doubao', exportedAt: iso })).toBe(`chat-exports/doubao/${stamp}.md`);
  });

  it('时间缺失或非法 → 回退到当前时刻，绝不产出 Invalid Date', () => {
    for (const bad of [undefined, null, '', 'not-a-date']) {
      const line = timeLineOf(mdOf(bad));
      expect(line).not.toContain('NaN');
      expect(line).not.toContain('Invalid');
      expect(Number.isNaN(new Date(line).getTime())).toBe(false);
    }
  });
});
