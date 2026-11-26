---
title: code:index:check 在 core.autocrlf 下永久过期 —— EOL 归一化修复（立项）
date: 2026-11-26
status: proposed（待用户拍板后实施）
scope: tools/code-index.mjs 的指纹计算与 --check 比较；不改业务代码、不改 git 配置
depends: 既有门禁 verify:fast 的 code:index:check 步骤；core.autocrlf=true 的 Windows checkout
---

# code-index:check 的 LF/CRLF 永久过期缺陷：立项方案

> 本文只立项，不改代码。结论来自 2026-11-26 的当下复现，不是复述历史日志。

## 1. 现象与复现证据

**现象**：在主工作区生成并提交索引后，任何全新 checkout（含 CI）跑 `npm run code:index:check` 都报「代码索引已过期」，即使源码与文档一字未改，且连已推送的基线提交 `16fc768` 也一样。

2026-11-26 现查：

| 场景 | 索引文件真实字节 | `tools/code-index.mjs` 真实字节 | `--check` |
|---|---|---|---|
| 主工作区（文件由工具写入，未被 git 重写） | CRLF 0 / LF 1332 | CRLF 0 / LF 215 | 通过 |
| 全新 `git worktree add --detach HEAD`（模拟 CI checkout） | CRLF 1332 / LF 1332 | CRLF 215 / LF 215 | **失败，退出码 1** |

`git config --get core.autocrlf` = `true`；`git show HEAD:specs/code-index.generated.md` 的字节是 LF（blob 存 LF，checkout 转 CRLF）。

**结论**：这是索引生成器与 git 换行转换的交互缺陷，不是某次提交引入的回归，也不是工作区脏文件导致。

## 2. 根因：两处独立的 EOL 敏感点

`tools/code-index.mjs` 当前实现：

```js
// ① 指纹直接用磁盘真实字节（124/131、147/152 行）
text = await readFile(abs, 'utf8');
hash: createHash('sha256').update(text).digest('hex').slice(0, 12),

// ② 生成的 Markdown 用 '\n' 拼装（169–196 行），--check 直接字符串比较（208 行）
const md = lines.join('\n') + ...;
if (current !== md) { /* 过期 */ }
```

于是：

1. **指纹层**：`autocrlf=true` 下，git blob 存 LF，checkout 变 CRLF。同一份源码在「工具写入的工作区」和「git checkout 的工作区」算出两个不同 sha256 → 索引记录的文件指纹天然对不上。
2. **文本层**：`--write` 写出的 md 用 LF；git 提交时规范化成 LF blob；checkout 后磁盘上是 CRLF。`--check` 读到的 `current` 带 `\r\n`，而内存里的 `md` 是 `\n`，**即使所有指纹一致，字符串比较也必失败**。

`summaryOf` / `docSummaryOf` 用 `trim()`，`exportsOf` 的正则不依赖行尾，均不受影响；`lines` 计数也不变。只需修这两处。

### 2.1 为什么不用这些替代方案

| 方案 | 不采用的原因 |
|---|---|
| 只加 `.gitattributes` 强制 `eol=lf` | 只影响未来的 checkout，已有工作区/CI 不会自动重检；且不修「指纹基于真实字节」这个根因。可作为防御性补充，但不作为主修复。 |
| 指纹改成 `git show HEAD:<path>` | 索引生成器必须能检测**未提交**改动，绑 git 反而失去这个能力；也把纯文件扫描变成依赖 git 进程的脚本。 |
| 只在 `--check` 比较时忽略换行 | 指纹本身在 CRLF checkout 里已经变了，比较归一化救不回来。两处必须一起修。 |

## 3. 推荐修复：统一规范化为 LF（canonical form）

新增纯函数并让所有相关路径共用：

```js
/** 把 CRLF / CR 统一成 LF；指纹与比较都以规范化文本为准 */
export const canonical = (text) => String(text).replace(/\r\n?/g, '\n');
```

落地三点：

