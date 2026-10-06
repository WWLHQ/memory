# 原子任务示例：用户注册（USER-REGISTER）

> 本文件是 `meta/TASK_SPLITTING.md` 中 T1~T10 的**完整填写示例**，演示每个原子任务如何带齐 8 项属性，供 Agent 直接消费。
> 注意：这是"用户注册"场景的再创作示例；真实项目须按自己的需求重新拆分，不要照抄层级。

---

## T1 初始化项目骨架
- 目标：搭建项目骨架，配置 lint 与 test 工具链
- 输入：空仓库；技术栈约定（README）
- 输出：`package.json`、`tsconfig.json`、`.eslintrc`、`vitest` 配置、`npm scripts`（lint / test）
- 验收：`npm run lint && npm test`（初始无用例应通过）
- 边界：仅 `package.json`、配置文件、空 `src/`
- 依赖：无；被 T2~T10 依赖
- 提交：`chore: init scaffold`

## T2 定义 User 类型 + DB schema
- 目标：定义 User 领域类型与数据库表结构
- 输入：注册需求（REQ）；架构文档
- 输出：`src/types/user.ts`（`User` 接口）、`db/schema.sql`（users 表：id, email, password_hash, created_at）
- 验收：`npx tsc --noEmit`（类型编译通过）
- 边界：仅 `src/types/`、`db/schema`
- 依赖：T1；被 T3 / T5 依赖
- 提交：`feat: define User type & schema`

## T3 数据库迁移
- 目标：生成并执行迁移，建立 users 表
- 输入：T2 的 schema
- 输出：`db/migrations/0001_create_users.ts` + 执行脚本
- 验收：`npm run migrate:up` 后数据库存在 users 表（命令或连库断言）
- 边界：仅 `db/migrations/`
- 依赖：T2；被 T5 依赖
- 提交：`feat: users migration`

## T4 实现 hashPassword（纯函数）
- 目标：实现密码哈希与校验函数
- 输入：哈希库文档（bcrypt / argon2）
- 输出：`src/auth/hash.ts` → `hashPassword(plain)`、`verifyPassword(plain, hash)`
- 验收：`npm test -- hash`（覆盖正确哈希、验证、防时序）
- 边界：仅 `src/auth/hash.ts` + 其测试
- 依赖：T1；被 T6 依赖
- 提交：`feat: hashPassword`

## T5 实现 UserRepository.create
- 目标：实现用户持久化创建
- 输入：T2 的 `User` 类型、T3 的表、DB 连接
- 输出：`src/repo/userRepo.ts` → `create(user): Promise<User>`
- 验收：`npm test -- userRepo`（用测试库断言插入）
- 边界：仅 `src/repo/` + 测试
- 依赖：T2, T3；被 T6 依赖
- 提交：`feat: UserRepository.create`

## T6 实现 RegisterService
- 目标：实现注册业务逻辑（调 hash + repo）
- 输入：T4 `hashPassword`、T5 `repo`、T2 类型
- 输出：`src/services/register.ts` → `register(input): Promise<User>`（含重复邮箱校验、抛错）
- 验收：`npm test -- register`（成功 / 重复 / 异常）
- 边界：仅 `src/services/` + 测试
- 依赖：T4, T5；被 T7 依赖
- 提交：`feat: RegisterService`

## T7 实现 POST /api/register
- 目标：实现注册 HTTP 接口
- 输入：T6 service、接口契约（REQ / AC）
- 输出：`src/api/register.ts` 路由 + 集成测试
- 验收：`npm test -- api.register`（201 / 409 / 400）
- 边界：仅 `src/api/` + 集成测试
- 依赖：T6；被 T8 / T9 / T10 依赖
- 提交：`feat: POST /api/register`

## T8 前端注册表单组件
- 目标：实现注册表单 UI 组件
- 输入：T7 的 API 契约（字段 / 响应码）、UI 原稿 `design/ui/`
- 输出：`src/web/RegisterForm.tsx` + 组件测试
- 验收：`npm test -- RegisterForm`（渲染 / 校验 / 提交事件）
- 边界：仅 `src/web/RegisterForm` + 测试
- 依赖：T7；被 T10 依赖
- 提交：`feat: RegisterForm`

## T9 前端 API client
- 目标：实现调用注册接口的 client
- 输入：T7 的 API 契约
- 输出：`src/web/api/register.ts` → `registerUser(payload)`
- 验收：`npm test -- apiClient.register`（mock fetch 断言）
- 边界：仅 `src/web/api/` + 测试
- 依赖：T7；被 T10 依赖
- 提交：`feat: register API client`

## T10 端到端注册测试
- 目标：端到端注册流程验证
- 输入：T6~T9 全部
- 输出：`e2e/register.spec.ts`
- 验收：`npm run test:e2e`（完整链路通过）
- 边界：仅 `e2e/`
- 依赖：T6, T7, T8, T9
- 提交：`test: e2e register`
