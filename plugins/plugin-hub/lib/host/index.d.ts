/**
 * dsh-plugin-hub host service: the Typert Remote surface the web client
 * talks to. Owns the local database (mirror cache + ratings + audit log), the
 * GitHub data source with scheduled mirror sync, and the one-click
 * install/uninstall/enable/disable pipeline.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type StoreDB } from './store-db.js';
import { GitHubClient } from './github.js';
import { type ProfileInfo } from './installer.js';
export interface ListFilters {
    category?: 'tool' | 'agent' | 'ui' | 'data' | 'other' | null;
    query?: string | null;
    sort?: 'random' | 'health' | 'stars' | 'rating' | 'downloads' | 'updated' | 'name' | null;
    installedOnly?: boolean | null;
    limit?: number | null;
    offset?: number | null;
}
export interface AuditQueryInput {
    action?: string | null;
    actor?: string | null;
    target?: string | null;
    limit?: number | null;
    offset?: number | null;
}
/** The long-lived host service behind `ctx.pluginStore`. */
export declare class PluginStoreService extends TypertRemoteService {
    static inject: string[];
    db: StoreDB;
    github: GitHubClient;
    profile: ProfileInfo;
    private syncing;
    private timer;
    private lastSyncError;
    private npmAvailable;
    /** Live install progress per package (polled by the UI). */
    private installProgressMap;
    /** Live publish progress per package (polled by the UI). */
    private publishProgressMap;
    /** Short-TTL cache of installed() — avoids full per-package disk I/O on
     * every UI refresh (require.resolve + readFileSync per dependency). */
    private installedCache;
    /** Per-repo GitHub issues cache (5 min TTL) for the detail view. */
    private issuesCache;
    /** Installed package → its package.json repository owner/name (null = unknown).
     * Built alongside the installed() cache; used to disambiguate same-name
     * plugins from different repositories. */
    private installedRepos;
    /** Write-op rate limiter (per action, 60s window) — application-layer guard
     * against request flooding; the Host allowlist lives in the dsh gateway. */
    private writeThrottle;
    /** npm daily download trend cache (6h TTL) per package. */
    private trendCache;
    /** Per-repo activity caches: commit days (`c:repo`) and star gains (`s:repo`). */
    private activityCache;
    /** Returns a message when the action is throttled, null when allowed. */
    private throttle;
    constructor(ctx: any, config?: Record<string, unknown>);
    private get loader();
    private scheduleTimer;
    /** Kick off a background mirror sync (fire-and-forget from the RPC side). */
    private runSync;
    private appendAudit;
    private installedPackageNames;
    private enabledOf;
    /** True when the plugin row is installed, with repository disambiguation:
     * same-name plugins from different repos must match by `repository` field. */
    private isInstalled;
    private project;
    private specFor;
    list(filters?: ListFilters): Promise<Record<string, unknown>>;
    detail(packageName: string): Promise<Record<string, unknown>>;
    /** Version of an installed package (null when not installed). */
    private installedVersionOf;
    private installedHasUpdate;
    /** Health overview for every mirrored plugin, sorted by score. */
    healthHub(): Promise<Record<string, unknown>>;
    /** Per-plugin health detail: score breakdown + release timeline + npm
     * download trend + open issue count (live). */
    healthDetail(packageName: string): Promise<Record<string, unknown>>;
    /** Per-day commit counts for the last 60 days (6h cache). */
    private commitActivityOf;
    /** Per-day star gains for a repo (6h cache). */
    private starGainsOf;
    /** Encyclopedia directory: mirrored plugins + external catalog entries. */
    wikiHub(raw?: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** Encyclopedia entry for one plugin: structured knowledge page. */
    wiki(packageName: string): Promise<Record<string, unknown>>;
    /** Daily npm download counts for the last 90 days (6h cache). */
    private npmDownloadTrend;
    syncNow(): Promise<Record<string, unknown>>;
    syncStatus(): Promise<Record<string, unknown>>;
    settings(): Promise<Record<string, unknown>>;
    setGithubToken(token: string, actorRaw: string): Promise<Record<string, unknown>>;
    clearGithubToken(actorRaw: string): Promise<Record<string, unknown>>;
    setSchedule(hours: number, actorRaw: string): Promise<Record<string, unknown>>;
    installPlugin(packageName: string, actorRaw: string, sourceRaw?: string): Promise<Record<string, unknown>>;
    /** Polled by the UI to render the install progress bar. Returns null when no
     * install is in flight for this package. */
    installProgress(packageName: string): Promise<Record<string, unknown> | null>;
    /** Issues of a plugin's GitHub repo (read-only, 5-min cache). */
    issues(packageName: string): Promise<Array<Record<string, unknown>>>;
    /** Locally-developed plugins (自创作分类) with their package.json, ready to publish. */
    myPlugins(): Promise<Array<Record<string, unknown>>>;
    /** Polled by the UI during a publish. Returns null when no publish is in flight. */
    publishProgress(packageName: string): Promise<Record<string, unknown> | null>;
    /** One-click publish of a locally-developed plugin to GitHub and/or npm. */
    publish(raw: Record<string, unknown>, actorRaw: string): Promise<Record<string, unknown>>;
    uninstall(packageName: string, actorRaw: string): Promise<Record<string, unknown>>;
    setEnabled(packageName: string, enabled: boolean, actorRaw: string): Promise<Record<string, unknown>>;
    private waitForEntry;
    installed(): Promise<Array<Record<string, unknown>>>;
    setCategoryEnabled(category: string, enabled: boolean, actorRaw: string): Promise<Record<string, unknown>>;
    rate(packageName: string, score: number, comment: string, actorRaw: string): Promise<Record<string, unknown>>;
    listReviews(packageName: string): Promise<Array<Record<string, unknown>>>;
    audit(query?: AuditQueryInput): Promise<Record<string, unknown>>;
    dependencyGraph(packageName: string): Promise<Record<string, unknown>>;
    scaffold(): Promise<Record<string, unknown>>;
}
export default PluginStoreService;
