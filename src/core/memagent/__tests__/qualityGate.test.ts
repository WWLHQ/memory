// L0→L1 质量门（§2.1 清洗红线）单测
import { describe, it, expect } from 'vitest';
import { checkL0ToL1Quality, filteredAuditDetail, QUALITY_GATE_VERSION } from '../qualityGate.ts';

describe('checkL0ToL1Quality', () => {
  it('空内容 / 纯空白 → 拦截', () => {
    expect(checkL0ToL1Quality('')).toEqual({ ok: false, code: 'empty', reason: '空内容' });
    expect(checkL0ToL1Quality('   \n\t  ')).toEqual({ ok: false, code: 'empty', reason: '空内容' });
    expect(checkL0ToL1Quality(undefined as unknown as string)).toEqual({ ok: false, code: 'empty', reason: '空内容' });
  });

  it('纯寒暄/确认语 → 拦截', () => {
    expect(checkL0ToL1Quality('好的').ok).toBe(false);
    expect(checkL0ToL1Quality('OK').ok).toBe(false);
    expect(checkL0ToL1Quality('嗯嗯').ok).toBe(false);
    expect(checkL0ToL1Quality('收到！').ok).toBe(false);
    expect(checkL0ToL1Quality('哈哈').ok).toBe(false);
    expect(checkL0ToL1Quality('👍').ok).toBe(false);
    expect(checkL0ToL1Quality('了解').ok).toBe(false);
  });

  it('纯数字 / 纯标点 / 分隔线 → 拦截', () => {
    expect(checkL0ToL1Quality('12345').ok).toBe(false);
    expect(checkL0ToL1Quality('---------').ok).toBe(false);
    expect(checkL0ToL1Quality('=====').ok).toBe(false);
    expect(checkL0ToL1Quality('！！！！！！！！！！！！').ok).toBe(false);
  });

  it('噪声规则按脱敏后文本匹配：裸链接脱敏后只剩占位符 → 拦截', () => {
    expect(checkL0ToL1Quality('https://example.com/a/b/c').ok).toBe(false);
    expect(checkL0ToL1Quality('postgres://user:pass@db:5432/app').ok).toBe(false);
  });

  it('脱敏后只剩占位符（有效字符不足）→ 拦截', () => {
    // 脱敏后变成 联系人{NAME} 等占位符，无有效信息
    expect(checkL0ToL1Quality('联系人：张三').ok).toBe(false);
  });

  it('有效技术内容 → 通过，返回脱敏后 L1 内容', () => {
    const raw = '部署步骤：1. 先用 Docker Compose 起 postgres 和 redis，2. 配置 .env 的 DATABASE_URL，3. 跑迁移脚本，4. 健康检查 /health 返回 200 即成功。若 502 检查 nginx upstream 超时配置（proxy_read_timeout 默认 60s 偏短，建议 120s）。';
    const r = checkL0ToL1Quality(raw);
    expect(r.ok).toBe(true);
    expect(r.content).toBeTruthy();
    expect(r.content!.length).toBeGreaterThan(10);
  });

  it('含敏感信息的内容：脱敏后仍有效 → 通过（脱敏产物干净）', () => {
    const raw = '服务地址 tcp://10.0.0.1:5432 的 postgres 连接串，api_key 为 sk-abcdefghijklmnop123，生产环境需轮换密钥。';
    const r = checkL0ToL1Quality(raw);
    expect(r.ok).toBe(true);
    // 脱敏产物不应含明文密钥/地址
    expect(r.content!).not.toMatch(/sk-abcdefghijklmnop123/);
    expect(r.content!).not.toMatch(/10\.0\.0\.1/);
  });

  it('纯 import / require 行（无逻辑）→ 拦截', () => {
    expect(checkL0ToL1Quality("import { foo } from 'bar';").ok).toBe(false);
    expect(checkL0ToL1Quality("const x = require('lodash');").ok).toBe(false);
    expect(checkL0ToL1Quality("import path from 'node:path';").ok).toBe(false);
  });
});

