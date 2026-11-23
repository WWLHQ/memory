# P1-6 / P1-7 / P1-8 重新评估（摆上台面）

> 时间：2026-11-23 15:50（北京时间）｜ 性质：**评估文档，不含任何代码改动，未获确认前不实施**
> 现查证据：`src/core/memagent/vector.ts`、`agent.ts`、`fileStorage.ts`、`types.ts`、`package.json`、`release/installer/`、本机 `audit.jsonl` + 归档（743 次 recall）、`memories.db.json`（5686 条有效记忆）、Web 现查 ONNX/Electron 资料。

---

## 0. 一句话结论

**P1-8 的方向被 11-22 方案写错了，真问题不是 qvec 缓存而是每条记忆的 tokenize；P1-6 付出 135MB 包体积 + 原生模块打包风险换语义能力，收益不可预先保证；P1-7 前置依赖 P1-6 且会拖慢本就超标的延迟。建议顺序：改版 P1-8（先做、纯逻辑）→ 观察 → P1-6 小步试点（需拍板）→ P1-7 暂缓。**

---

## 1. 关键现查发现（推翻原 P1-8 方案）

### 1.1 延迟到底是什么造成的

本机实测（2026-11-23，5686 条有效记忆，Node 22）：

| 环节 | 实测耗时 | 说明 |
|---|---|---|
| `embedSync(query)` 单条 query | **0.002 ms** | 报告里 P1-8 要缓存的对象——缓存它毫无收益 |
| 全库 5686 条 cosine（已建向量） | **1 ms** | 也不是瓶颈 |
| 全库 5686 条 `tokenize(m.content)` + `new Set` | **242 ms** | **真正的热路径开销**，占 p95 1168ms 约 20% |
| `JSON.parse` 32MB 全库 | 245 ms | 冷启动一次性；`reloadOnMtime` 默认 false、读写态 `maybeReload` 直接返回，故**不是每次 recall 成本** |

热路径定位到 `agent.ts:248`：每条候选都执行 `new Set(tokenize(m.content))`。query 的 token 集合只算一次（第 242 行），被打分的是**每条记忆正文**——原方案把缓存对象搞反了。

### 1.2 存储层现状

- 现网用 `FileStorage`（`main.ts:3377`）；`listMemories` 从内存 `doc` 过滤返回，不读盘。
- recall 内调用 `listMemories` 两次：`agent.ts:200` 全项目候选 + `:216` P_SYSTEM 增长配置；后者是内存过滤，开销可忽略。
- `vector.ts` 的 `index` 是**内存可丢弃索引**，进程重启为空；但 agent.ts 打分实际读 `m.embedding`（持久化在行上），与 index 无关——两条路径并存，改缓存要注意别改错对象。

### 1.3 语义检索现状

- `JsVectorBackend`：64 维 hash bag-of-words + cosine，中文 2-gram，零模型零出网。
- `embedSync` 被 9 个模块直接 import（vector/forgetting/dedup/conflict/rebuild/messages…），**不是只服务 recall**——替换成 ONNX 要顾及全链路，不能只改一处。
- `package.json` 当前 deps 仅 `pg/react/react-dom`，无任何模型/推理依赖。
- 当前安装包 **124MB**，unpacked **382MB**。

---

## 2. P1-8 延迟优化（重新定义，建议先做）

### 原方案（11-22）
> qvec 按 query 文本缓存（LRU），p95 1141→<500ms。

**判定：作废。** query embed 实测 0.002ms，缓存收益为零。

### 改版方案 P1-8′
**思路**：给 5686 条记忆的 token 集合建**进程内缓存**（按 `mem_id` + 内容哈希失效），把每条 `tokenize+Set` 从热路径移走。

- 落点建议：`forgetting.ts` 的 `tokenCoverageWeighted` 调用点 / `agent.ts:248`，包一个 `tokenSetOf(m)` 模块级 `Map`，key=mem_id、value={hash, Set}；hash 变则重算。
- 风险：内存占用（5686 个 Set，粗估几十 MB，可接受）；失效必须绑内容哈希，否则写后召回读到旧 token（A 闸门要钉住"写入后立刻召回"用例）。
- 预期：热路径省 ~240ms，p95 1168→~900ms 量级；**达不到 <500ms**（其余是 audit IPC、putMemory 回写、进程调度）。要 <500ms 需进一步砍 IPC/审计写盘，那是另一个原子任务。
- 成本：纯逻辑、零依赖、零出网；1 个原子任务 + 三道闸门即可验证。
- 验收：同一 query 跑前后 p50/p95 对比（用现役 audit 的 latency_ms 字段），命中集合与分数**逐条不变**（B 闸门只读断言：改缓存不能改召回结果）。

**建议：先做 P1-8′，它是三者里唯一"投入小、无外部依赖、风险可控"的。**

---

## 3. P1-6 ONNX embedding（64 → 384 维）

### 现查事实
- `intfloat/multilingual-e5-small`：384 维、100+ 语言、MIT 许可；官方 ONNX **int8 约 113–118MB**、fp32 448MB；tokenizer.json 约 **17MB** → 随包约 **135MB**（Web 现查 2026-11-23，来源 HuggingFace / onnx.bimant / 第三方 ADR）。
- Electron 打包坑（Web 现查多篇一手记录）：`onnxruntime-node` 是 native `.node`，必须 `electron-rebuild` 或 `asarUnpack` + `extraResources`；asar 内路径解析会失败；Windows 7 与新版系统表现不一致；模型文件下载中断会留截断文件且 loader 只查存在不查完整性，导致"静默降级、rerank 永远不运行"。
- 本项目 `release/` 已 gitignored、打包脚本走 `tools/package-builder.cjs`；加 native 模块要改打包配置并重新走完整交付闭环。

