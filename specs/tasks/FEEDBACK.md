# P9 用户反馈页 任务拆分（REQ-006 / 13.7 / 7.1 / 7.2）

> 布局：反馈表单卡 → 统计卡区。

## T1 脚手架
- `feedback.html` 入口 + `src/web/feedback/` + vite.config 注册 + Overview 导航。

## T2 数据模型 + 纯逻辑
- types：FeedbackDraft（memory_id/action confirm|reject|disputed/rating 1-5/comment）、FeedbackStat
- seed：SEED_MEMORIES_OPTIONS（memory_id 下拉选项带摘要）、SEED_FEEDBACKS（统计用历史数据）
- logic（纯函数）：
  - `trustDelta(action)` → confirm +0.1 / reject −0.05 / disputed 0（17.4）
  - `validateDraft(d)` → memory_id 必填；reject 时 comment 建议填（warning 不阻断）
  - `statShare(list)` → confirm/reject/disputed 占比、rating 分布、TopN 高低分
  - `reqId()` → 继承召回 request_id（18.2-E，fb_ 前缀演示）

## T3 组件
- FeedbackForm：memory_id 下拉选中带出摘要；action 单选联动（disputed → 提示将进 P7 冲突队列）；星级（★×5 可点）；comment 多行；user_id/enterprise_id 只读注入（R1 禁手填）
- StatCards：三占比 + rating 分布条 + TopN 高/低分列表 + trust_delta 累计

## T4 编排 + E2E
- FeedbackPage 编排 + toast（含 trust_delta 结果文案）+ useFeedbackMirror（safe-noop）；disputed 提交后提示跳 P7
- e2e/feedback.spec.ts（:8137）：必填校验、action 联动、星级选择、提交 toast trust_delta、统计卡渲染

## 验收要点
- R1：user_id/enterprise_id 为只读文本不可编辑
- rating 默认 3；confirm +0.1 / reject −0.05 文案出现在 toast