describe('批次10 元信息噪声（问候 / 身份询问 / 助手自述与能力清单）', () => {
  it('纯打招呼 / 问候+客套 → 拦截', () => {
    expect(checkL0ToL1Quality('你好').ok).toBe(false);
    expect(checkL0ToL1Quality('你好呀！').ok).toBe(false);
    expect(checkL0ToL1Quality('Hello there!').ok).toBe(false);
    expect(checkL0ToL1Quality('你好，有什么可以帮您的吗').ok).toBe(false);
    expect(checkL0ToL1Quality('你好，有什么可以帮您的吗').reason).toContain('询问');
  });

  it('纯身份/能力询问（不是真实技术问题）→ 拦截', () => {
    const ask = checkL0ToL1Quality('你好呀，请问你是什么模型呢');
    expect(ask.ok).toBe(false);
    expect(ask.reason).toContain('询问');
    expect(checkL0ToL1Quality('请问你能帮我做哪些工作呢').ok).toBe(false);
    expect(checkL0ToL1Quality('我是哪个模型').ok).toBe(false);
  });

  it('助手自我介绍 / 能力清单（多子句）→ 拦截', () => {
    const intro = checkL0ToL1Quality('你好，我是 DeepSeek，我可以帮你写代码、分析数据、回答问题。');
    expect(intro.ok).toBe(false);
    expect(intro.reason).toContain('助手');
    const list = checkL0ToL1Quality('我可以帮你做以下工作：\n1. 写代码\n2. 分析数据\n3. 回答问题');
    expect(list.ok).toBe(false);
    expect(checkL0ToL1Quality('我是 Claude，由 Anthropic 开发').ok).toBe(false);
    expect(checkL0ToL1Quality('作为 AI 助手，我可以帮你写代码、分析数据、回答问题。').ok).toBe(false);
    expect(checkL0ToL1Quality("I'm an AI assistant, I can help you with coding, data analysis, and answering questions.").ok).toBe(false);
  });

  it('含具体技术内容 → 放行（不误伤真实问题/方案）', () => {
    expect(checkL0ToL1Quality('你能帮我排查 Redis 连接池超时吗').ok).toBe(true);
    expect(checkL0ToL1Quality('我可以帮你优化 PostgreSQL 的索引配置').ok).toBe(true);
    expect(checkL0ToL1Quality('你好，部署前请检查 nginx upstream 超时配置').ok).toBe(true);
    expect(checkL0ToL1Quality('用户登录失败，错误码 E_AUTH').ok).toBe(true);
  });
});

