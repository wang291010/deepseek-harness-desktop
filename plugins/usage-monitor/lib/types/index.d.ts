import type { Context } from '@deepseek-ai/cordis';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import z from 'schemastery';
import type { ModelPrice } from './pricing.ts';
import type { BalanceSettings } from './provider-detect.ts';
export declare const name = "usage-stats";
export declare const inject: string[];
/** 宿主端在 ctx 上暴露 meter 的键（路由/余额任务读取）。 */
export declare const USAGE_STATS_METER_KEY: unique symbol;
export declare const USAGE_STATS_SETTINGS_NAMESPACE: SettingsNamespace;
export interface Config {
    /** 总开关；false 时停止订阅、写盘与 meter 挂载。 */
    enabled?: boolean;
    /** 持久化文件路径；缺省 ~/.dsh/dsh-usage-stats.json（测试注入用）。 */
    filePath?: string;
    /** 用户按模型覆盖的单价（每百万 token）。 */
    prices?: Record<string, ModelPrice>;
    /** 未知模型兜底单价。 */
    defaultPrice?: ModelPrice;
    /** 计价货币显示名，默认 CNY。 */
    currency?: string;
    /** 高峰时段（北京时间小时，[startHour, endHour)）；缺省 [[9,10],[14,15]]。 */
    peakHours?: Array<[number, number]>;
    /** 余额拉取配置；缺省 auto 自动推断。 */
    balance?: BalanceSettings;
}
/** 运行时 schema（schemastery）。 */
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map