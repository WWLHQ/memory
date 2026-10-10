# REQ-010 遗忘机制后台任务 任务拆分（第十七章 17.4–17.11）

> 落 `src/core/memagent/forgetting.ts`（内核扩展，复用 StorageBackend/Memory）。无 UI；P4/P14 已有展示页。

## T1 数据模型扩展（17.4）
- Memory 补可选字段：importance/confidence/access_count/reinforce_count/half_life_days/last_access_time/tags/merged_from/merged_into（向后兼容，全部可选带默认）

## T2 纯函数
- `freshnessOf(m, now)`：0.5^(age_days/half_life_days)，钳制 ≥0.05（17.5）
- `scoreMemory(m, relevance, w, now)`：relevance×(0.35f+0.30i+0.15c+0.20a)，pinned +0.15 且免检进候选（17.5/17.8 AC-03）；下限钳制 f≥0.05/i≥0.1/c≥0.05
- `policyFor(category)`：17.6 六类知识库默认策略（half_life/auto_archive_days/auto_merge）
- `classifyLayer(m, now)`：17.7 升降级（locked/pinned 豁免降级；>3d→warm、>30d/freshness<0.1/confidence<0.3→cold、cold+freshness<0.05+90d→dormant、命中/恢复→warm、pinned/imp≥0.9/24h强化→hot）
- `runForgettingCycle(storage, now, opts)`：17.10 一轮任务 = 新鲜度计算 + 层迁移 + 重复识别合并 + 冷压缩（每周）+ 全程审计；locked 不迁移不合并（AC-04）；不删除任何知识（AC-01）；可关闭（AC-14）
- `mergeDuplicates(group, storage)`：17.9 摘要 = importance 取最高 + merged_from 来源 + 原文降 Cold 保留 + 失败不影响原文（AC-09/10）

## T3 契约测试（AC 覆盖）
- AC-01 不删除只降权 / AC-03 pinned 免检加分 / AC-04 locked 豁免 / AC-05 忘记=降权 / AC-06 恢复 / AC-09 合并留原文 / AC-10 摘要失败不伤原文 / AC-11 冷层不进默认召回 / AC-14 可审计可关闭 + 17.7 全部升降级路径 + 17.6 策略表

## T4 门禁
- vitest 全绿 + build/validate/generate --check