describe('批次35 无意义会话禁止入库（本机账本 1642 行实测回放出的漏网形态）', () => {
  it('助手身份自述：夹带厂商名 / 模型 ID / 版本号也照拦', () => {
    const a = checkL0ToL1Quality('我是 **Claude Code**，底层使用的是 **Claude Haiku 4.5**（模型 ID：`claude-haiku-4-5`）。 这是 Anthropic 的轻量快速模型，专为高效对话和编程任务设计。如果你需要更强的推理能力，可以切换到更高级的模型（如 Sonnet 或 Opus）。');
    expect(a.ok).toBe(false);
    expect(a.reason).toContain('身份自述');
    expect(checkL0ToL1Quality('我是 Claude Code，Anthropic 开发的官方 CLI 工具。我会帮助你完成软件工程相关的任务，比如代码编写、调试、重构、解释代码等。 你现在使用的就是这个工具——可以直接在这里和我对话，让我帮你处理各种开发工作。有什么我可以帮你的吗？').reason).toContain('身份自述');
    expect(checkL0ToL1Quality('我是 **Agnes-3.0-flash**，由 Sapiens AI 开发。有什么可以帮你的吗？').ok).toBe(false);
  });

  it('助手能力清单：Markdown 装饰与追问句不能替内容逃过判定', () => {
    const list = checkL0ToL1Quality('当然可以！我可以帮你：\n\n- **需求分析** — 梳理功能需求、设计数据模型\n- **架构设计** — 选择技术栈、设计系统架构\n- **代码实现** — 从零搭建项目、编写功能代码\n- **界面设计** — 设计 UI/UX、制作前端页面\n\n告诉我你想做什么软件吧？比如：\n\n- 它是用来解决什么问题的？\n- 有没有偏好的技术（网站 / 桌面应用 / 手机 App / 小程序）？\n- 大概想要哪些功能？\n\n你也可以直接描述想法，我来帮你规划和实现。');
    expect(list.ok).toBe(false);
    expect(list.reason).toContain('能力清单');
  });

  it('助手过程旁白 / 进度自述 / 记忆簿自操作 → 拦截', () => {
    const narration = [
      '我先看一下当前目录情况和开发环境（SolidWorks 版本、.NET 环境等）。',
      'Shell 能用了（有个临时文件报错是噪音）。目录是空的，是全新项目。接下来检查 SolidWorks 安装和 .NET 开发环境。',
      '输出捕获有点问题，我换用 Read 工具直接读取 D:\\tmp 下的版本文件。',
      'Shell CWD 环境有点问题，我用文件工具直接探测。',
      '项目骨架完成。现在写 Core 转换引擎。',
      'Core 引擎完成。现在写 Add-in 主类和转换对话框。',
      '让我检查服务器日志看是否有请求记录：',
      '服务器一直在被终止。让我看看实际发生了什么：',
      '我理解这个问题很严重。让我先重启服务器并测试API：',
      '你好！我先看一下记忆里有没有待办事项。',
      'B3 完成。存记忆并更新状态。',
      'B3 完成。更新记忆文件（直接重写更稳）。',
      '更新 HANDOVER。',
      '跑 selftest 验证 T13。',
      '更新记忆完成。跑最终全链路回归确认。',
      '真实 Codex 接入完成。截图面板确认。',
    ];
    for (const text of narration) {
      const r = checkL0ToL1Quality(text);
      expect(r.ok, text).toBe(false);
      expect(r.reason, text).toContain('旁白');
    }
  });

  it('旁白里夹带的产品名/框架名不再是放行证据（批次10 的头号漏网口径）', () => {
    // 「SolidWorks 版本、.NET 环境」在旧口径里算“具体信息”→ 整段放行
    expect(checkL0ToL1Quality('我先看一下当前目录情况和开发环境（SolidWorks 版本、.NET 环境等）。').ok).toBe(false);
  });

  it('带硬事实的行放行：实测数值 / 文件名 / 计数 / 状态码 / 函数调用', () => {
    const pass = [
      '**T15 PASS**：`trust 计算：active+引用 > draft（a=0.767 b=0）` — l6 **17/17**，全链路 **16 PASS / 0 FAIL + DB clean** ✅ Trust Score 实接完成。更新 HANDOVER。',
      '全绿（L6 14/14、L3 11、L4/L5 EXIT=0，feedback 5/5）。B6 完成。文档销项 + 存记忆。',
      '看到问题了！浏览器请求的是`L1_sessions`目录，不是文件。让我检查panel.html中的文件选择逻辑：',
      'C2、C1 已完成。现在做 ②A（blocklist 拒写）。L4 `clusterOne` 已加 blocklist 检查（查该簇任一 fact 在 blocklist 则拒写），L3 `extractL3` 已加。',
      'Codex 已完成，§11.1 剩 **ZCode / Trae / WorkBuddy**。先探机器上有没有这些源的痕迹（Trae 你之前用过）。',
      '项目主体已全部完成。让我看 SPEC 的扩展路线图（§10/§11），确定"下一步"指什么。',
      '面板显示"M0 采集状态：暂无采集记录"。我手动触发了M0收集，但数据显示为空。让我检查数据库和API返回的数据结构。',
      '## 九、检查清单（编码前 / 中必做）\n- [ ] 函数 / 模块标注服务的 REQ / TC\n- [ ] code-map 已更新\n- [ ] 错误带 `code` + 现场上下文，不吞\n- [ ] 关键路径有结构化日志\n- [ ] 单测覆盖（TDD）\n- [ ] 不整体重写，保持段落小而可定位',
      '问题出在 build.bat 的 for 循环里，%%i 混入中文字符，改成显式列表后解决',
      'SolidWorks 版本是 2020 SP5（内部版本 28.5.0），插件目标框架定为 .NET Framework 4.7.2',
      '编译成功，0 错误 0 警告',
    ];
    for (const text of pass) expect(checkL0ToL1Quality(text).ok, text).toBe(true);
  });

  it('祈使/约束句不是旁白：用户提的要求一律放行', () => {
    expect(checkL0ToL1Quality('Token 硬上限---可适当超支，一定要保证效果，尽量在可控范围内完成').ok).toBe(true);
    expect(checkL0ToL1Quality('L0原始层查阅授权卡片宽度没有改，要和其他卡片保持一样的宽度 L0密码是多少？我验证下是否可以显示').ok).toBe(true);
    expect(checkL0ToL1Quality('测试已补喵~ 先验证所有引用 `TenantProvider` 的地方是否需要适配新的 `backendUrl` prop，然后跑测试：').ok).toBe(true);
  });

  it('单句裸需求 → 放行（批次35 拍板：算有效内容）', () => {
    expect(checkL0ToL1Quality('请帮我做一个SolidWorks插件,要求:批量转换文件格式').ok).toBe(true);
  });
});

