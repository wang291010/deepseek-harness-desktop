/**
 * Installer: one-click install / uninstall / enable / disable for dsh plugins.
 *
 * Pipeline:
 *   1. `pnpm add|remove` inside the running profile directory (npm registry or
 *      `git+https` GitHub spec — no command line required from the user).
 *   2. Reconcile the profile manifest's `dsh.profile.bundles` layer list.
 *   3. Rewrite the profile's hot-reloaded `cordis.patch.yml`: an owned
 *      `insert` row activates the entry without a server restart (the profile
 *      boot watches this file through Cordis HMR).
 *   4. Wait for the Loader to settle the entry, then audit the operation.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rename, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isMap, isSeq, parseDocument } from 'yaml';
import { runQualityGate } from './quality-gate.js';
import { checkConflicts } from './conflict-check.js';
import { scanPlugin } from './security-scan.js';
const OWNER_MARKER = 'Managed by dsh-plugin-hub. Remove this row to return control to higher-level configuration.';
const LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'postpublish']);
let desktopPnpm = null;

/** Bind the desktop-owned, shell-free package manager capability. */
export function configureDesktopPnpm(service) {
    if (!service || typeof service.run !== 'function')
        throw new Error('dsh-plugin-hub: desktopPnpm service is required');
    desktopPnpm = service;
}
/** Resolve the running profile directory from a file-backed Loader baseUrl. */
export function resolveProfile(baseUrl, fallbackProfile = 'web') {
    let directory;
    if (baseUrl && baseUrl.startsWith('file:')) {
        const url = new URL(baseUrl);
        const root = url.pathname;
        const decoded = decodeURIComponent(root.replace(/^\/([A-Za-z]:)/, '$1')).replace(/[\\/]+$/, '');
        // baseUrl points at the config-tree anchor (profile dir) or a file inside it.
        directory = baseUrl.endsWith('/') ? decoded : dirname(decoded);
    }
    else {
        const home = process.env.DSH_HOME || join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh');
        directory = join(home, 'profiles', fallbackProfile);
    }
    return {
        directory,
        patchFile: join(directory, 'cordis.patch.yml'),
        packageJsonFile: join(directory, 'package.json'),
        profileName: dirname(directory).endsWith('profiles') ? basenameSafe(directory) : fallbackProfile,
    };
}
function basenameSafe(p) {
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] ?? 'web';
}
export function validPackageName(value) {
    return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value) && !value.includes('..');
}

