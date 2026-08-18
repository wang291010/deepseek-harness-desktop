import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { BalanceClient } from './balance.ts';
/** Loopback literal check plus browser same-origin markers (mirrors the pairing routes' fence). */
export declare function isLoopbackRequest(request: IncomingMessage): boolean;
/** 构造 usage-stats 全部只读路由（loopback 围栏，全部先过 isLoopbackRequest）。 */
export declare function makeRoutes(ctx: Context, balance: BalanceClient): WebRoute[];