// 批次40-B：短内容在 L0→L1 就拦掉，不留到后台精炼才发现（用户拍板「双条件」口径）
describe('批次40 短且无信号门（short_low_signal）', () => {
  it('短 + 无硬事实 + 无具体技术信息 → 拦，并记 short_low_signal', () => {
    const block = [
      '开始实施。先创建解决方案和项目文件。',
      '项目已完整编译通过。让我做一个最终文件结构确认。',
      '这是什么？很不理想，请按照第二张进行优化',
      '这个系统做完后，前后有哪些可以扩展的',
      '接下来我们需要怎么做',
      '你先帮忙分析下哪个比较好',
      '直接看当前内容然后更新。',
      '先做下工作交接，明天到公司再做',
      '让我重新读取文件，确认需要修改的部分：',
      '好的！现在让我启动服务器进行自测：',
    ];
    for (const text of block) {
      const r = checkL0ToL1Quality(text);
      expect(r.ok, text).toBe(false);
      expect(r.code, text).toBe('short_low_signal');
    }
  });

  it('短但带硬事实 → 放行（30–49 字带事实的正是最该留的短记忆）', () => {
    const pass = [
      '编译成功，0 错误 0 警告',
      'T15 PASS：l6 17/17，全链路 16 PASS / 0 FAIL',
      'HTTP 503，重试 3 次都失败',
    ];
    for (const text of pass) expect(checkL0ToL1Quality(text).ok, text).toBe(true);
  });

  it('短但带具体技术信息 → 放行（批次35 证据豁免沿用，不靠字数判生死）', () => {
    expect(checkL0ToL1Quality('我可以帮你优化 PostgreSQL 的索引配置').ok).toBe(true);
    expect(checkL0ToL1Quality('请帮我做一个SolidWorks插件,要求:批量转换文件格式').ok).toBe(true);
    expect(checkL0ToL1Quality('部署前请检查 nginx upstream 超时配置').ok).toBe(true);
  });

  it('噪声/元对话仍记自己的码，不被短门抢走（顺序即口径）', () => {
    expect(checkL0ToL1Quality('哈哈哈').code).not.toBe('short_low_signal');
    expect(checkL0ToL1Quality('你是谁？').code).not.toBe('short_low_signal');
  });

  it('质量门版本已升到 5（批次64 新增终端/附件门，改判定口径必须 +1）', () => {
    expect(QUALITY_GATE_VERSION).toBe(5);
  });
});

