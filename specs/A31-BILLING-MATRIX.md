# A31 厂商余额接口矩阵（spike 实测，2026-11-07）

> A31-a 产出：只记录**实测证据 + 公开文档结论**，不写产品代码。判定口径：能真接厂商 → `vendor_live`；无接口/无凭据 → `manual`；本机 → 0 元不限量。
> 本环境无 deepseek / kimi / siliconflow 凭据；zhipu 与 openrouter 用了本机 `llm-keys.json` 里已有的真实 key 实测（只回状态码与截断响应体，未打印任何明文）。

## 方法与判据

1. **未授权探测**本身不足以证明端点存在（多数网关先鉴权再路由，任意路径都回 401）。因此对每家都做「真实路径 vs 不存在的同形路径」对照：
   - 真实路径 401 / 不存在路径 404 → 网关有区分度，**可证明端点存在**；
   - 两者同码（401 或 403）→ **不具区分性**，只能靠公开文档下结论。
2. 有真实 key 的厂商（zhipu、openrouter）直接发带 Authorization 的请求，看鉴权后是 200 还是 404。

## 矩阵（现有 13 个 preset）

| preset | 端点 | 方法/鉴权 | 无凭据实测 | 对照路径（不存在） | 有凭据实测 | 结论 |
|---|---|---|---|---|---|---|
| deepseek | `https://api.deepseek.com/user/balance` | GET / Bearer | 401 | 401（不具区分） | 无 key | **可 vendor_live**（端点由公开文档与示例确认；响应形状待真实 key 复核：`balance_infos[].total_balance`） |
| kimi | `https://api.moonshot.cn/v1/users/me/balance` | GET / Bearer | 401 | 404 | 无 key | **可 vendor_live**（`data.available_balance`） |
| siliconflow | `https://api.siliconflow.cn/v1/user/info` | GET / Bearer | 401 | 404 | 无 key | **可 vendor_live**（`data.totalBalance`） |
| openrouter | `https://openrouter.ai/api/v1/key`、`/api/v1/credits` | GET / Bearer | 401 | 404 | **200（普通 key）** | **可 vendor_live，但必须分凭据级别** |
| zhipu | 候选 3 条路径 | GET / Bearer | 401 | 401 | **404（真实 key）** | **no_endpoint**（控制台「财务总览/费用账单」才看得到余额） |
| qwen | `dashscope.aliyuncs.com/api/v1/user/balance` 等候选 | GET / Bearer | 404 | 网关有区分（兼容模式真实路径 401 / 不存在 404） | 无 key | **no_endpoint** |
| minimax | `api.minimaxi.com/v1/{get,query}/balance` | GET / Bearer | 404 | 同上（`/v1/models` 401 vs 不存在 404） | 无 key | **no_endpoint** |
| stepfun | `api.stepfun.com/v1/{user,billing}/balance` | GET / Bearer | 404 | 同上 | 无 key | **no_endpoint** |
| spark | `spark-api-open.xf-yun.com/v1/user/balance` | GET / Bearer | 401 | 401（不具区分） | 无 key | **no_endpoint**（公开文档只有控制台配额，无余额 API） |
| groq | `api.groq.com/openai/v1/user/balance` | GET / Bearer | 403（全路径 403，边缘拦截） | — | 无 key | **no_endpoint**（公开文档无 credits/账单 API） |
| ollama | — | — | — | — | — | **local_free**（本机 0 元不限量） |
| vllm | — | — | — | — | — | **local_free** |
| lmstudio | — | — | — | — | — | **local_free** |

**非 preset（用户枚举里出现、仓库里不存在）**：openai、anthropic —— 按用户 2026-11-07 裁定「不新增 preset」，本矩阵记为「暂不接入」，本轮不做适配器。

## openrouter 凭据级别（实测暴露的陷阱）

用真实普通 key 实测：

```json
GET /api/v1/key      → data.is_management_key = false
                       data.limit = 100, data.limit_remaining = 100
GET /api/v1/credits  → data.total_credits = 0, data.total_usage = 0
```

- 普通 key 只能读 **本 key 限额**（`limit_remaining`），口径是 `key_limit`，界面必须写「key 限额，非账户余额」；
- `total_credits: 0` + `is_management_key: false` **绝不能当账户余额 0 展示**——那条 credits 数据对该 key 无意义；
- management key（独立 billing 槽）才读 `/api/v1/credits`，余额 = `total_credits - total_usage`，口径 `account`。

## 失败码 → 降级动作

| HTTP / 情形 | 适配器结论 | 页面动作 |
|---|---|---|
| 200 且字段可解析 | `ok` | `vendor_live`（「厂商实时 · HH:mm」） |
| 401 / 403 | `auth_deficient` | 降级手工，明示「凭据权限不足」 |
| 404 | `no_endpoint` | 降级手工，明示「该厂商无余额接口」 |
| 超时 / 5xx / 429 | `transient` | 保留上次成功值 → `vendor_stale`（「厂商上次成功 · N 分钟前（当前不可达）」）；无上次值则手工/未设置 |
| 200 但非 JSON / 字段缺失 | `error` | 降级手工，明示原因（不拿半截文本当余额） |
| 无适配器（自定义引擎）/ 无凭据 | — | `manual`；手工也没填 → `unset` |

## 已知未验证项（如实记录）

1. deepseek / kimi / siliconflow 的**响应 JSON 形状**未经真实 key 验证（本环境无凭据）；解析实现按各家公开文档字段写，并在缺字段时返回 `error`（不猜）。
2. `api.openai.com` / `api.anthropic.com` 在本机网络不可达（连接失败或边缘 403），与本次范围无关（非 preset）。
3. groq 全路径 403 属网络/边缘拦截，非鉴权结论；其「无余额 API」依据是公开文档，不是 403 本身。
