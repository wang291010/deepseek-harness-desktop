import type { Context } from '@deepseek-ai/cordis';
/** 余额模式的用户配置。 */
export interface BalanceSettings {
    /** auto：按 provider 自动推断；manual：使用固定 baseUrl；off：关闭。 */
    mode: 'auto' | 'manual' | 'off';
    /** manual 模式的余额端点基址。 */
    baseUrl?: string;
    /** 余额接口路径；缺省 /user/balance。 */
    path?: string;
    /** 读取 API key 的环境变量名；缺省 DEEPSEEK_API_KEY。 */
    apiKeyEnv?: string;
    /** 定时刷新间隔（毫秒）。 */
    refreshMs?: number;
}
/** 解析出的可拉取余额端点的完整信息。 */
export interface BalanceEndpoint {
    baseUrl: string;
    path: string;
    apiKeyEnv: string;
    source: string;
}
export type DetectResult = {
    ok: true;
    endpoint: BalanceEndpoint;
} | {
    ok: false;
    reason: string;
};
/** 默认凭据环境变量名（与 DeepSeek 适配器一致）。 */
export declare const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/**
 * 按给定配置与运行时服务解析出当前默认 provider 的余额端点。
 * @param ctx - 插件上下文（服务读取失败按缺失处理）。
 * @param settings - 余额配置。
 * @param settingsService - 可选：调用方已捕获的 settings 服务（cordis 的
 *   ctx.inject 可选注入结果）；缺省时尝试从 ctx 安全读取。
 */
export declare function detectBalanceEndpoint(ctx: Context, settings: BalanceSettings, settingsService?: {
    get(ns: unknown): unknown;
}): DetectResult;
/**
 * 解析全部可拉取的余额/配额端点（多 provider 快照用）：
 * - manual：仅 manual 端点（key 为 'manual'）
 * - auto：llm 可配置 provider 全量 + 已知端点表兜底（opencode-go / deepseek），
 *   每个 provider 独立推断，失败以 reason 记录、不影响其他 provider。
 */
export declare function detectBalanceEndpoints(ctx: Context, settings: BalanceSettings, settingsService?: {
    get(ns: unknown): unknown;
}): Record<string, DetectResult>;
