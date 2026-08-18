import type { DayBucket, ModelBucket, SessionRecord, UsageStatsState } from './meter.ts';
/** 持久化文件形状（version 1）。 */
export interface PersistedFile {
    version: 1;
    meta: {
        installedAt: string;
        lastSavedAt: string;
    };
    totals: ModelBucket;
    byDay: Record<string, DayBucket>;
    sessions: Record<string, SessionRecord>;
}
export declare const BY_DAY_RETENTION_DAYS = 730;
export declare const SESSIONS_RETENTION_MAX = 500;
/** 就地裁剪 byDay：只保留最近 730 个日期键。 */
export declare function trimByDay(byDay: Record<string, DayBucket>, now: number): void;
/** 就地裁剪 sessions：按 lastRequestAt 升序淘汰最旧，保留最近 max 条。 */
export declare function trimSessions(sessions: Record<string, SessionRecord>, max?: number): void;
export declare class UsageStatsStore {
    private readonly filePath;
    private lastInstalled;
    constructor(filePath: string);
    /** 读取持久化状态；不存在/损坏/版本不符返回 null（损坏时备份 .bak）。 */
    load(): UsageStatsState | null;
    /** load 时记录 meta.installedAt；从未 load 返回 null。 */
    lastInstalledAt(): string | null;
    /** 裁剪后原子写盘（tmp + rename）。失败抛错，由调用方告警。 */
    save(state: UsageStatsState, installedAt: string | null): void;
    private backup;
}
