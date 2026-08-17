/**
 * 0.1.4 one-click publish: turn a locally-developed plugin (自创作插件,
 * installed via file:/link:) into a published package on GitHub and/or npm.
 *
 * GitHub path:  validate token → read package.json → check repo existence →
 *               create repo (public/private) → git init/add/commit/push →
 *               set topics (dsh-plugin …) → create a v{version} release.
 * npm path:     validate token (whoami) → check package existence →
 *               npm publish with the token.
 *
 * Progress is reported through an onProgress callback; the host stores it in
 * a map and the UI polls publishProgress(packageName).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runGit } from './installer.js';
import { scanPlugin } from './security-scan.js';
const API = 'https://api.github.com';
const NPM_REGISTRY = 'https://registry.npmjs.org';
async function apiJson(url, init) {
    const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/vnd.github+json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = text;
    }
    return { status: res.status, data };
}
/** Resolve the plugin directory + package.json of a locally-installed plugin. */
export function localPluginManifest(profile, packageName) {
    const require = createRequire(join(profile.directory, 'noop.js'));
    try {
        const pkgPath = require.resolve(`${packageName}/package.json`);
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return { dir: pkgPath.replace(/[\\/]package\.json$/, ''), pkg };
    }
    catch {
        return null;
    }
}
/** Publish a local plugin. Returns a structured result for the UI + audit. */
export async function publishPlugin(profile, req, onProgress) {
    const name = String(req.packageName ?? '').trim();
    if (!name)
        return fail('插件名不能为空', null);
    const manifest = localPluginManifest(profile, name);
    if (!manifest)
        return fail(`无法在本地找到插件 ${name}（请确认它是通过 file:/link: 本地安装的自创作插件）`, null);
    const { dir, pkg } = manifest;
    const pkgName = String(pkg.name ?? name);
    const version = String(pkg.version ?? '0.0.0');
    const description = (req.description ?? '').trim() || String(pkg.description ?? '').trim() || pkgName;
    if (req.target === 'npm' || req.target === 'both')
        return fail('安全策略已暂时禁用一键 npm 发布', 'npm Token 不能安全地通过当前桌面子进程接口传递。请等待后续专用凭据能力，不要把 Token 放入命令行或项目 .npmrc。');
    // ---- security gate: critical findings reject the publish outright. ----
    onProgress('安全扫描中…', 3, null);
    const security = scanPlugin(dir, pkg);
    if (security.findings.length > 0) {
        const blocked = security.findings.map((f) => `🚫 [${f.severity}/${f.rule}] ${f.target}: ${f.detail}`).join('\n');
        return {
            ok: false,
            message: `安全扫描未完全通过，已驳回发布（${security.findings.length} 项需审查发现）`,
            detail: blocked || '存在未分类的安全发现',
            repoUrl: null,
            npmUrl: null,
            security,
        };
    }
    const results = {};
    const target = req.target === 'both' ? 'both' : req.target;
    if (target === 'github' || target === 'both') {
        results.github = await publishToGithub({ ...req, packageName: name }, { dir, pkgName, version, description }, onProgress);
    }
    const parts = [results.github, results.npm].filter(Boolean);
    const ok = parts.every((r) => r.ok);
    const failed = parts.filter((r) => !r.ok);
    const message = ok
        ? `发布成功：${parts.map((r) => r.repoUrl ?? r.npmUrl).filter(Boolean).join('  /  ')}`
        : failed.length === parts.length
            ? `发布失败：${failed.map((r) => r.message).join('；')}`
            : `部分成功：${parts.filter((r) => r.ok).map((r) => r.message).join('；')}；失败：${failed.map((r) => r.message).join('；')}`;
    const result = {
        ok,
        message,
        detail: parts.map((r) => `${r.ok ? '✅' : '❌'} ${r.message}${r.detail ? `\n${r.detail}` : ''}`).join('\n'),
        repoUrl: results.github?.ok ? results.github.repoUrl : null,
        npmUrl: results.npm?.ok ? results.npm.npmUrl : null,
    };
    // Attach the security report only when there are warnings — an explicit
    // `security: undefined` key trips the typert boundary validation.
    if (security.level === 'warning')
        result.security = security;
    return result;
}
async function publishToGithub(req, m, onProgress) {
    const token = String(req.githubToken ?? '').trim();
    if (!token)
        return fail('缺少 GitHub Token：请在发布页输入你的 GitHub 个人访问令牌（需 repo 写入权限）', null);
    onProgress('验证 GitHub Token…', 8, null);
    // 1) Validate token + get login.
    let login;
    try {
        const { status, data } = await apiJson(`${API}/user`, { headers: { Authorization: `Bearer ${token}` } });
        if (status !== 200) {
            return fail(`GitHub Token 无效（HTTP ${status}）：请检查令牌是否过期或已撤销`, String(data?.message ?? ''));
        }
        login = String(data.login ?? '');
        if (!login)
            return fail('GitHub Token 有效但无法获取用户名', null);
    }
    catch (e) {
        return fail('GitHub API 连接失败', e instanceof Error ? e.message : String(e));
    }
    // 2) Repo existence check.
    const repoName = m.pkgName.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9_.-]/g, '-') || 'dsh-plugin';
    onProgress('检查仓库是否已存在…', 20, null);
    let repoExists = false;
    try {
        const { status } = await apiJson(`${API}/repos/${encodeURIComponent(login)}/${encodeURIComponent(repoName)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        repoExists = status === 200;
    }
    catch {
        repoExists = false;
    }
    if (!repoExists) {
        // 3) Create repository.
        onProgress(`创建${req.visibility === 'private' ? '私人' : '公开'}仓库 ${repoName}…`, 35, null);
        try {
            const { status, data } = await apiJson(`${API}/user/repos`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: repoName,
                    private: req.visibility === 'private',
                    description: m.description.slice(0, 350),
                    auto_init: false,
                }),
            });
            if (status !== 201) {
                return fail(`创建仓库失败（HTTP ${status}）`, String(data?.message ?? ''));
            }
        }
        catch (e) {
            return fail('创建仓库请求失败', e instanceof Error ? e.message : String(e));
        }
    }
    // 4) git init/add/commit/push. The remote URL never contains credentials.
    // Authentication is injected into this child process only through Git's
    // environment-backed temporary config and is absent from argv and .git/config.
    const repoUrl = `https://github.com/${login}/${repoName}`;
    onProgress('推送代码到 GitHub…', 55, 'git add / commit / push');
    try {
        const gitUrl = `https://github.com/${login}/${repoName}.git`;
        const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
        const gitAuth = {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
        };
        // Optional: generate a README.md from the description when the plugin has
        // none (long Markdown descriptions with images render on GitHub). An
        // existing README is never overwritten — the author's docs stay intact.
        if (req.writeReadme !== false && m.description && !existsSync(join(m.dir, 'README.md')) && !existsSync(join(m.dir, 'readme.md'))) {
            try {
                const readme = `# ${m.pkgName}\n\n${m.description}\n`;
                writeFileSync(join(m.dir, 'README.md'), readme, 'utf8');
            }
            catch { /* best-effort */ }
        }
        if (!existsSync(join(m.dir, '.git'))) {
            await runGit(m.dir, ['init', '-b', 'main']);
        }
        await runGit(m.dir, ['add', '-A']);
        // commit may report "nothing to commit" — that is fine (already pushed).
        const commit = await runGit(m.dir, [
            '-c', `user.name=${login}`,
            '-c', `user.email=${login}@users.noreply.github.com`,
            'commit', '-m', `release v${m.version}`,
        ]);
        if (!commit.ok && !/nothing to commit|no changes added/i.test(commit.stderr + commit.stdout)) {
            return fail('git commit 失败', tail(commit.stderr || commit.stdout, 400));
        }
        await runGit(m.dir, ['branch', '-M', 'main']);
        await runGit(m.dir, ['remote', 'remove', 'origin']).catch(() => undefined);
        await runGit(m.dir, ['remote', 'add', 'origin', gitUrl]);
        // Push with retries: transient network resets (Recv failure / Connection
        // was reset) are common on CN networks — a retry usually succeeds. A large
        // postBuffer avoids mid-push failures on bigger repositories.
        let push = await runGit(m.dir, ['-c', 'http.postBuffer=524288000', 'push', '-u', 'origin', 'main'], 3 * 60_000, { env: gitAuth });
        for (let attempt = 1; !push.ok && attempt <= 3; attempt++) {
            if (!/403|denied|permission/i.test(push.stderr + push.stdout)) {
                onProgress(`git push 网络波动，自动重试 ${attempt}/3…`, null, null);
                await new Promise((r) => setTimeout(r, 2000 * attempt));
                push = await runGit(m.dir, ['-c', 'http.postBuffer=524288000', 'push', '-u', 'origin', 'main'], 3 * 60_000, { env: gitAuth });
            }
            else
                break;
        }
        if (!push.ok) {
            // 403 usually means the token lacks the repo write scope.
            const err = push.stderr + push.stdout;
            return fail(/403|denied|permission/i.test(err)
                ? '推送被拒绝：GitHub Token 缺少 repo 写入权限（需要在令牌中勾选 repo 或 public_repo）'
                : /Recv failure|Connection was reset|timed out|Timeout/i.test(err)
                    ? 'git push 网络连接不稳定（多次重试仍被重置）。请检查网络后重试；或在 git 中配置代理：git config --global http.proxy http://127.0.0.1:7890'
                    : 'git push 失败', tail(err, 500));
        }
    }
    catch (e) {
        return fail('git 推送过程异常', e instanceof Error ? e.message : String(e));
    }
    // 5) Topics.
    onProgress('设置标签（topics）…', 80, null);
    const topics = [...new Set([...(req.topics ?? []).map((t) => t.trim()).filter(Boolean), 'dsh-plugin'])].slice(0, 20);
    try {
        await apiJson(`${API}/repos/${encodeURIComponent(login)}/${encodeURIComponent(repoName)}/topics`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ names: topics }),
        });
    }
    catch { /* topics are best-effort */ }
    // 6) Release.
    onProgress('创建 v' + m.version + ' Release…', 92, null);
    try {
        const { status } = await apiJson(`${API}/repos/${encodeURIComponent(login)}/${encodeURIComponent(repoName)}/releases`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_name: `v${m.version}`, name: `v${m.version}`, body: m.description.slice(0, 1000), draft: false }),
        });
        if (status !== 201 && status !== 422) {
            return fail(`创建 Release 失败（HTTP ${status}）`, null);
        }
    }
    catch { /* release is best-effort */ }
    onProgress('发布完成', 100, repoUrl);
    return { ok: true, message: `GitHub 发布成功：${repoUrl}`, detail: `仓库 ${login}/${repoName}（${req.visibility}）· 标签 ${topics.join(', ')} · Release v${m.version}`, repoUrl, npmUrl: null };
}
function fail(message, detail) {
    return { ok: false, message, detail, repoUrl: null, npmUrl: null };
}
function tail(s, n) {
    const t = String(s ?? '').trim();
    return t.length > n ? `…${t.slice(-n)}` : t;
}