describe('filteredAuditDetail', () => {
  it('返回拦截审计字段（含预览 + 原因 + 长度）', () => {
    const gate = checkL0ToL1Quality('好的好的好的');
    const d = filteredAuditDetail('好的好的好的', gate);
    expect(d.action).toBe('filtered_l0_to_l1');
    expect(d.reason).toBe(gate.reason);
    expect(d.content_preview).toContain('好的');
    expect(d.content_length).toBeGreaterThan(0);
  });

  it('超长内容预览截断到 60 字 + …', () => {
    const long = 'a'.repeat(200);
    const d = filteredAuditDetail(long, checkL0ToL1Quality(long));
    expect(String(d.content_preview)).toHaveLength(61); // 60 + …
    expect(String(d.content_preview).endsWith('…')).toBe(true);
  });

  it('预览取脱敏后文本：不泄露姓名/电话/密钥', () => {
    const raw = '联系人：张三 电话 13800138000 api_key=abcd1234';
    const d = filteredAuditDetail(raw, checkL0ToL1Quality(raw));
    expect(String(d.content_preview)).not.toContain('张三');
    expect(String(d.content_preview)).not.toContain('13800138000');
    expect(String(d.content_preview)).not.toContain('abcd1234');
    expect(String(d.content_preview)).toContain('[姓名]');
    expect(d.masked).toBe(true);
  });

  it('批次36-A：审计带稳定拦截码与规则版本（回放/重判按码对账）', () => {
    const gate = checkL0ToL1Quality('好的好的好的');
    const d = filteredAuditDetail('好的好的好的', gate);
    expect(d.filter_code).toBe('thin'); // 短寒暄先撞上「有效内容不足」，不是 greeting
    expect(d.gate_version).toBe(QUALITY_GATE_VERSION);
  });

  it('批次36-A：未发码（异常调用）→ filter_code 如实记 unspecified，不冒充类别', () => {
    expect(filteredAuditDetail('好的', { ok: false, reason: '手工构造' }).filter_code).toBe('unspecified');
  });
});

