import type { TokenBuckets } from './meter.ts'

/** 单个模型的每百万 token 单价（单位为对应货币，通常为美元）。 */
export interface ModelPrice {
  /** 未命中缓存的输入 token 单价。 */
  input: number
  /** 命中缓存（缓存读取）的输入 token 单价。 */
  cacheRead: number
  /** 写入缓存产生的输入 token 单价。 */
  cacheWrite: number
  /** 输出 token 单价。 */
  output: number
  /**
   * 高峰时段单价（每百万 token）。缺省表示该模型无峰谷区分，任何时段
   * 均按本价计费。DeepSeek 官方 V4 系列自 2026-08-17 起实行峰谷定价，
   * 高峰时段价格为空闲时段的 2 倍。
   */
  peak?: ModelPrice
}

/** 价格配置：可按模型覆盖单价，可提供兜底价与货币单位。 */
export interface PriceConfig {
  prices?: Record<string, ModelPrice>
  defaultPrice?: ModelPrice
  currency?: string
}

/**
 * 内置价格表（每百万 token）。DeepSeek 官方价按 CNY；OpenCode Zen Go
 * （opencode-go provider）价格取自 pi-ai 官方 catalog（USD 口径）。
 * 货币标签以插件设置 currency 为准；混用两套计价时费用为估算值。
 *
 * ⚠️ DeepSeek-V4 系列自 2026-08-17 0 时（北京时间）起实行峰谷定价：
 * 高峰时段（每日 9:00、14:00 起，见 DEFAULT_PEAK_HOURS）价格为空闲
 * 时段的 2 倍。下表 base 字段为空闲时段价，peak 字段为高峰时段价。
 */
export const DEFAULT_DEEPSEEK_PRICES: Record<string, ModelPrice> = {
  // DeepSeek 官方（CNY）
  'deepseek-chat': { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 },
  'deepseek-reasoner': { input: 4, cacheRead: 1, cacheWrite: 4, output: 16 },
  // DeepSeek 官方 V4 系列（CNY，2026-08-17 起峰谷定价；空闲/高峰）
  'deepseek-v4-flash': {
    input: 1.5, cacheRead: 0.05, cacheWrite: 0, output: 4.5,
    peak: { input: 3, cacheRead: 0.1, cacheWrite: 0, output: 9 },
  },
  'deepseek-v4-pro': {
    input: 4.5, cacheRead: 0.15, cacheWrite: 0, output: 13.5,
    peak: { input: 9, cacheRead: 0.3, cacheWrite: 0, output: 27 },
  },
  // OpenCode Zen Go（USD，来源 pi-ai catalog data/opencode-go.json）
  'glm-5.1': { input: 1.4, cacheRead: 0.26, cacheWrite: 0, output: 4.4 },
  'glm-5.2': { input: 1.4, cacheRead: 0.26, cacheWrite: 0, output: 4.4 },
  'hy3': { input: 0.14, cacheRead: 0.035, cacheWrite: 0, output: 0.58 },
  'kimi-k2.6': { input: 0.95, cacheRead: 0.16, cacheWrite: 0, output: 4 },
  'kimi-k2.7-code': { input: 0.95, cacheRead: 0.19, cacheWrite: 0, output: 4 },
  'kimi-k3': { input: 3, cacheRead: 0.3, cacheWrite: 0, output: 15 },
  'mimo-v2.5': { input: 0.14, cacheRead: 0.0028, cacheWrite: 0, output: 0.28 },
  'mimo-v2.5-pro': { input: 0.435, cacheRead: 0.003625, cacheWrite: 0, output: 0.87 },
  'minimax-m2.7': { input: 0.3, cacheRead: 0.06, cacheWrite: 0, output: 1.2 },
  'minimax-m3': { input: 0.3, cacheRead: 0.06, cacheWrite: 0, output: 1.2 },
  'qwen3.6-plus': { input: 0.5, cacheRead: 0.05, cacheWrite: 0.625, output: 3 },
  'qwen3.7-max': { input: 2.5, cacheRead: 0.5, cacheWrite: 3.125, output: 7.5 },
  'qwen3.7-plus': { input: 0.4, cacheRead: 0.04, cacheWrite: 0.5, output: 1.6 },
  'grok-4.5': { input: 2, cacheRead: 0.5, cacheWrite: 0, output: 6 },
}

