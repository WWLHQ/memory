# P5 全局参数页 任务拆分（REQ-006 / 17.6 / 2.4.3 / 2.4.4 / 15.1 / 15.3）

> 布局：普通配置卡 → 知识库策略表 → 开发者模式（折叠）。G7：普通配置只出文案，不暴露参数名。

## T1 脚手架
- `params.html` 入口 + `src/web/params/`（types/seed/logic/theme/ParamsPage/paramsEntry）+ vite.config 注册 + Overview 导航。

## T2 数据模型 + 纯逻辑
- types：NormalConfig（遗忘速度 slow/mid/fast、保留时长 long/months/weeks/short、自动整理 bool、重要程度 normal/important/locked）、KbPolicyRow（六类 × half_life/archive_days/merge_on）、DevParams（weights/payload 三档/cold 补查/等级映射/N·M）。
- logic（纯函数可测）：
  - `speedToHalfLife(slow|mid|fast)` → 档位（如 60/30/7 天）
  - `retentionToArchive(long|months|weeks|short)` → 归档阈值档
  - `validateWeights(w)` → 和=1.0（容差 1e-6）+ 各 ≥0，违者报错文案
  - `payloadOrdered(a,b,c)` → 三档严格递增校验
  - `validateKbRow(row)` → half_life>0、archive>0 数值区间
  - `validateNM(n,m)` → N<M
  - `applyNormal(cfg)` → 生成审计 action=params_change + request_id

## T3 组件
- NormalConfigCard：四项文案化控件（单选×3 + 开关），改动即记待保存
- KbPolicyTable：六类行内编辑（number 输入 + 开关），行校验错误提示
- DevPanel：折叠面板（details/summary），权重四输入实时和校验、payload 三档、cold 补查阈值、N/M 天

## T4 编排 + E2E
- ParamsPage 编排 + useToast + useParamsMirror（safe-noop）+ 保存按钮（写审计 G6）
- e2e/params.spec.ts（:8135，避开已有 8123/8125/8128/8129/8130-8134）：普通配置改档位、策略表行编辑校验、开发者模式展开权重校验、保存 toast

## 验收要点（对照规格表）
- 普通配置四项默认：中 / 数月 / 开 / 重要
- 开发者模式默认：0.35/0.30/0.15/0.20、1500/2000/3000、0.85/0.9/Top1 0.6/L2 200t、N90/M180
- 等级 5 永不清除（只读标注）
