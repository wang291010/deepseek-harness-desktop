import type { ReactElement } from 'react';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { BalanceMap, SummaryResponse } from './api.ts';
/** 统计卡片主体所需的 props（受控组件，数据由 controller 轮询提供）。 */
export interface UsageStatsCardProps {
    /** 文案读取器。 */
    t: (key: string) => string;
    /** 区间汇总；null 表示尚未拿到数据。 */
    summary: SummaryResponse | null;
    /** 各 provider 余额/配额快照表；null 表示尚未拿到数据。 */
    balances: BalanceMap | null;
    /** 请求进行中。 */
    loading: boolean;
    /** 最近一次请求错误。 */
    error: string | null;
    /** 当前范围；'custom' 表示自定义起止。 */
    rangeDays: number | 'custom';
    /** 自定义开始日期（YYYY-MM-DD）。 */
    customFrom: string;
    /** 自定义结束日期（YYYY-MM-DD）。 */
    customTo: string;
    /** 切换固定范围（7/14/30/90）或自定义。 */
    onRangeDays: (days: number | 'custom') => void;
    /** 编辑自定义开始日期。 */
    onCustomFrom: (value: string) => void;
    /** 编辑自定义结束日期。 */
    onCustomTo: (value: string) => void;
    /** 手动刷新余额。 */
    onRefreshBalance: () => void;
    /** 余额刷新进行中。 */
    balanceRefreshing: boolean;
}
/** 提供商维度（影响 KPI 动态卡与配额/余额视图）。 */
export type ProviderId = 'opencode' | 'deepseek';
/** 统计卡片主体：折叠卡头 + 控制栏 + 4 KPI 卡 + 三级 Tab。 */
export declare function UsageStatsCard(props: UsageStatsCardProps): ReactElement;
/** 卡片投影快照（controller 注入给渲染层）。 */
export interface UsageStatsCardStore {
    summary: SummaryResponse | null;
    balances: BalanceMap | null;
    loading: boolean;
    error: string | null;
    rangeDays: number | 'custom';
    customFrom: string;
    customTo: string;
    balanceRefreshing: boolean;
    /** 卡片是否展开；收起时不渲染内容且暂停轮询。 */
    expanded: boolean;
}
/** controller 暴露的动作。 */
export interface UsageStatsCardActions {
    onRangeDays: (days: number | 'custom') => void;
    onCustomFrom: (value: string) => void;
    onCustomTo: (value: string) => void;
    onRefreshBalance: () => void;
}
/** 插槽注册侧注入面：hooks 快照 + 动作。 */
export interface UsageStatsCardActions {
    onRangeDays: (days: number | 'custom') => void;
    onCustomFrom: (value: string) => void;
    onCustomTo: (value: string) => void;
    onRefreshBalance: () => void;
    /** 展开/收起卡片（收起时暂停轮询）。 */
    onToggleExpanded: () => void;
}
export interface UsageStatsCardFace extends UsageStatsCardActions {
    hooks: {
        usageStatsCard: SnapshotStore<UsageStatsCardStore>;
    };
}
/** 设置页 section 与插件卡共享的 controller face（apply 注入）。 */
export interface StatsShared {
    face: UsageStatsCardFace;
    t: (key: string) => string;
}
export declare let statsShared: StatsShared | null;
export declare function setStatsShared(shared: StatsShared): void;
/** 统计卡片 controller：持有范围与数据状态，展开时 30s 轮询 summary/balance。 */
export declare class UsageStatsCardController {
    private readonly store;
    private rangeDays;
    private customFrom;
    private customTo;
    private summary;
    private balances;
    private loading;
    private error;
    private balanceRefreshing;
    private expanded;
    private abort;
    private timer;
    constructor();
    /** 计算当前范围起点；自定义且未填时返回 null。 */
    private currentFrom;
    /** 计算当前范围终点；自定义且未填时返回 null。 */
    private currentTo;
    private projection;
    private publish;
    private startPolling;
    private stopPolling;
    /** 切换展开状态：展开即拉取并定时刷新，收起即停止轮询并中止在途请求。 */
    toggleExpanded(): void;
    private pollSummary;
    private pollBalance;
    /** 构建插槽注册侧注入面。 */
    inject(): UsageStatsCardFace;
}
//# sourceMappingURL=UsageStatsCard.d.ts.map