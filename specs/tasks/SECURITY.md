# P12 账号与安全页 任务拆分（REQ-006 / 4.1 / 4.2 / 3.2 / 18.2-A）

> 布局：密码策略 → 加密状态（只读）→ 角色矩阵 → 用户/团队 → API 密钥。

## T1 脚手架
- `security.html` 入口 + `src/web/security/` + vite.config 注册 + Overview 导航。

## T2 数据模型 + 纯逻辑
- types：PwdPolicy（minLen/maxLen/upper/lower/digit/special/history_count）、TeamMember（id/role/team/shared）、ApiKey（id/created_at/last_rotated/revoked）
- seed：策略默认全开 + history 5；成员 4 条（含跨团队未共享样本）；密钥 2 条（含超 90 天未轮换）
- logic（纯函数）：
  - `validatePwd(pwd, policy, history)` → 长度 8-64、字符类、forbidden_patterns 命中即拒「含禁用词」、与最近 5 次重复「与历史重复」
  - `canCrossTeam(member)` → 跨团队需 shared=true
  - `rotatable(key)` → 宽限 24h 内旧钥可用；>90 天未轮换 → 提示
  - `maskKey(key)` → 脱敏展示（前 4 后 4）
  - `audit(action)` → G6：密码变更/权限改动写审计 + request_id

## T3 组件
- PwdPolicyCard：长度范围 + 四字符类开关 + 实时校验示例输入框
- RoleMatrix：企业/团队/个人可见范围只读矩阵 + 共享开关即时生效
- MemberTable：增删改行、跨团队共享标记（未共享禁跨团队操作）
- KeyTable：密钥脱敏、轮换（宽限 24h 文案）、吊销（二次确认）、超 90 天警示

## T4 编排 + E2E
- SecurityPage 编排 + toast + useSecurityMirror（safe-noop）
- e2e/security.spec.ts（:8138）：密码校验（禁用词/历史重复）、成员跨团队约束、密钥脱敏与 90 天提示、吊销确认

## 验收要点
- 加密区只读：L1 脱敏占位符 / TLS / AES 全「开」
- 密钥默认脱敏显示；轮换弹宽限 24h 说明