/**
 * 合并价格表：内置表打底，用户覆盖优先。
 * @param userPrices 用户自定义价格，覆盖同名字典项。
 */
export function resolvePrices(
  userPrices?: Record<string, ModelPrice>,
): Record<string, ModelPrice> {
  return { ...DEFAULT_DEEPSEEK_PRICES, ...userPrices }
}

/**
 * 默认高峰时段（北京时间小时，[startHour, endHour) 左闭右开）。
 * DeepSeek 官方公告：高峰时段为每日 9:00、14:00 起，其余时间为空闲时段。
 * 如官方后续明确结束时间，可在插件设置中调整 peakHours。
 */
export const DEFAULT_PEAK_HOURS: Array<[number, number]> = [[9, 10], [14, 15]]

/** 判断 timeMs（epoch 毫秒）是否落在高峰时段（按北京时区 UTC+8）。 */
export function isPeakHour(timeMs: number, peakHours: Array<[number, number]> = DEFAULT_PEAK_HOURS): boolean {
  const hour = new Date(timeMs + 8 * 3600_000).getUTCHours()
  return peakHours.some(([start, end]) => hour >= start && hour < end)
}

/** 单价是否完整有效（四项均为有限数；空对象/缺失/非有限一律视为无效）。 */
function isValidPrice(price: ModelPrice | undefined | null): price is ModelPrice {
  if (price === undefined || price === null || typeof price !== 'object') return false
  return Number.isFinite(price.input) && Number.isFinite(price.cacheRead)
    && Number.isFinite(price.cacheWrite) && Number.isFinite(price.output)
}

/**
 * 按每百万 token 单价估算一次用量的费用。各分项除以 1e6 后乘以对应单价，
 * 四项累加。未知模型且未提供兜底价时返回 0。
 *
 * 防御：defaultPrice 可能是 schemastery 对未配置对象字段解析出的空对象 {}，
 * 其单价字段为 undefined，直接参与乘法会产生 NaN 污染累计状态（NaN 经
 * JSON 序列化为 null）——空对象、缺失或非有限单价一律视为无价格，返回 0。
 */
export function priceBuckets(
  model: string,
  buckets: TokenBuckets,
  prices: Record<string, ModelPrice>,
  defaultPrice?: ModelPrice,
): number {
  const price = prices[model] ?? defaultPrice
  if (!isValidPrice(price)) return 0
  const perMillion = 1e6
  return (
    (buckets.uncachedInputTokens / perMillion) * price.input +
    (buckets.cacheReadTokens / perMillion) * price.cacheRead +
    (buckets.cacheWriteTokens / perMillion) * price.cacheWrite +
    (buckets.outputTokens / perMillion) * price.output
  )
}

/**
 * 按请求时间（timeMs）选取生效单价后估算费用：高峰时段优先使用模型的
 * peak 价（无 peak 或 peak 无效时回退基础价），空闲时段用基础价。
 * 未提供 timeMs 时按基础价计算（兼容旧调用）。
 */
export function priceBucketsAt(
  model: string,
  buckets: TokenBuckets,
  prices: Record<string, ModelPrice>,
  defaultPrice: ModelPrice | undefined,
  timeMs: number | undefined,
  peakHours: Array<[number, number]> = DEFAULT_PEAK_HOURS,
): number {
  const price = prices[model] ?? defaultPrice
  if (!isValidPrice(price)) return 0
  const effective = timeMs !== undefined && isPeakHour(timeMs, peakHours) && isValidPrice(price.peak)
    ? price.peak
    : price
  const perMillion = 1e6
  return (
    (buckets.uncachedInputTokens / perMillion) * effective.input +
    (buckets.cacheReadTokens / perMillion) * effective.cacheRead +
    (buckets.cacheWriteTokens / perMillion) * effective.cacheWrite +
    (buckets.outputTokens / perMillion) * effective.output
  )
}
