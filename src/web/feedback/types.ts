// 用户反馈页（REQ-006 / P9）数据模型
// 规格：13.7 表单 / 17.4 trust_delta / 7.1·7.2 统计 / R1 注入禁手填 / 18.2-E request_id。

export type FeedbackAction = 'confirm' | 'reject' | 'disputed';

export interface FeedbackDraft {
  memory_id: string;
  action: FeedbackAction;
  rating: number;
  comment: string;
}

/** 只读注入上下文（R1：禁手填） */
export interface InjectedContext {
  user_id: string;
  enterprise_id: string;
  /** 继承召回链路（18.2-E） */
  request_id: string;
}

/** 反馈历史（统计卡用） */
export interface FeedbackRecord extends FeedbackDraft {
  id: string;
  trust_delta: number;
  created_at: string;
}
