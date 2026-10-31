---
status: done
---

# 批次 31 手动测试报告 —— LLM 精炼网关（Ollama 简单层 + DeepSeek 深层，生成真实 L2–L6）

- 日期：2026-10-31
- 起因：用户问「LLM 怎么接入可以生成 L2–L6」。批次9 起「无真实大模型只落 L1」是硬规则，但内核从未接真 LLM——需要一条诚实、可控、密钥不泄露的接入路径。
- 拍板：**「简单的用 Ollama，需要深入的用 DeepSeek，不加硬上限」**——L2（简单层）路由本地 Ollama，L3–L6（深入层）路由 DeepSeek，任一引擎失败自动回退另一引擎，不设硬性层级上限。

## 1. 架构与改动清单（逐文件理由）

核心约束：内核跑在渲染进程，直连 LLM API 会撞 CORS 且泄露 apiKey → **网关放主进程**，渲染层经 IPC 代理；浏览器模式（`npm run dev`）无主进程 → 保持 FakeLlmProvider stub 口径（诚实，不伪造）。

| 文件 | 改动 | 为什么 |
|---|---|---|
| `src/electron/llmGateway.ts`（新增） | `TieredLlmProvider`（分层路由+互备+聚合错误）、`buildLayerPrompt`（读 `layerRules.ts` LAYER_SPECS 单一真源）、`loadLlmConfig/saveLlmConfig`（钳制加载，绝不存密钥）、`loadDeepseekKey/saveDeepseekKey`（0600）、`testOllama/testDeepseek` 真拨测、`loadLlmGateway`（未启用返回 null） | 网关纯函数/类集中一处，可全量单测；提示词规格不改 layerRules 就能跟随单一真源 |
| `src/electron/__tests__/llmGateway.test.ts`（新增） | 14 例：L2→ollama / L3+L6→deepseek 路由、Bearer 只发 DeepSeek（Ollama 请求无 Authorization）、互备双向、双失败错误文本含引擎原因但**不含密钥**、禁用/缺钥跳过、listModels 元数据、config 往返+JSON 不含密钥+钳制、密钥文件往返+清除、buildLayerPrompt 规格（适用场景/边界条件/keywords/projections）、拨测诚实失败、文件名常量 | 修复前先立失败用例的约定；密钥安全是测试断言的一部分 |
| `src/electron/ipcChannels.ts` | 新增 `llm:config` / `llm:configSet` / `llm:test` / `llm:refine` | 通道常量单一真源 |
| `src/electron/dataRoot.ts` | 迁移白名单加 `llm-config.json`、`llm-deepseek-key.txt` | 切换数据根后 LLM 配置不丢 |
| `src/electron/main.ts` | 新增 §6d `registerLlmIpc`（config 需会话；configSet/test 需管理员；refine 需会话+载荷校验 layer∈L2–L6/category 6 值/非空 input）；bootstrap `loadLlmGateway(USER_DATA)` + `bootstrap:llm-gateway` 日志 | 门禁三层强制（§5）；主进程日志绝不记密钥 |
| `src/electron/preload.ts` | 暴露 `api.llm.{config,setConfig,test,refine}`（带会话尾参） | preload 面约定 |
| `src/desktop/hostBridge.ts` | `HostMethod` + `CHANNEL_TO_NATIVE` 加四条 `llm:*` 通道 | iframe 子页（概览页内）同样可用 |
| `src/web/hostLlm.ts`（新增） | `createHostLlm()`：HostLlmProvider，`isStub` 是 **getter**（由模块级配置快照驱动，`refreshHostLlmSnapshotOnce` 去重拉取）；`listModels()` 映射 Ollama free / DeepSeek cheap；`refineLayer/call` 经 hostCall 代理 | 内核 `agent.write` 同步调 `llm.listModels()` → 用快照 + getter 避免重建内核；配置保存即热生效 |
| `src/web/kernel.ts` | `getKernel`/`createKernelOnSameStorage` 装配 `llm: overrides.llm ?? createHostLlm() ?? new FakeLlmProvider()`；`rebuildKernelForDataPlane()` 顺带刷新快照 | 内核不动，注入点收敛在 kernel.ts；浏览器拿 null → FakeLlmProvider（行为不变） |
| `src/web/params/llmEngine.ts`（新增） | 桥接：`llmGetConfig/llmSaveConfig/llmTestEngine`（成功后回写快照；deepseekKey 只在请求参数中出现） | 渲染层桥接模式与 backup.ts 一致 |
| `src/web/params/LlmEngineCard.tsx`（新增） | 参数页「LLM 精炼引擎」管理卡：两引擎启用/模型名/baseURL（Ollama 可改，DeepSeek 固定）、「测试连通」（先保存再真拨测，✅/❌+延时）、DeepSeek API Key 密码框（留空=保持现有，保存/清除）、保存 LLM 配置；管理员门禁 + 浏览器模式诚实禁用说明 | UI 与 KbManagementCard 管理卡模式一致；密钥输入框 placeholder 不回显已存密钥 |
| `src/web/params/ParamsPage.tsx` | 在知识库策略表后渲染 `<LlmEngineCard />` | 参数页是配置入口（G7：不暴露参数名，文案人话） |
| `AGENTS.md` §3/§6/§9、`specs/code-map.md`、`specs/code-index.generated.md` | 批次31 条目与索引刷新（285 文件） | 门禁要求 |

