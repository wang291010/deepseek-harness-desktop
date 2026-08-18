import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** 四类 token 分项（与 provider usage 对应）。 */
export interface TokenBuckets {
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
}
/** 一个聚合桶：token 分项 + 请求/轮次/费用 + 最近请求信息。 */
export interface ModelBucket extends TokenBuckets {
    requests: number;
    turns: number;
    cost: number;
    lastRequestAt?: string;
    lastRequestCost?: number;
    lastRequestHitRate?: number;
    lastModel?: string;
}
/** 单日聚合：当日总桶 + 当日分模型桶（区间模型统计由此聚合）。 */
export interface DayBucket {
    bucket: ModelBucket;
    byModel: Record<string, ModelBucket>;
}
/** 单会话记录（供"当前会话轮次/费用"等展示）。 */
export interface SessionRecord {
    sessionId: string;
    workspace: string | null;
    createdAt: string;
    turns: number;
    requests: number;
    cost: number;
    /** 会话级 token 分项（会话页用量：Tokens 用量与平均命中率由此计算）。 */
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    lastRequestAt: string | null;
    lastModel: string | null;
    lastRequestCost: number | null;
    lastRequestHitRate: number | null;
    /** 最近一次有 usage 的请求的 token 合计（最近单次消耗展示）。 */
    lastRequestTokens: number | null;
    /** 最近一轮对话（一次发送信息触发的完整 turn）的消耗合计。 */
    lastTurnTokens: number | null;
    lastTurnCost: number | null;
}
/** 完整聚合状态（持久化形状）。 */
export interface UsageStatsState {
    totals: ModelBucket;
    byDay: Record<string, DayBucket>;
    sessions: Record<string, SessionRecord>;
}
/** 单会话折叠态（不进持久化）。 */
export interface SessionFold {
    currentModel: string | null;
    pending: PendingUsage | null;
    /** 当前轮（turn）的累计消耗：turn/start 重置，settle 累加，turn/end 落盘。 */
    turnTokens: number;
    turnCost: number;
}
/** 当前 step 已记账的用量（替换语义的基准）。 */
export interface PendingUsage {
    turn: number;
    step: number;
    buckets: TokenBuckets;
    cost: number;
    hitRate: number;
}
export declare const UNKNOWN_MODEL = "__unknown__";
/** 缓存命中率口径：cacheRead / (uncached + cacheRead + cacheWrite)；无输入为 0。 */
export declare function hitRateOf(buckets: TokenBuckets): number;
/** 本地时区 YYYY-MM-DD（按当日 12 时取键，避免 DST 边界抖动）。 */
export declare function localDateKey(timeMs: number): string;
export declare function createEmptyBucket(): ModelBucket;
export interface MeterOptions {
    /** 时钟注入（测试用）；默认 Date.now。 */
    now?: () => number;
    /** 费用计算（Task 2 接入 pricing）；缺省返回 0。第三参为请求时间戳（epoch ms），供峰谷定价使用。 */
    getPrice?: (model: string, buckets: TokenBuckets, timeMs?: number) => number;
}
export declare class UsageStatsMeter {
    private readonly data;
    private readonly folds;
    private getPrice;
    constructor(opts?: MeterOptions);
    /** 深拷贝快照（路由/持久化读取用）。 */
    state(): UsageStatsState;
    applyEvent(sessionId: string, workspace: string | null, event: SessionEvent): void;
    /** 替换语义记账：同 (turn,step) 时减旧加新，否则直接累加。 */
    private settle;
    /** 用持久化状态重建（清空会话折叠态；旧版本数据补齐会话 token 分项）。 */
    restore(state: UsageStatsState): void;
    /**
     * 当前轮的实时消耗（进行中的 turn 累计；无进行中轮时返回 null）。
     * 供会话页"本次消耗"展示：每发一次信息（新一轮）自动重置。
     */
    currentTurnUsage(sessionId: string): {
        tokens: number;
        cost: number;
    } | null;
    /** 替换费用计算器（配置热更新用）。 */
    setPriceResolver(fn: (model: string, buckets: TokenBuckets, timeMs?: number) => number): void;
    private day;
    private modelBucket;
    private sessionOf;
    private foldOf;
}