function assertSafeInstallSpec(spec) {
    if (typeof spec !== 'string' || spec.length === 0 || spec.length > 500 || spec.includes('\0'))
        throw new Error('unsafe or empty install specification');
    const git = /^git\+https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git(?:#([A-Za-z0-9._/-]+))?$/.exec(spec);
    if (git) {
        if ([git[1], git[2], git[3] ?? ''].some((part) => part.includes('..')))
            throw new Error('GitHub install specification contains an unsafe path segment');
        return;
    }
    const at = spec.lastIndexOf('@');
    const name = at > 0 ? spec.slice(0, at) : spec;
    const version = at > 0 ? spec.slice(at + 1) : 'latest';
    if (!validPackageName(name) || !/^[A-Za-z0-9*^~._+-]+$/.test(version))
        throw new Error('only npm package versions or HTTPS GitHub repositories may be installed');
}
/** Parse one pnpm progress line ("Progress: resolved 2, reused 0, downloaded 1, added 0").
 * Returns {phase, percent} or null when the line is not a progress report. */
export function parsePnpmProgress(line) {
    const m = line.match(/Progress:\s*resolved\s+(\d+),\s*reused\s+(\d+),\s*downloaded\s+(\d+),\s*added\s+(\d+)/i);
    if (m) {
        const resolved = Number(m[1]);
        const downloaded = Number(m[3]);
        const added = Number(m[4]);
        const total = Math.max(resolved, 1);
        const percent = Math.min(100, Math.round(((downloaded + added) / total) * 100));
        return { phase: 'fetching', percent };
    }
    if (/^Packages: \+/i.test(line))
        return { phase: 'fetching', percent: null };
    return null;
}
/** Run packaged pnpm through DSH's managed, shell-free desktop capability. */
export function runPnpm(cwd, args, timeoutMs = 5 * 60_000, onProgress) {
    void cwd;
    return new Promise((resolve) => {
        if (desktopPnpm === null) {
            resolve({ ok: false, code: null, stdout: '', stderr: 'desktopPnpm service is unavailable; refusing unsafe fallback' });
            return;
        }
        const baseArgs = args.map(String);
        if (baseArgs.some((arg) => arg.includes('\0'))) {
            resolve({ ok: false, code: null, stdout: '', stderr: 'pnpm arguments must not contain NUL' });
            return;
        }
        const command = baseArgs[0];
        const securedArgs = command === 'add' || command === 'remove'
            ? [...baseArgs, '--ignore-scripts', '--reporter=append-only']
            : [...baseArgs, '--reporter=append-only'];
        let operation;
        try { operation = desktopPnpm.run(securedArgs); }
        catch (error) {
            resolve({ ok: false, code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) });
            return;
        }
        let stdout = '';
        let stderr = '';
        let settled = false;
        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            resolve(result);
        };
        const timer = setTimeout(() => operation.cancel(), timeoutMs);
        const feed = (chunk) => {
            const lines = chunk.split(/\r?\n/);
            for (const line of lines) {
                if (!line || !onProgress)
                    continue;
                const parsed = parsePnpmProgress(line);
                if (parsed)
                    onProgress({ phase: parsed.phase, percent: parsed.percent, detail: line.slice(0, 80) });
            }
        };
        const collect = async (stream, receiver) => {
            for await (const chunk of stream)
                receiver(Buffer.from(chunk).toString());
        };
        void Promise.all([
            collect(operation.stdout, (s) => { stdout += s; feed(s); }),
            collect(operation.stderr, (s) => { stderr += s; }),
            operation.done,
        ]).then(([, , outcome]) => {
            clearTimeout(timer);
            onProgress?.({ phase: 'done', percent: 100, detail: 'done' });
            settle({ ok: outcome.exitCode === 0, code: outcome.exitCode, stdout, stderr });
        }).catch((error) => {
            clearTimeout(timer);
            settle({ ok: false, code: null, stdout, stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}` });
        });
    });
}

function lifecycleScriptsOf(packageName, profileDir) {
    try {
        const require = createRequire(join(profileDir, 'noop.js'));
        const manifestPath = require.resolve(`${packageName}/package.json`);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        return Object.entries(manifest.scripts ?? {})
            .filter(([key, value]) => LIFECYCLE_SCRIPTS.has(key) && String(value).trim() !== '')
            .map(([key, value]) => `${key}: ${String(value).slice(0, 200)}`);
    }
    catch {
        return [];
    }
}

function formatSecurityFindings(report) {
    return report.findings.map((finding) => `  • [${finding.severity}] ${finding.target}: ${finding.detail}`).join('\n');
}

async function preflightInstall(installSpec, packageName, onProgress) {
    const quarantine = await mkdtemp(join(tmpdir(), 'dsh-plugin-hub-quarantine-'));
    try {
        await writeFile(join(quarantine, 'package.json'), '{"name":"dsh-plugin-hub-quarantine","private":true}\n', 'utf8');
        onProgress?.({ phase: 'resolving', percent: 5, detail: '隔离下载并执行安装前安全审批…' });
        const fetched = await runPnpm(quarantine, ['--dir', quarantine, 'add', installSpec, '--ignore-scripts', '--lockfile=false'], 5 * 60_000, onProgress);
        if (!fetched.ok) {
            return { ok: false, message: '隔离下载失败，未修改当前 DSH profile', detail: tail(fetched.stderr || fetched.stdout, 800) };
        }
        const packageDir = join(quarantine, 'node_modules', ...packageName.split('/'));
        const manifestFile = join(packageDir, 'package.json');
        if (!existsSync(manifestFile))
            return { ok: false, message: '安全审批失败：下载内容与候选包名不一致', detail: `隔离区中找不到 ${packageName}/package.json` };
        let manifest;
        try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); }
        catch { return { ok: false, message: '安全审批失败：package.json 无法解析', detail: null }; }
        if (manifest.name !== packageName)
            return { ok: false, message: '安全审批失败：包名不一致', detail: `请求 ${packageName}，实际下载 ${String(manifest.name ?? '(missing)')}` };

        const lifecycle = Object.entries(manifest.scripts ?? {})
            .filter(([key, value]) => LIFECYCLE_SCRIPTS.has(key) && String(value).trim() !== '')
            .map(([key, value]) => `${key}: ${String(value).slice(0, 200)}`);
        if (lifecycle.length > 0) {
            return { ok: false, message: `安全审批拦截：${packageName} 包含安装生命周期脚本`, detail: lifecycle.map((line) => `  • ${line}`).join('\n') };
        }

        const report = scanPlugin(packageDir, manifest);
        if (report.findings.length > 0) {
            return { ok: false, message: `安全审批拦截：${packageName} 存在需人工审查的代码`, detail: formatSecurityFindings(report) };
        }
        const gate = runQualityGate(packageName, quarantine);
        if (!gate.ok)
            return { ok: false, message: `质量门拦截：${packageName} 依赖不完整`, detail: gate.detail };
        return { ok: true, message: '安装前安全审批通过', detail: `扫描 ${report.scanned ?? 0} 个文件 / ${report.scannedBytes ?? 0} 字节` };
    }
    finally {
        await rmrf(quarantine);
    }
}
// ---- profile manifest reconciliation ---------------------------------------
function readProfileManifest(filename) {
    if (!existsSync(filename))
        return { dependencies: {}, dsh: { profile: { bundles: [] } } };
    try {
        return JSON.parse(readFileSync(filename, 'utf8'));
    }
    catch {
        return { dependencies: {}, dsh: { profile: { bundles: [] } } };
    }
}
function exportsBundlePatch(packageName, profileDir) {
    try {
        const require = createRequire(join(profileDir, 'noop.js'));
        const manifestPath = require.resolve(`${packageName}/package.json`);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const dsh = manifest.dsh;
        const bundle = dsh?.bundle;
        return typeof bundle?.patch === 'string';
    }
    catch {
        return false;
    }
}
/** Read the loader entry ids a plugin's own bundle patch inserts (e.g. a
 * `cordis.patch.yml` declaring `insert: [{id: code-pet, name: deepseek-pet}]`).
 * These ids are what the profile patch layer must target to disable/enable the
 * plugin — NOT the package name, which may differ. */
export function bundleEntryIds(packageName, profileDir) {
    const ids = [];
    try {
        const require = createRequire(join(profileDir, 'noop.js'));
        const manifestPath = require.resolve(`${packageName}/package.json`);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const dsh = manifest.dsh;
        const bundle = dsh?.bundle;
        if (typeof bundle?.patch !== 'string')
            return ids;
        const patchFile = join(dirname(manifestPath), bundle.patch.replace(/^\.\//, ''));
        if (!existsSync(patchFile))
            return ids;
        const document = parseDocument(readFileSync(patchFile, 'utf8'));
        if (!isSeq(document.contents))
            return ids;
        for (const item of document.contents.items) {
            if (!isMap(item))
                continue;
            const insert = item.get('insert');
            // yaml's get() returns a YAMLSeq *node* (iterable, but NOT a JS array).
            // Normalize with the library's toJS / spread so rows become plain objects.
            const rows = insert === null || insert === undefined
                ? []
                : isSeq(insert)
                    ? insert.toJSON()
                    : Array.isArray(insert)
                        ? insert
                        : [];
            for (const row of rows) {
                if (typeof row?.id === 'string' && row.id)
                    ids.push(row.id);
            }
        }
    }
    catch { /* best-effort */ }
    return ids;
}
/** Reconcile `dsh.profile.bundles` against installed dependencies (mirrors the
 * `dsh plugin` CLI's reconcile step). */
function reconcileBundles(profile, added, removed) {
    const manifest = readProfileManifest(profile.packageJsonFile);
    const deps = (manifest.dependencies ?? {});
    const dsh = (manifest.dsh ?? {});
    const profileObj = (dsh.profile ?? {});
    const bundles = Array.isArray(profileObj.bundles) ? [...profileObj.bundles].map(String) : [];
    let changed = false;
    for (const name of added) {
        if (bundles.includes(name))
            continue;
        if (exportsBundlePatch(name, profile.directory)) {
            bundles.push(name);
            changed = true;
        }
    }
    for (const name of removed) {
        const at = bundles.indexOf(name);
        if (at >= 0) {
            bundles.splice(at, 1);
            changed = true;
        }
    }
    if (!changed)
        return;
    manifest.dsh = {
        ...dsh,
        profile: { ...profileObj, bundles },
    };
    writeFile(profile.packageJsonFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8').catch((err) => {
        console.error(`dsh-plugin-hub: failed to reconcile ${profile.packageJsonFile}: ${err.message}`);
    });
}
// ---- patch file management -------------------------------------------------
async function readPatchDocument(filename) {
    let source;
    try {
        source = await readFile(filename, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return parseDocument('[]\n');
        throw error;
    }
    const document = parseDocument(source);
    if (document.errors.length > 0)
        throw new Error(`cannot parse ${filename}: ${document.errors[0]?.message}`);
    if (!isSeq(document.contents))
        throw new Error(`${filename} must contain a YAML sequence of patches`);
    return document;
}
function isOwned(map) {
    return isMap(map) && map.commentBefore?.includes('Managed by dsh-plugin-hub') === true;
}
function ownedInsertRow(document, packageName) {
    const seq = document.contents;
    return seq.items.find((item) => {
        if (!isMap(item) || !isOwned(item))
            return false;
        const insert = item.get('insert');
        if (!Array.isArray(insert))
            return false;
        return insert.some((e) => isMap(e) && e.get('id') === packageName);
    });
}
/** Find an owned insert row targeting a specific loader entry id. */
function ownedInsertRowById(document, entryId) {
    const seq = document.contents;
    return seq.items.find((item) => {
        if (!isMap(item) || !isOwned(item))
            return false;
        const insert = item.get('insert');
        if (!Array.isArray(insert))
            return false;
        return insert.some((e) => isMap(e) && e.get('id') === entryId);
    });
}
function ownedToggleRow(document, packageName) {
    const seq = document.contents;
    return seq.items.find((item) => {
        if (!isMap(item) || !isOwned(item))
            return false;
        return item.get('id') === packageName && item.get('insert') === undefined;
    });
}
/** Remove every store-owned row referencing `packageName`. */
async function removeOwnedRows(filename, packageName) {
    const document = await readPatchDocument(filename);
    const seq = document.contents;
    const kept = seq.items.filter((item) => {
        if (!isMap(item) || !isOwned(item))
            return true;
        if (item.get('id') === packageName)
            return false;
        const insert = item.get('insert');
        if (Array.isArray(insert) && insert.some((e) => isMap(e) && e.get('id') === packageName))
            return false;
        return true;
    });
    if (kept.length === seq.items.length)
        return;
    document.contents = document.createNode(kept);
    await atomicWrite(filename, String(document));
}
async function atomicWrite(filename, content) {
    await mkdir(dirname(filename), { recursive: true });
    const temporary = join(dirname(filename), `.${basenameSafe(filename)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporary, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    await rename(temporary, filename);
}
/** Insert an owned activation row: `insert: [{id, name}]`.
 * Activation happens through the profile's hot-reloaded user patch layer
 * (Cordis HMR), so a freshly installed plugin starts WITHOUT a server
 * restart. If the package is ALSO listed in `dsh.profile.bundles` (its bundle
 * layer will insert the same entry at boot), the user-patch row is skipped to
 * avoid a duplicate entry id on the next boot. */
export async function addActivationRow(profile, packageName, entryId = packageName) {
    if (isInBundles(profile, packageName))
        return;
    const document = await readPatchDocument(profile.patchFile);
    const seq = document.contents;
    // Idempotent upsert: if an owned insert row already targets this entry id,
    // update its `name` in place instead of appending a duplicate row. Duplicate
    // insert rows for the same entry id crash the loader at boot
    // ("duplicate loader entry id"), so this must never append twice.
    const existing = ownedInsertRowById(document, entryId);
    if (existing) {
        const insert = existing.get('insert');
        if (Array.isArray(insert)) {
            for (const e of insert) {
                if (isMap(e) && e.get('id') === entryId) {
                    e.set('name', packageName);
                }
            }
        }
        await atomicWrite(profile.patchFile, String(document));
        return;
    }
    const row = document.createNode({ insert: [{ id: entryId, name: packageName }] });
    row.commentBefore = OWNER_MARKER;
    seq.add(row);
    await atomicWrite(profile.patchFile, String(document));
}
/** Whether the package is listed in the profile manifest's bundle layer list. */
function isInBundles(profile, packageName) {
    try {
        const manifest = readProfileManifest(profile.packageJsonFile);
        const dsh = (manifest.dsh ?? {});
        const profileObj = (dsh.profile ?? {});
        return Array.isArray(profileObj.bundles) && profileObj.bundles.includes(packageName);
    }
    catch {
        return false;
    }
}
/** Toggle one entry's desired enablement through an owned override row. */
export async function writeEnablement(profile, entryId, moduleName, enabled) {
    const document = await readPatchDocument(profile.patchFile);
    const seq = document.contents;
    let row = ownedToggleRow(document, entryId);
    if (row === undefined) {
        row = document.createNode({ id: entryId, name: moduleName, disabled: !enabled });
        row.commentBefore = OWNER_MARKER;
        seq.add(row);
    }
    else {
        row.set('disabled', !enabled);
    }
    await atomicWrite(profile.patchFile, String(document));
}
/** Remove an owned toggle row (used to restore the base state on uninstall). */
async function removeToggleRow(filename, entryId) {
    const document = await readPatchDocument(filename);
    const seq = document.contents;
    const kept = seq.items.filter((item) => !(isMap(item) && isOwned(item) && item.get('id') === entryId && item.get('insert') === undefined));
    if (kept.length === seq.items.length)
        return;
    document.contents = document.createNode(kept);
    await atomicWrite(filename, String(document));
}
/** Determine the pnpm spec for a plugin: npm registry package or git URL. */
export function installSpecFor(packageName, repoFullName, ref) {
    return `${packageName}@${ref ?? 'latest'}`;
}
export function gitSpecFor(repoFullName, ref) {
    return `git+https://github.com/${repoFullName}.git${ref ? `#${ref}` : ''}`;
}
/**
 * Install a plugin package into the profile.
 * @param packageName npm package name (primary) or GitHub `owner/repo`.
 * @param installSpec the pnpm install spec (npm `name@ver` or `git+https`).
 * @param entryId loader entry id to activate (defaults to package name).
 * @param onProgress optional live progress callback (resolving/fetching/done).
 */
export async function installPlugin(profile, installSpec, entryId, actor, onProgress) {
    const started = Date.now();
    assertSafeInstallSpec(installSpec);
    if (!validPackageName(entryId))
        throw new Error('invalid plugin package name');
    const isGit = /^git\+/.test(installSpec);
    const preflight = await preflightInstall(installSpec, entryId, onProgress);
    if (!preflight.ok) {
        return {
            ok: false,
            message: preflight.message,
            detail: preflight.detail,
            restartRequired: false,
            reloadRequired: false,
        };
    }
    let result = await runPnpm(profile.directory, ['add', installSpec], 5 * 60_000, onProgress);
    const gitErr = result.stderr + result.stdout;
    if (!result.ok) {
        const hint = /allowBuilds/.test(gitErr)
            ? ' pnpm blocked the package build script — add its key under `allowBuilds` in pnpm-workspace.yaml, then retry.'
            : /fetch-pack|invalid index-pack|unexpected disconnect|fatal: unable to access|Recv failure|Connection was reset|error \(23\)|TimeoutError|timeout|aborted due to timeout/i.test(gitErr)
                ? ' GitHub 下载源码失败（网络受限或仓库过大）。已自动尝试 git clone 方式仍失败：请在命令行执行 `git config --global http.proxy http://127.0.0.1:<端口>` 配置代理后重试。'
                : isGit
                    ? ' GitHub 安装失败（非网络类错误）。请查看下方错误详情，或改用 npm 安装。'
                    : '';
        return {
            ok: false,
            message: `pnpm add failed (exit ${result.code ?? 'spawn-error'})${hint}`,
            detail: tail(gitErr, 800),
            restartRequired: false,
            reloadRequired: false,
        };
    }
    const name = entryId;
    const lifecycleScripts = lifecycleScriptsOf(name, profile.directory);
    if (lifecycleScripts.length > 0) {
        await runPnpm(profile.directory, ['remove', name]);
        return {
            ok: false,
            message: `安全审批拦截：${name} 包含安装生命周期脚本`,
            detail: `一键安装默认不执行第三方生命周期脚本。请先人工审查以下脚本：\n${lifecycleScripts.map((line) => `  • ${line}`).join('\n')}`,
            restartRequired: false,
            reloadRequired: false,
        };
    }
    // Quality gate: verify the package's entry imports are all declared (or
    // platform-provided) BEFORE activation, so a broken install cannot take
    // down the whole dsh boot. On missing dependencies, roll back immediately.
    const gate = runQualityGate(name, profile.directory);
    if (!gate.ok) {
        await runPnpm(profile.directory, ['remove', name]);
        return {
            ok: false,
            message: `质量门拦截：${name} 依赖不完整`,
            detail: gate.detail,
            restartRequired: false,
            reloadRequired: false,
        };
    }
    // Conflict check: slot collisions (single-kind slots crash the tree),
    // dependency version clashes and activation-patch integrity. Blocks stop
    // the install; warnings are surfaced in the receipt detail.
    const conflicts = checkConflicts(profile, name);
    if (!conflicts.ok) {
        await runPnpm(profile.directory, ['remove', name]);
        return {
            ok: false,
            message: `冲突检查拦截：${name} 与现有环境存在冲突`,
            detail: conflicts.detail,
            restartRequired: false,
            reloadRequired: false,
        };
    }
    // Directory requirements: if the plugin reads a path that does not exist
    // (e.g. a pets folder under the home dir), installing it enabled would crash
    // the whole dsh boot. Install the package but keep it disabled, and tell the
    // user exactly which directory to create.
    const missingDirs = gate.missingDirs ?? [];
    if (missingDirs.length > 0) {
        // Register the bundle / patch so the package is tracked, then disable it.
        // IMPORTANT: the disable row must target the plugin's real loader entry
        // id(s) from its own bundle patch (e.g. `code-pet`), not the package name —
        // a wrong id silently fails to disable and the plugin still crashes boot.
        const entryIds = exportsBundlePatch(name, profile.directory)
            ? bundleEntryIds(name, profile.directory)
            : [];
        if (entryIds.length > 0) {
            reconcileBundles(profile, [name], []);
            for (const id of entryIds)
                await writeEnablement(profile, id, name, false);
        }
        else {
            await addActivationRow(profile, name, entryId);
            await writeEnablement(profile, entryId, name, false);
        }
        return {
            ok: true,
            message: `已安装 ${name}（暂未启用）：缺少运行所需目录，请创建后重新启用`,
            detail: `插件 ${name} 启动时需要以下目录（当前缺失）:\n${missingDirs.map((d) => `  • ${d}`).join('\n')}\n\n请创建这些目录后，在「已安装插件」中重新启用。`,
            restartRequired: false,
            reloadRequired: true,
        };
    }
    // Plugins that ship their own bundle patch join `dsh.profile.bundles`, so the
    // bundle layer activates them on the next boot (mirrors `dsh plugin add`).
    // Plugins without a bundle patch get a hot-reloaded user-patch row instead.
    // The two paths are mutually exclusive to avoid a boot-time duplicate entry.
    if (exportsBundlePatch(name, profile.directory)) {
        reconcileBundles(profile, [name], []);
    }
    else {
        await addActivationRow(profile, name, entryId);
    }
    void started;
    return {
        ok: true,
        message: `已安装 ${name}，正在热加载…（界面刷新后生效）`,
        detail: tail(result.stdout, 600),
        restartRequired: false,
        reloadRequired: true,
        requiredEnv: scanRequiredEnv(name, profile.directory),
    };
}
/** Scan a package for environment variables it reads at runtime (API keys /
 * tokens). Informational hint surfaced in the install receipt. */
export function scanRequiredEnv(packageName, profileDir) {
    const require = createRequire(join(profileDir, 'noop.js'));
    const found = new Set();
    try {
        const pkgPath = require.resolve(`${packageName}/package.json`);
        const dir = pkgPath.replace(/[\\/]package\.json$/, '');
        // entry sources (.js/.ts) + README, capped sizes to stay cheap
        const targets = [];
        const walk = (d) => {
            let entries = [];
            try {
                entries = readdirSync(d);
            }
            catch {
                return;
            }
            for (const e of entries) {
                if (e === 'node_modules' || e === '.git' || e === 'dist')
                    continue;
                const full = join(d, e);
                let st;
                try {
                    st = statSync(full);
                }
                catch {
                    continue;
                }
                if (st.isDirectory())
                    walk(full);
                else if (st.size <= 200 * 1024 && /\.(?:js|mjs|cjs|ts|tsx|jsx)$/.test(e))
                    targets.push(full);
            }
        };
        walk(dir);
        for (const file of targets.slice(0, 120)) {
            let text = '';
            try {
                text = readFileSync(file, 'utf8');
            }
            catch {
                continue;
            }
            for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g))
                found.add(m[1]);
            for (const m of text.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g))
                found.add(m[1]);
        }
        // README config blocks often document KEY=VALUE pairs
        for (const name of ['README.md', 'readme.md', 'README.MD']) {
            const readmePath = join(dir, name);
            if (!existsSync(readmePath))
                continue;
            const text = readFileSync(readmePath, 'utf8').slice(0, 60_000);
            for (const m of text.matchAll(/^([A-Z][A-Z0-9_]{2,})\s*=\s*.{0,40}$/gm)) {
                if (!/^(?:NODE|PATH|HOME|SHELL|USER|TERM|LANG|EDITOR|TMP|CI)/.test(m[1]))
                    found.add(m[1]);
            }
        }
    }
    catch { /* package not resolvable */ }
    return [...found].sort();
}
/** Run `git <args>` in `cwd`, resolving on close (non-zero = reject). */
export function runGit(cwd, args, timeoutMs = 3 * 60_000, options = {}) {
    return new Promise((resolve) => {
        const child = spawn('git', args, { cwd, shell: false, windowsHide: true, env: { ...process.env, ...(options.env ?? {}), GIT_TERMINAL_PROMPT: '0' } });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
        child.stdout.on('data', (d) => { stdout += String(d); });
        child.stderr.on('data', (d) => { stderr += String(d); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
    });
}
/** Best-effort recursive remove (never throws). */
export async function rmrf(target) {
    try {
        await rm(target, { recursive: true, force: true });
    }
    catch { /* ignore */ }
}
/** Uninstall a plugin package from the profile (removes entry + bundles). */ export async function uninstallPlugin(profile, packageName, entryId, actor) {
    const result = await runPnpm(profile.directory, ['remove', packageName]);
    if (!result.ok && !/ELOCKFILE|ERR_PNPM_NO_MATCHING_VERSION|not.*found|No projects matched/i.test(result.stderr + result.stdout)) {
        return {
            ok: false,
            message: `pnpm remove failed (exit ${result.code ?? 'spawn-error'})`,
            detail: tail(result.stderr || result.stdout, 800),
            restartRequired: false,
            reloadRequired: false,
        };
    }
    reconcileBundles(profile, [], [packageName]);
    await removeOwnedRows(profile.patchFile, packageName);
    await removeToggleRow(profile.patchFile, entryId);
    return {
        ok: true,
        message: `已卸载 ${packageName}`,
        detail: tail(result.stdout, 600),
        restartRequired: false,
        reloadRequired: true,
    };
}
function tail(text, max) {
    const t = text.trim();
    return t.length > max ? `…${t.slice(t.length - max)}` : t;
}
export { writeEnablement as setPluginEnabled, removeToggleRow };
