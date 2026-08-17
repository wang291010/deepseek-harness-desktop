import type { TokenBuckets } from './meter.ts';
/** 单个模型的每百万 token 单价（单位为对应货币，通常为美元）。 */
export interface ModelPrice {
    /** 未命中缓存的输入 token 单价。 */
    input: number;
    /** 命中缓存（缓存读取）的输入 token 单价。 */
    cacheRead: number;
    /** 写入缓存产生的输入 token 单价。 */
    cacheWrite: number;
    /** 输出 token 单价。 */
    output: number;
    /**
     * 高峰时段单价（每百万 token）。缺省表示该模型无峰谷区分，任何时段
     * 均按本价计费。DeepSeek 官方 V4 系列自 2026-08-17 起实行峰谷定价。
     */
    peak?: ModelPrice;
}
/** 价格配置：可按模型覆盖单价，可提供兜底价与货币单位。 */
export interface PriceConfig {
    prices?: Record<string, ModelPrice>;
    defaultPrice?: ModelPrice;
    currency?: string;
}
/**
 * 内置价格表（每百万 token）。DeepSeek 官方价按 CNY；OpenCode Zen Go
 * （opencode-go provider）价格取自 pi-ai 官方 catalog（USD 口径）。
 * 货币标签以插件设置 currency 为准；混用两套计价时费用为估算值。
 */
export declare const DEFAULT_DEEPSEEK_PRICES: Record<string, ModelPrice>;
/**
 * 合并价格表：内置表打底，用户覆盖优先。
 * @param userPrices 用户自定义价格，覆盖同名字典项。
 */
export declare function resolvePrices(userPrices?: Record<string, ModelPrice>): Record<string, ModelPrice>;
/**
 * 按每百万 token 单价估算一次用量的费用。各分项除以 1e6 后乘以对应单价，
 * 四项累加。未知模型且未提供兜底价时返回 0。
 *
 * 防御：defaultPrice 可能是 schemastery 对未配置对象字段解析出的空对象 {}，
 * 其单价字段为 undefined，直接参与乘法会产生 NaN 污染累计状态（NaN 经
 * JSON 序列化为 null）——空对象、缺失或非有限单价一律视为无价格，返回 0。
 */
export declare function priceBuckets(model: string, buckets: TokenBuckets, prices: Record<string, ModelPrice>, defaultPrice?: ModelPrice): number;
/** 默认高峰时段（北京时间小时，[startHour, endHour)）。DeepSeek 官方公告：每日 9:00、14:00 起。 */
export declare const DEFAULT_PEAK_HOURS: Array<[number, number]>;
/** 判断 timeMs（epoch 毫秒）是否落在高峰时段（按北京时区 UTC+8）。 */
export declare function isPeakHour(timeMs: number, peakHours?: Array<[number, number]>): boolean;
/** 按请求时间选价估算费用：高峰时段优先用模型的 peak 价（无效则回退基础价），空闲时段用基础价。 */
export declare function priceBucketsAt(model: string, buckets: TokenBuckets, prices: Record<string, ModelPrice>, defaultPrice: ModelPrice | undefined, timeMs: number | undefined, peakHours?: Array<[number, number]>): number;
//# sourceMappingURL=pricing.d.ts.map