import type { BalanceEndpoint, BalanceSettings, DetectResult } from './provider-detect.ts';
/** 单个配额窗口的用量与重置时间。 */
export interface QuotaWindow {
    percent: number;
    resetsAt: string | null;
}
/** OpenCode 订阅配额（/v1/usage）：滚动 / 每周 / 每月三个窗口。 */
export interface UsageQuota {
    rolling: QuotaWindow | null;
    weekly: QuotaWindow | null;
    monthly: QuotaWindow | null;
}
/** 一次余额快照（路由响应形状）。金额与配额二选一：有 quota 时为订阅制。 */
export interface BalanceSnapshot {
    balance: number | null;
    currency: string;
    updatedAt: string | null;
    error: string | null;
    source: Omit<BalanceEndpoint, 'apiKeyEnv'> | null;
    /** OpenCode 等订阅制的配额百分比；金额型（DeepSeek）为 null。 */
    quota: UsageQuota | null;
    /** 费用计价货币（插件设置 currency；CNY 显示 ¥，USD 显示 $）。 */
    costCurrency: string;
}
/** 余额客户端的运行时依赖（测试可注入）。 */
export interface BalanceClientDeps {
    fetchFn: typeof fetch;
    getEnv: (name: string) => string | undefined;
    /** 费用计价货币（插件设置 currency 透传；缺省 CNY）。 */
    getCostCurrency?: () => string;
}
/** 解析 DeepSeek 兼容余额响应；格式不符返回 null。 */
export declare function parseBalanceResponse(body: unknown): {
    balance: number;
    currency: string;
} | null;
/**
 * 解析 OpenCode 订阅配额响应（GET /v1/usage → { usage: { rolling/weekly/monthly:
 * { status, percent, resetsAt } } }）。三个窗口全部提取；窗口缺失或格式
 * 不符时为 null。整体格式不符（无任何窗口）返回 null。
 */
export declare function parseOpenCodeUsage(body: unknown): UsageQuota | null;
export declare class BalanceClient {
    private readonly deps;
    private settings;
    private detect;
    private last;
    constructor(deps: BalanceClientDeps);
    setSettings(settings: BalanceSettings): void;
    setDetect(fn: () => Record<string, DetectResult>): void;
    /** 最近一次各 provider 快照（provider id → 快照；未检测到的 provider 不在表内）。 */
    snapshot(): Record<string, BalanceSnapshot>;
    /** 费用计价货币（设置 currency 实时读取）。 */
    private costCurrency;
    /** 并行刷新全部检测到的 provider 快照；单个 provider 失败不影响其他。 */
    refresh(): Promise<Record<string, BalanceSnapshot>>;
    /** 拉取并解析单个端点的快照（key 缺失、网络错误、格式不符均落 FAIL）。 */
    private fetchEndpoint;
    /** 立即刷新一次并定时刷新；返回定时器 disposer。 */
    start(intervalMs: number): () => void;
}
//# sourceMappingURL=balance.d.ts.map