describe('批次63：模型/工具运行失败日志（有失败无正常对话 → 禁止入库）', () => {
  // 用户 2026-11-19 给的两张截图原文（Our Free Model 更新失败），逐类钉住
  it.each([
    ['RATE_LIMIT', '● 本轮运行失败 Rate limit: our-free-model/nemotron-3.5-super-vl-free exceeded 10 req/min; retry in 4s    RATE_LIMIT'],
    ['NO_ADAPTER', '已调用工具并向用户提出了问题\n\n● 本轮运行失败 no adapter registered for provider "our-free-model"    NO_ADAPTER'],
    ['PI_AI_ERROR/404 下架', '处理失败\n\n已注入上下文\n\n● 本轮运行失败 404: {"message":"poolside/laguna-s-2.1:free is no longer available on OpenRouter: no provider serves this model anymore. See available models at https://openrouter.ai/models","code":404}    PI_AI_ERROR'],
    ['AUTHORIZATION_REQUIRED', '● 本轮运行失败 需要 GitHub 授权并 star 仓库后使用 EAC 模型    AUTHORIZATION_REQUIRED'],
    ['MODEL_SWITCH_COMPACTION_FAILED', '● 本轮运行失败 Cannot switch to our-free-model/beam-free: context compaction failed: 404: {"message":"This model is unavailable for free","code":404}. The previous request model is preserved; retry or select a model with a larger context window.    MODEL_SWITCH_COMPACTION_FAILED'],
  ])('拦截：%s', (_name, text) => {
    const r = checkL0ToL1Quality(text);
    expect(r.ok, text).toBe(false);
    expect(r.code, text).toBe('run_failure');
  });

  it('极短状态词「处理失败」由既有 thin 门拦下（先撞短门，属既有口径）', () => {
    const r = checkL0ToL1Quality('处理失败');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('thin');
  });

  it('失败行 + 过程旁白剔除后无实质内容 → run_failure', () => {
    const text = '已重试模型请求 (2/2) · 2s\n● 本轮运行失败 no adapter registered for provider "our-free-model"    NO_ADAPTER\n已注入上下文';
    const r = checkL0ToL1Quality(text);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('run_failure');
  });

  // 放行边界：截图里夹在失败日志之间的正常对话，绝不能被误伤
  it.each([
    ['用户提问', '请帮我更新 Our Free Model 到最新版'],
    ['助手正常回复', 'Our Free Model 当前版本为 2.7.4，更新需要先卸载再安装最新版。是否继续？确认更新'],
    ['正常故障讨论', '我们昨天排查了运行失败的问题，根因是 OpenRouter 的 provider 下线，已切换到备用模型'],
    ['技术记忆带错误码', '用户登录失败，错误码 E_AUTH，原因是 token 过期'],
  ])('放行：%s', (_name, text) => {
    expect(checkL0ToL1Quality(text).ok, text).toBe(true);
  });

  it('失败日志夹带真实诉求 → 放行（有正常对话就不拦）', () => {
    const text = '本轮运行失败 404: model unavailable    PI_AI_ERROR\n\n请帮我排查一下 OpenRouter 的模型配置，残留 provider 已经下线需要更换';
    expect(checkL0ToL1Quality(text).ok).toBe(true);
  });

  it('拦截码稳定：run_failure 走审计 detail.filter_code', () => {
    const gate = checkL0ToL1Quality('● 本轮运行失败 Rate limit: exceeded 10 req/min    RATE_LIMIT');
    const d = filteredAuditDetail('● 本轮运行失败 Rate limit: exceeded 10 req/min    RATE_LIMIT', gate);
    expect(d.filter_code).toBe('run_failure');
    expect(d.gate_version).toBe(QUALITY_GATE_VERSION);
  });
});

describe('批次64：终端/探针输出与纯附件占位（2026-11-22 实机账本取证原文）', () => {
  // 下列四条均为本机真实账本 data.memories 中 collector 写入的 L1 行（用户实机反馈「毫无意义」）。
  // 逐字回放钉住：这些行以后必须被质量门拦下，不能再进 L1 列表。
  it.each([
    ['纯附件占位（4 张截图 + 简短确认）', '@image#1:Clipboard_Screenshot.png @image#2:Clipboard_Screenshot-1.png @image#3:Clipboard_Screenshot-2.png @image#4:Clipboard_Screenshot-3.png 刚测试完，请确认', 'attachment_only'],
    ['探针自检输出（IMG:error / entries / hit）', '第二轮探针结果：IMG:error | entries=1 | hit=dur=0ms size=0', 'tool_output'],
    ['探针失败输出（A/B/C:FAIL）', '探针结果：A:FAIL Failed to fetch | B:FAIL Failed to fetch | C:FAIL Failed to fetch', 'tool_output'],
    ['终端会话记录（git status / log / remote）', 'S D:\\LHQ\\WorkBuddy\\GitHub\\shenji> git status\nOn branch main\nUntracked files:\n(use "git add <file>..." to include in what will be committed)\nREADME.md\n\nnothing added to commit but untracked files present (use "git add" to track)\nPS D:\\LHQ\\WorkBuddy\\GitHub\\shenji> git log --oneline\n14b1ee1 (HEAD -> main) Initial commit\nPS D:\\LHQ\\WorkBuddy\\GitHub\\shenji> git remote -v\norigin  [服务地址] (fetch)\norigin  [服务地址] (push)', 'tool_output'],
  ])('拦截：%s → %s', (_name, text, code) => {
    const r = checkL0ToL1Quality(text);
    expect(r.ok, text).toBe(false);
    expect(r.code, text).toBe(code);
  });

  // 放行边界：贴日志追问 / 附件旁的真实描述，是用户真正想沉淀的内容，绝不能误伤
  it('终端日志后面带提问 → 放行（有正常对话就不拦）', () => {
    const text = 'PS D:\\proj> git status\nOn branch main\nPS D:\\proj> git log\n为什么少了昨天的提交？';
    expect(checkL0ToL1Quality(text).ok, text).toBe(true);
  });

  it('截图 + 实质技术描述 → 放行（附件不是正文，但正文确实存在）', () => {
    const text = '@image#1:Clipboard_Screenshot.png 这张图里 nginx 502 的原因是 upstream 超时，需要把 proxy_read_timeout 从 60s 改成 120s';
    expect(checkL0ToL1Quality(text).ok, text).toBe(true);
  });

  it('只是讨论探针/终端的真实问题 → 放行（不是输出记录）', () => {
    expect(checkL0ToL1Quality('探针为什么会返回 error？请帮我查一下日志').ok).toBe(true);
    expect(checkL0ToL1Quality('终端里执行 npm run build 时报 TS2304，为什么会这样？').ok).toBe(true);
  });

  it('无附件引用 / 无探针行的普通短内容仍按原口径判定（不被新门抢走）', () => {
    // 新门不得把「短但带硬事实」的老放行口径吃掉
    expect(checkL0ToL1Quality('编译成功，0 错误 0 警告').ok).toBe(true);
    // 纯附件占位必须发自己的码，而不是被 short_low_signal 兜走
    expect(checkL0ToL1Quality('@image#1:a.png 看这个').code).toBe('attachment_only');
  });
});

