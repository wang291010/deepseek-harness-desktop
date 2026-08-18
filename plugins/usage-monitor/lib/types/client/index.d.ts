import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { UsageStatsCopy } from './locales.ts';
export declare const name = "usage-stats";
export declare const inject: string[];
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** usage-stats settings-card copy. */
        'usage-stats': keyof UsageStatsCopy;
    }
}
export declare function apply(ctx: ClientContext): void;
