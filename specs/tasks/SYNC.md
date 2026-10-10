# REQ-008 云同步 任务拆分（同步机制详细设计 §1–§8）

> 落 `src/core/memagent/sync.ts`（内核扩展）。三项锁定：桌面主源 / 自动 LWW / 中枢账本。契约级用内存 SyncHub 扮演 Postgres 中枢（接口同构）。
> **PgSyncHub 落地（`src/core/memagent/pgSyncHub.ts`）**：基于 @electric-sql/pglite（进程内真 Postgres WASM，无参=内存库 / 传 dataDir=落盘持久化），五表账本 hub_memories（镜像+全局单调 version_seq+#loser# 墓碑）/ hub_seen（sha256 幂等）/ hub_conflicts（9.7 裁决队列）/ hub_audits（§6 审计）/ hub_meta（cursor）；与内存版接口同构语义一致（push 全分支 / pull 隔离增量 / reconcile 指纹校验 / resolve 败者归档），引擎 syncUp/syncDown/reconcile 接受双 Hub（`AnySyncHub`）。

## T1 数据模型扩展（§3.1）
- Memory 补可选：pending_sync（离线回传标记）/ sha256（内容指纹幂等）/ vclock（{端:版本} 向量时钟）

## T2 同步原语
- `sha256hex(s)`：纯 JS sha256（浏览器+Node 通用，5.4 幂等指纹）
- `vcCompare(a, b)`：向量时钟偏序 → 'ahead'|'behind'|'concurrent'|'equal'
- `SyncHub`（中枢，§2）：全端镜像 + 幂等账本 + 冲突挂起队列 + version_cursor
  - `push(mem, form)`：sha256 相同跳过（幂等）；无冲突落镜像；冲突 → §4
  - `pull(cursor, scope{team_id,user_id?})`：增量下行（team_id 隔离，§1）
  - `conflicts()`：挂起队列（conflict_id + 双方版本 + 两端 form）
  - `resolve(conflict_id, winner)`：裁决回写，败者 archived（9.7），审计 conflict_resolve

## T3 同步引擎（§3/§5/§6）
- `syncUp(local, hub, form)`：pending_sync/version 高于镜像 → 上行；并发冲突 → LWW（晚者赢、败者 archived）或全晚进队列；审计 sync_up/sync_fail（form 归因）
- `syncDown(hub, local, scope)`：cursor 增量 → 本地落盘；审计 sync_down
- `reconcile(local, hub, scope)`：每日全量对账（sha256 比对补漏）；审计 sync_reconcile

## T4 契约测试（§8 全 6 用例）
- 桌面→Web 5min 镜像（sync_down form 归因）/ 移动离线 3 条批量回传幂等无重复 / 离线冲突 LWW + 败者 archived / CLI team_id 隔离不混入 / 对账补漏 / 审计可查（sync_* 按 form 过滤）

## T5 门禁
- vitest 全绿 + build/validate/generate --check