describe('质量门版本戳与拦截码（批次36-A）', () => {
  it('每一版判定口径都带 QUALITY_GATE_VERSION 常量（历史行按 v1 处理，绝不猜最新）', () => {
    expect(QUALITY_GATE_VERSION).toBeGreaterThan(1);
  });

  // 判定顺序：空 → 有效字符不足（thin）→ 噪声规则 → 元信息。
  // 因此「---------」「好的」这类短噪声实测先撞上 thin，不会给出 separator/greeting 码——
  // 表内只列实测真实可达的码，不拿期望当事实。
  it.each([
    ['', 'empty'],
    ['   \n\t ', 'empty'],
    ['123456789012', 'bare_number'],
    ['[这是一个很长很长没有任何正文的链接标题文字]', 'bare_link'],
    ['// TODO 这里需要补充说明一下具体的实现方式', 'comment_only'],
    ["import { createStore, combineReducers, applyMiddleware } from 'redux';", 'import_only'],
    ['"this is a bare json string value"', 'bare_json'],
    ['你好，有什么可以帮您的吗', 'meta_question'],
    ['我先看一下当前目录情况和开发环境（SolidWorks 版本、.NET 环境等）。', 'narration'],
    ['我是 **Claude Code**，底层使用的是 **Claude Haiku 4.5**（模型 ID：`claude-haiku-4-5`）。 这是 Anthropic 的轻量快速模型，专为高效对话和编程任务设计。', 'identity'],
  ])('拦截码稳定：%p → %p', (text, code) => {
    const r = checkL0ToL1Quality(text);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
  });

  it('所有拦截分支都必须发码（缺码 = 回放器无法归类）', () => {
    for (const text of ['', '   \n', '好的', '12345', '---------', '=====', '联系人：张三', "const x = require('lodash');"]) {
      const r = checkL0ToL1Quality(text);
      expect(r.ok, text).toBe(false);
      expect(r.code, text).toBeTruthy();
    }
  });

  it('放行分支不发码、不发 reason', () => {
    const r = checkL0ToL1Quality('用户登录失败，错误码 E_AUTH，原因是 token 过期');
    expect(r.ok).toBe(true);
    expect(r.code).toBeUndefined();
    expect(r.reason).toBeUndefined();
  });
});
