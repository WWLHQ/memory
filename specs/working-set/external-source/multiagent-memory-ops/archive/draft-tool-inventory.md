# 记忆库工具清单（按 读 / 写 / 管理）

> 状态：目标工具集已定（本清单为"已确定"产物）；脱敏闸门的**强度档位/脱敏策略/扫描时机**仍待定（见 `multiuser-design-status.md` 未定论清单）。
> 说明：不启服务，仅能力盘点。MCP 工具 = Agent 可调用；内部/外部 = 系统必备但非 MCP 工具。

## A. 对外 MCP 工具（Agent 可调用）

### 读（Read）— 取回与查询
| 工具 | 作用 | 状态 | 备注 |
|---|---|---|---|
| `recall_memory` | 语义召回（单 `project_id` 内） | 现有 | 主入口；支持 `mode`/`scene`/`detail` |
| `recall_memory(scope='session')` | 工作记忆（按 `session_id`+时间窗） | 草案§6 | 不走向量检索，取"刚才说了啥" |
| `get_user_preferences` | 取用户偏好（按 `user_id`） | 现有 | 跨租户报"禁止跨租户读取" |
| `list_projects` | 列令牌作用域内的项目 | 现有 | 统一 `projectInScope` 校验 |
| `list_memories` | 按 `category`/`decay_class`/时间 过滤 + 分页 | 草案§5 | 浏览/审计用 |
| `get_write_status` | 读 L0 写密钥解锁态（只读、无副作用） | 草案§11 | 写前探锁，避免撞 `E_L0_LOCKED` |
| `decrypt_l0` | 解密单条 L0 原始归档 | 现有内核/IPC | **特权**：仅持 L0 会话/管理封装；不进常规 recall |

### 写（Write）— 产生与标注
| 工具 | 作用 | 状态 | 备注 |
|---|---|---|---|
| `write_memory` | 写入 → 落 **L0 全量归档** | 现有 + §2 | 新增 `importance`/`confidence`/`half_life_days`/`tags`；**永不直写池**，由管线脱敏后升 L1 再分流 |
| `feedback` | 对记忆 `confirm`/`reject`/`disputed` | 草案§3 | 反哺精炼与置信度 |

### 管理（Manage）— 治理与运维
| 工具 | 作用 | 状态 | 备注 |
|---|---|---|---|
| `manage_memory` | 更新/合并/移动/锁定/钉住/归档/（删除） | 草案§4 | 含**跨池搬移**（脱敏后 `P-<user>` ↔ `P-shared`）；`delete` 最高风险，需配置开关+人工确认 |
| `gc_report` | 触发/查看遗忘引擎报告 | 草案§7 | 遗忘周期、合并、摘要、迁移统计 |
| `create_project` | 开通每用户私人池 `P-<user>` | 草案§14.5 | 仅管理员令牌可调用 |

> MCP 工具合计：**读 7 / 写 2 / 管理 3 = 12 个**（现状 4 个 → 目标 12 个）。

## B. 内部管线 / 外部组件（非 MCP 工具，但系统必备）
| 能力 | 归属 | 作用 | 关键约束 |
|---|---|---|---|
| **采集器 Collector** | 内部 | 扫会话日志 → L0（全量） | 后台周期（如 5min） |
| **脱敏闸门 Desensitization Gate** | 内部·服务端强制 | L0→L1 清洗+脱敏 | **必须跑在可信内核**，不可放客户端；fail-safe（疑敏不进共享）；**强度档位待定(NQ3)** |
| **routeL1** | 内部 | 脱敏后 L1 打 `project_id`（私人/共享） | 消费 L1 产物，天然满足"P-shared 仅收脱敏 L1" |
| **精炼管线** | 内部 | L1→L6 逐层（摘要/得失/模式/洞察/索引） | `layer` 自动产生，Agent 不手填 |
| **令牌代理 Token Broker** | **外部** | 登录 mint `['P-shared','P-uX']` 令牌、revoke | 记忆服务只消费令牌做 `projectInScope`；不在 MCP 内实现 |

## 串起来的不变式
- **写永远落 L0**：Agent 的 `write_memory` 只产生原始归档，绝不直写 `P-shared`/`P-<user>`；共享内容只能由"脱敏后的 L1"经 `routeL1` 晋升。
- **读按令牌作用域**：`recall`/`list`/`manage` 统一 `projectInScope`，越界即拒。
- **共享=已脱敏**：管线顺序（脱敏先于分流）保证 `P-shared` 里只有脱敏 L1。
