// 批次 D：场景画像（只读派生，不落库）。
// 来源：recall 审计（detail.scene / detail.query / detail.hit_keywords）按窗口聚合。
// 红线：
// ① 画像是审计的**派生物**，不新写任何记忆/配置——用户删掉对应审计（audit_delete）画像即消失；
// ② 只聚合计数与频次词，不落 query 原文进画像输出（query 是用户内容，聚合后即弃）；
// ③ 画像只产「建议提示」，绝不自动改分流配置或打分权重（改配置只能走 growth:v1 显式链路）。
import type { AuditRecord } from '../types.ts';

const DAY = 24 * 3600_000;

export interface SceneProfileRow {
  scene: string;
  count: number;
  /** 占窗口召回总次数的比例（保留 3 位；总数 0 时为 0） */
  share: number;
  /** 窗口内该场景最近一次召回时间戳 */
  last_ts: number;
  /** 窗口内该场景 hit_keywords 频次 Top5（审计无 hit_keywords 时为空数组，不编造） */
  top_terms: string[];
}

export interface SceneProfile {
  window_days: number;
  total_recalls: number;
  /** 按次数降序；并列按最近使用时间降序 */
  scenes: SceneProfileRow[];
  dominant_scene: string | null;
  /** 诚实口径说明（画像可删、只提示不改配置） */
  note: string;
}

/** 纯函数：recall 审计 → 窗口内场景画像（没有样本时各计数如实为 0/空，不补造） */
export function buildSceneProfile(
  recallAudits: AuditRecord[],
  now: number,
  windowDays = 30,
): SceneProfile {
  const since = now - windowDays * DAY;
  const byScene = new Map<string, { count: number; last_ts: number; terms: Map<string, number> }>();
  let total = 0;
  for (const a of recallAudits) {
    if (a.ts < since) continue;
    const d = a.detail as { scene?: unknown; hit_keywords?: unknown } | undefined;
    const scene = typeof d?.scene === 'string' && d.scene ? d.scene : 'default';
    let row = byScene.get(scene);
    if (!row) {
      row = { count: 0, last_ts: a.ts, terms: new Map() };
      byScene.set(scene, row);
    }
    row.count += 1;
    if (a.ts > row.last_ts) row.last_ts = a.ts;
    total += 1;
    if (Array.isArray(d?.hit_keywords)) {
      for (const t of d.hit_keywords) {
        if (typeof t !== 'string' || !t.trim()) continue;
        row.terms.set(t, (row.terms.get(t) ?? 0) + 1);
      }
    }
  }
  const scenes: SceneProfileRow[] = [...byScene.entries()]
    .map(([scene, r]) => ({
      scene,
      count: r.count,
      share: total ? Math.round((r.count / total) * 1000) / 1000 : 0,
      last_ts: r.last_ts,
      top_terms: [...r.terms.entries()]
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, 5)
        .map(([t]) => t),
    }))
    .sort((a, b) => b.count - a.count || b.last_ts - a.last_ts);
  return {
    window_days: windowDays,
    total_recalls: total,
    scenes,
    dominant_scene: scenes[0]?.scene ?? null,
    note: '画像是召回审计的只读派生物（不落库）：删除对应审计即消失；画像只提示场景偏好，不自动改分流配置或打分权重。',
  };
}