**路由与回退**：`refineLayer` L2 → `[ollama, deepseek]`，L3–L6 → `[deepseek, ollama]`；首个启用且成功的引擎胜出；都失败抛聚合错误（内核如实记 `refine_error`，该层留空——绝不伪造层内容）。内核写路径本身未改：质量门 → L1 → 逐层（生成→`checkLayerSpec` 校验→查重→嫁接）。

## 2. 安装包

| 项 | 值 |
|---|---|
| 路径 | `release/installer/MultiAgent Memory-0.1.0-setup.exe` |
| 大小 | 121,995,921 B（116.34 MiB） |
| SHA256 | `9B34CBC5D6D2D00211EC7CF32F371E0CDF1A40EFB734E3B735D5BB48A68BF236` |

打包收口：`release/installer` 被外部进程占用（EPERM）→ 按既有机制复制+删除完成收口，旧安装包已清理，仅保留最新一份。

## 3. 自动化验证（真实跑过）

- `npm run verify:fast` **exit 0**：typecheck 双配置 0 错、oxlint 0/0（452 文件）、索引新鲜度通过（285 文件）。
- 单测：**123 文件 / 1365 用例全过**（含批次31 新增 14 例）。
- 覆盖率：语句 79.10% / 分支 71.26% / 函数 74.84% / 行 82.13%（均高于阈值）。
- **实机 E2E（真 Ollama，非 mock）**：本机 `127.0.0.1:11434` 在线（qwen2.5:7b + qwen2.5-coder:7b）。用 esbuild 打包**真实网关代码**直调：
  - L2（ollama）：真返回 149 字符，符合规格（保留「教训/错误码」关键词，字数在区间内），延时 ~28s；
  - L3（deepseek 路由，DeepSeek 未启用）→ **自动回退 ollama 成功**：真返回 82 字符（含 成功/失败/教训），互备得到实测验证；
  - 临时脚本已删除，无残留。

## 4. 手动测试步骤（验收用）

1. 安装新包并启动桌面端，管理员登录。
2. 打开「全局参数」页 → 找到「🧠 LLM 精炼引擎」卡。
3. 确保本机 Ollama 在跑（`http://127.0.0.1:11434`，先 `ollama pull qwen2.5:7b`）→ 勾选启用、模型名 `qwen2.5:7b` → 点「测试连通」→ 应显示 ✅ + 真实延时。
4. 点「保存 LLM 配置」→ 写入成功提示（`llm:config-saved` 动作日志）。
5. 到「写记忆」页写入一条测试记忆 → 应看到 L1 与 L2 逐层生成（L2 走 Ollama，约 20–40s）；层级列表/详情页可看到真实 L2 正文与 `layers_generated_at`（本组层生成时刻）。
6. （可选）填入 DeepSeek API Key →「测试连通」✅ 后，新写入的 L3–L6 应由 DeepSeek 生成；关掉 DeepSeek 再写应自动回退 Ollama。
7. 门禁回归：普通成员登录 → 该卡显示「需管理员」、控件禁用；未登录/浏览器 dev 模式 → 卡片诚实显示不可用，不冒充可配置。
8. 审计回查：写失败/禁用时内核审计出现 `llm_fallback` / `refine_error`，错误文案不含密钥。

## 5. 已知边界（诚实声明）

- **DeepSeek 真调未在本机实测**（需要用户自填 API Key，留给你验证）——协议与 Ollama 同为 OpenAI 兼容 `/v1/chat/completions`，已有 14 例单测覆盖 Bearer 头与失败路径；「测试连通」即真拨测。
- 本机 7B 模型可能偶发违反层级规格（字数/mustInclude）→ 内核 `checkLayerSpec` 判废并如实留空/记审计，不降级为假内容。
- **L2 走本地 Ollama 单次 ~28s**（qwen2.5:7b，CPU/无 GPU 时更久）→ 写入会明显变慢；可换更小模型或仅启用 DeepSeek。
- price/quota（Ollama free / DeepSeek 0.01）只是路由记账元数据，满足 routeProxy 价帽，**不代表真实 DeepSeek 计费**。
- `llm:refine` 需会话但不需管理员：登录用户写入即触发精炼；配置面（启用/模型/密钥）仍仅管理员。
- 浏览器 dev 模式无主进程 → 永远 FakeLlmProvider（只落 L1），卡片诚实禁用，符合既有宿主能力边界。
