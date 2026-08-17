import type { ReactElement } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { BalanceResponse, PerSession } from './api.ts';
/**
 * 会话页用量面板（注册于 conversation.session.header.actions）：
 * 会话头部「用量」按钮 → 点击展开下拉面板，展示当前会话的
 * 本次命中 / 本次费用 / 完成轮次 / 会话轮次 / 会话费用 /
 * 平均缓存命中率 / Tokens 用量 / 账户余额。
 * session scope 由框架注入 sessionId（inject 首参），controller 持有。
 */
/** 面板投影快照。 */
export interface SessionUsageStore {
    open: boolean;
    perSession: PerSession | null;
    balance: BalanceResponse | null;
    loading: boolean;
    error: string | null;
}
/** 会话用量注入面。 */
export interface SessionUsageFace {
    hooks: {
        sessionUsage: SnapshotStore<SessionUsageStore>;
    };
    onToggle: () => void;
    /**
     * 重新绑定会话：框架对每个会话的 inject face 做 identity 缓存，
     * 切回原会话时 inject 不再被调用，组件层需在 sessionId 变化时
     * 主动 rebind（否则 controller 停留在上一个会话）。
     */
    rebind: (sessionId: string) => void;
}
/** 会话用量 controller：面板开合 + 展开时轮询会话明细与余额。 */
export declare class SessionUsageController {
    private readonly store;
    private open;
    private perSession;
    private balance;
    private loading;
    private error;
    private abort;
    private timer;
    private sessionId;
    constructor();
    private projection;
    private publish;
    private poll;
    private startPolling;
    private stopPolling;
    toggle(): void;
    /**
     * session scope 注入：框架对每个会话的 inject face 做 identity 缓存
     * （provide bundle 稳定，切回原会话时不再调用 inject），所以会话切换
     * 的实时性由组件层 rebind 保证；这里仅处理首次绑定与切换时的拉取。
     * 会话绑定/切换时立即清空旧数据并拉取一次（不依赖面板是否打开）：
     * 按钮上始终显示当前会话用量，重启/刷新后不会停留在 0。
     * 面板打开时另有 30s 轮询。
     */
    inject(sessionId: string): SessionUsageFace;
}
/** 受控的用量按钮 + 展开面板（外部点击 / Escape 关闭）。 */
export declare function SessionUsageButton(props: {
    t: (key: string) => string;
    state: SessionUsageStore;
    onToggle: () => void;
}): ReactElement;
/** 会话页注册侧：slot 组合 props（header.utilities：头部右侧工具区）。 */
type SessionUsageSlotProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'usage-stats'> & InjectFace<SessionUsageFace>;
/** 插槽适配：bridge 注入面到受控按钮组件。 */
export declare function SessionUsageSlotButton(props: SessionUsageSlotProps): ReactElement;
export {};
//# sourceMappingURL=session-usage.d.ts.map