1. **指纹**：`createHash('sha256').update(canonical(text))`。源码与文档都走它。
2. **生成**：`md` 仍用 `\n` 拼装（保持确定性），`--write` 写出的内容不变语义。
3. **比较**：`if (canonical(current) !== md)`，让 CRLF checkout 的索引文件与 LF 基准等价。

一次性副作用：**所有指纹值会变**（因为旧指纹来自 LF，新规则对 LF 文本结果相同——若基准文本本来就是 LF，sha256 不变；真正变化的是 CRLF 工作区生成的索引）。实施时仍须在各场景重跑 `--write`，并把结果提交；提交前在「LF 工作区 + CRLF 全新 checkout」双场景各跑一次 `--check` 确认。

### 3.1 纯函数拆分与测试落点

把 `canonical`、`fingerprintOf(text)`、`isIndexCurrent(written, generated)` 抽到 `tools/code-index-core.mjs`（无 IO、无 git 依赖），`code-index.mjs` 只负责扫描与读写。测试放 `tools/__tests__/code-index-core.test.mjs`，用 `node --test`：

- LF 与 CRLF 同一内容 → `fingerprintOf` 相同；
- `isIndexCurrent(crlfIndex, lfGenerated)` → `true`；
- 单字节改动（源码/文档各一）→ `fingerprintOf` 不同；
- 真 CR 换行也归一化。

`package.json` 增 `test:tools`: `node --test tools/__tests__/*.test.mjs`，并加入 `verify:fast`（在 `code:index:check` 之前），让门禁自身锁住这个坑。

## 4. 三道闸门（实施时的验收判据）

**A·影响面回归**：主工作区（LF）跑 `npm run code:index -- --write` 后 `--check` 通过；`verify:fast` 全绿（typecheck / lint / no-demo / 覆盖率阈值）；索引的「文件数 / 目录分组 / 表格内容」除指纹外逐行不变；业务源码零改动。

**B·效果验证**：
1. 在提交后的 HEAD 上新建 `core.autocrlf=true` 的全新 worktree（文件为 CRLF），**不重跑 `--write`**，`node tools/code-index.mjs --check` 必须退出码 0；
2. 临时把某个被索引的源码改一行 → `--check` 退出码 1；还原 → 0；
3. 临时把某份文档改一行 → `--check` 退出码 1；还原 → 0；
4. `core.autocrlf=false` 的全新 checkout 同样通过（不能只修 Windows 一侧）。

**C·变异验证**：
1. 把 `fingerprintOf` 里的 `canonical()` 删掉 → B1 必须红；
2. 把 `isIndexCurrent` 里的 `canonical(current)` 换回 `current` → B1 必须红；
3. 两处还原后全部重绿。变异只改临时副本，不动主工作区。

## 5. 影响面清单（拍板后按此改）

| 文件 | 改动 | 闸门角色 |
|---|---|---|
| `tools/code-index.mjs` | 指纹/比较改走 core 纯函数；保留 CLI 参数与输出格式 | A + B 主战场 |
| `tools/code-index-core.mjs`（新增） | `canonical` / `fingerprintOf` / `isIndexCurrent` 纯函数 | B + C |
| `tools/__tests__/code-index-core.test.mjs`（新增） | 4 组节点测试 | B + C |
| `package.json` | 新增 `test:tools` 并接入 `verify:fast` | A 回归 |
| `specs/code-index.generated.md` | 一次性重建（内容语义不变） | B 效果 |
| 本文 + `meta/index.md` | 立项登记 | — |

## 6. 边界与诚实限制

- 本方案只解决 **EOL 差异导致的假过期**；内容真变更仍必须 `--write`，不被静默放过。
- 不改 `core.autocrlf`，不改 `.gitattributes`：现有仓库的换行策略保持不变，避免大规模 renormalize 抖动。
- 指纹算法仍是 12 位 sha256 前缀；不追求抗碰撞，只做变更检测。
- 该缺陷在 LF-only 环境（多数 Linux/macOS CI）不显现，所以「本地绿、Windows CI 红」是预期表现，不是偶发。
- 实施完成后，本文状态改为 `implemented`，并把 B1 的实测结果写进验收记录。
