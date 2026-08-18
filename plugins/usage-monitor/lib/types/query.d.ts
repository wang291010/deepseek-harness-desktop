import { hitRateOf } from './meter.ts';
import type { TokenBuckets, UsageStatsState } from './meter.ts';
/** 区间查询参数：起止日期键（YYYY-MM-DD）+ 聚合粒度。 */
export interface RangeQuery {
    from: string;
    to: string;
    granularity: 'day' | 'week';
}
/** 趋势序列点：单日或自然周的聚合（hitRate 为该桶缓存命中率，无输入为 0）。 */
export interface SeriesPoint {
    bucket: string;
    requests: number;
    tokens: number;
    cost: number;
    hitRate: number;
    /** 桶内按模型拆分的 token 用量（tokens 降序，供堆叠柱状图与 tooltip）。 */
    byModel: Array<{
        model: string;
        tokens: number;
    }>;
}
/** 分模型聚合行。 */
export interface ModelSummary {
    model: string;
    requests: number;
    tokens: number;
    cost: number;
}
/** 区间汇总（路由 /summary 的主体）。 */
export interface RangeSummary {
    from: string;
    to: string;
    requests: number;
    turns: number;
    tokens: TokenBuckets & {
        total: number;
    };
    cost: number;
    activeDays: number;
    avgCacheHitRate: number;
    topModel: string | null;
    uncountedRequests: number;
    byModel: ModelSummary[];
    series: SeriesPoint[];
}
/** 解析 from/to 查询参数；缺省为今日；非法/超界返回错误。 */
export declare function parseRange(fromRaw: string | undefined, toRaw: string | undefined, now: number): {
    ok: true;
    query: RangeQuery;
} | {
    ok: false;
    error: string;
};
/** 对区间内 byDay 条目聚合：总量指标、分模型、趋势序列。 */
export declare function summarizeRange(state: UsageStatsState, query: RangeQuery): RangeSummary;
export { hitRateOf };