### 收益与风险
| 项 | 判断 |
|---|---|
| 语义质量 | 理论上能显著改善（hash 词袋→真语义），但**具体提升多少无法预先保证**，必须离线 eval 实测，不能拿官方 benchmark 数字当我们的收益 |
| 包体积 | 124MB → ~260MB（翻倍）；用户下载与安装体验下降 |
| 冷启动 | 模型加载约 1–2s（外部 ADR 实测），首次 recall 延迟反而变差 |
| 零出网卖点 | 模型随包分发则**不破**；若走首次下载则破——这是硬红线，只能选随包 |
| 全链路影响 | `embedSync` 被 9 个模块直接用；换模型要重算全库向量（5686 条）、改维度兼容（`cosine` 维度不一致按 0 分，见 vector.ts:62）、历史向量迁移 |
| 确定性 | int8 在不同 CPU 指令集上向量有 ~0.0065 偏移（外部 ADR 实测），跨机器迁移索引会有阈值漂移 |

### 建议
**不直接全量切换**，走小步试点：
1. 只做**离线评估**（不动生产链路）：模型 + onnxruntime 放 `tools/` 开发期依赖，对现役 743 次审计的 query 重算 embedding，比较 top1/NDCG，**先证明收益真实存在**。
2. 若收益达标，再评估"双后端并行"（64 维主 + 384 维旁路打分融合），避免一次性推翻现有打分口径。
3. 全程保持随包离线、SHA256 校验、asarUnpack。

**需用户拍板**：是否接受包体积翻倍 + 引入 native 模块工程复杂度，去换一个尚未量化的语义收益。

---

## 4. P1-7 cross-encoder reranker（建议暂缓）

### 现查事实
- `Xenova/ms-marco-MiniLM-L-6-v2` 量化 ONNX 约 **23MB**（外部一手 issue 记录的截断/正确文件大小对比）；模型小，但推理是逐 query 对 top-20 候选做 cross-encode。
- 依赖 ONNX runtime 同类 native 打包问题。
- 已知坑（外部 issue #29 实测）：模型截断/加载失败时，onnxruntime-node 回退 WASM 在 Node 下因 blob: Worker 报错而**静默降级**——rerank 永远不运行但用户无感知，搜索"能用但更差"。

### 判断
- **前置依赖 P1-6**：既然都要引入 ONNX runtime，P1-7 的边际工程成本低于单独做；但在 P1-6 收益未证实前，叠加 reranker 只会放大复杂度。
- **与本就超标的延迟冲突**：现网 p95 已 1168ms，cross-encoder 对 20 候选逐对推理会再加数百 ms，与 P1-8 的优化方向相反。
- **建议**：等 P1-6 离线评估有正收益、且 P1-8′ 把延迟压下来之后，再作为独立原子任务评估；现在不动。

---

## 5. 三者优先级与决策建议

| 优先级 | 任务 | 投入 | 收益确定性 | 风险 | 建议 |
|---|---|---|---|---|---|
| 1 | **P1-8′（改版延迟优化）** | 低（纯逻辑 1 任务） | 高（实测 242ms 可省） | 低 | **建议立即做** |
| 2 | **P1-6 离线评估** | 中（模型+评估脚本，不进生产） | 未知（需实测） | 中（开发期依赖） | **建议做评估，再决定是否上生产** |
| 3 | P1-6 生产化 | 高（包体积翻倍+native 打包+全库重嵌入） | 取决于上一步 | 高 | 待评估结果拍板 |
| 4 | P1-7 reranker | 中高 | 未验证 | 高（静默降级坑） | **暂缓** |

**推荐执行顺序**：P1-8′ → 离线 P1-6 评估 → （若收益达标）P1-6 生产化 → P1-7。

---

## 6. 执行纪律
1. 本文件是评估，**不授权任何代码改动**；用户确认具体哪一项后才进原子实施。
2. 每项实施遵守三道闸门：A 影响面回归（打分逐条不变）/ B 效果验证（延迟或 NDCG 真的变了）/ C 变异验证（临时改错关键判定→测试红灯→还原绿灯）。
3. 涉及运行时改动走完整交付闭环：关端 → 打包 → 验产物 → 启端 → 核运行态；commit/push 单独等人工确认。
4. 不为一周数据调参凑数；语义收益必须离线 NDCG 实测，不拿官方 benchmark 当我们的成绩。

---

## 本次问题复盘
**① 现象与根因**：11-22 报告把 P1-8 写成"qvec LRU 缓存"，但现查发现 query embed 仅 0.002ms——报告的说法基于直觉而非实测，找错了优化对象。
**② 弯路**：评估中途一度把 245ms 的 JSON.parse 当成每次 recall 成本，差点据此下结论；回读 `fileStorage.ts:237` 的 `maybeReload` 才纠正——读写态根本不读盘，那是冷启动成本。教训：性能结论必须先定位到具体代码行再实测。
**③ 修复点与防复发**：本评估把每个耗时数字绑到源码行号（`agent.ts:248` / `vector.ts:62` / `fileStorage.ts:237`）与实测命令；P1-8 重新定义为 tokenSet 缓存，验收要求"命中与分数逐条不变"。
**④ 遗留未解项**：P1-6 的语义收益尚未量化（需离线评估）；ONNX native 打包的具体配置（`asarUnpack`/`extraResources`/rebuild 版本）需在生产化时实测；P1-7 的静默降级风险需在实施时加显式健康检查。

沉淀：本轮结论落盘于本报告；可复用知识待 write_memory 固化后补 mem_id。
