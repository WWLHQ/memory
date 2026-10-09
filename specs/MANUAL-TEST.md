# REQ-005 人工测试清单（T1–T12）

> 一键启动：双击 `start-all.bat`（同时起后端 :8200 + 前端 :5180，自动开页面）
> 演示账号：`user_001` / `demo1234`（team_id=team_001 由管理员分配，只读）
> 单独启动前端：双击 `start-home.bat`（无后端，登录会走本地只读占位）

## 第一部分：UI 人工测试（浏览器里点）

### 步骤 0 · 首屏（未登录）
1. 打开 `http://127.0.0.1:5180/index.html`
2. **预期**：深色主题；顶栏「欢迎使用记忆助手 · 当前未登录 · 当前端[桌面]」+ 蓝色「▶ 登录」按钮；下方两个虚线灰置框「未登录，登录后可查看功劳 / 异常 / 活跃 / 待办」
3. ✅ 确认页面有样式（非黑白裸 HTML）

### 步骤 1 · 打开登录卡
1. 点顶栏「▶ 登录」
2. **预期**：居中弹卡「登录（确定同步身份）」，含账号框、密码框、「端形态 自动识别 = 桌面端」、「团队 团队（管理员分配 · 只读 · P12）」、三个按钮：登录 / 扫码（Web）/ 系统密钥（mac/CLI）
3. ✅ 确认端形态与团队是**纯文字**（无输入框，不能改）

### 步骤 2 · 账号为空校验
1. 账号留空，密码随便填，点「登录」
2. **预期**：`#loginErr` 显示「账号不能为空」
3. ✅ 弹卡不关闭

### 步骤 3 · 密码为空校验
1. 填账号 `user_001`，密码留空，点「登录」
2. **预期**：显示「密码不能为空」

### 步骤 4 · 密码错误（对应 T3 锁定 + T10 审计）
1. 账号 `user_001`，密码填 `wrong`，点「登录」
2. **预期**：显示「密码错误，已记审计（错 5 次锁 15min）」
3. ✅ 后端窗口可见 login_fail 审计写盘

### 步骤 5 · 登录成功（对应 T6/T7/T9）
1. 账号 `user_001`，密码 `demo1234`，点「登录」
2. **预期**：弹卡关闭；顶栏变「你好，user_001 · 团队 team_001（管理员分配 · 只读）· 当前端[桌面·主源]」+ 绿色「已同步」pill + 「登出」按钮
3. ✅ 下方出现**功劳 4 卡**：🪙 成本 -58% / ⚡ 速度 -34% / 🔁 复用 3.2× / 💸 额度 省¥19
4. ✅ 右侧出现「异常速览」（熔断 OPEN 置顶红字）、「近 1h 召回 Top3 + 待办」

### 步骤 6 · 数字溯源（对应 T7 .rid）
1. 点异常区里蓝色的 `anom_e2e_1`
2. **预期**：弹出「溯源审计」框显示 `request_id: anom_e2e_1`
3. ✅ 点「关闭」或框外区域可关

### 步骤 7 · 登出复位
1. 点顶栏「登出」
2. **预期**：回到步骤 0 的未登录灰置态

### 步骤 8 · 扫码 / 系统密钥（对应 T8）
1. 重新打开登录卡，点「扫码（Web）」
2. **预期**：toast 提示「Web 扫码登录：同账号（审计 form:web）」
3. 点「系统密钥（mac/CLI）」→ toast 提示非交互 token

## 第二部分：逻辑/后端验证（命令行）

对应无法在浏览器直观验证的任务，在**另一个终端**执行：

| 任务 | 命令 | 预期 |
|---|---|---|
| T1 类型 | `npm run typecheck` | 0 错误 |
| T2 哈希 | `npm test -- auth/__tests__/hash` | 6 passed |
| T3 登录锁定 | `npm test -- auth/__tests__/login` | 9 passed |
| T4 聚合 | `npm test -- home/__tests__/dashboard` | 7 passed |
| T5 Provider | `npm test -- Home/__tests__/tenantContext` | 6 passed |
| T6 顶栏 | `npm test -- Home/__tests__/TopBar` | 5 passed |
| T7 Dashboard | `npm test -- Home/__tests__/Dashboard` | 5 passed |
| T8 登录卡 | `npm test -- Home/__tests__/LoginModal` | 10 passed |
| T9 装配 | `npm test -- Home/__tests__/HomePage` | 5 passed |
| T10 后端 | `npm test -- home/__tests__/server` | 7 passed |
| T11 镜像 | `npm test -- Home/__tests__/useLoginMirror` | 6 passed |
| T12 E2E | `node e2e/run.mjs` | 13 passed |

或一次性跑全部：`npm test`

## 第三部分：锁定策略手工验证（T3）
1. 用错误密码对同一账号连续登录 5 次
2. 第 6 次登录
3. **预期**：「账号已锁定，请于 XX:XX 后重试（错 5 次锁 15min）」
4. 重启后端进程，锁定态仍保留（落盘 `home-locks.json`）

## 注意事项
- 端口冲突：若 5180 被占用，Vite 会自动换端口，看终端提示的 `Local:` 地址
- 登录后顶栏若显示 `local-readonly`，说明后端没起 → 双击 `start-all.bat` 而不是 `start-home.bat`
- 关闭：关掉两个 cmd 窗口即可
