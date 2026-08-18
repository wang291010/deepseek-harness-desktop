/**
 * dsh-workbench — client bundle v4 (workbench shell, P1).
 *
 * Architecture (route A, decided with user):
 *   - The native layout plugin (@deepseek-ai/dsh-client-ui-layout, entry id
 *     `ui-layout`) is DISABLED in the profile. This bundle forks it (MIT):
 *     provides the `layout` service, registers the `root` slot with the same
 *     child slots (sidebar / conversation / details / shell.overlay) and the
 *     same layout store, and re-implements the theme presenter.
 *   - Root component = WorkbenchRoot: a collapsible nav rail with 6 pages
 *     (Agent / 知识库 / 专家 / 风格 / 监控 / 工作流) + 插件商店 + 设置
 *     (native footer slots re-rendered in the rail foot). No global session
 *     button: the session panel lives inside the Agent page only and is
 *     expanded by default (layout store starts with sidebar=280).
 *   - Agent page = workspace only (conversation + toolbar). The session list
 *     is OUR custom SessionPanel in a drawer (project switcher, new session,
 *     new project, session status/time/context menu); the right column is OUR
 *     tabbed WbToolbar: 详细信息 (session status, active expert + expandable
 *     tool list from the preset composition), Git图谱 / 文件视图 (P2 host
 *     service placeholders), 任务看板 (per-session goal + todos projections
 *     via Session.projections, bound with useSyncExternalStore), 蒸馏 (P6).
 *     Native details slot is no longer rendered.
 *   - Native sidebar tree is fully replaced by the custom panel.
 */
window.__ModuleLoader__.load({
  id: "dsh-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };

    // ---- externals provided by the web shell ----
    var React = require("react");
    var ReactDOM = require("react-dom");
    var jsxRuntime = require("react/jsx-runtime");
    var runtimeClient = require("@deepseek-ai/dsh-client-runtime/client");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // =====================================================================
    // Dev tooling: error overlay + safe mode (迭代保护层)
    //  - Any uncaught script error shows a readable red screen instead of a
    //    blank window.
    //  - localStorage "wb.safe" === "1" renders a minimal fallback page so a
    //    broken build never locks you out of the app.
    // =====================================================================
    function wbResetUI() {
      try {
        ["wb.page", "wb.nav", "wb.ws", "wb.tb", "wb.safe"].forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* noop */ }
      location.reload();
    }
    function wbCopyFallback(text) {
      try {
        var ta = document.createElement("textarea");
        ta.value = String(text == null ? "" : text);
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    function wbCopyText(text) {
      var value = String(text == null ? "" : text);
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          return navigator.clipboard.writeText(value).then(function () { return true; }, function () { return wbCopyFallback(value); });
        }
      } catch (e) { /* fall through to execCommand */ }
      return Promise.resolve(wbCopyFallback(value));
    }
    function wbShowError(title, err) {
      try {
        if (document.getElementById("wb-dev-error")) return;
        var message = "[dsh-workbench 开发错误] " + title + "\n\n" + ((err && err.stack) || String(err)) + "\n\n修复后保存文件，HMR 会自动重新加载；或点下方按钮。";
        var el = document.createElement("div");
        el.id = "wb-dev-error";
        el.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#fff;color:#111;padding:28px 24px 24px 80px;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:auto;white-space:pre-wrap";
        el.textContent = message;
        var bar = document.createElement("div");
        bar.style.cssText = "position:fixed;top:16px;left:16px;display:flex;gap:8px;z-index:2147483001";
        var copyBtn = document.createElement("button");
        copyBtn.textContent = "复制错误";
        copyBtn.style.cssText = "padding:8px 14px;cursor:pointer;font:12px sans-serif";
        copyBtn.onclick = function () { wbCopyText(message).then(function () { copyBtn.textContent = "已复制"; setTimeout(function () { copyBtn.textContent = "复制错误"; }, 1200); }); };
        var reloadBtn = document.createElement("button");
        reloadBtn.textContent = "重新加载页面";
        reloadBtn.style.cssText = "padding:8px 14px;cursor:pointer;font:12px sans-serif";
        reloadBtn.onclick = function () { location.reload(); };
        var safeBtn = document.createElement("button");
        safeBtn.textContent = "进入安全模式（暂时停用工作台 UI）";
        safeBtn.style.cssText = "padding:8px 14px;cursor:pointer;font:12px sans-serif;background:#fff3cd;border:1px solid #b8860b";
        safeBtn.onclick = function () { try { localStorage.setItem("wb.safe", "1"); } catch (e) {} location.reload(); };
        var resetBtn = document.createElement("button");
        resetBtn.textContent = "重置工作台界面（清空页面状态）";
        resetBtn.style.cssText = "padding:8px 14px;cursor:pointer;font:12px sans-serif;background:#e8f0fe;border:1px solid #1a73e8";
        resetBtn.onclick = wbResetUI;
        bar.appendChild(copyBtn);
        bar.appendChild(reloadBtn);
        bar.appendChild(safeBtn);
        bar.appendChild(resetBtn);
        document.body.appendChild(bar);
        document.body.appendChild(el);
      } catch (e) { /* overlay must never throw */ }
    }
    function installWbErrorOverlay() {
      try {
        window.addEventListener("error", function (e) { wbShowError("未捕获的脚本错误", e.error || e.message); });
        window.addEventListener("unhandledrejection", function (e) { wbShowError("未处理的 Promise 拒绝", e.reason); });
      } catch (e) { /* noop */ }
    }
    installWbErrorOverlay();
    function wbSafeModeActive() {
      try { return localStorage.getItem("wb.safe") === "1"; } catch (e) { return false; }
    }
    // Minimal fallback UI used when wb.safe === "1".
    function SafeFallback() {
      return jsxRuntime.jsx("div", { style: { minHeight: "100vh", background: "#fff", color: "#111", padding: 48, fontFamily: "system-ui, sans-serif" }, children: jsxRuntime.jsxs("div", { children: [
        jsxRuntime.jsx("h1", { style: { fontSize: 20, marginBottom: 12 }, children: "dsh-workbench 安全模式" }),
        jsxRuntime.jsx("p", { style: { marginBottom: 8 }, children: "工作台 UI 已暂时停用（localStorage wb.safe=1）。修复 lib/client.js 后，点下面的按钮恢复。" }),
        jsxRuntime.jsx("button", { style: { padding: "8px 16px", cursor: "pointer" }, onClick: wbResetUI, children: "退出安全模式并重置界面" })
      ] }) });
    }

    // ---- services stashed by apply() for components ----
    var WB_SVC = { sessions: null, workspaces: null, api: null, remote: null };

    // =====================================================================
    // Forked from @deepseek-ai/dsh-client-ui-layout (MIT)
    // =====================================================================
    var SIDEBAR_AUTO_COLLAPSE = 1024;

    function clampWidth(px, min, max) {
      return Math.min(max, Math.max(min, Math.round(px)));
    }

    function computeColumns(viewport, sidebar, details) {
      const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);
      const d0 = details === 0 ? 0 : clampWidth(details, 300, 520);
      if (s + d0 + 640 <= viewport) return { sidebar: s, center: viewport - s - d0, details: d0 };
      const d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);
      if (s + d1 + 640 <= viewport) return { sidebar: s, center: 640, details: d1 };
      return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };
    }

    var APPFRAME_CSS = ".pI_x6G_frame{background:var(--dsw-alias-bg-base);height:100%;transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);grid-template-rows:100%;display:grid;position:relative;overflow:hidden}.pI_x6G_frame[data-dragging]{transition:none}@media (prefers-reduced-motion:reduce){.pI_x6G_frame{transition:none}}.pI_x6G_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;overflow:hidden}.pI_x6G_centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}.pI_x6G_detailsCol{border-left:1px solid var(--dsw-alias-border-l2);min-width:0;overflow:hidden}.pI_x6G_frame[data-details-collapsed] .pI_x6G_detailsCol{border-left:none}.pI_x6G_handle{cursor:col-resize;z-index:2;touch-action:none;width:8px;transition:left var(--ds-transition-duration-slow) var(--ds-ease-in-out);margin-left:-4px;position:absolute;top:0;bottom:0}.pI_x6G_frame[data-dragging] .pI_x6G_handle{transition:none}@media (prefers-reduced-motion:reduce){.pI_x6G_handle{transition:none}}.pI_x6G_handle[data-side=details]:after{content:\"\";box-sizing:border-box;background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);opacity:0;width:12px;height:32px;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:10px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.pI_x6G_detailsCol:hover~.pI_x6G_handle[data-side=details]:after,.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{opacity:1}.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}.pI_x6G_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}.pI_x6G_overlayLayer>*{pointer-events:auto}";

    var APPFRAME_CSS_TAG = "dsh-workbench/AppFrame.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(APPFRAME_CSS_TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-workbench";
      tag.dataset.pluginCss = APPFRAME_CSS_TAG;
      tag.textContent = APPFRAME_CSS;
      document.head.appendChild(tag);
    }

    var appframeCss = {
      detailsCol: "pI_x6G_detailsCol",
      sidebarCol: "pI_x6G_sidebarCol",
      overlayLayer: "pI_x6G_overlayLayer",
      handle: "pI_x6G_handle",
      frame: "pI_x6G_frame",
      centerCol: "pI_x6G_centerCol"
    };

    function CenterColumn(props) {
      return jsxRuntime.jsx("div", { className: appframeCss.centerCol, style: { gridColumn: 2 }, children: props.children });
    }

    function DragHandle(props) {
      const [dragging, setDragging] = React.useState(false);
      const origin = React.useRef(0);
      const latest = React.useRef(0);
      const frame = React.useRef(null);
      const callbacks = React.useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd });
      callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd };
      const onPointerDown = React.useCallback((e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = e.clientX;
        latest.current = e.clientX;
        callbacks.current.onStart();
        setDragging(true);
      }, []);
      const onPointerMove = React.useCallback((e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        latest.current = e.clientX;
        frame.current ??= requestAnimationFrame(() => {
          frame.current = null;
          callbacks.current.onDrag(latest.current - origin.current);
        });
      }, []);
      const onPointerUp = React.useCallback((e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
        callbacks.current.onDrag(latest.current - origin.current);
        setDragging(false);
        callbacks.current.onEnd();
      }, []);
      return jsxRuntime.jsx("div", {
        className: appframeCss.handle,
        style: { left: props.left },
        "data-side": props.side,
        "data-dragging": dragging || void 0,
        onPointerDown,
        onPointerMove,
        onPointerUp
      });
    }

    function createLayoutStore() {
      return runtimeClient.defineStore({
        init: () => ({ sidebar: 280, details: 0, narrow: false, narrowExpanded: false }),
        actions: {
          setSidebar: (d, px) => { d.sidebar = clampWidth(px, 264, 420); },
          setDetails: (d, px) => { d.details = clampWidth(px, 300, 520); },
          toggleSidebar: (d) => { d.sidebar = d.sidebar === 0 ? 280 : 0; },
          setNarrow: (d, narrow) => { if (d.narrow === narrow) return; d.narrow = narrow; d.narrowExpanded = false; },
          openDetails: (d) => { if (d.details === 0) d.details = 360; },
          closeDetails: (d) => { d.details = 0; }
        }
      });
    }

    var LayoutController = class {
      #panels;
      attachPanels(actions) { this.#panels = actions; }
      toggleSidebar() { this.#require().toggleSidebar(); }
      openDetails() { this.#require().openDetails(); }
      closeDetails() { this.#require().closeDetails(); }
      #require() {
        if (this.#panels === void 0) throw new Error("layout: panel actions not wired (root entry not mounted)");
        return this.#panels;
      }
    };

    var DARK_ATTRIBUTE = "data-ds-dark-theme";

    var ThemePresenter = class {
      appliedTokens = [];
      themeColorMeta;
      constructor() {
        this.themeColorMeta = document.createElement("meta");
        this.themeColorMeta.name = "theme-color";
      }
      apply(snapshot) {
        const scheme = snapshot.active.colorScheme;
        document.documentElement.style.colorScheme = scheme;
        const body = document.body;
        if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
        else body.removeAttribute(DARK_ATTRIBUTE);
        for (const name of this.appliedTokens) body.style.removeProperty(name);
        this.appliedTokens = [];
        for (const [name, value] of Object.entries(snapshot.active.tokens)) {
          body.style.setProperty(name, value);
          this.appliedTokens.push(name);
        }
        this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
        if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
      }
      dispose() {
        document.documentElement.style.removeProperty("color-scheme");
        const body = document.body;
        body.removeAttribute(DARK_ATTRIBUTE);
        for (const name of this.appliedTokens) body.style.removeProperty(name);
        this.appliedTokens = [];
        this.themeColorMeta.remove();
      }
    };

    // =====================================================================
    // Workbench shell (ours)
    // =====================================================================
    var WB_CSS = [
      ".wb-root{display:flex;height:100%;width:100%;min-width:0}",
      ".wb-nav{flex:none;display:flex;flex-direction:column;gap:2px;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1));border-right:1px solid var(--dsw-alias-border-l1);padding:8px;box-sizing:border-box;transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);overflow:hidden}",
      ".wb-nav-expanded{width:196px}",
      ".wb-nav-collapsed{width:48px;padding-left:5px;padding-right:5px}",
      ".wb-nav-brand{flex:none;height:40px;display:flex;align-items:center;gap:8px;padding:0 7px;margin-bottom:3px;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden}",
      ".wb-nav-main{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px;padding-right:1px}.wb-nav-main::-webkit-scrollbar{width:4px}.wb-nav-main::-webkit-scrollbar-thumb{border-radius:999px;background:var(--dsw-alias-border-l2)}",
      ".wb-nav-section-label{height:22px;display:flex;align-items:center;padding:0 8px;margin-top:5px;color:var(--dsw-alias-label-tertiary);font-size:9px;font-weight:700;letter-spacing:.12em;white-space:nowrap}",
      ".wb-nav-sep{flex:none;height:1px;background:var(--dsw-alias-border-l1);margin:6px 2px}",
      ".wb-nav-btn{flex:none;display:flex;align-items:center;gap:9px;width:100%;height:36px;padding:0 8px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:12px;font-weight:520;white-space:nowrap;overflow:hidden;box-sizing:border-box}",
      ".wb-nav-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-nav-btn-active{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-button-floating-fill));color:var(--dsw-alias-label-primary)}",
      ".wb-nav-btn-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px}",
      ".wb-nav-btn-main{font-weight:620;color:var(--dsw-alias-label-primary)}.wb-nav-badge{margin-left:auto;min-width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:9px;box-sizing:border-box}",
      ".wb-nav-collapsed .wb-nav-btn{justify-content:center;padding:0}",
      ".wb-nav-collapsed .wb-nav-label,.wb-nav-collapsed .wb-nav-brand-label,.wb-nav-collapsed .wb-nav-section-label,.wb-nav-collapsed .wb-nav-badge,.wb-nav-collapsed .wb-nav-capture{display:none}",
      ".wb-nav-collapsed .wb-nav-brand{justify-content:center;padding:0}",
      ".wb-nav-capture{flex:none;margin:7px 1px 5px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,transparent)}.wb-nav-capture-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.wb-nav-capture-head strong{font-size:11px;color:var(--dsw-alias-label-primary)}.wb-nav-capture-head button{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:9px inherit;cursor:pointer}.wb-nav-capture textarea{width:100%;min-height:56px;box-sizing:border-box;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:10px/1.45 inherit;outline:none;resize:none}.wb-nav-capture textarea:focus{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}.wb-nav-capture-actions{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:6px}.wb-nav-capture-actions small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:8px}.wb-nav-capture-actions button{flex:none;height:26px;padding:0 8px;border:none;border-radius:7px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-accent-fill));color:var(--dsw-alias-label-primary-inverted);font:9px inherit;cursor:pointer}.wb-nav-capture-actions button:disabled{opacity:.45;cursor:default}.wb-nav-ideas{display:flex;flex-direction:column;gap:3px;margin-top:7px}.wb-nav-idea{width:100%;display:flex;align-items:center;gap:5px;padding:5px 6px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:9px inherit;text-align:left;cursor:pointer}.wb-nav-idea:hover{background:var(--dsw-alias-interactive-bg-hover)}.wb-nav-idea span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wb-nav-idea:before{content:'';flex:none;width:5px;height:5px;border-radius:50%;background:#ff9f0a}.wb-nav-capture-note{margin-top:5px;font-size:8px;color:#30b650}",
      ".wb-nav-foot{flex:none;display:flex;flex-direction:column;gap:2px;margin-top:auto}",
      ".wb-nav-collapsed .wb-nav-foot{align-items:center}",
      ".wb-nav-arrow{flex:none}",
      ".wb-content{flex:1;min-width:0;display:flex}",
      ".wb-content>*{flex:1;min-width:0}",
      ".wb-root-nav-expanded .wb-task-center-shell{left:206px}.wb-root-nav-collapsed .wb-task-center-shell{left:58px}",
      ".wb-page{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto;background:var(--dsw-alias-bg-base)}",
      ".wb-page-inner{max-width:880px;width:100%;margin:0 auto;padding:40px 32px;box-sizing:border-box}",
      ".wb-page-title{font-size:22px;font-weight:600;margin:0 0 6px;color:var(--dsw-alias-label-primary)}",
      ".wb-page-desc{margin:0 0 24px;line-height:1.7;color:var(--dsw-alias-label-secondary);font-size:14px}",
      ".wb-page-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:500;background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}",
      ".wb-page-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:20px 24px;margin-top:16px}",
      // ---- agent workspace ----
      ".wb-agent{position:relative;height:100%;min-width:0}",
      ".wb-agent-frame{display:grid;grid-template-rows:100%;height:100%}",
      // ---- session panel ----
      ".wb-sp-col{min-width:0;overflow:hidden;background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);display:flex}",
      ".wb-sp{flex:1;min-width:0;display:flex;flex-direction:column;padding:12px 10px;box-sizing:border-box;gap:8px}",
      ".wb-sp-head{display:flex;flex-direction:column;gap:6px}",
      ".wb-sp-capture{flex:none;padding:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,transparent)}.wb-sp-capture-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.wb-sp-capture-head strong{font-size:11px;color:var(--dsw-alias-label-primary)}.wb-sp-capture-head span{font-size:9px;color:var(--dsw-alias-label-tertiary)}.wb-sp-capture-head button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:9px inherit;cursor:pointer}.wb-sp-capture textarea{width:100%;min-height:55px;box-sizing:border-box;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:10px/1.45 inherit;outline:none;resize:none}.wb-sp-capture textarea:focus{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}.wb-sp-capture-actions{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:6px}.wb-sp-capture-actions small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:8px}.wb-sp-capture-actions button{flex:none;height:26px;padding:0 9px;border:none;border-radius:7px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-accent-fill));color:var(--dsw-alias-label-primary-inverted);font:9px inherit;cursor:pointer}.wb-sp-capture-actions button:disabled{opacity:.45;cursor:default}.wb-sp-capture-note{margin-top:5px;font-size:8px;color:#30b650}.wb-sp-idea-list{display:flex;flex-direction:column;gap:2px;margin-top:6px}.wb-sp-idea{width:100%;display:flex;align-items:center;gap:5px;padding:4px 5px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:9px inherit;text-align:left;cursor:pointer}.wb-sp-idea:hover{background:var(--dsw-alias-interactive-bg-hover)}.wb-sp-idea:before{content:'';flex:none;width:5px;height:5px;border-radius:50%;background:#ff9f0a}.wb-sp-idea span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wb-sp-wsrow{display:flex;align-items:center;gap:6px}",
      ".wb-sp-select{flex:1;min-width:0;height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:0 8px;font-family:inherit;font-size:13px;cursor:pointer}",
      ".wb-sp-btn{flex:none;height:32px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;font-weight:500;padding:0 10px;box-sizing:border-box;transition:background .15s ease,color .15s ease,border-color .15s ease}",
      ".wb-sp-btn:hover{background:var(--dsw-alias-button-floating-hover)}",
      ".wb-sp-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-accent-fill));border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}",
      ".wb-sp-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill));color:var(--dsw-alias-label-primary-inverted)}",
      ".wb-sp-newform{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}",
      ".wb-sp-dualwarn{margin-top:8px;padding:8px 10px;border:1px solid rgba(255,159,10,.3);border-radius:9px;background:rgba(255,159,10,.07);color:#b96a00;font-size:10px;line-height:1.5}",
      ".wb-sp-input{height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 8px;font-family:inherit;font-size:12px;box-sizing:border-box}",
      ".wb-sp-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px}",
      ".wb-sp-empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:20px 0}",
      ".wb-sp-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;cursor:pointer;position:relative}",
      ".wb-sp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-sp-row-active{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-button-floating-fill))}",
      ".wb-sp-dot{flex:none;width:7px;height:7px;border-radius:50%}",
      ".wb-sp-pin{flex:none;font-size:10px;color:#ff9f0a}",
      ".wb-st-idle{background:var(--dsw-alias-label-secondary)}",
      ".wb-st-run{background:#34c759}",
      ".wb-st-inter{background:#ff9f0a}",
      ".wb-sp-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}",
      ".wb-sp-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wb-sp-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:center}",
      ".wb-sp-menu{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;visibility:hidden}",
      ".wb-sp-row:hover .wb-sp-menu{visibility:visible}",
      ".wb-sp-menu:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-sp-pop{position:absolute;right:6px;top:30px;z-index:30;min-width:110px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:4px;box-shadow:var(--dsw-shadow-lv2);display:flex;flex-direction:column}",
      ".wb-sp-pop-item{display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;text-align:left}",
      ".wb-sp-pop-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-sp-pop-item-danger{color:#ff453a}",
      ".wb-sp-renaming{display:flex;gap:4px;align-items:center}",
      ".wb-sp-close{flex:none}",
      ".wb-sp-reopen{position:absolute;left:8px;top:50%;transform:translateY(-50%);z-index:12;width:30px;height:44px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:.75;box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-sp-reopen:hover{opacity:1;color:var(--dsw-alias-label-primary)}",
      // ---- right toolbar (P1) ----
      ".wb-tb-col{min-width:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l1);display:flex}",
      ".wb-tb{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1));box-sizing:border-box}",
      ".wb-tb-head{flex:none;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".wb-tb-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".wb-tb-close{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".wb-tb-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wb-tb-scroll{flex:1;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}",
      ".wb-tb-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}",
      ".wb-tb-card-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.04em}",
      ".wb-tb-status{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
      ".wb-tb-session-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all;line-height:1.5}",
      ".wb-tb-meta{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6;word-break:break-all}",
      ".wb-tb-chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".wb-tb-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-button-floating-fill));color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}",
      ".wb-tb-empty{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".wb-tb-distill{width:100%;height:34px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:not-allowed;font-family:inherit;font-size:12px;box-sizing:border-box}",
      ".wb-tb-reopen{position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:12;width:30px;height:44px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:.75;box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-tb-reopen:hover{opacity:1;color:var(--dsw-alias-label-primary)}",
      // ---- toolbar tabs (P1) ----
      ".wb-tb-tabs{flex:1;min-width:0;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}",
      ".wb-tb-tabs::-webkit-scrollbar{display:none}",
      ".wb-tb-tab{flex:none;height:26px;padding:0 9px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:12px;font-weight:500;white-space:nowrap}",
      ".wb-tb-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-tb-tab-active{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-button-floating-fill));color:var(--dsw-alias-label-primary)}",
      // ---- expandable tool rows ----
      ".wb-tb-tools{display:flex;flex-direction:column;gap:2px}",
      ".wb-tb-tool{display:flex;flex-direction:column}",
      ".wb-tb-tool-row{display:flex;align-items:center;gap:6px;width:100%;height:30px;padding:0 6px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;text-align:left;box-sizing:border-box}",
      ".wb-tb-tool-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-tb-tool-caret{flex:none;width:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);transition:transform .15s}",
      ".wb-tb-tool-open .wb-tb-tool-caret{transform:rotate(90deg)}",
      ".wb-tb-tool-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}",
      ".wb-tb-tool-id{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wb-tb-tool-detail{margin:0 4px 8px 26px;padding:8px 10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.7;word-break:break-all;display:flex;flex-direction:column;gap:4px}",
      // ---- task board ----
      ".wb-tb-goal-phase{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:500;background:var(--dsw-alias-accent-fill,var(--dsw-alias-button-floating-fill));color:var(--dsw-alias-label-primary)}",
      ".wb-tb-group-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:8px 0 2px}",
      ".wb-tb-task{display:flex;gap:8px;padding:5px 4px;border-radius:8px;align-items:flex-start}",
      ".wb-tb-task:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-tb-task-glyph{flex:none;width:14px;height:14px;margin-top:1px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#fff}",
      ".wb-tb-task-glyph-done{background:#34c759;border-color:#34c759}",
      ".wb-tb-task-glyph-run{background:#ff9f0a;border-color:#ff9f0a}",
      ".wb-tb-task-content{font-size:12px;color:var(--dsw-alias-label-primary);line-height:1.5;min-width:0;word-break:break-word}",
      ".wb-tb-task-done .wb-tb-task-content{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}",
      // ---- task board v2 (kanban) ----
      ".wb-task-switch{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}",
      ".wb-task-switch button{height:28px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:12px inherit;font-family:inherit;cursor:pointer}",
      ".wb-task-switch button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-task-switch .wb-task-switch-active{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-tb-search{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;background:var(--dsw-alias-bg-base)}",
      ".wb-tb-search svg{flex:none;color:var(--dsw-alias-label-tertiary)}",
      ".wb-tb-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:12px inherit;font-family:inherit}",
      ".wb-tb-add{display:flex;gap:6px;align-items:center}",
      ".wb-tb-add input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px inherit;font-family:inherit}",
      ".wb-tb-add input:focus{outline:none;border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-tb-add select{flex:none;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px inherit;font-family:inherit;padding:0 5px}",
      ".wb-tb-progress{height:6px;border-radius:999px;background:var(--dsw-alias-bg-base);overflow:hidden;border:1px solid var(--dsw-alias-border-l1)}",
      ".wb-tb-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));transition:width .2s ease}",
      ".wb-tb-progress-meta{display:flex;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-board{display:flex;gap:8px;align-items:flex-start;margin-top:4px;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x proximity}",
      ".wb-board-col{flex:0 0 220px;min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:4px;min-height:60px;scroll-snap-align:start}",
      ".wb-board-col-drag{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-board-col-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:2px 4px}",
      ".wb-board-col-count{flex:none;font-size:10px;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;padding:0 6px;color:var(--dsw-alias-label-secondary)}",
      ".wb-board-card{display:flex;align-items:flex-start;gap:6px;padding:5px 6px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);cursor:grab;font-size:12px;color:var(--dsw-alias-label-primary);line-height:1.45;word-break:break-word}",
      ".wb-board-card:hover{box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-board-card:active{cursor:grabbing}",
      ".wb-board-card-done{opacity:.55}",
      ".wb-board-card-done .wb-board-card-content{text-decoration:line-through;color:var(--dsw-alias-label-tertiary)}",
      ".wb-board-dot{flex:none;width:13px;height:13px;margin-top:2px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:#fff;cursor:pointer;background:transparent}",
      ".wb-board-dot:hover{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-board-dot-done{background:#34c759;border-color:#34c759}",
      ".wb-board-dot-run{background:#ff9f0a;border-color:#ff9f0a}",
      ".wb-board-card-content{flex:1;min-width:0}",
      ".wb-board-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
      ".wb-task-priority{align-self:flex-start;display:inline-flex;padding:1px 6px;border-radius:999px;font-size:9px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}",
      ".wb-task-priority-high{color:#ff453a;background:rgba(255,69,58,.08)}",
      ".wb-task-priority-medium{color:#ff9f0a;background:rgba(255,159,10,.08)}",
      ".wb-task-priority-low{color:#34c759;background:rgba(52,199,89,.08)}",
      ".wb-board-card-actions{display:flex;flex-direction:column;gap:2px;flex:none;opacity:.25}",
      ".wb-board-card:hover .wb-board-card-actions{opacity:1}",
      ".wb-board-card-actions button{background:none;border:none;padding:2px;border-radius:4px;cursor:pointer;color:var(--dsw-alias-label-tertiary);display:flex}",
      ".wb-board-card-actions button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wb-board-empty{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:4px 2px}",
      ".wb-tb-sort{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-tb-sort select{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font:11px inherit;font-family:inherit;padding:2px 4px}",
      ".wb-tb-err{font-size:11px;color:#ff453a;line-height:1.5}",
      ".wb-goal-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}",
      ".wb-goal-actions .wb-sp-btn{padding:2px 10px;font-size:11px}",
      ".wb-goal-rounds{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-goal-progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-base);overflow:hidden;border:1px solid var(--dsw-alias-border-l1);margin-top:4px}",
      ".wb-goal-progress-fill{height:100%;background:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));border-radius:999px}",
      ".wb-goal-edit{display:flex;gap:6px;align-items:center}",
      ".wb-goal-edit input{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px inherit;font-family:inherit}",
      ".wb-goal-edit input:focus{outline:none;border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      // ---- Workbench Flow: focus panel + full task center ----
      ".wb-task-quick{display:flex;flex-direction:column;gap:10px}",
      ".wb-task-quick-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:2px 2px 0}",
      ".wb-task-kicker{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
      ".wb-task-quick-title{margin-top:2px;font-size:17px;line-height:1.35;font-weight:650;color:var(--dsw-alias-label-primary)}",
      ".wb-task-quick-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}",
      ".wb-task-stat{padding:8px 9px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}",
      ".wb-task-stat strong{display:block;font-size:16px;line-height:1.2;color:var(--dsw-alias-label-primary)}",
      ".wb-task-stat span{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-focus-card{display:flex;flex-direction:column;gap:5px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,transparent)}",
      ".wb-focus-section{display:flex;align-items:center;justify-content:space-between;padding:1px 2px 3px}",
      ".wb-focus-label{font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary)}",
      ".wb-focus-count{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-focus-row{display:flex;align-items:flex-start;gap:8px;padding:7px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:1px solid transparent;transition:border-color .15s ease,background .15s ease}",
      ".wb-focus-row:hover{border-color:var(--dsw-alias-border-l2)}",
      ".wb-focus-check{flex:none;width:24px;height:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}",
      ".wb-focus-check:hover{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));color:var(--dsw-alias-label-primary)}",
      ".wb-focus-check-active{background:rgba(255,159,10,.14);border-color:#ff9f0a;color:#ff9f0a}",
      ".wb-focus-check-blocked{background:rgba(255,69,58,.12);border-color:#ff453a;color:#ff453a}",
      ".wb-focus-main{flex:1;min-width:0;cursor:pointer}",
      ".wb-focus-title{font-size:12px;font-weight:520;line-height:1.45;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".wb-focus-meta{display:flex;align-items:center;gap:6px;margin-top:3px;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-priority-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}",
      ".wb-priority-dot-high{background:#ff453a}.wb-priority-dot-medium{background:#ff9f0a}.wb-priority-dot-low{background:#34c759}",
      ".wb-task-quick-add{display:flex;align-items:center;gap:6px;padding:5px 5px 5px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-base)}",
      ".wb-task-quick-add input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:12px inherit}",
      ".wb-task-expand{width:100%;min-height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:600 12px inherit;cursor:pointer;box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-task-expand:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-task-center-shell{position:fixed;inset:14px 16px 16px 70px;z-index:120;display:flex;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 60px rgba(0,0,0,.28);animation:wb-task-center-in .16s ease-out}",
      ".wb-root-nav-expanded .wb-task-center-shell{left:206px}.wb-root-nav-collapsed .wb-task-center-shell{left:58px}",
      "@keyframes wb-task-center-in{from{opacity:0;transform:translateY(8px) scale(.995)}to{opacity:1;transform:none}}",
      ".wb-task-center{flex:1;min-width:0;display:flex;flex-direction:column}",
      ".wb-task-center-head{flex:none;display:flex;align-items:center;gap:16px;min-height:62px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,transparent)}",
      ".wb-task-center-brand{flex:none;min-width:168px}",
      ".wb-task-center-brand strong{display:block;font-size:16px;color:var(--dsw-alias-label-primary)}",
      ".wb-task-center-brand span{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-task-center-tabs{flex:1;display:flex;align-items:center;gap:3px;overflow:auto}",
      ".wb-task-center-tab{flex:none;min-height:32px;padding:0 12px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:550 12px inherit;cursor:pointer}",
      ".wb-task-center-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-task-center-tab-active{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-task-scope{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;min-width:270px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-task-scope button{height:28px;padding:0 9px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:11px inherit;cursor:pointer;white-space:nowrap}",
      ".wb-task-scope button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-task-scope .wb-task-scope-active{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-weight:650;box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-task-project-select{width:190px;height:34px;padding:0 28px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px inherit;outline:none;text-overflow:ellipsis}",
      ".wb-task-project-select:focus{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-task-center-tools{flex:none;display:flex;align-items:center;gap:8px}",
      ".wb-task-center-search{width:220px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px inherit;outline:none}",
      ".wb-task-center-search:focus{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-task-center-close{width:32px;height:32px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;cursor:pointer}",
      ".wb-task-center-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".wb-task-center-body{flex:1;min-height:0;overflow:auto;padding:18px;background:var(--dsw-alias-bg-base)}",
      ".wb-task-view-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}",
      ".wb-task-view-head h2{margin:0;font-size:22px;line-height:1.25;color:var(--dsw-alias-label-primary)}",
      ".wb-task-view-head p{margin:4px 0 0;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-task-create{display:flex;gap:7px;align-items:center}",
      ".wb-task-create input{width:300px;height:34px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:12px inherit;outline:none}",
      ".wb-task-center-board{display:grid;grid-template-columns:repeat(5,minmax(235px,1fr));gap:10px;min-width:1220px;align-items:start}",
      ".wb-task-center-col{min-height:160px;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:13px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-task-center-col-over{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-task-center-col-head{display:flex;align-items:center;justify-content:space-between;padding:3px 4px 9px;font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary)}",
      ".wb-task-center-card{position:relative;display:flex;flex-direction:column;gap:7px;margin-bottom:6px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease}",
      ".wb-task-center-card:hover{transform:translateY(-1px);border-color:var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-task-center-card-title{font-size:12px;font-weight:540;line-height:1.5;color:var(--dsw-alias-label-primary)}",
      ".wb-task-center-card-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-task-card-group{display:inline-flex;max-width:100%;padding:2px 7px;border-radius:7px;background:rgba(90,120,255,.09);color:var(--dsw-alias-label-secondary);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".wb-task-owner{display:inline-flex;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".wb-task-card-status{width:100%;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:10px inherit}",
      ".wb-task-today-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:14px}",
      ".wb-task-panel{padding:13px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-task-panel + .wb-task-panel{margin-top:12px}",
      ".wb-task-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary)}",
      ".wb-task-list-row{display:grid;grid-template-columns:minmax(240px,1fr) 120px 90px 110px 110px;gap:10px;align-items:center;min-height:44px;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-task-list-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-task-list-head{min-height:32px;font-size:10px;font-weight:650;color:var(--dsw-alias-label-tertiary);background:transparent}",
      ".wb-task-list-title{min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}",
      ".wb-task-list-row select{width:100%;height:28px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:11px inherit}",
      ".wb-task-list-row select:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}",
      ".wb-task-timeline{display:flex;flex-direction:column;gap:12px}",
      ".wb-task-date-group{display:grid;grid-template-columns:120px minmax(0,1fr);gap:14px;align-items:start}",
      ".wb-task-date-label{position:sticky;top:0;padding:10px 0;font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary)}",
      ".wb-task-date-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}",
      ".wb-task-review-stats{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px;margin-bottom:14px}",
      ".wb-task-review-stat{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-task-review-stat strong{display:block;font-size:26px;color:var(--dsw-alias-label-primary)}",
      ".wb-task-review-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-task-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-bottom:14px}",
      ".wb-task-group{padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-task-group-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}",
      ".wb-task-group-title{font-size:12px;font-weight:650;line-height:1.4;color:var(--dsw-alias-label-primary)}",
      ".wb-task-group-meta{margin-top:4px;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-task-group-progress{height:5px;margin-top:8px;border-radius:999px;background:var(--dsw-alias-bg-base);overflow:hidden}",
      ".wb-task-group-progress span{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-template-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}",
      ".wb-template-card{display:flex;flex-direction:column;gap:9px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-template-card h3{margin:0;font-size:14px;color:var(--dsw-alias-label-primary)}",
      ".wb-template-steps{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-template-step{display:flex;gap:7px;line-height:1.4}.wb-template-step span:first-child{color:var(--dsw-alias-label-tertiary)}",
      ".wb-template-actions{display:flex;gap:7px;margin-top:auto}",
      ".wb-orch{display:flex;flex-direction:column;gap:12px;max-width:1500px;margin:0 auto}",
      ".wb-orch-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 20px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 26%,var(--dsw-alias-border-l1));border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 10%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1))}",
      ".wb-orch-hero h3{margin:3px 0 5px;font-size:18px;color:var(--dsw-alias-label-primary)}",
      ".wb-orch-hero p{max-width:760px;margin:0;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary)}",
      ".wb-orch-runtime{display:grid;grid-template-columns:auto 1fr;column-gap:7px;align-items:center;min-width:210px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,transparent)}",
      ".wb-orch-runtime strong{font-size:11px;color:var(--dsw-alias-label-primary)}.wb-orch-runtime small{grid-column:2;font-size:9px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-orch-dot{width:8px;height:8px;border-radius:50%;background:#ff453a;box-shadow:0 0 0 3px rgba(255,69,58,.12)}.wb-orch-dot-on{background:#34c759;box-shadow:0 0 0 3px rgba(52,199,89,.12)}",
      ".wb-orch-compose{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}",
      ".wb-orch-compose textarea,.wb-orch-feedback{width:100%;box-sizing:border-box;min-height:82px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px/1.55 inherit;outline:none;resize:vertical}",
      ".wb-orch-compose textarea:focus,.wb-orch-feedback:focus{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-orch-compose>div{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}.wb-orch-compose>div>span{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-planning{margin-top:11px;padding:14px 15px;border:1px solid rgba(255,159,10,.28);border-radius:12px;background:rgba(255,159,10,.06)}.wb-planning-bar{position:relative;height:6px;border-radius:999px;background:var(--dsw-alias-bg-base);overflow:hidden}.wb-planning-bar span{position:absolute;top:0;left:-40%;width:40%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)),transparent);animation:wb-planning-slide 1.2s ease-in-out infinite}@keyframes wb-planning-slide{from{left:-40%}to{left:100%}}.wb-planning p{margin:9px 0 3px;font-size:11px;color:var(--dsw-alias-label-primary)}.wb-planning small{font-size:9px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-run-progress{margin:12px 0 2px;padding:11px 12px;border:1px solid rgba(255,159,10,.22);border-radius:11px;background:rgba(255,159,10,.05)}.wb-run-progress-bar{height:7px;border-radius:999px;background:var(--dsw-alias-bg-base);overflow:hidden}.wb-run-progress-bar span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ff9f0a,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)));transition:width .5s ease}.wb-run-progress-meta{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:10px;color:var(--dsw-alias-label-secondary)}.wb-run-progress-meta strong{color:var(--dsw-alias-label-primary)}.wb-orch-agent-elapsed{font-style:normal;opacity:.75}",
      ".wb-orch-resume-hint{display:block;margin:0 0 8px;font-size:9px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".wb-orch-feedback-hint{display:block;margin-top:5px;font-size:9px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".wb-orch-list{display:flex;flex-direction:column;gap:12px}",
      ".wb-orch-card{padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-orch-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.wb-orch-card-head h3{margin:0;font-size:15px;color:var(--dsw-alias-label-primary)}.wb-orch-card-head p{max-width:900px;margin:5px 0 0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}",
      ".wb-orch-phase{flex:none;padding:4px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:650}.wb-orch-phase-planned{background:rgba(10,132,255,.12);color:#0a84ff}.wb-orch-phase-running{background:rgba(255,159,10,.13);color:#ff9f0a}.wb-orch-phase-review{background:rgba(175,82,222,.13);color:#bf5af2}.wb-orch-phase-accepted{background:rgba(52,199,89,.13);color:#30b650}.wb-orch-phase-failed,.wb-orch-phase-changes_requested{background:rgba(255,69,58,.12);color:#ff453a}",
      ".wb-orch-summary{margin-top:11px;padding:9px 11px;border-left:3px solid var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-base);font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary)}",
      ".wb-orch-main,.wb-orch-worker{padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.wb-orch-main{margin-top:11px;border-color:color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 24%,var(--dsw-alias-border-l1))}",
      ".wb-orch-agent-title{display:flex;align-items:center;gap:9px}.wb-orch-agent-title>div{flex:1;min-width:0}.wb-orch-agent-title strong{display:block;font-size:12px;color:var(--dsw-alias-label-primary)}.wb-orch-agent-title small{display:block;margin-top:1px;font-size:9px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-orch-avatar{flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:700}.wb-orch-avatar-main{background:color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 15%,transparent);color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-orch-agent-status{flex:none;font-size:9px;color:var(--dsw-alias-label-tertiary)}.wb-orch-agent-status-running{color:#ff9f0a}.wb-orch-agent-status-completed{color:#30b650}.wb-orch-agent-status-failed{color:#ff453a}",
      ".wb-orch-main p,.wb-orch-worker p{margin:8px 0 0;font-size:10px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}",
      ".wb-orch-workers{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;margin-top:8px}.wb-orch-deps,.wb-orch-acceptance{margin-top:7px;font-size:9px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.wb-orch-acceptance{padding-top:7px;border-top:1px dashed var(--dsw-alias-border-l1)}",
      ".wb-orch-criteria,.wb-orch-report{margin-top:10px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base)}.wb-orch-criteria>strong,.wb-orch-report>strong{font-size:11px;color:var(--dsw-alias-label-primary)}.wb-orch-criteria ol{margin:7px 0 0;padding-left:20px;font-size:10px;line-height:1.7;color:var(--dsw-alias-label-secondary)}",
      ".wb-orch-report pre,.wb-orch-output pre{margin:8px 0 0;max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.6 inherit;color:var(--dsw-alias-label-secondary)}.wb-orch-output{margin-top:8px}.wb-orch-output summary{cursor:pointer;font-size:9px;color:var(--dsw-alias-label-secondary)}",
      ".wb-orch-feedback{min-height:72px;margin-top:10px}.wb-orch-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:11px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.wb-orch-actions>.wb-tb-meta{margin-left:auto}",
      ".wb-task-subviews{display:inline-flex;gap:3px;margin:-3px 0 14px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.wb-task-subviews button{height:28px;padding:0 12px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:11px inherit;cursor:pointer}.wb-task-subviews button:hover{background:var(--dsw-alias-interactive-bg-hover)}.wb-task-subviews .wb-task-subview-active{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-weight:650;box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-ideas{display:flex;flex-direction:column;gap:12px;max-width:1500px;margin:0 auto}.wb-idea-capture{display:grid;grid-template-columns:minmax(260px,.7fr) minmax(360px,1.3fr);gap:24px;align-items:center;padding:17px 19px;border:1px solid color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 22%,var(--dsw-alias-border-l1));border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 8%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1))}.wb-idea-capture h3{margin:3px 0 4px;font-size:18px;color:var(--dsw-alias-label-primary)}.wb-idea-capture p{margin:0;font-size:10px;line-height:1.6;color:var(--dsw-alias-label-secondary)}.wb-idea-capture-box{display:flex;align-items:flex-end;gap:8px}.wb-idea-capture-box textarea{flex:1;min-height:72px;box-sizing:border-box;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px/1.55 inherit;resize:vertical;outline:none}",
      ".wb-idea-workspace{display:grid;grid-template-columns:300px minmax(0,1fr);gap:10px;min-height:490px}.wb-idea-list-panel,.wb-idea-detail{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}.wb-idea-list-panel{display:flex;flex-direction:column;min-height:0;overflow:hidden}.wb-idea-filters{display:flex;flex-wrap:wrap;gap:3px;padding:9px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wb-idea-filters button{flex:none;display:flex;align-items:center;gap:5px;height:27px;padding:0 8px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:10px inherit;cursor:pointer}.wb-idea-filters button small{color:var(--dsw-alias-label-tertiary)}.wb-idea-filters .wb-idea-filter-active{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-weight:650}.wb-idea-list{padding:6px;overflow:auto}.wb-idea-row{width:100%;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}.wb-idea-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.wb-idea-row-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill)}.wb-idea-row>span{min-width:0}.wb-idea-row strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.wb-idea-row small{display:block;margin-top:3px;font-size:9px;color:var(--dsw-alias-label-tertiary)}.wb-idea-row em{flex:none;padding:2px 5px;border-radius:5px;background:rgba(10,132,255,.1);color:#0a84ff;font:normal 8px inherit}",
      ".wb-idea-detail{padding:17px;overflow:auto}.wb-idea-detail>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.wb-idea-detail>header>div{display:flex;align-items:center;gap:8px}.wb-idea-detail>header small{font-size:9px;color:var(--dsw-alias-label-tertiary)}.wb-idea-detail select,.wb-idea-detail input,.wb-idea-detail textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px/1.5 inherit;outline:none}.wb-idea-detail select,.wb-idea-fields input{height:32px;padding:0 8px}.wb-idea-title-input{width:100%;height:40px;margin-top:12px;padding:0 11px;font-size:16px!important;font-weight:650!important}.wb-idea-body-input{width:100%;min-height:130px;margin-top:8px;padding:10px;resize:vertical}.wb-idea-fields{display:grid;grid-template-columns:minmax(160px,1fr) 90px 90px minmax(130px,.7fr);gap:8px;margin-top:9px}.wb-idea-fields label{display:flex;flex-direction:column;gap:4px;font-size:9px;font-weight:650;color:var(--dsw-alias-label-tertiary)}.wb-idea-fields input{width:100%}.wb-idea-ai{margin-top:12px;padding:12px;border:1px solid rgba(10,132,255,.2);border-radius:11px;background:rgba(10,132,255,.055);font-size:10px;line-height:1.6;color:var(--dsw-alias-label-secondary)}.wb-idea-ai-head{display:flex;align-items:center;justify-content:space-between}.wb-idea-ai-head strong{color:var(--dsw-alias-label-primary)}.wb-idea-ai-head span{padding:2px 7px;border-radius:999px;background:rgba(10,132,255,.12);color:#0a84ff}.wb-idea-ai p{margin:7px 0}.wb-idea-rationale{padding-top:7px;border-top:1px dashed rgba(10,132,255,.2)}.wb-idea-ai ul{margin:5px 0 0;padding-left:18px}.wb-idea-ai-empty{border-style:dashed;color:var(--dsw-alias-label-tertiary)}.wb-idea-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1)}.wb-idea-detail-empty{display:flex;align-items:center;justify-content:center}",
      ".wb-collab{max-width:1600px;margin:0 auto}.wb-collab-grid{display:grid;grid-template-columns:260px minmax(460px,1fr) 290px;gap:10px;align-items:start}.wb-collab-list,.wb-collab-main,.wb-collab-decision{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}.wb-collab-list{position:sticky;top:0;max-height:calc(100vh - 180px);overflow:auto;padding:7px}.wb-collab-list-head{display:flex;align-items:center;justify-content:space-between;padding:7px 7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}.wb-collab-list-head>span{font-size:10px;color:var(--dsw-alias-label-tertiary)}.wb-collab-row{width:100%;display:block;margin-top:5px;padding:10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}.wb-collab-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.wb-collab-row-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill)}.wb-collab-row strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.wb-collab-row>span{display:flex;justify-content:space-between;gap:6px;margin-top:5px}.wb-collab-row small{font-size:9px;color:var(--dsw-alias-label-tertiary)}.wb-collab-empty{padding:28px 14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px}",
      ".wb-collab-main{min-height:540px;padding:16px}.wb-collab-title{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.wb-collab-title h3{margin:7px 0 3px;font-size:18px;color:var(--dsw-alias-label-primary)}.wb-collab-title p{margin:0;max-width:720px;font-size:10px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}.wb-collab-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:15px 0}.wb-collab-steps>div{position:relative;display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary)}.wb-collab-steps>div:after{content:'';position:absolute;left:27px;right:5px;top:10px;height:1px;background:var(--dsw-alias-border-l2)}.wb-collab-steps>div:last-child:after{display:none}.wb-collab-steps span{z-index:1;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);font-size:9px}.wb-collab-steps small{z-index:1;padding-right:5px;background:var(--dsw-alias-bg-layer-1);font-size:9px}.wb-collab-steps .wb-collab-step-active{color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}.wb-collab-steps .wb-collab-step-active span{border-color:currentColor;background:color-mix(in srgb,currentColor 12%,var(--dsw-alias-bg-layer-1))}.wb-collab-tabs{display:flex;gap:16px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wb-collab-tabs button{height:34px;padding:0 2px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:11px inherit;cursor:pointer}.wb-collab-tabs .wb-collab-tab-active{border-bottom-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));color:var(--dsw-alias-label-primary);font-weight:650}",
      ".wb-collab-agent{margin-top:9px;padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}.wb-collab-agent-main{border-color:color-mix(in srgb,var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill)) 28%,var(--dsw-alias-border-l1))}.wb-collab-agent>p{margin:8px 0 0;font-size:10px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}.wb-collab-agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px}.wb-agent-model{display:flex;flex-direction:column;gap:3px;margin-top:9px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1)}.wb-agent-model select{width:100%;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:9px inherit}.wb-agent-model small{font-size:8px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}.wb-collab-delivery{padding-top:10px}.wb-collab-history{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:10px}.wb-collab-history>section{padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}.wb-collab-history h4{margin:0 0 7px;font-size:11px;color:var(--dsw-alias-label-primary)}.wb-collab-history-row{display:grid;grid-template-columns:34px 1fr;gap:7px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:9px;color:var(--dsw-alias-label-secondary)}.wb-collab-history-row:last-child{border-bottom:none}.wb-collab-history-row p{margin:3px 0 0;line-height:1.45}.wb-collab-history-row small{color:var(--dsw-alias-label-tertiary)}",
      ".wb-collab-decision{position:sticky;top:0;display:flex;flex-direction:column;gap:9px;padding:10px}.wb-collab-decision .wb-orch-runtime{min-width:0}.wb-collab-decision-card{display:flex;flex-direction:column;gap:7px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.wb-collab-decision-card>strong{font-size:11px;color:var(--dsw-alias-label-primary)}.wb-collab-decision-card>small{font-size:9px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.wb-collab-decision-card select{height:31px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:10px inherit}.wb-collab-decision-card textarea{min-height:108px;box-sizing:border-box;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:10px/1.5 inherit;resize:vertical}.wb-collab-actions{display:flex;flex-direction:column;gap:6px}.wb-collab-actions .wb-sp-btn{width:100%}",
      ".wb-task-detail{flex:0 0 390px;min-width:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);animation:wb-task-detail-in .16s ease-out}",
      "@keyframes wb-task-detail-in{from{transform:translateX(18px);opacity:.5}to{transform:none;opacity:1}}",
      ".wb-task-detail-head{display:flex;align-items:center;justify-content:space-between;min-height:62px;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".wb-task-detail-head strong{font-size:14px;color:var(--dsw-alias-label-primary)}",
      ".wb-task-detail-body{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:13px}",
      ".wb-task-field{display:flex;flex-direction:column;gap:5px}",
      ".wb-task-field label{font-size:10px;font-weight:650;color:var(--dsw-alias-label-tertiary)}",
      ".wb-task-field input,.wb-task-field select,.wb-task-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px/1.5 inherit;outline:none}",
      ".wb-task-field input,.wb-task-field select{height:34px;padding:0 9px}.wb-task-field textarea{min-height:110px;padding:9px;resize:vertical}",
      ".wb-task-field input:focus,.wb-task-field select:focus,.wb-task-field textarea:focus{border-color:var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill))}",
      ".wb-task-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".wb-task-detail-actions{display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1)}",
      ".wb-task-detail-actions .wb-sp-btn-primary{flex:1}",
      ".wb-task-empty-state{padding:28px 16px;text-align:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".wb-import-overlay{position:fixed;inset:0;z-index:180;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.26);backdrop-filter:blur(4px)}",
      ".wb-import-dialog{width:min(520px,calc(100vw - 40px));padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 20px 70px rgba(0,0,0,.3)}",
      ".wb-import-dialog h3{margin:0;font-size:17px;color:var(--dsw-alias-label-primary)}",
      ".wb-import-dialog>p{margin:6px 0 14px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
      ".wb-import-name{width:100%;height:36px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px inherit;outline:none}",
      ".wb-import-options{display:flex;flex-direction:column;gap:7px;margin-top:12px}",
      ".wb-import-option{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;text-align:left;color:var(--dsw-alias-label-primary)}",
      ".wb-import-option:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-import-option-icon{width:32px;height:32px;border-radius:9px;background:var(--dsw-alias-button-elevated-fill);display:flex;align-items:center;justify-content:center;font-size:15px}",
      ".wb-import-option strong{display:block;font-size:12px}.wb-import-option small{display:block;margin-top:2px;font-size:10px;line-height:1.45;color:var(--dsw-alias-label-secondary)}",
      ".wb-import-cancel{display:flex;justify-content:flex-end;margin-top:12px}",
      ".wb-task-quick button:focus-visible,.wb-task-center-shell button:focus-visible,.wb-task-center-shell input:focus-visible,.wb-task-center-shell select:focus-visible,.wb-task-center-shell textarea:focus-visible{outline:2px solid var(--dsw-alias-accent-fill,var(--dsw-alias-button-primary-fill));outline-offset:2px}",
      "@media(prefers-reduced-motion:reduce){.wb-task-center-shell,.wb-task-detail{animation:none}.wb-task-center-card,.wb-tb-progress-fill{transition:none}}",
      "@media(max-width:1250px){.wb-collab-grid{grid-template-columns:230px minmax(430px,1fr)}.wb-collab-decision{position:static;grid-column:2}.wb-idea-fields{grid-template-columns:1fr 90px 90px}}",
      "@media(max-width:1100px){.wb-task-center-shell{inset:8px}.wb-task-center-brand{min-width:auto}.wb-task-center-brand span{display:none}.wb-task-center-search{width:150px}.wb-task-view-head{align-items:flex-start}.wb-task-create{flex-wrap:wrap;justify-content:flex-end}.wb-task-scope{min-width:240px}.wb-task-create input{width:240px}.wb-task-today-grid{grid-template-columns:1fr}.wb-task-review-stats{grid-template-columns:repeat(2,1fr)}.wb-task-detail{flex-basis:340px}.wb-orch-hero{grid-template-columns:1fr}.wb-orch-runtime{min-width:0}.wb-idea-capture{grid-template-columns:1fr}.wb-idea-workspace{grid-template-columns:260px minmax(0,1fr)}}",
      "@media(max-width:820px){.wb-task-center-head{gap:6px;padding:0 9px}.wb-task-center-brand{display:none}.wb-task-center-search{width:110px}.wb-task-center-body{padding:10px}.wb-task-view-head{display:block}.wb-task-create{justify-content:flex-start;margin-top:8px}.wb-task-scope{min-width:210px}.wb-idea-workspace,.wb-collab-grid{grid-template-columns:1fr}.wb-collab-list{position:static;max-height:240px}.wb-collab-decision{grid-column:auto}.wb-idea-fields,.wb-collab-history{grid-template-columns:1fr}.wb-idea-capture-box{align-items:stretch;flex-direction:column}}",
      // ---- file view / git graph (P2) ----
      ".wb-fs-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;font-size:12px}",
      ".wb-fs-sep{color:var(--dsw-alias-label-tertiary);padding:0 2px}",
      ".wb-fs-crumb{background:none;border:none;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;padding:2px 4px;border-radius:4px}",
      ".wb-fs-crumb:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-fs-list{display:flex;flex-direction:column;gap:1px;margin-top:4px}",
      ".wb-fs-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:12px;color:var(--dsw-alias-label-primary);text-align:left}",
      ".wb-fs-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".wb-fs-icon{flex:none}",
      ".wb-fs-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wb-fs-size{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".wb-fs-editor{display:flex;flex-direction:column;gap:8px;margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}",
      ".wb-fs-editor-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".wb-fs-editor textarea{width:100%;min-height:240px;resize:vertical;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;font:12px/1.6 ui-monospace,Consolas,monospace;box-sizing:border-box}",
      ".wb-fs-saved{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".wb-git-text{font:11px/1.6 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-primary);white-space:pre;overflow:auto;word-break:keep-all;margin:0}",
      // ---- experts page (P2) ----
      ".wb-exp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:20px}",
      ".wb-exp-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;transition:border-color .15s ease,box-shadow .15s ease}",
      ".wb-exp-card:hover{border-color:var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv1)}",
      ".wb-exp-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".wb-exp-name{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".wb-exp-badge{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}",
      ".wb-exp-badge-danger{color:#ff453a;border-color:#ff453a}",
      ".wb-exp-desc{flex:1;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7;min-height:0}",
      ".wb-exp-actions{display:flex;gap:8px}",
      ".wb-exp-actions .wb-sp-btn{flex:1;padding:0 4px}",
      ".wb-exp-error{color:#ff453a;font-size:12px}",
      // ---- edit modal (left YAML + right AI chat) ----
      ".wb-exp-modal{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:24px}",
      ".wb-exp-modal-box{width:min(1100px,96vw);max-height:88vh;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}",
      ".wb-exp-modal-head{display:flex;align-items:center;justify-content:space-between}",
      ".wb-exp-modal-body{flex:1;min-height:0;display:flex;gap:14px}",
      ".wb-exp-left{flex:1.2;min-width:0;display:flex;flex-direction:column;gap:6px;overflow:auto}",
      ".wb-exp-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
      ".wb-exp-textarea{width:100%;min-height:260px;resize:vertical;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;font:12px/1.6 ui-monospace,Consolas,monospace;box-sizing:border-box}",
      ".wb-exp-textarea-sm{min-height:100px}",
      ".wb-exp-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px}",
      ".wb-exp-right{flex:1;min-width:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1);padding-left:14px;min-height:0}",
      ".wb-exp-chat-title{flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px}",
      ".wb-exp-chat-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:10px}",
      ".wb-exp-empty{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.8;white-space:pre-line;padding:8px 4px}",
      ".wb-exp-msg{max-width:92%;padding:8px 10px;border-radius:10px;position:relative}",
      ".wb-exp-msg pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,Consolas,monospace;margin:0;font-family:inherit}",
      ".wb-exp-msg-user{align-self:flex-end;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}",
      ".wb-exp-msg-ai{align-self:flex-start;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}",
      ".wb-exp-msg-ai:hover .wb-exp-msg-copy{opacity:1}",
      ".wb-exp-msg-copy{position:absolute;top:-8px;right:6px;opacity:0;transition:opacity .15s;font-size:10px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit}",
      ".wb-exp-chat-input{flex:none;display:flex;gap:8px;align-items:flex-end}",
      ".wb-exp-chat-input textarea{flex:1;min-width:0;height:60px;resize:vertical;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;font:12px/1.5 inherit;box-sizing:border-box;font-family:inherit}",
    ].join("\n");

    var WB_CSS_TAG = "dsh-workbench/workbench.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(WB_CSS_TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-workbench";
      tag.dataset.pluginCss = WB_CSS_TAG;
      tag.textContent = WB_CSS;
      document.head.appendChild(tag);
    }

    var PAGES = [
      { id: "agent", label: "Agent 工作区", icon: primitives.IconNewChatOutline16, group: "core" },
      { id: "kb", label: "知识库", icon: primitives.IconFolderOpenOutline16, group: "assets" },
      { id: "experts", label: "专家", icon: primitives.IconAgentPresetOutline16, group: "assets" },
      { id: "workflows", label: "工作流", icon: primitives.IconBranchOutline16, group: "assets" },
      { id: "style", label: "风格", icon: primitives.IconPersonalizationOutline16, group: "system" },
      { id: "monitor", label: "监控", icon: primitives.IconDataOutline16, group: "system" }
    ];

    var PAGE_META = {
      kb: { title: "知识库（第二大脑）", desc: "自生长的本地知识库：项目对话、学习笔记自动沉淀，规模起来后反哺工作。方案待与用户深入讨论（P6）。" },
      experts: { title: "专家", desc: "切换 Agent 的对话风格与专长。每位专家 = 一套预设（人格 + 工具 + 专属技能）。首批：健身专家、AI 产品架构师（P2）。" },
      style: { title: "风格", desc: "工作台外貌：主题模式、强调色、壁纸透明度、字体密度、风格预设，以及可叠加在专家上的「对话风格」层（P3）。" },
      monitor: { title: "监控", desc: "账户总览、用量统计、会话洞察、实时面板与页面内告警（P4）。" },
      workflows: { title: "工作流", desc: "把重复性多步骤任务固化成模板：日报汇总、会议纪要、调研写作流水线……一键运行 + 定时调度（P5）。" }
    };

    function normPath(p) {
      return typeof p === "string" ? p.replace(/[\\/]+$/, "").toLowerCase() : "";
    }

    function fmtTime(v) {
      if (!v) return "";
      const ms = typeof v === "string" ? Date.parse(v) : v;
      if (!ms) return "";
      const diff = Date.now() - ms;
      const min = Math.floor(diff / 60000);
      if (min < 1) return "刚刚";
      if (min < 60) return min + " 分钟前";
      const hr = Math.floor(min / 60);
      if (hr < 24) return hr + " 小时前";
      const d = Math.floor(hr / 24);
      if (d < 7) return d + " 天前";
      const dt = new Date(ms);
      return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    }

    function statusOf(s) {
      if (s.pendingInteraction) return { label: "待处理", cls: "wb-st-inter" };
      if (s.running) return { label: "运行中", cls: "wb-st-run" };
      return { label: "待命", cls: "wb-st-idle" };
    }

    // ---- global error surface: event-handler errors would otherwise be silent ----
    (function installErrorSurface() {
      if (typeof document === "undefined" || typeof window === "undefined") return;
      if (window.__DSH_WB_ERR_GUARD__) return;
      window.__DSH_WB_ERR_GUARD__ = true;
      function show(msg) {
        try {
          var text = "[dsh-workbench] " + msg + "\n(点击复制后可粘贴给开发者；关闭按钮清除本条)";
          let el = document.getElementById("wb-error-surface");
          if (!el) {
            el = document.createElement("div");
            el.id = "wb-error-surface";
            el.style.cssText = "position:fixed;left:8px;bottom:8px;right:8px;z-index:2147483000;max-height:40vh;overflow:auto;padding:10px 14px;background:#2a0a0a;color:#ff6b6b;border:1px solid #ff453a;border-radius:10px;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none";
            document.body.appendChild(el);
          }
          el.textContent = "";
          var row = document.createElement("div");
          row.style.cssText = "display:flex;gap:10px;align-items:flex-start";
          var textEl = document.createElement("span");
          textEl.style.cssText = "flex:1;min-width:0;white-space:pre-wrap";
          textEl.textContent = text;
          var copyBtn = document.createElement("button");
          copyBtn.textContent = "复制错误";
          copyBtn.style.cssText = "pointer-events:auto;flex:none;padding:3px 8px;cursor:pointer;font:12px sans-serif;background:#3a1212;color:#ff8b8b;border:1px solid #ff453a;border-radius:6px";
          copyBtn.onclick = function () { wbCopyText(text).then(function () { copyBtn.textContent = "已复制"; setTimeout(function () { copyBtn.textContent = "复制错误"; }, 1200); }); };
          var closeBtn = document.createElement("button");
          closeBtn.textContent = "关闭";
          closeBtn.style.cssText = "pointer-events:auto;flex:none;padding:3px 8px;cursor:pointer;font:12px sans-serif;background:transparent;color:#ff8b8b;border:1px solid #ff453a;border-radius:6px";
          closeBtn.onclick = function () { el.remove(); };
          row.appendChild(textEl);
          row.appendChild(copyBtn);
          row.appendChild(closeBtn);
          el.appendChild(row);
        } catch (e) {}
      }
      window.addEventListener("error", function (e) { show(String((e.error && e.error.stack) || e.message || e)); });
      window.addEventListener("unhandledrejection", function (e) { show("unhandledrejection: " + String((e.reason && e.reason.stack) || e.reason)); });
    })();

    // ---- custom session panel ----
    function SessionPanel({ useSessions, useWorkspaces, onClose }) {
      const sessions = useSessions((s) => s);
      const workspaces = useWorkspaces((s) => s);
      const [wsId, setWsId] = React.useState(() => { try { return localStorage.getItem("wb.ws") || ""; } catch (e) { return ""; } });
      const [addingWs, setAddingWs] = React.useState(false);
      const [wsPath, setWsPath] = React.useState("");
      const wsPickerRef = React.useRef(null);
      const [dualWarn, setDualWarn] = React.useState("");
      const [menuId, setMenuId] = React.useState(null);
      const [renamingId, setRenamingId] = React.useState(null);
      const [renameText, setRenameText] = React.useState("");
      const [pinned, setPinned] = React.useState(() => { try { const raw = JSON.parse(localStorage.getItem("wb.pinned") || "[]"); return Array.isArray(raw) ? raw : []; } catch (e) { return []; } });

      const wsItems = workspaces.items || [];
      const currentSession = sessions.current ? sessions.byId[sessions.current] : void 0;
      const defaultWs = wsItems.find((w) => normPath(w.path) === normPath(currentSession && currentSession.cwd)) || wsItems[0];
      const activeWs = wsItems.find((w) => w.workspaceId === wsId) || defaultWs || null;
      const ideaProjectPath = activeWs && activeWs.path ? activeWs.path : (currentSession && currentSession.cwd ? currentSession.cwd : "");
      const ideaStore = useWorkbenchTasks(sessions.current, ideaProjectPath);
      const [ideaDraft, setIdeaDraft] = React.useState("");
      const [ideaNotice, setIdeaNotice] = React.useState("");
      const activeIdeas = wbTasksForScope(ideaStore.ideas, ideaProjectPath, ideaProjectPath ? "current" : "global").filter((item) => item.status !== "promoted" && item.status !== "archived").sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

      const wsSessions = (sessions.ids || []).map((id) => sessions.byId[id]).filter((s) => {
        return s && !s.blank && activeWs !== null && normPath(s.cwd) === normPath(activeWs.path);
      }).sort((a, b) => {
        const pa = pinned.includes(a.id) ? 0 : 1;
        const pb = pinned.includes(b.id) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

      const selectWs = (id) => { try { setWsId(id); localStorage.setItem("wb.ws", id); } catch (e) { /* keep previous state */ } };
      const persistPinned = (ids) => { try { localStorage.setItem("wb.pinned", JSON.stringify(ids)); } catch (e) {} };
      const togglePin = (id) => { const next = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id]; setPinned(next); persistPinned(next); setMenuId(null); };
      const openSession = (id) => {
        try {
          const inst = wbSessionOf(id);
          if (inst && (inst.running || inst.pendingInteraction)) {
            setDualWarn("该会话当前处于运行/待交互状态，可能同时在其他客户端打开；请确认没有重复使用同一会话，以免操作冲突。");
          } else {
            setDualWarn("");
          }
          if (WB_SVC.sessions) WB_SVC.sessions.open(id);
        } catch (e) { /* noop */ }
      };
      const newSession = () => {
        try {
          if (WB_SVC.workspaces && activeWs) {
            WB_SVC.workspaces.connectWorkspace(activeWs.workspaceId).then((sid) => {
              if (sid && WB_SVC.sessions) WB_SVC.sessions.open(sid);
            }).catch(() => {});
          }
        } catch (e) { /* noop */ }
      };
      const createWs = () => {
        const p = wsPath.trim();
        if (!p || !WB_SVC.workspaces) return;
        WB_SVC.workspaces.create({ path: p }).then(() => {
          setAddingWs(false);
          setWsPath("");
        }).catch((e) => { console.error("[dsh-workbench] create workspace failed", e); });
      };
      const pickWsFolder = () => { if (wsPickerRef.current) wsPickerRef.current.click(); };
      const onWsPicked = (e) => {
        const files = Array.prototype.slice.call((e.target && e.target.files) || []);
        const first = files[0];
        if (e.target) e.target.value = "";
        if (!first) return;
        let folder = "";
        try {
          const filePath = String(first.path || (window.webUtils && typeof window.webUtils.getPathForFile === "function" ? window.webUtils.getPathForFile(first) : "") || "");
          const rel = String(first.webkitRelativePath || "");
          if (filePath && rel) {
            const prefixLength = filePath.length - rel.length;
            folder = prefixLength > 0 ? filePath.slice(0, prefixLength) : "";
          } else if (filePath) {
            folder = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
          }
        } catch (err) { folder = ""; }
        if (!folder) {
          try { window.alert("无法从当前环境读取文件夹绝对路径，请手动输入路径。"); } catch (err) {}
          return;
        }
        setWsPath(folder);
      };
      const startRename = (id) => { setRenamingId(id); setRenameText(sessions.byId[id]?.title || sessions.byId[id]?.displayTitle || ""); setMenuId(null); };
      const commitRename = (id) => {
        const t = renameText.trim();
        if (t && WB_SVC.sessions) { const inst = wbSessionOf(id); if (inst && inst.rename) inst.rename(t); }
        setRenamingId(null);
      };
      const archiveSession = (id) => { if (WB_SVC.workspaces) WB_SVC.workspaces.archiveSession(id); setMenuId(null); };
      const openIdeas = () => window.dispatchEvent(new CustomEvent("wb:open-task-center", { detail: { view: "ideas" } }));
      const captureIdea = () => {
        const value = ideaDraft.trim();
        if (!value) return;
        ideaStore.mutate("idea_create", { title: value.split(/\r?\n/)[0].slice(0, 120), body: value, projectPath: ideaProjectPath }).then(() => {
          setIdeaDraft(""); setIdeaNotice("已存入想法库"); window.setTimeout(() => setIdeaNotice(""), 2200);
          try { window.dispatchEvent(new CustomEvent("wb:tasks-changed")); } catch (e) { /* noop */ }
        }).catch(() => {});
      };

      return jsxRuntime.jsxs("div", { className: "wb-sp", children: [
        jsxRuntime.jsxs("div", { className: "wb-sp-head", children: [
          jsxRuntime.jsxs("div", { className: "wb-sp-wsrow", children: [
            jsxRuntime.jsxs("select", { className: "wb-sp-select", value: activeWs ? activeWs.workspaceId : "", onChange: (e) => selectWs(e.target.value), title: "项目切换", children: [
              (wsItems.length === 0) && jsxRuntime.jsx("option", { value: "", children: "（无项目）" }),
              wsItems.map((w) => jsxRuntime.jsx("option", { value: w.workspaceId, children: w.title || w.path }, w.workspaceId))
            ] }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", title: "新建会话", onClick: newSession, children: jsxRuntime.jsx(primitives.IconPlusOutline16, { size: 14 }) }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", title: "创建新项目", onClick: () => setAddingWs((v) => !v), children: jsxRuntime.jsx(primitives.IconProjectAddOutline16, { size: 14 }) }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-close", title: "收起会话面板", onClick: onClose, children: jsxRuntime.jsx(primitives.IconChevronLeftOutline14, { size: 14 }) })
          ] }),
          dualWarn && jsxRuntime.jsx("div", { className: "wb-sp-dualwarn", role: "status", children: dualWarn }),
          addingWs && jsxRuntime.jsxs("div", { className: "wb-sp-newform", children: [
            jsxRuntime.jsx("input", { className: "wb-sp-input", placeholder: "项目文件夹路径，如 D:\\我的项目", value: wsPath, onChange: (e) => setWsPath(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") createWs(); } }),
            jsxRuntime.jsx("input", { ref: wsPickerRef, type: "file", webkitdirectory: "", multiple: "", style: { display: "none" }, onChange: onWsPicked }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: pickWsFolder, children: "浏览…" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", onClick: createWs, children: "创建项目" })
          ] })
        ] }),
        jsxRuntime.jsxs("section", { className: "wb-sp-capture", children: [
          jsxRuntime.jsxs("div", { className: "wb-sp-capture-head", children: [jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("strong", { children: "临时想法" }), activeIdeas.length > 0 && jsxRuntime.jsx("span", { children: " · " + activeIdeas.length })] }), jsxRuntime.jsx("button", { type: "button", onClick: openIdeas, children: "打开想法库" })] }),
          jsxRuntime.jsx("textarea", { value: ideaDraft, placeholder: "先记下来，稍后再整理…", onChange: (e) => setIdeaDraft(e.target.value), onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") captureIdea(); } }),
          jsxRuntime.jsxs("div", { className: "wb-sp-capture-actions", children: [jsxRuntime.jsx("small", { title: ideaProjectPath || "全局想法", children: ideaProjectPath ? wbProjectLabel(ideaProjectPath) : "全局想法" }), jsxRuntime.jsx("button", { type: "button", disabled: ideaStore.busy || !ideaDraft.trim(), onClick: captureIdea, children: "存入" })] }),
          ideaNotice && jsxRuntime.jsx("div", { className: "wb-sp-capture-note", children: ideaNotice }),
          activeIdeas.length > 0 && jsxRuntime.jsx("div", { className: "wb-sp-idea-list", children: activeIdeas.slice(0, 2).map((idea) => jsxRuntime.jsx("button", { type: "button", className: "wb-sp-idea", title: idea.title, onClick: openIdeas, children: jsxRuntime.jsx("span", { children: idea.title }) }, idea.id)) })
        ] }),
        jsxRuntime.jsx("div", { className: "wb-sp-list", children: wsSessions.length === 0
          ? jsxRuntime.jsx("div", { className: "wb-sp-empty", children: activeWs ? "该项目还没有会话" : "请先选择或创建项目。" })
          : wsSessions.map((s) => {
            const st = statusOf(s);
            const active = s.id === sessions.current;
            const renaming = renamingId === s.id;
            return jsxRuntime.jsxs("div", {
              className: "wb-sp-row" + (active ? " wb-sp-row-active" : ""),
              onClick: () => openSession(s.id),
              children: [
                jsxRuntime.jsx("span", { className: "wb-sp-dot " + st.cls, title: st.label }),
                pinned.includes(s.id) && jsxRuntime.jsx("span", { className: "wb-sp-pin", title: "已置顶", children: "★" }),
                renaming
                  ? jsxRuntime.jsxs("span", { className: "wb-sp-renaming", onClick: (e) => e.stopPropagation(), children: [
                      jsxRuntime.jsx("input", { className: "wb-sp-input", autoFocus: true, value: renameText, onChange: (e) => setRenameText(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") commitRename(s.id); if (e.key === "Escape") setRenamingId(null); } }),
                      jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: () => commitRename(s.id), children: "保存" })
                    ] })
                  : jsxRuntime.jsxs("span", { className: "wb-sp-main", children: [
                      jsxRuntime.jsx("span", { className: "wb-sp-title", children: s.displayTitle || s.id }),
                      jsxRuntime.jsxs("span", { className: "wb-sp-meta", children: [
                        jsxRuntime.jsx("span", { children: st.label }),
                        jsxRuntime.jsx("span", { children: "·" }),
                        jsxRuntime.jsx("span", { children: fmtTime(s.updatedAt) })
                      ] })
                    ] }),
                jsxRuntime.jsx("button", { type: "button", className: "wb-sp-menu", title: "更多", onClick: (e) => { e.stopPropagation(); setMenuId(menuId === s.id ? null : s.id); }, children: jsxRuntime.jsx(primitives.IconEllipsisOutline16, { size: 14 }) }),
                menuId === s.id && jsxRuntime.jsxs("div", { className: "wb-sp-pop", onClick: (e) => e.stopPropagation(), children: [
                  jsxRuntime.jsx("button", { type: "button", className: "wb-sp-pop-item", onClick: () => startRename(s.id), children: "重命名" }),
                  jsxRuntime.jsx("button", { type: "button", className: "wb-sp-pop-item", onClick: () => togglePin(s.id), children: pinned.includes(s.id) ? "取消置顶" : "置顶" }),
                  jsxRuntime.jsx("button", { type: "button", className: "wb-sp-pop-item", onClick: () => archiveSession(s.id), children: "归档" })
                ] })
              ]
            }, s.id);
          }) })
      ] });
    }

    // =====================================================================
    // Right toolbar (P1): current-session tools only — 详细信息 / Git图谱 /
    // 文件视图 / 蒸馏. Task center lives in the global rail; idea capture lives
    // in the project/session column so it follows the selected project context.
    // Data: session status + expert from preset read; git/files
    // need host services (P2) and show design placeholders for now.
    // =====================================================================
    var WB_TB_TABS = [
      { id: "info", label: "详细信息" },
      { id: "git", label: "Git图谱" },
      { id: "files", label: "文件视图" },
      { id: "distill", label: "蒸馏" }
    ];

    // Extract enabled tool rows from a preset composition YAML: {id, name, config}.
    function parsePresetTools(content) {
      const tools = [];
      const lines = String(content || "").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*-\s*id:\s*(tool-[\w.-]+)/);
        if (!m) continue;
        let disabled = false;
        let name = "";
        const config = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 14); j++) {
          const raw = lines[j];
          const t = raw.trim();
          if (/^disabled:\s*(true|!!js\s+true)/.test(t)) { disabled = true; break; }
          if (/^-\s/.test(t) || (t.length > 0 && !/^\s/.test(raw) && !/^#/.test(t))) break;
          if (/^name:\s*/.test(t)) name = t.replace(/^name:\s*/, "").replace(/['"]/g, "").trim();
          else if (/^[A-Za-z0-9_.-]+:\s*\S/.test(t) && !/^#/.test(t)) config.push(t);
        }
        if (!disabled) tools.push({ id: m[1], name, config: config.slice(0, 6).join(" ") });
      }
      return tools;
    }

    // Per-session projection reader for our root-level toolbar (useProjection is
    // only injected into session-scope slot components; we bind the same store
    // through the Session instance's public `projections` face). Kept defensive:
    // nothing here may throw during render, and subscribe/getSnapshot keep
    // stable identities so useSyncExternalStore never re-subscribes in a loop.
    // NOTE: SessionRuntime exposes `binding(id)` (→ { session }), NOT `.get()`.
    function wbSessionOf(sessionId) {
      try {
        if (!sessionId || !WB_SVC.sessions) return null;
        const binding = WB_SVC.sessions.binding(sessionId);
        return (binding && binding.session) || null;
      } catch (e) { return null; }
    }
    function useProjectionValue(sessionId, key) {
      const face = React.useMemo(() => {
        try {
          const inst = wbSessionOf(sessionId);
          return inst && inst.projections ? inst.projections.faceOf(key) : null;
        } catch (e) { return null; }
      }, [sessionId, key]);
      const subscribe = React.useCallback((cb) => {
        try { return face ? face.subscribe(cb) : () => {}; } catch (e) { return () => {}; }
      }, [face]);
      const getSnapshot = React.useCallback(() => {
        try { return face ? face.getSnapshot() : void 0; } catch (e) { return void 0; }
      }, [face]);
      return React.useSyncExternalStore(subscribe, getSnapshot);
    }

    function ToolToolRow({ tool }) {
      const [open, setOpen] = React.useState(false);
      return jsxRuntime.jsxs("div", { className: "wb-tb-tool" + (open ? " wb-tb-tool-open" : ""), children: [
        jsxRuntime.jsx("button", { type: "button", className: "wb-tb-tool-row", onClick: () => setOpen((v) => !v), title: "点击展开/收起", children: [
          jsxRuntime.jsx("span", { className: "wb-tb-tool-caret", children: jsxRuntime.jsx(primitives.IconChevronRightOutline14, { size: 12 }) }),
          jsxRuntime.jsx("span", { className: "wb-tb-tool-name", children: tool.id.replace(/^tool-/, "") }),
          jsxRuntime.jsx("span", { className: "wb-tb-tool-id", children: tool.id })
        ] }),
        open && jsxRuntime.jsx("div", { className: "wb-tb-tool-detail", children: [
          tool.name && jsxRuntime.jsx("div", { children: "模块：" + tool.name }),
          tool.config ? jsxRuntime.jsx("div", { children: "配置：" + tool.config }) : jsxRuntime.jsx("div", { children: "（无额外配置）" }),
          jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "完整说明待 P2 host 工具元数据接入后补充。" })
        ] })
      ] });
    }

    // 详细信息: session status + expert + expandable tool list.
    function ToolbarInfo({ summary, preset, st }) {
      const tools = preset && preset.content ? parsePresetTools(preset.content) : [];
      return jsxRuntime.jsxs(React.Fragment, { children: [
        jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsx("div", { className: "wb-tb-card-title", children: "会话状态" }),
          !summary || !st ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "当前没有打开的会话" }) : jsxRuntime.jsxs(React.Fragment, { children: [
            jsxRuntime.jsxs("div", { className: "wb-tb-status", children: [
              jsxRuntime.jsx("span", { className: "wb-sp-dot " + st.cls, title: st.label }),
              jsxRuntime.jsx("span", { children: st.label })
            ] }),
            jsxRuntime.jsx("div", { className: "wb-tb-session-title", children: summary.displayTitle || summary.id }),
            jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "工作目录：" + (summary.cwd || "—") }),
            jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "更新于：" + fmtTime(summary.updatedAt) })
          ] })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsx("div", { className: "wb-tb-card-title", children: "专家" }),
          !summary ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "—" }) : jsxRuntime.jsxs(React.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "wb-tb-session-title", children: (preset && preset.name) || summary.agentPreset || "默认" }),
            preset && preset.description ? jsxRuntime.jsx("div", { className: "wb-tb-meta", children: preset.description }) : null
          ] })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsx("div", { className: "wb-tb-card-title", children: "可用工具（" + tools.length + "）" }),
          tools.length === 0 ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "暂无工具信息" }) : jsxRuntime.jsx("div", { className: "wb-tb-tools", children: tools.map((t) => jsxRuntime.jsx(ToolToolRow, { tool: t }, t.id)) })
        ] })
      ] });
    }

    // 任务看板 (v2 kanban): goal card + 3-column board with drag/drop, add,
    // edit, remove, search, sort, progress — writes go through the host
    // `/todo` command (whole-list replace, same last-write-wins semantics as
    // the model's `todo_write` tool); goal mutations use the native goals
    // remote verbs (edit/pause/resume/clear).
    var GOAL_PHASE_LABEL = { active: "进行中", paused: "已暂停", completed: "已完成", blocked: "受阻" };
    var TODO_COLUMNS = [
      { key: "pending", label: "待办" },
      { key: "in_progress", label: "进行中" },
      { key: "completed", label: "已完成" }
    ];
    var WB_TASK_COLUMNS = [
      { key: "inbox", label: "待整理" },
      { key: "pending", label: "待执行" },
      { key: "in_progress", label: "进行中" },
      { key: "blocked", label: "等待 / 阻塞" },
      { key: "completed", label: "已完成" }
    ];
    var WB_TASK_VIEWS = [
      { id: "today", label: "聚焦" },
      { id: "ideas", label: "想法库" },
      { id: "board", label: "任务" },
      { id: "orchestrate", label: "AI 协作" },
      { id: "list", label: "列表" },
      { id: "timeline", label: "时间线" },
      { id: "review", label: "复盘" },
      { id: "templates", label: "模板" }
    ];
    var WB_PRIMARY_VIEWS = [
      { id: "today", label: "聚焦" }, { id: "ideas", label: "想法库" }, { id: "tasks", label: "任务" },
      { id: "orchestrate", label: "AI 协作" }, { id: "review", label: "复盘" }
    ];
    var WB_TASK_SUBVIEWS = [
      { id: "board", label: "看板" }, { id: "list", label: "列表" }, { id: "timeline", label: "时间线" }, { id: "templates", label: "模板" }
    ];
    var WB_PRIORITY_LABEL = { low: "低", medium: "中", high: "高" };
    var WB_OWNER_LABEL = { human: "我", agent: "Agent", hybrid: "协作" };
    var WB_STATUS_LABEL = Object.fromEntries(WB_TASK_COLUMNS.map((item) => [item.key, item.label]));

    function wbTodayKey(value) {
      const date = value || new Date();
      return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    }
    function wbDateLabel(value) {
      if (!value) return "未安排";
      const day = String(value).slice(0, 10);
      const parts = day.split("-");
      if (parts.length !== 3) return value;
      return Number(parts[1]) + "月" + Number(parts[2]) + "日";
    }
    function wbTaskSort(a, b) {
      const rank = { high: 0, medium: 1, low: 2 };
      if (a.groupId && a.groupId === b.groupId) return (a.groupOrder || 0) - (b.groupOrder || 0);
      return (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || String(a.plannedFor || a.dueAt || "9999").localeCompare(String(b.plannedFor || b.dueAt || "9999")) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    }
    function wbTasksForScope(tasks, projectPath, scope) {
      const list = Array.isArray(tasks) ? tasks : [];
      if (scope === "all") return list;
      if (scope === "global") return list.filter((task) => !String(task.projectPath || "").trim());
      const key = String(projectPath || "").replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
      return list.filter((task) => String(task.projectPath || "").replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase() === key);
    }
    function wbProjectLabel(path) {
      const text = String(path || "").replace(/\\/g, "/").replace(/\/$/, "");
      return text ? text.split("/").pop() : "全局";
    }
    function wbFetchJson(url, options, timeoutMs) {
      const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
      const finalOptions = Object.assign({}, options || {}, controller ? { signal: controller.signal } : {});
      return fetch(url, finalOptions).then((response) => response.text().then((text) => {
        let data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (e) { throw new Error("响应不是有效 JSON（HTTP " + response.status + "）：" + String((e && e.message) || e)); }
        }
        if (!response.ok) throw new Error((data && (data.message || data.error)) || ("请求失败（HTTP " + response.status + "）" + (text ? "：" + String(text).slice(0, 300) : "")));
        return { ok: true, data };
      })).catch((e) => {
        if (controller && controller.signal.aborted) throw new Error("请求超时或连接中断（" + timeout + "ms）：" + String((e && e.message) || e));
        throw e;
      }).finally(() => { if (timer) clearTimeout(timer); });
    }
    function WbErrNote({ message }) {
      const text = String(message == null ? "" : message);
      if (!text) return null;
      return jsxRuntime.jsxs("div", { className: "wb-tb-err", style: { display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }, children: [
        jsxRuntime.jsx("span", { style: { flex: 1, minWidth: 0, whiteSpace: "pre-wrap" }, children: text }),
        jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", style: { flex: "none" }, onClick: (e) => { wbCopyText(text).then(() => { if (e.currentTarget) { e.currentTarget.textContent = "已复制"; setTimeout(() => { if (e.currentTarget) e.currentTarget.textContent = "复制"; }, 1200); } }); }, children: "复制" })
      ] });
    }

    function ToolbarTasks({ sessionId, projectPath, workspaceItems }) {
      const [mode, setMode] = React.useState(() => { try { return localStorage.getItem("wb.taskView") === "agent" ? "agent" : "focus"; } catch (e) { return "focus"; } });
      const [centerOpen, setCenterOpen] = React.useState(false);
      const [selectedId, setSelectedId] = React.useState(null);
      const store = useWorkbenchTasks(sessionId, projectPath);
      const selectMode = (next) => { setMode(next); try { localStorage.setItem("wb.taskView", next); } catch (e) {} };
      const openCenter = (task) => { setSelectedId(task && task.id ? task.id : null); setCenterOpen(true); };
      return jsxRuntime.jsxs(React.Fragment, { children: [
        jsxRuntime.jsxs("div", { className: "wb-task-switch", children: [
          jsxRuntime.jsx("button", { type: "button", className: mode === "focus" ? "wb-task-switch-active" : "", onClick: () => selectMode("focus"), children: "今日聚焦" }),
          jsxRuntime.jsx("button", { type: "button", className: mode === "agent" ? "wb-task-switch-active" : "", onClick: () => selectMode("agent"), children: "Agent 计划" })
        ] }),
        mode === "focus"
          ? jsxRuntime.jsx(WorkbenchFocusPanel, { store, onOpenCenter: openCenter })
          : jsxRuntime.jsx(AgentPlanTasks, { sessionId, projectPath, compact: true, onWorkbenchChanged: store.reload }),
        centerOpen && jsxRuntime.jsx(WorkbenchTaskCenter, { store, workspaceItems, selectedId, onSelectedId: setSelectedId, onClose: () => { setCenterOpen(false); setSelectedId(null); } })
      ] });
    }

    function useWorkbenchTasks(sessionId, projectPath) {
      const [tasks, setTasks] = React.useState([]);
      const [templates, setTemplates] = React.useState([]);
      const [ideas, setIdeas] = React.useState([]);
      const [orchestrations, setOrchestrations] = React.useState([]);
      const [orchestrationRuntime, setOrchestrationRuntime] = React.useState({ available: false, providers: [] });
      const [modelCatalog, setModelCatalog] = React.useState([]);
      const [loading, setLoading] = React.useState(true);
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState(null);
      const loadTasks = React.useCallback((silent) => {
        if (!silent) { setLoading(true); setErr(null); }
        wbFetchJson("/api/dsh-workbench/tasks/list?scope=all&projectPath=" + encodeURIComponent(projectPath || ""), null, 30000)
          .then(({ data }) => { setTasks(Array.isArray(data.tasks) ? data.tasks : []); setTemplates(Array.isArray(data.templates) ? data.templates : []); setIdeas(Array.isArray(data.ideas) ? data.ideas : []); setOrchestrations(Array.isArray(data.orchestrations) ? data.orchestrations : []); setOrchestrationRuntime(data.orchestrationRuntime || { available: false, providers: [] }); setModelCatalog(Array.isArray(data.modelCatalog) ? data.modelCatalog : []); })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => { if (!silent) setLoading(false); });
      }, [projectPath]);
      React.useEffect(() => { loadTasks(); }, [loadTasks]);

      const mutate = (action, extra) => {
        setBusy(true); setErr(null);
        return wbFetchJson("/api/dsh-workbench/tasks/mutate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, scope: "all", projectPath: projectPath || "", sourceSessionId: sessionId || "", ...(extra || {}) })
        }, 120000)
          .then(({ data }) => { setTasks(Array.isArray(data.tasks) ? data.tasks : []); setTemplates(Array.isArray(data.templates) ? data.templates : []); setIdeas(Array.isArray(data.ideas) ? data.ideas : []); setOrchestrations(Array.isArray(data.orchestrations) ? data.orchestrations : []); setOrchestrationRuntime(data.orchestrationRuntime || { available: false, providers: [] }); setModelCatalog(Array.isArray(data.modelCatalog) ? data.modelCatalog : []); return data; })
          .catch((e) => { setErr(String((e && e.message) || e)); throw e; })
          .finally(() => setBusy(false));
      };
      const reload = React.useCallback(() => loadTasks(false), [loadTasks]);
      const refresh = React.useCallback(() => loadTasks(true), [loadTasks]);
      return {
        tasks, templates, ideas, orchestrations, orchestrationRuntime, modelCatalog, loading, busy, err, setErr, projectPath, sessionId,
        reload,
        refresh,
        mutate,
        add: (title, extra) => mutate("add", { title, ...(extra || {}) }),
        update: (id, patch) => mutate("update", { id, patch }),
        remove: (id) => mutate("remove", { id })
      };
    }

    function WorkbenchFocusRow({ task, store, onOpen }) {
      const nextStatus = task.status === "completed" ? "pending" : (task.status === "in_progress" || task.status === "blocked") ? "completed" : "in_progress";
      const checkClass = task.status === "in_progress" ? " wb-focus-check-active" : task.status === "blocked" ? " wb-focus-check-blocked" : "";
      return jsxRuntime.jsxs("div", { className: "wb-focus-row", children: [
        jsxRuntime.jsx("button", { type: "button", className: "wb-focus-check" + checkClass, title: task.status === "completed" ? "恢复任务" : task.status === "pending" || task.status === "inbox" ? "开始任务" : "完成任务", onClick: () => store.update(task.id, { status: nextStatus }).catch(() => {}), children: task.status === "completed" ? "✓" : task.status === "blocked" ? "!" : task.status === "in_progress" ? "›" : "" }),
        jsxRuntime.jsxs("div", { className: "wb-focus-main", onClick: () => onOpen(task), children: [
          jsxRuntime.jsx("div", { className: "wb-focus-title", children: task.title }),
          jsxRuntime.jsxs("div", { className: "wb-focus-meta", children: [
            jsxRuntime.jsx("span", { className: "wb-priority-dot wb-priority-dot-" + task.priority }),
            jsxRuntime.jsx("span", { children: WB_PRIORITY_LABEL[task.priority] + "优先级" }),
            jsxRuntime.jsx("span", { children: WB_OWNER_LABEL[task.owner] || "我" }),
            (task.dueAt || task.plannedFor) && jsxRuntime.jsx("span", { children: wbDateLabel(task.dueAt || task.plannedFor) })
          ] })
        ] })
      ] });
    }

    function WorkbenchFocusPanel({ store, onOpenCenter }) {
      const [draft, setDraft] = React.useState("");
      const today = wbTodayKey();
      const currentTasks = wbTasksForScope(store.tasks, store.projectPath, "current");
      const active = currentTasks.filter((task) => task.status === "in_progress").sort(wbTaskSort);
      const blocked = currentTasks.filter((task) => task.status === "blocked").sort(wbTaskSort);
      const candidates = currentTasks.filter((task) => task.status === "pending" || task.status === "inbox").sort((a, b) => {
        const at = a.plannedFor === today ? -1 : 0;
        const bt = b.plannedFor === today ? -1 : 0;
        return at - bt || wbTaskSort(a, b);
      });
      const todayTasks = candidates.slice(0, 3);
      const remaining = currentTasks.filter((task) => task.status !== "completed").length;
      const add = () => {
        const title = draft.trim();
        if (!title) return;
        store.add(title, { priority: "medium", status: "inbox", owner: "human", plannedFor: today }).then(() => setDraft("")).catch(() => {});
      };
      const renderSection = (label, items, empty) => jsxRuntime.jsxs("div", { className: "wb-focus-card", children: [
        jsxRuntime.jsxs("div", { className: "wb-focus-section", children: [jsxRuntime.jsx("span", { className: "wb-focus-label", children: label }), jsxRuntime.jsx("span", { className: "wb-focus-count", children: items.length })] }),
        items.length ? items.map((task) => jsxRuntime.jsx(WorkbenchFocusRow, { task, store, onOpen: onOpenCenter }, task.id)) : jsxRuntime.jsx("div", { className: "wb-board-empty", children: empty })
      ] });
      return jsxRuntime.jsxs("div", { className: "wb-task-quick", children: [
        jsxRuntime.jsxs("div", { className: "wb-task-quick-head", children: [
          jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("div", { className: "wb-task-kicker", children: "WORKBENCH FLOW" }), jsxRuntime.jsx("div", { className: "wb-task-quick-title", children: "今天，" + wbDateLabel(today) })] }),
          jsxRuntime.jsx("span", { className: "wb-task-owner", children: store.projectPath ? "当前项目" : "全局" })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-task-quick-summary", children: [
          jsxRuntime.jsxs("div", { className: "wb-task-stat", children: [jsxRuntime.jsx("strong", { children: active.length }), jsxRuntime.jsx("span", { children: "进行中" })] }),
          jsxRuntime.jsxs("div", { className: "wb-task-stat", children: [jsxRuntime.jsx("strong", { children: blocked.length }), jsxRuntime.jsx("span", { children: "被阻塞" })] }),
          jsxRuntime.jsxs("div", { className: "wb-task-stat", children: [jsxRuntime.jsx("strong", { children: remaining }), jsxRuntime.jsx("span", { children: "未完成" })] })
        ] }),
        active.length > 2 && jsxRuntime.jsx("div", { className: "wb-tb-err", children: "当前同时进行 " + active.length + " 项，建议收束到 1–2 项。" }),
        renderSection("正在进行", active.slice(0, 3), "还没有正在执行的任务"),
        blocked.length > 0 && renderSection("等待处理", blocked.slice(0, 2), ""),
        renderSection("今日优先", todayTasks, "今日已经清空，可以从任务中心安排下一项"),
        jsxRuntime.jsxs("div", { className: "wb-task-quick-add", children: [
          jsxRuntime.jsx("input", { value: draft, placeholder: "快速记下任务…", onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") add(); } }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !draft.trim(), onClick: add, title: "添加到今日", children: jsxRuntime.jsx(primitives.IconPlusOutline16, { size: 12 }) })
        ] }),
        store.err && jsxRuntime.jsx(WbErrNote, { message: store.err }),
        jsxRuntime.jsx("button", { type: "button", className: "wb-task-expand", onClick: () => onOpenCenter(null), children: "展开任务中心" })
      ] });
    }

    function WorkbenchTaskCard({ task, store, onOpen }) {
      return jsxRuntime.jsxs("div", { className: "wb-task-center-card", draggable: true, onDragStart: (e) => e.dataTransfer.setData("text/plain", task.id), onClick: () => onOpen(task.id), children: [
        task.groupId && jsxRuntime.jsx("div", { className: "wb-task-card-group", title: task.groupTitle, children: (task.groupOrder + 1) + ". " + task.groupTitle }),
        jsxRuntime.jsx("div", { className: "wb-task-center-card-title", children: task.title }),
        jsxRuntime.jsxs("div", { className: "wb-task-center-card-meta", children: [
          jsxRuntime.jsx("span", { className: "wb-priority-dot wb-priority-dot-" + task.priority }),
          jsxRuntime.jsx("span", { children: WB_PRIORITY_LABEL[task.priority] + "优先级" }),
          jsxRuntime.jsx("span", { className: "wb-task-owner", children: WB_OWNER_LABEL[task.owner] || "我" }),
          jsxRuntime.jsx("span", { children: wbProjectLabel(task.projectPath) }),
          (task.dueAt || task.plannedFor) && jsxRuntime.jsx("span", { children: wbDateLabel(task.dueAt || task.plannedFor) })
        ] }),
        jsxRuntime.jsx("select", { className: "wb-task-card-status", value: task.status, title: "不拖拽也可以从这里切换状态", onClick: (e) => e.stopPropagation(), onChange: (e) => store.update(task.id, { status: e.target.value }).catch(() => {}), children: WB_TASK_COLUMNS.map((item) => jsxRuntime.jsx("option", { value: item.key, children: item.label }, item.key)) })
      ] });
    }

    function WorkbenchTaskDetail({ task, store, onClose }) {
      const [draft, setDraft] = React.useState(task);
      const agentTodos = useProjectionValue(store.sessionId, "todos") || [];
      React.useEffect(() => setDraft(task), [task]);
      const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
      const save = () => store.update(task.id, {
        title: draft.title, status: draft.status, priority: draft.priority, owner: draft.owner,
        notes: draft.notes, plannedFor: draft.plannedFor, startAt: draft.startAt, dueAt: draft.dueAt,
        durationMinutes: Number(draft.durationMinutes) || 0,
        labels: String(draft.labelsText === undefined ? (draft.labels || []).join(",") : draft.labelsText).split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        blockedReason: draft.blockedReason
      }).catch(() => {});
      const handoff = () => {
        const session = wbSessionOf(store.sessionId);
        if (!session || typeof session.command !== "function") { store.setErr("当前会话的 Agent 命令通道不可用"); return; }
        const current = Array.isArray(agentTodos) ? agentTodos : [];
        const title = String(draft.title || task.title).trim();
        const next = current.some((item) => item.content === title) ? current : [...current, { content: title, status: "pending" }];
        session.command("/todo replace " + JSON.stringify(next))
          .then((result) => {
            if (!result || result.ok === false || (result.value && result.value.matched === false)) throw new Error("Agent 计划写入失败");
            return store.update(task.id, { owner: "agent" });
          })
          .catch((error) => store.setErr(String((error && error.message) || error)));
      };
      const openSource = () => {
        try {
          if (task.sourceSessionId && WB_SVC.sessions && typeof WB_SVC.sessions.open === "function") WB_SVC.sessions.open(task.sourceSessionId);
        } catch (error) { store.setErr(String((error && error.message) || error)); }
      };
      return jsxRuntime.jsxs("aside", { className: "wb-task-detail", children: [
        jsxRuntime.jsxs("div", { className: "wb-task-detail-head", children: [jsxRuntime.jsx("strong", { children: "任务详情" }), jsxRuntime.jsx("button", { type: "button", className: "wb-task-center-close", onClick: onClose, children: "×" })] }),
        jsxRuntime.jsxs("div", { className: "wb-task-detail-body", children: [
          jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "任务标题" }), jsxRuntime.jsx("textarea", { style: { minHeight: 74 }, value: draft.title || "", onChange: (e) => field("title", e.target.value) })] }),
          jsxRuntime.jsxs("div", { className: "wb-task-field-grid", children: [
            jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "状态" }), jsxRuntime.jsx("select", { value: draft.status, onChange: (e) => field("status", e.target.value), children: WB_TASK_COLUMNS.map((item) => jsxRuntime.jsx("option", { value: item.key, children: item.label }, item.key)) })] }),
            jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "优先级" }), jsxRuntime.jsx("select", { value: draft.priority, onChange: (e) => field("priority", e.target.value), children: Object.keys(WB_PRIORITY_LABEL).map((key) => jsxRuntime.jsx("option", { value: key, children: WB_PRIORITY_LABEL[key] }, key)) })] })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-task-field-grid", children: [
            jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "执行者" }), jsxRuntime.jsx("select", { value: draft.owner || "human", onChange: (e) => field("owner", e.target.value), children: Object.keys(WB_OWNER_LABEL).map((key) => jsxRuntime.jsx("option", { value: key, children: WB_OWNER_LABEL[key] }, key)) })] }),
            jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "预计时长（分钟）" }), jsxRuntime.jsx("input", { type: "number", min: 0, value: draft.durationMinutes || "", onChange: (e) => field("durationMinutes", e.target.value) })] })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-task-field-grid", children: [
            jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "计划日期" }), jsxRuntime.jsx("input", { type: "date", value: draft.plannedFor || "", onChange: (e) => field("plannedFor", e.target.value) })] }),
            jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "截止日期" }), jsxRuntime.jsx("input", { type: "date", value: String(draft.dueAt || "").slice(0, 10), onChange: (e) => field("dueAt", e.target.value) })] })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "标签（逗号分隔）" }), jsxRuntime.jsx("input", { value: draft.labelsText === undefined ? (draft.labels || []).join(", ") : draft.labelsText, onChange: (e) => field("labelsText", e.target.value) })] }),
          jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "说明与验收标准" }), jsxRuntime.jsx("textarea", { value: draft.notes || "", onChange: (e) => field("notes", e.target.value), placeholder: "补充背景、完成标准或 Agent 执行要求…" })] }),
          (draft.status === "blocked" || draft.blockedReason) && jsxRuntime.jsxs("div", { className: "wb-task-field", children: [jsxRuntime.jsx("label", { children: "阻塞原因" }), jsxRuntime.jsx("textarea", { style: { minHeight: 72 }, value: draft.blockedReason || "", onChange: (e) => field("blockedReason", e.target.value), placeholder: "正在等待什么？" })] }),
          task.groupId && jsxRuntime.jsx("div", { className: "wb-task-group", children: [jsxRuntime.jsx("div", { className: "wb-task-group-title", children: task.groupTitle }), jsxRuntime.jsx("div", { className: "wb-task-group-meta", children: "流程步骤 " + (task.groupOrder + 1) })] }),
          task.sourceSessionId && jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "关联会话：" + task.sourceSessionId })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-task-detail-actions", children: [
          jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !String(draft.title || "").trim(), onClick: save, children: "保存修改" }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy || !store.sessionId, onClick: handoff, title: "把这项长期任务加入当前会话的 Agent 计划", children: "加入 Agent 计划" }),
          task.sourceSessionId && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: openSource, children: "打开关联会话" }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: () => { if (window.confirm("确定删除这个任务吗？")) store.remove(task.id).then(onClose).catch(() => {}); }, children: "删除" })
        ] })
      ] });
    }

    var WB_ORCHESTRATION_PHASE = {
      idea: "想法待规划", planning: "正在规划", planned: "等待确认", running: "代理执行中",
      review: "等待验收", changes_requested: "需要修改", accepted: "已验收",
      failed: "执行异常", cancelled: "已终止"
    };
    var WB_ORCHESTRATION_AGENT_STATUS = {
      planned: "待分配", waiting: "等待中", running: "执行中", completed: "已完成", failed: "失败", cancelled: "已终止"
    };

    function WorkbenchOrchestrationLegacy({ store, projectPath, scope, query }) {
      const [idea, setIdea] = React.useState("");
      const [feedbacks, setFeedbacks] = React.useState({});
      const scoped = wbTasksForScope(store.orchestrations, projectPath, scope);
      const q = String(query || "").trim().toLocaleLowerCase();
      const items = (q ? scoped.filter((item) => (item.title + " " + item.idea + " " + (item.finalReport || "")).toLocaleLowerCase().includes(q)) : scoped)
        .slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      const isRunning = store.orchestrations.some((item) => item.phase === "running" || item.phase === "planning");
      React.useEffect(() => {
        if (!isRunning) return;
        const timer = window.setInterval(() => store.refresh(), 1800);
        return () => window.clearInterval(timer);
      }, [isRunning, store.refresh]);
      const setFeedback = (id, value) => setFeedbacks((current) => ({ ...current, [id]: value }));
      const createIdea = () => {
        const value = idea.trim();
        if (!value) return;
        store.mutate("orchestration_create", { idea: value, title: value.slice(0, 80), projectPath: scope === "global" ? "" : projectPath })
          .then(() => setIdea("")).catch(() => {});
      };
      const plan = (item) => store.mutate("orchestration_plan", { id: item.id, feedback: String(feedbacks[item.id] === undefined ? (item.feedback || "") : feedbacks[item.id]).trim() }).catch(() => {});
      const start = (item) => {
        const count = Array.isArray(item.workers) ? item.workers.length : 0;
        if (!window.confirm("确认执行“" + item.title + "”吗？\n\n将启动 1 个主代理和 " + count + " 个子代理，并可能读写所选项目。")) return;
        store.mutate("orchestration_start", { id: item.id }).catch(() => {});
      };
      const requestChanges = (item) => {
        const value = String(feedbacks[item.id] || "").trim();
        if (!value) { store.setErr("请先写明需要修改的内容"); return; }
        store.mutate("orchestration_request_changes", { id: item.id, feedback: value }).catch(() => {});
      };
      const phaseClass = (phase) => "wb-orch-phase wb-orch-phase-" + phase;
      return jsxRuntime.jsxs("div", { className: "wb-orch", children: [
        jsxRuntime.jsxs("section", { className: "wb-orch-hero", children: [
          jsxRuntime.jsxs("div", { children: [
            jsxRuntime.jsx("div", { className: "wb-task-kicker", children: "HUMAN-GATED MULTI-AGENT" }),
            jsxRuntime.jsx("h3", { children: "先审方案，再启动代理，最后由你验收" }),
            jsxRuntime.jsx("p", { children: "AI 会选择主代理、拆分子代理工作包和依赖关系。没有你的确认不会执行；代理完成也不会自动判定通过。" })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-orch-runtime", children: [
            jsxRuntime.jsx("span", { className: store.orchestrationRuntime.available ? "wb-orch-dot wb-orch-dot-on" : "wb-orch-dot" }),
            jsxRuntime.jsx("strong", { children: store.orchestrationRuntime.available ? "DSH 子代理运行时已就绪" : "子代理运行时未就绪" }),
            store.orchestrationRuntime.available && jsxRuntime.jsx("small", { children: (store.orchestrationRuntime.providers || []).join(" · ") })
          ] })
        ] }),
        jsxRuntime.jsxs("section", { className: "wb-orch-compose", children: [
          jsxRuntime.jsx("textarea", { value: idea, placeholder: "写下一个想法或目标，例如：检查这个项目的登录流程，找出安全和体验问题，并给出可执行的改进方案…", onChange: (e) => setIdea(e.target.value), onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") createIdea(); } }),
          jsxRuntime.jsxs("div", { children: [
            jsxRuntime.jsx("span", { children: "Ctrl/⌘ + Enter 快速添加；添加后只保存想法，不会立刻执行。" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !idea.trim(), onClick: createIdea, children: "添加想法" })
          ] })
        ] }),
        items.length === 0 ? jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "这个范围内还没有多代理编排。先添加一个想法，AI 会为你生成可检查的执行方案。" }) :
          jsxRuntime.jsx("div", { className: "wb-orch-list", children: items.map((item) => {
            const workers = Array.isArray(item.workers) ? item.workers : [];
            const byId = new Map(workers.map((worker) => [worker.id, worker]));
            const feedback = feedbacks[item.id] === undefined ? (item.feedback || "") : feedbacks[item.id];
            const planData = item.plan || {};
            return jsxRuntime.jsxs("article", { className: "wb-orch-card", children: [
              jsxRuntime.jsxs("header", { className: "wb-orch-card-head", children: [
                jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("h3", { children: item.title }), jsxRuntime.jsx("p", { children: item.idea })] }),
                jsxRuntime.jsx("span", { className: phaseClass(item.phase), children: WB_ORCHESTRATION_PHASE[item.phase] || item.phase })
              ] }),
              planData.summary && jsxRuntime.jsx("div", { className: "wb-orch-summary", children: planData.summary }),
              item.mainAgent && jsxRuntime.jsxs("section", { className: "wb-orch-main", children: [
                jsxRuntime.jsxs("div", { className: "wb-orch-agent-title", children: [jsxRuntime.jsx("span", { className: "wb-orch-avatar wb-orch-avatar-main", children: "主" }), jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("strong", { children: item.mainAgent.name }), jsxRuntime.jsx("small", { children: item.mainAgent.role })] }), jsxRuntime.jsx("span", { className: "wb-orch-agent-status wb-orch-agent-status-" + item.mainAgent.status, children: WB_ORCHESTRATION_AGENT_STATUS[item.mainAgent.status] || item.mainAgent.status })] }),
                item.mainAgent.mission && jsxRuntime.jsx("p", { children: item.mainAgent.mission }),
                item.mainAgent.rationale && jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "选择理由：" + item.mainAgent.rationale })
              ] }),
              workers.length > 0 && jsxRuntime.jsx("div", { className: "wb-orch-workers", children: workers.map((worker, index) => jsxRuntime.jsxs("section", { className: "wb-orch-worker", children: [
                jsxRuntime.jsxs("div", { className: "wb-orch-agent-title", children: [jsxRuntime.jsx("span", { className: "wb-orch-avatar", children: index + 1 }), jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("strong", { children: worker.name }), jsxRuntime.jsx("small", { children: worker.role })] }), jsxRuntime.jsx("span", { className: "wb-orch-agent-status wb-orch-agent-status-" + worker.status, children: WB_ORCHESTRATION_AGENT_STATUS[worker.status] || worker.status })] }),
                jsxRuntime.jsx("p", { children: worker.mission }),
                worker.dependsOn && worker.dependsOn.length > 0 && jsxRuntime.jsx("div", { className: "wb-orch-deps", children: "依赖：" + worker.dependsOn.map((id) => byId.get(id) ? byId.get(id).name : id).join("、") }),
                worker.acceptance && jsxRuntime.jsx("div", { className: "wb-orch-acceptance", children: "完成标准：" + worker.acceptance }),
                worker.output && jsxRuntime.jsxs("details", { className: "wb-orch-output", children: [jsxRuntime.jsx("summary", { children: "查看子代理交接" }), jsxRuntime.jsx("pre", { children: worker.output })] }),
                worker.error && jsxRuntime.jsx("div", { className: "wb-tb-err", children: worker.error })
              ] }, worker.id)) }),
              planData.acceptanceCriteria && planData.acceptanceCriteria.length > 0 && jsxRuntime.jsxs("section", { className: "wb-orch-criteria", children: [jsxRuntime.jsx("strong", { children: "最终验收清单" }), jsxRuntime.jsx("ol", { children: planData.acceptanceCriteria.map((criterion, index) => jsxRuntime.jsx("li", { children: criterion }, index)) })] }),
              item.runtimeError && jsxRuntime.jsx("div", { className: "wb-tb-err", children: item.runtimeError }),
              item.finalReport && jsxRuntime.jsxs("section", { className: "wb-orch-report", children: [jsxRuntime.jsx("strong", { children: "主代理最终报告" }), jsxRuntime.jsx("pre", { children: item.finalReport })] }),
              (item.phase === "review" || item.phase === "changes_requested" || item.phase === "failed" || item.phase === "cancelled") && jsxRuntime.jsx("textarea", { className: "wb-orch-feedback", value: feedback, placeholder: item.phase === "review" ? "写下需要修改的内容；如果结果符合预期，也可以直接通过验收。" : "补充修改意见，让 AI 重新编排…", onChange: (e) => setFeedback(item.id, e.target.value) }),
              jsxRuntime.jsxs("footer", { className: "wb-orch-actions", children: [
                item.phase === "idea" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy, onClick: () => plan(item), children: "AI 生成编排方案" }),
                item.phase === "planned" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !store.orchestrationRuntime.available, onClick: () => start(item), children: "确认并执行" }),
                item.phase === "planned" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => plan(item), children: "重新规划" }),
                item.phase === "running" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => { if (window.confirm("确定终止这次代理执行吗？")) store.mutate("orchestration_cancel", { id: item.id }).catch(() => {}); }, children: "终止执行" }),
                item.phase === "review" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy, onClick: () => { if (window.confirm("确认结果符合要求并通过验收吗？")) store.mutate("orchestration_accept", { id: item.id, note: "用户已在任务中心通过验收" }).catch(() => {}); }, children: "通过验收" }),
                item.phase === "review" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy || !String(feedback || "").trim(), onClick: () => requestChanges(item), children: "要求修改" }),
                item.phase === "changes_requested" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy, onClick: () => plan(item), children: "AI 按反馈重新编排" }),
                (item.phase === "failed" || item.phase === "cancelled") && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy, onClick: () => plan(item), children: "重新生成方案" }),
                item.phase !== "running" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => { if (window.confirm("确定删除这条编排记录吗？")) store.mutate("orchestration_remove", { id: item.id }).catch(() => {}); }, children: "删除" }),
                jsxRuntime.jsx("span", { className: "wb-tb-meta", children: "第 " + (item.attempt || 0) + " 次执行 · " + wbProjectLabel(item.projectPath) })
              ] })
            ] }, item.id);
          }) })
      ] });
    }

    var WB_IDEA_STATUS = { inbox: "收件箱", considering: "待评估", promoted: "已推进", snoozed: "稍后", archived: "已归档" };
    var WB_IDEA_RECOMMENDATION = { task: "转为普通任务", orchestration: "交给 AI 团队", later: "稍后再看", archive: "归档" };

    function WorkbenchIdeas({ store, projectPath, scope, query, onOpenCollaboration }) {
      const [selectedId, setSelectedId] = React.useState(null);
      const [filter, setFilter] = React.useState("active");
      const [capture, setCapture] = React.useState("");
      const [draft, setDraft] = React.useState(null);
      const scoped = wbTasksForScope(store.ideas, projectPath, scope);
      const q = String(query || "").trim().toLocaleLowerCase();
      const filtered = scoped.filter((item) => {
        if (filter === "active" && (item.status === "archived" || item.status === "promoted")) return false;
        if (filter !== "all" && filter !== "active" && item.status !== filter) return false;
        return !q || (item.title + " " + item.body + " " + (item.tags || []).join(" ") + " " + (item.aiSummary || "")).toLocaleLowerCase().includes(q);
      }).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null;
      React.useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id); }, [selected && selected.id]);
      React.useEffect(() => { setDraft(selected ? { ...selected, tagsText: (selected.tags || []).join(", ") } : null); }, [selected && selected.id, selected && selected.updatedAt]);
      const create = () => {
        const value = capture.trim();
        if (!value) return;
        store.mutate("idea_create", { title: value.split(/\r?\n/)[0].slice(0, 120), body: value, projectPath: scope === "global" ? "" : projectPath }).then(() => {
          setCapture("");
          try { window.dispatchEvent(new CustomEvent("wb:tasks-changed")); } catch (e) { /* noop */ }
        }).catch(() => {});
      };
      const save = () => {
        if (!draft || !String(draft.title || "").trim()) return;
        store.mutate("idea_update", { id: draft.id, patch: { title: draft.title, body: draft.body, status: draft.status, tags: String(draft.tagsText || "").split(/[,，]/).map((v) => v.trim()).filter(Boolean), impact: Number(draft.impact) || 0, effort: Number(draft.effort) || 0, snoozedUntil: draft.snoozedUntil || "" } }).catch(() => {});
      };
      const convertOrchestration = (item) => store.mutate("idea_convert_orchestration", { id: item.id }).then((data) => {
        const next = (data.ideas || []).find((idea) => idea.id === item.id);
        const linkedId = next && next.linkedOrchestrationId;
        const orchestration = (data.orchestrations || []).find((entry) => entry.id === linkedId);
        if (typeof onOpenCollaboration === "function") onOpenCollaboration(linkedId, orchestration);
      }).catch(() => {});
      const statusCounts = scoped.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
      return jsxRuntime.jsxs("div", { className: "wb-ideas", children: [
        jsxRuntime.jsxs("section", { className: "wb-idea-capture", children: [
          jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("div", { className: "wb-task-kicker", children: "IDEA INBOX" }), jsxRuntime.jsx("h3", { children: "先捕捉，再决定是否执行" }), jsxRuntime.jsx("p", { children: "想法不会自动进入任务清单。需要时让 AI 帮你整理，再转成普通任务或多代理协作。" })] }),
          jsxRuntime.jsxs("div", { className: "wb-idea-capture-box", children: [jsxRuntime.jsx("textarea", { value: capture, placeholder: "记下突发想法、待验证问题或改进方向…", onChange: (e) => setCapture(e.target.value), onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") create(); } }), jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !capture.trim(), onClick: create, children: "存入想法库" })] })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-idea-workspace", children: [
          jsxRuntime.jsxs("aside", { className: "wb-idea-list-panel", children: [
            jsxRuntime.jsx("div", { className: "wb-idea-filters", children: [{ id: "active", label: "待处理" }, { id: "inbox", label: "收件箱" }, { id: "considering", label: "待评估" }, { id: "snoozed", label: "稍后" }, { id: "promoted", label: "已推进" }, { id: "archived", label: "归档" }, { id: "all", label: "全部" }].map((item) => jsxRuntime.jsxs("button", { type: "button", className: filter === item.id ? "wb-idea-filter-active" : "", onClick: () => setFilter(item.id), children: [jsxRuntime.jsx("span", { children: item.label }), item.id !== "all" && item.id !== "active" && jsxRuntime.jsx("small", { children: statusCounts[item.id] || 0 })] }, item.id)) }),
            jsxRuntime.jsx("div", { className: "wb-idea-list", children: filtered.length ? filtered.map((item) => jsxRuntime.jsxs("button", { type: "button", className: "wb-idea-row" + (selected && selected.id === item.id ? " wb-idea-row-active" : ""), onClick: () => setSelectedId(item.id), children: [jsxRuntime.jsxs("span", { children: [jsxRuntime.jsx("strong", { children: item.title }), jsxRuntime.jsx("small", { children: (WB_IDEA_STATUS[item.status] || item.status) + " · " + wbProjectLabel(item.projectPath) })] }), item.aiRecommendation && jsxRuntime.jsx("em", { children: WB_IDEA_RECOMMENDATION[item.aiRecommendation] || item.aiRecommendation })] }, item.id)) : jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "这个分类里还没有想法" }) })
          ] }),
          selected && draft ? jsxRuntime.jsxs("article", { className: "wb-idea-detail", children: [
            jsxRuntime.jsxs("header", { children: [jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("span", { className: "wb-orch-phase", children: WB_IDEA_STATUS[draft.status] || draft.status }), jsxRuntime.jsx("small", { children: "更新于 " + new Date(draft.updatedAt).toLocaleString() })] }), jsxRuntime.jsx("select", { value: draft.status, onChange: (e) => setDraft({ ...draft, status: e.target.value }), children: Object.keys(WB_IDEA_STATUS).map((key) => jsxRuntime.jsx("option", { value: key, children: WB_IDEA_STATUS[key] }, key)) })] }),
            jsxRuntime.jsx("input", { className: "wb-idea-title-input", value: draft.title, onChange: (e) => setDraft({ ...draft, title: e.target.value }) }),
            jsxRuntime.jsx("textarea", { className: "wb-idea-body-input", value: draft.body, onChange: (e) => setDraft({ ...draft, body: e.target.value }), placeholder: "补充背景、希望解决的问题和限制条件…" }),
            jsxRuntime.jsxs("div", { className: "wb-idea-fields", children: [
              jsxRuntime.jsxs("label", { children: ["标签", jsxRuntime.jsx("input", { value: draft.tagsText || "", placeholder: "体验, 插件, 待验证", onChange: (e) => setDraft({ ...draft, tagsText: e.target.value }) })] }),
              jsxRuntime.jsxs("label", { children: ["影响 1–5", jsxRuntime.jsx("input", { type: "number", min: 0, max: 5, value: draft.impact || "", onChange: (e) => setDraft({ ...draft, impact: e.target.value }) })] }),
              jsxRuntime.jsxs("label", { children: ["投入 1–5", jsxRuntime.jsx("input", { type: "number", min: 0, max: 5, value: draft.effort || "", onChange: (e) => setDraft({ ...draft, effort: e.target.value }) })] }),
              draft.status === "snoozed" && jsxRuntime.jsxs("label", { children: ["提醒日期", jsxRuntime.jsx("input", { type: "date", value: String(draft.snoozedUntil || "").slice(0, 10), onChange: (e) => setDraft({ ...draft, snoozedUntil: e.target.value }) })] })
            ] }),
            draft.aiSummary ? jsxRuntime.jsxs("section", { className: "wb-idea-ai", children: [
              jsxRuntime.jsxs("div", { className: "wb-idea-ai-head", children: [jsxRuntime.jsx("strong", { children: "AI 整理建议" }), jsxRuntime.jsx("span", { children: WB_IDEA_RECOMMENDATION[draft.aiRecommendation] || draft.aiRecommendation })] }),
              jsxRuntime.jsx("p", { children: draft.aiSummary }), draft.aiRationale && jsxRuntime.jsx("div", { className: "wb-idea-rationale", children: draft.aiRationale }),
              (draft.questions || []).length > 0 && jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("strong", { children: "执行前值得确认" }), jsxRuntime.jsx("ul", { children: draft.questions.map((question, index) => jsxRuntime.jsx("li", { children: question }, index)) })] })
            ] }) : jsxRuntime.jsx("section", { className: "wb-idea-ai wb-idea-ai-empty", children: "需要判断优先级或执行方式时，再让 AI 整理；捕捉阶段不会自动消耗模型。" }),
            jsxRuntime.jsxs("footer", { className: "wb-idea-actions", children: [
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: save, children: "保存" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => store.mutate("idea_analyze", { id: selected.id }).catch(() => {}), children: draft.aiSummary ? "重新 AI 整理" : "AI 整理建议" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || (selected.linkedTaskIds || []).length > 0, onClick: () => store.mutate("idea_convert_task", { id: selected.id }).catch(() => {}), children: (selected.linkedTaskIds || []).length > 0 ? "已转为普通任务" : "转为普通任务" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !!selected.linkedOrchestrationId, onClick: () => convertOrchestration(selected), children: selected.linkedOrchestrationId ? "已进入 AI 协作" : "交给 AI 团队" }),
              selected.linkedOrchestrationId && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: () => onOpenCollaboration(selected.linkedOrchestrationId), children: "查看协作任务" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => { if (window.confirm("确定永久删除这个想法吗？")) store.mutate("idea_remove", { id: selected.id }).then(() => setSelectedId(null)).catch(() => {}); }, children: "删除" })
            ] })
          ] }) : jsxRuntime.jsx("div", { className: "wb-task-empty-state wb-idea-detail-empty", children: "从左侧选择一个想法，或在上方快速记录。" })
        ] })
      ] });
    }

    function WorkbenchAgentModel({ agent, orchestration, store }) {
      if (!agent) return null;
      const editable = orchestration.phase !== "running" && orchestration.phase !== "review" && orchestration.phase !== "accepted";
      const value = agent.provider && agent.model ? agent.provider + "::" + agent.model : "";
      const change = (event) => {
        const parts = event.target.value.split("::");
        store.mutate("orchestration_set_agent_model", { id: orchestration.id, agentId: agent.id, provider: parts[0] || "", model: parts.slice(1).join("::") || "" }).catch(() => {});
      };
      return jsxRuntime.jsxs("div", { className: "wb-agent-model", children: [
        jsxRuntime.jsx("select", { value, disabled: store.busy || !editable, onChange: change, title: editable ? "为这个代理单独选择模型" : "执行后模型已锁定", children: [jsxRuntime.jsx("option", { value: "", children: "继承主会话模型" }), (store.modelCatalog || []).map((item) => jsxRuntime.jsx("option", { value: item.provider + "::" + item.id, children: (item.providerName || item.provider) + " · " + (item.name || item.id) }, item.provider + "::" + item.id))] }),
        jsxRuntime.jsx("small", { children: agent.usedModel ? "实际使用：" + (agent.usedProvider ? agent.usedProvider + " · " : "") + agent.usedModel : (agent.modelReason || "未指定时继承当前会话") })
      ] });
    }

    function WorkbenchOrchestration({ store, projectPath, scope, query, initialId, onOpenIdeas }) {
      const [selectedId, setSelectedId] = React.useState(initialId || null);
      const [tab, setTab] = React.useState("plan");
      const [feedback, setFeedback] = React.useState("");
      const [policy, setPolicy] = React.useState("balanced");
      const [draftIdea, setDraftIdea] = React.useState("");
      const scoped = wbTasksForScope(store.orchestrations, projectPath, scope);
      const q = String(query || "").trim().toLocaleLowerCase();
      const items = scoped.filter((item) => !q || (item.title + " " + item.idea + " " + (item.finalReport || "")).toLocaleLowerCase().includes(q)).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      const selected = items.find((item) => item.id === selectedId) || items[0] || store.orchestrations.find((item) => item.id === selectedId) || null;
      React.useEffect(() => { if (initialId) setSelectedId(initialId); }, [initialId]);
      React.useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id); }, [selected && selected.id]);
      React.useEffect(() => { setFeedback(""); }, [selected && selected.id]);
      const isRunning = store.orchestrations.some((item) => item.phase === "running" || item.phase === "planning");
      React.useEffect(() => { if (!isRunning) return; const timer = window.setInterval(() => store.refresh(), 1800); return () => window.clearInterval(timer); }, [isRunning, store.refresh]);
      const plan = () => { if (!selected) return; const value = feedback.trim() || (selected.phase === "changes_requested" ? String(selected.feedback || "") : ""); store.mutate("orchestration_plan", { id: selected.id, feedback: value, modelPolicy: policy }).then(() => setFeedback("")).catch(() => {}); };
      const createDirect = () => {
        const value = draftIdea.trim();
        if (!value || store.busy) return;
        store.mutate("orchestration_create", { title: value.split(/\r?\n/)[0].slice(0, 120), idea: value, projectPath: scope === "global" ? "" : projectPath }).then((data) => {
          const created = (Array.isArray(data.orchestrations) ? data.orchestrations : []).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
          if (created) setSelectedId(created.id);
          setDraftIdea("");
          setTab("plan");
        }).catch(() => {});
      };
      const start = () => {
        if (!selected) return;
        if (!window.confirm("确认执行“" + selected.title + "”吗？\n\n将启动主代理和 " + (selected.workers || []).length + " 个子代理，并可能读写所选项目。")) return;
        store.mutate("orchestration_start", { id: selected.id }).catch(() => {});
      };
      const resume = () => {
        if (!selected) return;
        const remaining = (selected.workers || []).filter((worker) => worker.status !== "completed").length;
        if (!window.confirm("从未完成步骤继续执行“" + selected.title + "”吗？\n\n已完成步骤将保留，仅重新运行剩余 " + remaining + " 个子代理，然后由主代理汇总；不会重复执行已完成的部分。")) return;
        store.mutate("orchestration_resume", { id: selected.id }).catch(() => {});
      };
      const requestChanges = () => { const value = feedback.trim(); if (!value) { store.setErr("请先写明需要修改的内容"); return; } store.mutate("orchestration_request_changes", { id: selected.id, feedback: value }).then(() => setFeedback("")).catch(() => {}); };
      const phaseIndex = !selected ? 0 : selected.phase === "idea" || selected.phase === "planning" || selected.phase === "planned" ? 1 : selected.phase === "running" ? 2 : 3;
      const runningProgress = selected && selected.phase === "running" ? (() => {
        const workers = Array.isArray(selected.workers) ? selected.workers : [];
        const total = workers.length + 1;
        const doneWorkers = workers.filter((worker) => ["completed", "failed", "cancelled"].includes(worker.status)).length;
        const mainDone = selected.mainAgent && ["completed", "failed", "cancelled"].includes(selected.mainAgent.status) ? 1 : 0;
        const done = doneWorkers + mainDone;
        const current = selected.mainAgent && selected.mainAgent.status === "running" ? selected.mainAgent : workers.find((worker) => worker.status === "running");
        return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0, current };
      })() : null;
      const renderAgent = (agent, index, main) => agent && jsxRuntime.jsxs("section", { className: "wb-collab-agent" + (main ? " wb-collab-agent-main" : ""), children: [
        jsxRuntime.jsxs("div", { className: "wb-orch-agent-title", children: [jsxRuntime.jsx("span", { className: "wb-orch-avatar" + (main ? " wb-orch-avatar-main" : ""), children: main ? "主" : index + 1 }), jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("strong", { children: agent.name }), jsxRuntime.jsx("small", { children: agent.role })] }), jsxRuntime.jsxs("span", { className: "wb-orch-agent-status wb-orch-agent-status-" + agent.status, children: [WB_ORCHESTRATION_AGENT_STATUS[agent.status] || agent.status, agent.status === "running" && agent.startedAt && jsxRuntime.jsx("small", { className: "wb-orch-agent-elapsed", children: " · " + Math.max(0, Math.round((Date.now() - new Date(agent.startedAt).getTime()) / 1000)) + "s" })] })] }),
        jsxRuntime.jsx("p", { children: agent.mission }), agent.acceptance && jsxRuntime.jsx("div", { className: "wb-orch-acceptance", children: "完成标准：" + agent.acceptance }), agent.dependsOn && agent.dependsOn.length > 0 && jsxRuntime.jsx("div", { className: "wb-orch-deps", children: "依赖 " + agent.dependsOn.length + " 个工作包" }),
        jsxRuntime.jsx(WorkbenchAgentModel, { agent, orchestration: selected, store }),
        agent.output && jsxRuntime.jsxs("details", { className: "wb-orch-output", children: [jsxRuntime.jsx("summary", { children: "查看代理交接" }), jsxRuntime.jsx("pre", { children: agent.output })] }), agent.error && jsxRuntime.jsx("div", { className: "wb-tb-err", children: agent.error })
      ] }, agent.id);
      return jsxRuntime.jsxs("div", { className: "wb-collab", children: [
        jsxRuntime.jsxs("section", { className: "wb-orch-compose", children: [
          jsxRuntime.jsx("textarea", { value: draftIdea, placeholder: "直接写任务或目标，例如：调研竞品并输出对比报告… Enter 创建，Shift+Enter 换行；创建后需确认方案才会执行。", onChange: (e) => setDraftIdea(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); createDirect(); } } }),
          jsxRuntime.jsxs("div", { children: [
            jsxRuntime.jsx("span", { children: "Enter 直接创建并进入方案阶段；不会自动执行。" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !draftIdea.trim(), onClick: createDirect, children: "交给 AI 团队" })
          ] })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-collab-grid", children: [
          jsxRuntime.jsxs("aside", { className: "wb-collab-list", children: [
            jsxRuntime.jsxs("div", { className: "wb-collab-list-head", children: [jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("div", { className: "wb-task-kicker", children: "AI COLLABORATION" }), jsxRuntime.jsx("strong", { children: "协作任务" })] }), jsxRuntime.jsx("span", { children: items.length })] }),
            items.length ? items.map((item) => jsxRuntime.jsxs("button", { type: "button", className: "wb-collab-row" + (selected && selected.id === item.id ? " wb-collab-row-active" : ""), onClick: () => { setSelectedId(item.id); setTab("plan"); }, children: [jsxRuntime.jsx("strong", { children: item.title }), jsxRuntime.jsxs("span", { children: [jsxRuntime.jsx("small", { children: WB_ORCHESTRATION_PHASE[item.phase] || item.phase }), jsxRuntime.jsx("small", { children: "V" + ((item.planVersions || []).length || 0) + " · " + wbProjectLabel(item.projectPath) })] })] }, item.id)) : jsxRuntime.jsxs("div", { className: "wb-collab-empty", children: [jsxRuntime.jsx("p", { children: "还没有 AI 协作任务。在上方直接发布，或从想法库挑选。" }), jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", onClick: onOpenIdeas, children: "去想法库挑选" })] })
          ] }),
          selected ? jsxRuntime.jsxs("main", { className: "wb-collab-main", children: [
            jsxRuntime.jsxs("header", { className: "wb-collab-title", children: [jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("span", { className: "wb-orch-phase wb-orch-phase-" + selected.phase, children: WB_ORCHESTRATION_PHASE[selected.phase] || selected.phase }), jsxRuntime.jsx("h3", { children: selected.title }), jsxRuntime.jsx("p", { children: selected.idea })] }), jsxRuntime.jsx("span", { className: "wb-task-owner", children: "第 " + (selected.attempt || 0) + " 次执行" })] }),
            runningProgress && jsxRuntime.jsxs("section", { className: "wb-run-progress", children: [
              jsxRuntime.jsx("div", { className: "wb-run-progress-bar", children: jsxRuntime.jsx("span", { style: { width: runningProgress.pct + "%" } }) }),
              jsxRuntime.jsxs("div", { className: "wb-run-progress-meta", children: [
                jsxRuntime.jsx("strong", { children: "进度 " + runningProgress.pct + "% · " + runningProgress.done + "/" + runningProgress.total + " 个阶段完成" }),
                jsxRuntime.jsx("span", { children: runningProgress.current ? ("当前：" + runningProgress.current.name + "（" + (WB_ORCHESTRATION_AGENT_STATUS[runningProgress.current.status] || runningProgress.current.status) + "）") : (runningProgress.done >= runningProgress.total ? "全部完成，等待主代理汇总" : "等待代理启动…") })
              ] })
            ] }),
            jsxRuntime.jsx("div", { className: "wb-collab-steps", children: ["想法", "方案", "执行", "验收"].map((label, index) => jsxRuntime.jsxs("div", { className: index <= phaseIndex ? "wb-collab-step-active" : "", children: [jsxRuntime.jsx("span", { children: index + 1 }), jsxRuntime.jsx("small", { children: label })] }, label)) }),
            jsxRuntime.jsx("nav", { className: "wb-collab-tabs", children: [{ id: "plan", label: "方案" }, { id: "delivery", label: "交付" }, { id: "history", label: "历史" }].map((item) => jsxRuntime.jsx("button", { type: "button", className: tab === item.id ? "wb-collab-tab-active" : "", onClick: () => setTab(item.id), children: item.label }, item.id)) }),
            tab === "plan" && jsxRuntime.jsxs(React.Fragment, { children: [selected.phase === "planning" && jsxRuntime.jsxs("section", { className: "wb-planning", children: [jsxRuntime.jsx("div", { className: "wb-planning-bar", children: jsxRuntime.jsx("span", {}) }), jsxRuntime.jsx("p", { children: selected.planningNote || "AI 正在生成方案…" }), jsxRuntime.jsx("small", { children: "已用时 " + Math.max(0, Math.round((Date.now() - new Date(selected.updatedAt || Date.now()).getTime()) / 1000)) + " 秒；生成完成后会自动出现在下方。可以先切到其他任务或关闭本页。" })] }), selected.plan && selected.plan.summary && jsxRuntime.jsx("section", { className: "wb-orch-summary", children: selected.plan.summary }), selected.mainAgent && renderAgent(selected.mainAgent, 0, true), (selected.workers || []).length > 0 && jsxRuntime.jsx("div", { className: "wb-collab-agents", children: selected.workers.map((agent, index) => renderAgent(agent, index, false)) }), selected.plan && (selected.plan.acceptanceCriteria || []).length > 0 && jsxRuntime.jsxs("section", { className: "wb-orch-criteria", children: [jsxRuntime.jsx("strong", { children: "最终验收清单" }), jsxRuntime.jsx("ol", { children: selected.plan.acceptanceCriteria.map((item, index) => jsxRuntime.jsx("li", { children: item }, index)) })] })] }),
            tab === "delivery" && jsxRuntime.jsxs("div", { className: "wb-collab-delivery", children: [selected.runtimeError && jsxRuntime.jsx(WbErrNote, { message: selected.runtimeError }), selected.finalReport ? jsxRuntime.jsxs("section", { className: "wb-orch-report", children: [jsxRuntime.jsx("strong", { children: "主代理最终报告" }), jsxRuntime.jsx("pre", { children: selected.finalReport })] }) : jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: selected.phase === "running" ? "代理正在工作，完成的交付会显示在这里。" : "执行后，这里集中展示代理交付和最终报告。" })] }),
            tab === "history" && jsxRuntime.jsxs("div", { className: "wb-collab-history", children: [
              jsxRuntime.jsxs("section", { children: [jsxRuntime.jsx("h4", { children: "方案版本" }), (selected.planVersions || []).slice().reverse().map((version) => jsxRuntime.jsxs("div", { className: "wb-collab-history-row", children: [jsxRuntime.jsx("strong", { children: "V" + version.version }), jsxRuntime.jsxs("span", { children: [jsxRuntime.jsx("small", { children: new Date(version.createdAt).toLocaleString() }), version.feedback && jsxRuntime.jsx("p", { children: "修改依据：" + version.feedback })] })] }, version.version))] }),
              jsxRuntime.jsxs("section", { children: [jsxRuntime.jsx("h4", { children: "执行记录" }), (selected.runs || []).length ? selected.runs.slice().reverse().map((run, index) => jsxRuntime.jsxs("div", { className: "wb-collab-history-row", children: [jsxRuntime.jsx("strong", { children: "#" + run.attempt }), jsxRuntime.jsxs("span", { children: [jsxRuntime.jsx("small", { children: run.status + " · " + new Date(run.completedAt || run.startedAt).toLocaleString() }), run.reviewNote && jsxRuntime.jsx("p", { children: run.reviewNote })] })] }, index)) : jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "尚未执行" })] })
            ] })
          ] }) : jsxRuntime.jsx("main", { className: "wb-collab-main wb-collab-empty", children: "在上方直接发布任务，或从想法库提升一个事项；随后在这里审方案、执行和验收。" }),
          selected && jsxRuntime.jsxs("aside", { className: "wb-collab-decision", children: [
            jsxRuntime.jsxs("div", { className: "wb-orch-runtime", children: [jsxRuntime.jsx("span", { className: store.orchestrationRuntime.available ? "wb-orch-dot wb-orch-dot-on" : "wb-orch-dot" }), jsxRuntime.jsx("strong", { children: store.orchestrationRuntime.available ? "代理运行时已就绪" : "代理运行时未就绪" }), jsxRuntime.jsx("small", { children: (store.orchestrationRuntime.providers || []).join(" · ") || "当前只能保存和规划" })] }),
            jsxRuntime.jsxs("section", { className: "wb-collab-decision-card", children: [jsxRuntime.jsx("strong", { children: "模型分配策略" }), jsxRuntime.jsx("select", { value: policy, disabled: selected.phase === "running", onChange: (e) => setPolicy(e.target.value), children: [jsxRuntime.jsx("option", { value: "balanced", children: "智能平衡" }), jsxRuntime.jsx("option", { value: "quality", children: "质量优先" }), jsxRuntime.jsx("option", { value: "economy", children: "成本优先" }), jsxRuntime.jsx("option", { value: "manual", children: "全部手动" })] }), jsxRuntime.jsx("small", { children: (store.modelCatalog || []).length ? "已发现 " + store.modelCatalog.length + " 个可用模型；生成方案后仍可逐个调整。" : "没有读取到模型目录，所有代理将继承主会话。" })] }),
            jsxRuntime.jsxs("section", { className: "wb-collab-decision-card", children: [jsxRuntime.jsx("strong", { children: selected.phase === "review" ? "验收意见" : "给编排 AI 的反馈" }), jsxRuntime.jsx("textarea", { value: feedback, disabled: selected.phase === "running", placeholder: selected.phase === "review" ? "写下需要修改的地方；符合预期可直接通过。" : "反馈将用于生成一份修改后的新方案，不会在子代理执行时重复注入。例如：减少代理数量；让安全审查与体验审查并行…", onChange: (e) => setFeedback(e.target.value) }), selected.phase !== "review" && jsxRuntime.jsx("small", { className: "wb-orch-feedback-hint", children: "提交后按反馈生成新方案版本；执行按新方案进行，子代理不再收到反馈原文。" })] }),
            (selected.phase === "failed" || selected.phase === "cancelled") && jsxRuntime.jsx("small", { className: "wb-orch-resume-hint", children: "“继续执行”会保留已完成步骤、只重跑未完成代理；若仍失败，原因会显示在交付页，可据此决定是否重新生成方案。" }),
            jsxRuntime.jsxs("div", { className: "wb-collab-actions", children: [
              selected.phase === "idea" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy, onClick: plan, children: "AI 生成方案" }),
              selected.phase === "planned" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !store.orchestrationRuntime.available, onClick: start, children: "确认方案并执行" }),
              selected.phase === "planned" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: plan, children: feedback.trim() ? "按反馈生成 V" + ((selected.planVersions || []).length + 1) : "重新生成方案" }),
              selected.phase === "running" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => { if (window.confirm("确定终止这次代理执行吗？")) store.mutate("orchestration_cancel", { id: selected.id }).catch(() => {}); }, children: "终止执行" }),
              selected.phase === "review" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy, onClick: () => { if (window.confirm("确认结果符合要求并通过验收吗？")) store.mutate("orchestration_accept", { id: selected.id, note: feedback.trim() || "用户已通过验收" }).then(() => setFeedback("")).catch(() => {}); }, children: "通过验收" }),
              selected.phase === "review" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy || !feedback.trim(), onClick: requestChanges, children: "要求修改" }),
              (selected.phase === "failed" || selected.phase === "cancelled") && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !store.orchestrationRuntime.available, onClick: resume, children: "继续执行" }),
              (selected.phase === "changes_requested" || selected.phase === "failed" || selected.phase === "cancelled") && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: plan, children: selected.phase === "changes_requested" ? "按反馈重新编排" : "重新生成方案" }),
              selected.phase !== "running" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => { if (window.confirm("确定删除这条协作记录吗？")) store.mutate("orchestration_remove", { id: selected.id }).then(() => setSelectedId(null)).catch(() => {}); }, children: "删除记录" })
            ] })
          ] })
        ] })
      ] });
    }

    function WorkbenchTaskCenter({ store, workspaceItems, selectedId, onSelectedId, initialView, onClose }) {
      const [view, setView] = React.useState(() => { try { return initialView || localStorage.getItem("wb.taskCenterView") || "today"; } catch (e) { return initialView || "today"; } });
      const [scope, setScope] = React.useState(() => { try { return localStorage.getItem("wb.taskScope") || "current"; } catch (e) { return "current"; } });
      const [viewProjectPath, setViewProjectPath] = React.useState(store.projectPath || "");
      const [query, setQuery] = React.useState("");
      const [draft, setDraft] = React.useState("");
      const [dragOver, setDragOver] = React.useState(null);
      const [collaborationInitialId, setCollaborationInitialId] = React.useState(null);
      const searchRef = React.useRef(null);
      const createRef = React.useRef(null);
      React.useEffect(() => { store.refresh(); }, [store.refresh]);
      const chooseView = (id) => {
        let next = id;
        if (id === "tasks") { try { next = localStorage.getItem("wb.taskDisplay") || "board"; } catch (e) { next = "board"; } }
        if (WB_TASK_SUBVIEWS.some((item) => item.id === next)) { try { localStorage.setItem("wb.taskDisplay", next); } catch (e) {} }
        setView(next);
        if (next === "orchestrate" || next === "ideas") onSelectedId(null);
        try { localStorage.setItem("wb.taskCenterView", next); } catch (e) {}
      };
      React.useEffect(() => { if (initialView) chooseView(initialView); }, [initialView]);
      const chooseScope = (id) => { setScope(id); try { localStorage.setItem("wb.taskScope", id); } catch (e) {} };
      const projectOptions = [];
      const projectKeys = new Set();
      const addProjectOption = (path, label) => {
        const value = String(path || "").trim();
        const key = normPath(value);
        if (!value || !key || projectKeys.has(key)) return;
        projectKeys.add(key);
        projectOptions.push({ path: value, label: label || wbProjectLabel(value) });
      };
      (Array.isArray(workspaceItems) ? workspaceItems : []).forEach((item) => addProjectOption(item.path, item.title || wbProjectLabel(item.path)));
      addProjectOption(store.projectPath, wbProjectLabel(store.projectPath));
      store.tasks.forEach((task) => addProjectOption(task.projectPath, wbProjectLabel(task.projectPath)));
      store.ideas.forEach((idea) => addProjectOption(idea.projectPath, wbProjectLabel(idea.projectPath)));
      store.orchestrations.forEach((item) => addProjectOption(item.projectPath, wbProjectLabel(item.projectPath)));
      const chooseProject = (path) => { setViewProjectPath(path); chooseScope("current"); onSelectedId(null); };
      const q = query.trim().toLocaleLowerCase();
      const scopedTasks = wbTasksForScope(store.tasks, viewProjectPath, scope);
      const visible = [...(q ? scopedTasks.filter((task) => (task.title + " " + (task.notes || "") + " " + (task.labels || []).join(" ") + " " + (task.groupTitle || "")).toLocaleLowerCase().includes(q)) : scopedTasks)].sort(wbTaskSort);
      const selected = selectedId ? store.tasks.find((task) => task.id === selectedId) : null;
      const today = wbTodayKey();
      const active = visible.filter((task) => task.status === "in_progress");
      const todayItems = visible.filter((task) => task.status !== "completed" && task.plannedFor === today);
      const suggested = visible.filter((task) => (task.status === "pending" || task.status === "inbox") && task.plannedFor !== today).slice(0, 5);
      const completed = visible.filter((task) => task.status === "completed");
      const blocked = visible.filter((task) => task.status === "blocked");
      const groupMap = new Map();
      scopedTasks.filter((task) => task.groupId).forEach((task) => {
        if (!groupMap.has(task.groupId)) groupMap.set(task.groupId, { id: task.groupId, title: task.groupTitle, tasks: [] });
        groupMap.get(task.groupId).tasks.push(task);
      });
      const taskGroups = [...groupMap.values()].sort((a, b) => a.title.localeCompare(b.title));
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (selectedId) onSelectedId(null); else onClose();
            return;
          }
          const target = event.target;
          const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
          if (typing) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" || event.key === "/") { event.preventDefault(); searchRef.current && searchRef.current.focus(); return; }
          if (event.key.toLowerCase() === "c") { event.preventDefault(); createRef.current && createRef.current.focus(); return; }
          const shortcuts = { y: "today", i: "ideas", b: "board", o: "orchestrate", l: "list", t: "timeline", r: "review", p: "templates" };
          const next = shortcuts[event.key.toLowerCase()];
          if (next) { event.preventDefault(); chooseView(next); }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [selectedId, onSelectedId, onClose]);
      const add = () => { const title = draft.trim(); if (title) store.add(title, { projectPath: scope === "global" ? "" : viewProjectPath, status: view === "today" ? "pending" : "inbox", priority: "medium", owner: "human", plannedFor: view === "today" ? today : "" }).then(() => setDraft("")).catch(() => {}); };
      const renderCards = (items) => items.length ? items.map((task) => jsxRuntime.jsx(WorkbenchTaskCard, { task, store, onOpen: onSelectedId }, task.id)) : jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "这里暂时没有任务" });
      let body;
      if (view === "ideas") {
        body = jsxRuntime.jsx(WorkbenchIdeas, { store, projectPath: viewProjectPath, scope, query, onOpenCollaboration: (id, orchestration) => {
          if (orchestration) {
            setViewProjectPath(orchestration.projectPath || "");
            setScope(orchestration.projectPath ? "current" : "all");
          }
          setCollaborationInitialId(id || null);
          chooseView("orchestrate");
        } });
      } else if (view === "orchestrate") {
        body = jsxRuntime.jsx(WorkbenchOrchestration, { store, projectPath: viewProjectPath, scope, query, initialId: collaborationInitialId, onOpenIdeas: () => chooseView("ideas") });
      } else if (view === "templates") {
        body = store.templates.length ? jsxRuntime.jsx("div", { className: "wb-template-grid", children: store.templates.map((template) => jsxRuntime.jsxs("section", { className: "wb-template-card", children: [
          jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("h3", { children: template.title }), jsxRuntime.jsx("div", { className: "wb-task-group-meta", children: template.steps.length + " 个步骤 · 可用于任意项目" })] }),
          template.description && jsxRuntime.jsx("div", { className: "wb-tb-meta", children: template.description }),
          jsxRuntime.jsx("div", { className: "wb-template-steps", children: template.steps.slice(0, 8).map((step, index) => jsxRuntime.jsxs("div", { className: "wb-template-step", children: [jsxRuntime.jsx("span", { children: index + 1 }), jsxRuntime.jsx("span", { children: step.title })] }, index)) }),
          template.steps.length > 8 && jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "还有 " + (template.steps.length - 8) + " 个步骤" }),
          jsxRuntime.jsxs("div", { className: "wb-template-actions", children: [
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !viewProjectPath, onClick: () => store.mutate("template_apply", { templateId: template.id, projectPath: viewProjectPath }).then(() => { chooseScope("current"); chooseView("today"); }).catch(() => {}), children: "应用到所选项目" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: store.busy, onClick: () => { if (window.confirm("确定删除这个流程模板吗？")) store.mutate("template_remove", { templateId: template.id }).catch(() => {}); }, children: "删除" })
          ] })
        ] }, template.id)) }) : jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "还没有流程模板。可以在 Agent 计划中点击“全部收进工作台”创建。" });
      } else if (view === "board") {
        body = jsxRuntime.jsx("div", { className: "wb-task-center-board", children: WB_TASK_COLUMNS.map((column) => {
          const items = visible.filter((task) => task.status === column.key);
          return jsxRuntime.jsxs("section", { className: "wb-task-center-col" + (dragOver === column.key ? " wb-task-center-col-over" : ""), onDragOver: (e) => { e.preventDefault(); setDragOver(column.key); }, onDragLeave: () => setDragOver(null), onDrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); setDragOver(null); if (id) store.update(id, { status: column.key }).catch(() => {}); }, children: [
            jsxRuntime.jsxs("div", { className: "wb-task-center-col-head", children: [jsxRuntime.jsx("span", { children: column.label }), jsxRuntime.jsx("span", { className: "wb-board-col-count", children: items.length })] }),
            items.length ? items.map((task) => jsxRuntime.jsx(WorkbenchTaskCard, { task, store, onOpen: onSelectedId }, task.id)) : jsxRuntime.jsx("div", { className: "wb-board-empty", children: "拖到这里" })
          ] }, column.key);
        }) });
      } else if (view === "list") {
        body = jsxRuntime.jsxs("div", { className: "wb-task-panel", children: [
          jsxRuntime.jsxs("div", { className: "wb-task-list-row wb-task-list-head", children: [jsxRuntime.jsx("span", { children: "任务" }), jsxRuntime.jsx("span", { children: "状态" }), jsxRuntime.jsx("span", { children: "优先级" }), jsxRuntime.jsx("span", { children: "执行者" }), jsxRuntime.jsx("span", { children: "日期" })] }),
          visible.map((task) => jsxRuntime.jsxs("div", { className: "wb-task-list-row", children: [
            jsxRuntime.jsx("span", { className: "wb-task-list-title", onClick: () => onSelectedId(task.id), title: task.groupTitle || task.title, children: task.groupId ? task.groupTitle + " · " + task.title : task.title }),
            jsxRuntime.jsx("select", { value: task.status, onChange: (e) => store.update(task.id, { status: e.target.value }).catch(() => {}), children: WB_TASK_COLUMNS.map((item) => jsxRuntime.jsx("option", { value: item.key, children: item.label }, item.key)) }),
            jsxRuntime.jsx("select", { value: task.priority, onChange: (e) => store.update(task.id, { priority: e.target.value }).catch(() => {}), children: Object.keys(WB_PRIORITY_LABEL).map((key) => jsxRuntime.jsx("option", { value: key, children: WB_PRIORITY_LABEL[key] }, key)) }),
            jsxRuntime.jsx("select", { value: task.owner || "human", onChange: (e) => store.update(task.id, { owner: e.target.value }).catch(() => {}), children: Object.keys(WB_OWNER_LABEL).map((key) => jsxRuntime.jsx("option", { value: key, children: WB_OWNER_LABEL[key] }, key)) }),
            jsxRuntime.jsx("span", { children: wbDateLabel(task.plannedFor || task.dueAt) })
          ] }, task.id))
        ] });
      } else if (view === "timeline") {
        const groups = new Map();
        visible.filter((task) => task.status !== "completed").forEach((task) => { const key = String(task.plannedFor || task.dueAt || "").slice(0, 10) || "unscheduled"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(task); });
        const keys = [...groups.keys()].sort((a, b) => a === "unscheduled" ? 1 : b === "unscheduled" ? -1 : a.localeCompare(b));
        body = jsxRuntime.jsx("div", { className: "wb-task-timeline", children: keys.length ? keys.map((key) => jsxRuntime.jsxs("div", { className: "wb-task-date-group", children: [
          jsxRuntime.jsx("div", { className: "wb-task-date-label", children: key === "unscheduled" ? "未安排" : (key === today ? "今天 · " : "") + wbDateLabel(key) }),
          jsxRuntime.jsx("div", { className: "wb-task-date-items", children: groups.get(key).map((task) => jsxRuntime.jsx(WorkbenchTaskCard, { task, store, onOpen: onSelectedId }, task.id)) })
        ] }, key)) : jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "还没有可以排期的任务" }) });
      } else if (view === "review") {
        const cutoff = Date.now() - 7 * 86400000;
        const weekDone = completed.filter((task) => Date.parse(task.completedAt || task.updatedAt || 0) >= cutoff);
        const total = scopedTasks.length;
        body = jsxRuntime.jsxs(React.Fragment, { children: [
          jsxRuntime.jsxs("div", { className: "wb-task-review-stats", children: [
            jsxRuntime.jsxs("div", { className: "wb-task-review-stat", children: [jsxRuntime.jsx("strong", { children: weekDone.length }), jsxRuntime.jsx("span", { children: "近 7 天完成" })] }),
            jsxRuntime.jsxs("div", { className: "wb-task-review-stat", children: [jsxRuntime.jsx("strong", { children: active.length }), jsxRuntime.jsx("span", { children: "正在推进" })] }),
            jsxRuntime.jsxs("div", { className: "wb-task-review-stat", children: [jsxRuntime.jsx("strong", { children: blocked.length }), jsxRuntime.jsx("span", { children: "需要解阻" })] }),
            jsxRuntime.jsxs("div", { className: "wb-task-review-stat", children: [jsxRuntime.jsx("strong", { children: total ? Math.round(completed.length / total * 100) + "%" : "0%" }), jsxRuntime.jsx("span", { children: "整体完成率" })] })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-task-panel", children: [jsxRuntime.jsxs("div", { className: "wb-task-panel-head", children: [jsxRuntime.jsx("span", { children: "最近完成" }), jsxRuntime.jsx("span", { children: weekDone.length })] }), renderCards(weekDone.slice(0, 12))] }),
          blocked.length > 0 && jsxRuntime.jsxs("div", { className: "wb-task-panel", children: [jsxRuntime.jsxs("div", { className: "wb-task-panel-head", children: [jsxRuntime.jsx("span", { children: "等待处理" }), jsxRuntime.jsx("span", { children: blocked.length })] }), renderCards(blocked)] })
        ] });
      } else {
        body = jsxRuntime.jsxs("div", { className: "wb-task-today-grid", children: [
          jsxRuntime.jsxs("div", { children: [
            jsxRuntime.jsxs("section", { className: "wb-task-panel", children: [jsxRuntime.jsxs("div", { className: "wb-task-panel-head", children: [jsxRuntime.jsx("span", { children: "正在进行" }), jsxRuntime.jsx("span", { children: active.length + " / 建议最多 2" })] }), renderCards(active)] }),
            jsxRuntime.jsxs("section", { className: "wb-task-panel", children: [jsxRuntime.jsxs("div", { className: "wb-task-panel-head", children: [jsxRuntime.jsx("span", { children: "今天要完成" }), jsxRuntime.jsx("span", { children: todayItems.length })] }), renderCards(todayItems.filter((task) => task.status !== "in_progress"))] })
          ] }),
          jsxRuntime.jsxs("div", { children: [
            jsxRuntime.jsxs("section", { className: "wb-task-panel", children: [jsxRuntime.jsxs("div", { className: "wb-task-panel-head", children: [jsxRuntime.jsx("span", { children: "建议下一步" }), jsxRuntime.jsx("span", { children: "按优先级" })] }), renderCards(suggested)] }),
            blocked.length > 0 && jsxRuntime.jsxs("section", { className: "wb-task-panel", children: [jsxRuntime.jsxs("div", { className: "wb-task-panel-head", children: [jsxRuntime.jsx("span", { children: "需要解阻" }), jsxRuntime.jsx("span", { children: blocked.length })] }), renderCards(blocked)] })
          ] })
        ] });
      }
      return jsxRuntime.jsxs("div", { className: "wb-task-center-shell", role: "dialog", "aria-modal": true, "aria-label": "任务中心", children: [
        jsxRuntime.jsxs("main", { className: "wb-task-center", children: [
          jsxRuntime.jsxs("header", { className: "wb-task-center-head", children: [
            jsxRuntime.jsxs("div", { className: "wb-task-center-brand", children: [jsxRuntime.jsx("strong", { children: "任务中心" }), jsxRuntime.jsx("span", { children: "收集 · 聚焦 · 执行 · 复盘" })] }),
            jsxRuntime.jsx("nav", { className: "wb-task-center-tabs", children: WB_PRIMARY_VIEWS.map((item) => {
              const active = item.id === "tasks" ? WB_TASK_SUBVIEWS.some((sub) => sub.id === view) : view === item.id;
              return jsxRuntime.jsx("button", { type: "button", className: "wb-task-center-tab" + (active ? " wb-task-center-tab-active" : ""), title: item.label, onClick: () => chooseView(item.id), children: item.label }, item.id);
            }) }),
            jsxRuntime.jsxs("div", { className: "wb-task-center-tools", children: [jsxRuntime.jsx("input", { ref: searchRef, className: "wb-task-center-search", value: query, placeholder: "搜索任务、备注或标签…", title: "快捷键：/ 或 Ctrl+K", onChange: (e) => setQuery(e.target.value) }), jsxRuntime.jsx("button", { type: "button", className: "wb-task-center-close", title: "关闭任务中心（Esc）", onClick: onClose, children: "×" })] })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-task-center-body", children: [
            jsxRuntime.jsxs("div", { className: "wb-task-view-head", children: [
              jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("h2", { children: (WB_TASK_VIEWS.find((item) => item.id === view) || { label: "任务" }).label }), jsxRuntime.jsx("p", { children: scope === "all" ? "全部项目" : scope === "global" ? "全局任务" : (viewProjectPath || "未选择项目") })] }),
              jsxRuntime.jsxs("div", { className: "wb-task-create", children: [
                jsxRuntime.jsxs("select", { className: "wb-task-project-select", value: viewProjectPath, disabled: projectOptions.length === 0, onChange: (e) => chooseProject(e.target.value), title: "切换任务中心正在查看的项目", children: [
                  projectOptions.length === 0 && jsxRuntime.jsx("option", { value: "", children: "暂无项目" }),
                  projectOptions.map((item) => jsxRuntime.jsx("option", { value: item.path, children: item.label }, item.path))
                ] }),
                jsxRuntime.jsx("div", { className: "wb-task-scope", children: [{ id: "current", label: "所选项目" }, { id: "all", label: "全部项目" }, { id: "global", label: "全局任务" }].map((item) => jsxRuntime.jsx("button", { type: "button", className: scope === item.id ? "wb-task-scope-active" : "", onClick: () => chooseScope(item.id), children: item.label }, item.id)) }),
                view !== "templates" && view !== "orchestrate" && view !== "ideas" && jsxRuntime.jsx("input", { ref: createRef, value: draft, placeholder: "新建任务，回车保存…", title: "快捷键：C", onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") add(); } }),
                view !== "templates" && view !== "orchestrate" && view !== "ideas" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: store.busy || !draft.trim(), onClick: add, children: "添加任务" })
              ] })
            ] }),
            WB_TASK_SUBVIEWS.some((item) => item.id === view) && jsxRuntime.jsx("nav", { className: "wb-task-subviews", children: WB_TASK_SUBVIEWS.map((item) => jsxRuntime.jsx("button", { type: "button", className: view === item.id ? "wb-task-subview-active" : "", onClick: () => chooseView(item.id), children: item.label }, item.id)) }),
            store.err && jsxRuntime.jsx(WbErrNote, { message: store.err }),
            view !== "templates" && view !== "orchestrate" && view !== "ideas" && taskGroups.length > 0 && jsxRuntime.jsx("div", { className: "wb-task-groups", children: taskGroups.map((group) => {
              const done = group.tasks.filter((task) => task.status === "completed").length;
              const pct = Math.round(done / Math.max(1, group.tasks.length) * 100);
              return jsxRuntime.jsxs("section", { className: "wb-task-group", children: [
                jsxRuntime.jsxs("div", { className: "wb-task-group-head", children: [jsxRuntime.jsx("div", { className: "wb-task-group-title", children: group.title }), jsxRuntime.jsx("span", { className: "wb-task-owner", children: done + "/" + group.tasks.length })] }),
                jsxRuntime.jsx("div", { className: "wb-task-group-meta", children: "完整流程 · " + pct + "%" }),
                jsxRuntime.jsx("div", { className: "wb-task-group-progress", children: jsxRuntime.jsx("span", { style: { width: pct + "%" } }) })
              ] }, group.id);
            }) }),
            store.loading ? jsxRuntime.jsx("div", { className: "wb-task-empty-state", children: "正在加载任务…" }) : body
          ] })
        ] }),
        selected && jsxRuntime.jsx(WorkbenchTaskDetail, { task: selected, store, onClose: () => onSelectedId(null) })
      ] });
    }

    function AgentPlanImportDialog({ title, onTitle, count, busy, onChoose, onClose }) {
      const options = [
        { id: "group", icon: "▦", title: "保存为任务组", desc: "保留流程名称、步骤顺序和整体进度，适合继续跟踪。", tag: "推荐" },
        { id: "independent", icon: "≡", title: "拆成独立任务", desc: "每一步单独进入当前项目，适合互不依赖的事项。", tag: "" },
        { id: "template", icon: "◇", title: "保存为流程模板", desc: "保存为全局模板，以后可以应用到任意项目。", tag: "可复用" }
      ];
      const dialog = jsxRuntime.jsx("div", { className: "wb-import-overlay", role: "dialog", "aria-modal": true, "aria-label": "保存 Agent 计划", onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); }, children: jsxRuntime.jsxs("div", { className: "wb-import-dialog", children: [
        jsxRuntime.jsx("h3", { children: "保存 Agent 计划" }),
        jsxRuntime.jsx("p", { children: "当前共有 " + count + " 个步骤。选择保存方式；原 Agent 计划不会被删除。" }),
        jsxRuntime.jsx("input", { className: "wb-import-name", value: title, onChange: (e) => onTitle(e.target.value), placeholder: "流程或模板名称…", autoFocus: true }),
        jsxRuntime.jsx("div", { className: "wb-import-options", children: options.map((option) => jsxRuntime.jsxs("button", { type: "button", className: "wb-import-option", disabled: busy || !title.trim(), onClick: () => onChoose(option.id), children: [
          jsxRuntime.jsx("span", { className: "wb-import-option-icon", children: option.icon }),
          jsxRuntime.jsxs("span", { children: [jsxRuntime.jsx("strong", { children: option.title }), jsxRuntime.jsx("small", { children: option.desc })] }),
          option.tag && jsxRuntime.jsx("span", { className: "wb-task-owner", children: option.tag })
        ] }, option.id)) }),
        jsxRuntime.jsx("div", { className: "wb-import-cancel", children: jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: onClose, children: "取消" }) })
      ] }) });
      return typeof document !== "undefined" && ReactDOM && typeof ReactDOM.createPortal === "function" ? ReactDOM.createPortal(dialog, document.body) : dialog;
    }

    function AgentPlanTasks({ sessionId, projectPath, compact, onWorkbenchChanged }) {
      const rawGoal = useProjectionValue(sessionId, "goal");
      const todos = useProjectionValue(sessionId, "todos") || [];
      const goal = rawGoal && rawGoal.goal ? rawGoal.goal : null;
      const roundsStarted = rawGoal ? rawGoal.roundsStarted : 0;
      const [query, setQuery] = React.useState("");
      const [sortBy, setSortBy] = React.useState("order");
      const [addDraft, setAddDraft] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState(null);
      const [editingGoal, setEditingGoal] = React.useState(false);
      const [goalDraft, setGoalDraft] = React.useState("");
      const [editingContent, setEditingContent] = React.useState(null);
      const [editDraft, setEditDraft] = React.useState("");
      const [dragFrom, setDragFrom] = React.useState(null);
      const [dragOverCol, setDragOverCol] = React.useState(null);
      const [importOpen, setImportOpen] = React.useState(false);
      const [importName, setImportName] = React.useState("");
      const [notice, setNotice] = React.useState("");
      const session = wbSessionOf(sessionId);

      const openImport = () => {
        if (todos.length === 0) {
          setErr("当前 Agent 计划还没有可保存的步骤；请先让 Agent 生成计划，或在下方添加一步。");
          setNotice("");
          return;
        }
        setImportName((goal && goal.objective) || ("Agent 计划 · " + wbTodayKey()));
        setImportOpen(true); setNotice(""); setErr(null);
      };
      const importToWorkbench = (items, options) => {
        const picked = Array.isArray(items) ? items : [];
        if (picked.length === 0) return;
        const settings = options || { importMode: "independent" };
        setBusy(true); setErr(null);
        fetch("/api/dsh-workbench/tasks/mutate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "import", scope: "all", projectPath: projectPath || "", sourceSessionId: sessionId || "", items: picked, importMode: settings.importMode || "independent", groupTitle: settings.groupTitle || "" })
        })
          .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
          .then(({ ok, data }) => {
            if (!ok) throw new Error(data.message || "收进工作台失败");
            setImportOpen(false);
            setNotice(settings.importMode === "template" ? "已保存为全局流程模板" : settings.importMode === "group" ? "已保存为完整任务组" : "已收进当前项目");
            if (typeof onWorkbenchChanged === "function") onWorkbenchChanged();
          })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setBusy(false));
      };

      // ---- write channel: whole-list replace via host /todo command ----
      const applyTodos = (next) => {
        if (!session || !session.command) { setErr("会话命令通道不可用"); return; }
        setBusy(true); setErr(null);
        session.command("/todo replace " + JSON.stringify(next))
          .then((r) => {
            if (!r.ok) setErr((r.error && r.error.message) || "任务更新失败");
            else if (r.value && r.value.matched === false) setErr("未找到 /todo 命令（host 可能未重启）");
          })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setBusy(false));
      };
      const setStatus = (content, status) => {
        applyTodos(todos.map((t) => (t.content === content ? { content: t.content, status } : t)));
      };
      const toggleDone = (item) => setStatus(item.content, item.status === "completed" ? "pending" : "completed");
      const removeTodo = (content) => applyTodos(todos.filter((t) => t.content !== content));
      const addTodo = () => {
        const text = addDraft.trim();
        if (!text) return;
        if (todos.some((t) => t.content === text)) { setErr("任务已存在：" + text); return; }
        applyTodos([...todos, { content: text, status: "pending" }]);
        setAddDraft("");
      };
      const commitEdit = () => {
        const text = (editDraft || "").trim();
        const old = editingContent;
        setEditingContent(null);
        if (!text || !old || text === old) return;
        if (todos.some((t) => t.content === text)) { setErr("任务已存在：" + text); return; }
        applyTodos(todos.map((t) => (t.content === old ? { content: text, status: t.status } : t)));
      };

      // ---- goal mutations via native remote verbs ----
      const goalRef = goal ? { id: goal.id, revision: goal.revision } : null;
      const goalRemote = WB_SVC.remote && WB_SVC.remote.goals;
      const goalAction = (verb, arg) => {
        if (!goalRemote || !goalRef) { setErr("目标服务不可用"); return; }
        const fn = verb === "edit" ? goalRemote.edit : goalRemote[verb];
        if (typeof fn !== "function") { setErr("目标操作不可用：" + verb); return; }
        setBusy(true); setErr(null);
        const call = verb === "edit"
          ? fn(sessionId, goalRef, { objective: arg })
          : fn(sessionId, goalRef);
        Promise.resolve(call)
          .then((r) => { if (r && r.ok === false) setErr((r.error && r.error.message) || "操作失败"); })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setBusy(false));
      };
      const startGoalEdit = () => { setGoalDraft(goal ? goal.objective : ""); setEditingGoal(true); setErr(null); };

      // ---- filter + sort ----
      const q = query.trim().toLowerCase();
      let visible = todos;
      if (q) visible = visible.filter((t) => t.content.toLowerCase().includes(q));
      if (sortBy === "alpha") visible = [...visible].sort((a, b) => a.content.localeCompare(b.content));

      const total = todos.length;
      const doneCount = todos.filter((t) => t.status === "completed").length;
      const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

      const onDragStart = (e, content) => { e.dataTransfer.setData("text/plain", content); setDragFrom(content); };
      const onDrop = (e, status) => {
        e.preventDefault();
        const content = e.dataTransfer.getData("text/plain") || dragFrom;
        setDragOverCol(null);
        setDragFrom(null);
        if (content) setStatus(content, status);
      };

      if (compact) return jsxRuntime.jsxs("div", { className: "wb-task-quick", children: [
        jsxRuntime.jsxs("div", { className: "wb-task-quick-head", children: [
          jsxRuntime.jsxs("div", { children: [jsxRuntime.jsx("div", { className: "wb-task-kicker", children: "CURRENT SESSION" }), jsxRuntime.jsx("div", { className: "wb-task-quick-title", children: "Agent 当前计划" })] }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: openImport, title: todos.length === 0 ? "当前计划没有可保存的步骤" : "选择任务组、独立任务或流程模板", children: "全部收进工作台" })
        ] }),
        goal && jsxRuntime.jsxs("div", { className: "wb-focus-card", children: [
          jsxRuntime.jsxs("div", { className: "wb-focus-section", children: [jsxRuntime.jsx("span", { className: "wb-focus-label", children: "当前目标" }), jsxRuntime.jsx("span", { className: "wb-tb-goal-phase", children: GOAL_PHASE_LABEL[goal.phase] || goal.phase })] }),
          editingGoal ? jsxRuntime.jsxs("div", { className: "wb-goal-edit", children: [
            jsxRuntime.jsx("input", { value: goalDraft, onChange: (e) => setGoalDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") { const text = goalDraft.trim(); if (text) { goalAction("edit", text); setEditingGoal(false); } } if (e.key === "Escape") setEditingGoal(false); }, autoFocus: true }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", onClick: () => { const text = goalDraft.trim(); if (text) { goalAction("edit", text); setEditingGoal(false); } }, children: "保存" })
          ] }) : jsxRuntime.jsx("div", { className: "wb-tb-session-title", children: goal.objective }),
          jsxRuntime.jsxs("div", { className: "wb-goal-progress", children: [jsxRuntime.jsx("div", { className: "wb-goal-progress-fill", style: { width: Math.min(100, Math.round((roundsStarted / Math.max(1, goal.maxGoalRounds)) * 100)) + "%" } })] }),
          !editingGoal && jsxRuntime.jsxs("div", { className: "wb-goal-actions", children: [
            goal.phase === "active" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: () => goalAction("pause"), children: "暂停" }),
            (goal.phase === "paused" || goal.phase === "blocked") && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: () => goalAction("resume"), children: "恢复" }),
            goal.phase !== "completed" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: startGoalEdit, children: "编辑" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: () => goalAction("clear"), children: "清除" })
          ] })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-task-quick-summary", children: [
          jsxRuntime.jsxs("div", { className: "wb-task-stat", children: [jsxRuntime.jsx("strong", { children: todos.filter((item) => item.status === "in_progress").length }), jsxRuntime.jsx("span", { children: "执行中" })] }),
          jsxRuntime.jsxs("div", { className: "wb-task-stat", children: [jsxRuntime.jsx("strong", { children: todos.filter((item) => item.status === "pending").length }), jsxRuntime.jsx("span", { children: "待执行" })] }),
          jsxRuntime.jsxs("div", { className: "wb-task-stat", children: [jsxRuntime.jsx("strong", { children: pct + "%" }), jsxRuntime.jsx("span", { children: "完成度" })] })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-task-quick-add", children: [
          jsxRuntime.jsx("input", { value: addDraft, placeholder: "给当前计划添加一步…", onChange: (e) => setAddDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") addTodo(); } }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: busy || !addDraft.trim(), onClick: addTodo, children: jsxRuntime.jsx(primitives.IconPlusOutline16, { size: 12 }) })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-focus-card", children: [
          jsxRuntime.jsxs("div", { className: "wb-focus-section", children: [jsxRuntime.jsx("span", { className: "wb-focus-label", children: "本轮执行步骤" }), jsxRuntime.jsx("span", { className: "wb-focus-count", children: doneCount + "/" + total })] }),
          todos.length === 0 ? jsxRuntime.jsx("div", { className: "wb-board-empty", children: "Agent 尚未生成本轮计划" }) : visible.map((item) => jsxRuntime.jsxs("div", { className: "wb-focus-row", children: [
            jsxRuntime.jsx("button", { type: "button", className: "wb-focus-check" + (item.status === "in_progress" ? " wb-focus-check-active" : ""), title: item.status === "completed" ? "恢复任务" : "标记完成", onClick: () => toggleDone(item), children: item.status === "completed" ? "✓" : item.status === "in_progress" ? "›" : "" }),
            editingContent === item.content ? jsxRuntime.jsxs("div", { className: "wb-goal-edit", style: { flex: 1, minWidth: 0 }, children: [jsxRuntime.jsx("input", { value: editDraft, onChange: (e) => setEditDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingContent(null); }, autoFocus: true }), jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", onClick: commitEdit, children: "存" })] }) : jsxRuntime.jsxs("div", { className: "wb-focus-main", children: [jsxRuntime.jsx("div", { className: "wb-focus-title", children: item.content }), jsxRuntime.jsx("select", { className: "wb-task-card-status", value: item.status, onChange: (e) => setStatus(item.content, e.target.value), children: TODO_COLUMNS.map((column) => jsxRuntime.jsx("option", { value: column.key, children: column.label }, column.key)) })] }),
            jsxRuntime.jsxs("div", { className: "wb-board-card-actions", style: { opacity: 1 }, children: [
              jsxRuntime.jsx("button", { type: "button", title: "作为独立任务收进当前项目", onClick: () => importToWorkbench([item], { importMode: "independent" }), children: "+" }),
              jsxRuntime.jsx("button", { type: "button", title: "编辑", onClick: () => { setEditingContent(item.content); setEditDraft(item.content); }, children: jsxRuntime.jsx(primitives.IconEditOutline16, { size: 11 }) }),
              jsxRuntime.jsx("button", { type: "button", title: "删除", onClick: () => removeTodo(item.content), children: jsxRuntime.jsx(primitives.IconTrashOutline16, { size: 11 }) })
            ] })
          ] }, item.content))
        ] }),
        jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "Agent 计划属于当前轮次，下一轮可能被清空或重写；需要长期保留的事项请收进工作台。" }),
        notice && jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "✓ " + notice }),
        err && jsxRuntime.jsx("div", { className: "wb-tb-err", children: err }),
        importOpen && jsxRuntime.jsx(AgentPlanImportDialog, { title: importName, onTitle: setImportName, count: todos.length, busy, onChoose: (mode) => importToWorkbench(todos, { importMode: mode, groupTitle: importName }), onClose: () => setImportOpen(false) })
      ] });

      return jsxRuntime.jsxs(React.Fragment, { children: [
        jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsxs("div", { className: "wb-tb-progress-meta", children: [
            jsxRuntime.jsx("span", { className: "wb-tb-card-title", children: "Agent 当前计划" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: openImport, title: todos.length === 0 ? "当前计划没有可保存的步骤" : "选择任务组、独立任务或流程模板", children: "全部收进工作台" })
          ] }),
          jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "这是模型当前轮次的临时计划，下一轮可能被清空或重写；长期事项请收进工作台。" })
        ] }),
        // ---- goal card ----
        jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsx("div", { className: "wb-tb-card-title", children: "当前目标" }),
          !goal ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "无进行中的目标（可在输入框用 /goal 创建）" }) : jsxRuntime.jsxs(React.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "wb-tb-session-title", children: goal.objective }),
            jsxRuntime.jsxs("div", { className: "wb-tb-meta", children: [
              jsxRuntime.jsx("span", { className: "wb-tb-goal-phase", children: GOAL_PHASE_LABEL[goal.phase] || goal.phase }),
              jsxRuntime.jsx("span", { className: "wb-goal-rounds", children: "轮次 " + roundsStarted + "/" + goal.maxGoalRounds })
            ] }),
            jsxRuntime.jsxs("div", { className: "wb-goal-progress", children: [
              jsxRuntime.jsx("div", { className: "wb-goal-progress-fill", style: { width: Math.min(100, Math.round((roundsStarted / Math.max(1, goal.maxGoalRounds)) * 100)) + "%" } })
            ] }),
            editingGoal ? jsxRuntime.jsxs("div", { className: "wb-goal-edit", children: [
              jsxRuntime.jsx("input", { value: goalDraft, onChange: (e) => setGoalDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") { const t = goalDraft.trim(); if (t) { goalAction("edit", t); setEditingGoal(false); } } if (e.key === "Escape") setEditingGoal(false); }, autoFocus: true, placeholder: "新的目标…" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: busy || !goalDraft.trim(), onClick: () => { const t = goalDraft.trim(); if (t) { goalAction("edit", t); setEditingGoal(false); } }, children: "保存" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: () => setEditingGoal(false), children: "取消" })
            ] }) : jsxRuntime.jsxs("div", { className: "wb-goal-actions", children: [
              (goal.phase === "active") && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: () => goalAction("pause"), title: "暂停目标", children: "暂停" }),
              (goal.phase === "paused" || goal.phase === "blocked") && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: () => goalAction("resume"), title: "恢复目标", children: "恢复" }),
              goal.phase !== "completed" && jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: startGoalEdit, title: "编辑目标", children: "编辑" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy, onClick: () => goalAction("clear"), title: "清除目标", children: "清除" })
            ] })
          ] })
        ] }),
        // ---- progress ----
        jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsxs("div", { className: "wb-tb-progress-meta", children: [
            jsxRuntime.jsx("span", { children: "完成度" }),
            jsxRuntime.jsx("span", { children: doneCount + "/" + total + "（" + pct + "%）" })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-tb-progress", children: [
            jsxRuntime.jsx("div", { className: "wb-tb-progress-fill", style: { width: pct + "%" } })
          ] }),
          err && jsxRuntime.jsx("div", { className: "wb-tb-err", children: err })
        ] }),
        // ---- search + add + sort ----
        jsxRuntime.jsx("div", { className: "wb-tb-card", children: [
          jsxRuntime.jsxs("div", { className: "wb-tb-search", children: [
            jsxRuntime.jsx(primitives.IconSearchOutline16, { size: 12 }),
            jsxRuntime.jsx("input", { value: query, placeholder: "过滤任务…", onChange: (e) => setQuery(e.target.value) })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-tb-add", children: [
            jsxRuntime.jsx("input", { value: addDraft, placeholder: "新任务，回车添加…", onChange: (e) => setAddDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") addTodo(); } }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: busy || !addDraft.trim(), onClick: addTodo, title: "添加任务", children: jsxRuntime.jsx(primitives.IconPlusOutline16, { size: 12 }) })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-tb-sort", children: [
            jsxRuntime.jsx("span", { children: "排序" }),
            jsxRuntime.jsx("select", { value: sortBy, onChange: (e) => setSortBy(e.target.value), children: [
              jsxRuntime.jsx("option", { value: "order", children: "默认顺序" }),
              jsxRuntime.jsx("option", { value: "alpha", children: "按内容" })
            ] })
          ] })
        ] }),
        // ---- kanban columns ----
        todos.length === 0 && !q ? jsxRuntime.jsx("div", { className: "wb-tb-card", children: jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "当前会话还没有任务（agent 会在规划时自动创建；也可在上方手动添加）" }) }) : jsxRuntime.jsx("div", { className: "wb-board", children: TODO_COLUMNS.map((col) => {
          const items = visible.filter((t) => t.status === col.key);
          const count = todos.filter((t) => t.status === col.key).length;
          return jsxRuntime.jsxs("div", {
            className: "wb-board-col" + (dragOverCol === col.key ? " wb-board-col-drag" : ""),
            onDragOver: (e) => { e.preventDefault(); setDragOverCol(col.key); },
            onDragLeave: () => setDragOverCol((c) => (c === col.key ? null : c)),
            onDrop: (e) => onDrop(e, col.key),
            children: [
              jsxRuntime.jsxs("div", { className: "wb-board-col-head", children: [
                jsxRuntime.jsx("span", { children: col.label }),
                jsxRuntime.jsx("span", { className: "wb-board-col-count", children: count })
              ] }),
              items.length === 0 ? jsxRuntime.jsx("div", { className: "wb-board-empty", children: q ? "无匹配" : "—" }) : items.map((item) => jsxRuntime.jsxs("div", {
                className: "wb-board-card" + (item.status === "completed" ? " wb-board-card-done" : ""),
                draggable: true,
                onDragStart: (e) => onDragStart(e, item.content),
                onDragEnd: () => { setDragFrom(null); setDragOverCol(null); },
                children: [
                  jsxRuntime.jsx("button", { type: "button", className: "wb-board-dot" + (item.status === "completed" ? " wb-board-dot-done" : item.status === "in_progress" ? " wb-board-dot-run" : ""), title: item.status === "completed" ? "取消完成" : "标记完成", onClick: () => toggleDone(item), children: item.status === "completed" ? "✓" : "" }),
                  editingContent === item.content ? jsxRuntime.jsxs("div", { className: "wb-goal-edit", style: { flex: 1, minWidth: 0 }, children: [
                    jsxRuntime.jsx("input", { value: editDraft, onChange: (e) => setEditDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingContent(null); }, autoFocus: true }),
                    jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: !editDraft.trim(), onClick: commitEdit, children: "存" }),
                    jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", onClick: () => setEditingContent(null), children: "×" })
                  ] }) : jsxRuntime.jsx("span", { className: "wb-board-card-content", children: item.content }),
                  jsxRuntime.jsxs("div", { className: "wb-board-card-actions", children: [
                    jsxRuntime.jsx("button", { type: "button", title: "作为独立任务收进当前项目", onClick: () => importToWorkbench([item], { importMode: "independent" }), children: "+" }),
                    jsxRuntime.jsx("button", { type: "button", title: "编辑任务", onClick: () => { setEditingContent(item.content); setEditDraft(item.content); setErr(null); }, children: jsxRuntime.jsx(primitives.IconEditOutline16, { size: 11 }) }),
                    jsxRuntime.jsx("button", { type: "button", title: "删除任务", onClick: () => removeTodo(item.content), children: jsxRuntime.jsx(primitives.IconTrashOutline16, { size: 11 }) })
                  ] })
                ]
              }, item.content))
            ]
          }, col.key);
        }) }),
        notice && jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "✓ " + notice }),
        importOpen && jsxRuntime.jsx(AgentPlanImportDialog, { title: importName, onTitle: setImportName, count: todos.length, busy, onChoose: (mode) => importToWorkbench(todos, { importMode: mode, groupTitle: importName }), onClose: () => setImportOpen(false) })
      ] });
    }


    // 文件视图 (P2): browse project dirs via host fs routes; open files in an editor.
    function ToolbarFiles({ cwd }) {
      const [path, setPath] = React.useState("");
      const [entries, setEntries] = React.useState(null);
      const [fsError, setFsError] = React.useState(null);
      const [opened, setOpened] = React.useState(null);
      React.useEffect(() => { if (cwd) setPath((p) => p || cwd); }, [cwd]);
      const load = React.useCallback(() => {
        setFsError(null);
        fetch("/api/dsh-workbench/fs/list?path=" + encodeURIComponent(path))
          .then((r) => r.json()).then((body) => {
            if (body.error) setFsError(body.message || body.error);
            else setEntries(body.entries || []);
          }).catch((e) => setFsError(String((e && e.message) || e)));
      }, [path]);
      React.useEffect(load, [load]);
      const openFile = (full) => {
        setFsError(null);
        fetch("/api/dsh-workbench/fs/read?path=" + encodeURIComponent(full))
          .then((r) => r.json()).then((body) => {
            if (body.error) setFsError(body.message || body.error);
            else setOpened({ path: full, content: body.content, saved: true });
          }).catch((e) => setFsError(String((e && e.message) || e)));
      };
      const saveFile = () => {
        if (!opened) return;
        setFsError(null);
        fetch("/api/dsh-workbench/fs/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: opened.path, content: opened.content }) })
          .then((r) => r.json()).then((body) => {
            if (body.ok) setOpened((o) => ({ ...o, saved: true }));
            else setFsError(body.message || body.error);
          }).catch((e) => setFsError(String((e && e.message) || e)));
      };
      const crumbs = path ? path.split(/[\\/]+/).filter(Boolean) : [];
      const crumbPath = (i) => {
        // Windows drive paths: crumbs[0] is the drive ("D:"); crumbs[1..] are
        // the segments below it. The drive root crumb must be "D:\" alone, and
        // every deeper crumb appends after it — never re-joins the drive.
        if (/^[A-Za-z]:/.test(path)) return crumbs[0] + "\\" + crumbs.slice(1, i + 1).join("\\");
        const head = /^\//.test(path) ? "/" : "";
        return head + crumbs.slice(0, i + 1).join("/");
      };
      return jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
        jsxRuntime.jsx("div", { className: "wb-tb-card-title", children: "项目文件" }),
        !path ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "当前会话没有工作目录，请先在会话面板选择/创建项目。" }) : jsxRuntime.jsxs(React.Fragment, { children: [
          jsxRuntime.jsxs("div", { className: "wb-fs-crumbs", children: crumbs.map((c, i) => jsxRuntime.jsxs(React.Fragment, { children: [
            i > 0 && jsxRuntime.jsx("span", { className: "wb-fs-sep", children: "›" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-fs-crumb", onClick: () => { setPath(crumbPath(i)); setOpened(null); }, children: c })
          ] }, i)) }),
          fsError && jsxRuntime.jsx("div", { className: "wb-tb-empty", children: fsError }),
          entries === null ? (!fsError ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "加载中…" }) : null) : jsxRuntime.jsx("div", { className: "wb-fs-list", children: entries.map((e) => jsxRuntime.jsx("button", {
            type: "button",
            className: "wb-fs-row" + (e.isDir ? " wb-fs-dir" : ""),
            title: e.isDir ? "打开目录" : "打开文件",
            onClick: () => { if (e.isDir) { setPath(joinPath(path, e.name)); setOpened(null); } else openFile(joinPath(path, e.name)); },
            children: [
              jsxRuntime.jsx("span", { className: "wb-fs-icon", children: e.isDir ? "📁" : "📄" }),
              jsxRuntime.jsx("span", { className: "wb-fs-name", children: e.name }),
              !e.isDir && jsxRuntime.jsx("span", { className: "wb-fs-size", children: fmtSize(e.size) })
            ]
          }, e.name)) })
        ] }),
        opened && jsxRuntime.jsxs("div", { className: "wb-fs-editor", children: [
          jsxRuntime.jsxs("div", { className: "wb-fs-editor-head", children: [
            jsxRuntime.jsx("span", { className: "wb-tb-session-title", children: basenameOf(opened.path) }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", onClick: saveFile, children: "保存" }),
            jsxRuntime.jsx("span", { className: "wb-fs-saved", children: opened.saved ? "已保存" : "未保存" })
          ] }),
          jsxRuntime.jsx("textarea", { value: opened.content, spellCheck: false, onChange: (e) => setOpened((o) => ({ ...o, content: e.target.value, saved: false })) })
        ] })
      ] });
    }
    function joinPath(a, b) { return a.endsWith("\\") || a.endsWith("/") ? a + b : a + "\\" + b; }
    function basenameOf(p) { const parts = String(p || "").split(/[\\/]+/).filter(Boolean); return parts[parts.length - 1] || p; }
    function fmtSize(n) {
      if (!n && n !== 0) return "";
      if (n < 1024) return n + " B";
      if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
      return (n / 1048576).toFixed(1) + " MB";
    }

    // Git图谱 (P2): host `git log --graph` text view.
    function ToolbarGit({ cwd }) {
      const [text, setText] = React.useState(null);
      const [gErr, setGErr] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        if (!cwd) return;
        fetch("/api/dsh-workbench/git/graph?path=" + encodeURIComponent(cwd))
          .then((r) => r.json()).then((body) => {
            if (!alive) return;
            setText(body.text || "");
            setGErr(body.error ? (body.message || body.error) : null);
          }).catch((e) => { if (alive) { setText(""); setGErr(String((e && e.message) || e)); } });
        return () => { alive = false; };
      }, [cwd]);
      return jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
        jsxRuntime.jsx("div", { className: "wb-tb-card-title", children: "Git 提交图谱" }),
        !cwd ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "当前会话没有工作目录" }) : gErr ? jsxRuntime.jsxs(React.Fragment, { children: [
          jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "不是 Git 仓库或 git 不可用：" }),
          jsxRuntime.jsx("div", { className: "wb-tb-meta", children: gErr })
        ] }) : text === null ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "加载中…" }) : text === "" ? jsxRuntime.jsx("div", { className: "wb-tb-empty", children: "没有提交记录" }) : jsxRuntime.jsx("pre", { className: "wb-git-text", children: text })
      ] });
    }

    // 蒸馏 (P6): standalone page, knowledge-base dependent.
    function ToolbarDistill() {
      return jsxRuntime.jsxs("div", { className: "wb-tb-card", children: [
        jsxRuntime.jsx("span", { className: "wb-page-badge", children: "建设中 · P6" }),
        jsxRuntime.jsx("div", { className: "wb-tb-session-title", children: "蒸馏本段对话" }),
        jsxRuntime.jsx("div", { className: "wb-tb-meta", children: "对话结束后点击，agent 自动提炼本段对话的重点/结论/可复用方法，写入本地知识库（markdown + 标签 + 索引）。待 P6 知识库方案讨论后开放。" }),
        jsxRuntime.jsx("button", { type: "button", className: "wb-tb-distill", disabled: true, title: "P6 知识库上线后开放", children: [
          jsxRuntime.jsx(primitives.IconThinkOutline16, { size: 14 }),
          jsxRuntime.jsx("span", { children: "开始蒸馏（P6 开放）" })
        ] })
      ] });
    }

    function WbToolbar({ useSessions, onClose }) {
      // Read primitive values only: a raw object selector would retrigger every render.
      const currentId = useSessions((s) => (s.current === void 0 ? void 0 : s.byId[s.current] ? s.current : void 0));
      const sessionsState = useSessions((s) => s);
      const summary = currentId === void 0 ? void 0 : sessionsState.byId[currentId];
      const [tab, setTab] = React.useState(() => { try { const value = localStorage.getItem("wb.tb") || "info"; return WB_TB_TABS.some((item) => item.id === value) ? value : "info"; } catch (e) { return "info"; } });
      const selectTab = (id) => { setTab(id); try { localStorage.setItem("wb.tb", id); } catch (e) {} };
      const [preset, setPreset] = React.useState(null);
      const presetId = summary && summary.agentPreset;
      React.useEffect(() => {
        let alive = true;
        setPreset(null);
        if (!presetId || !WB_SVC.api) return;
        WB_SVC.api.agentPresets.read({ agentPreset: presetId }).then((resp) => {
          if (!alive) return;
          if (resp && resp.result && resp.result.ok) setPreset(resp.result.value);
          else setPreset(null);
        }).catch(() => { if (alive) setPreset(null); });
        return () => { alive = false; };
      }, [presetId]);
      const st = summary ? statusOf(summary) : null;
      return jsxRuntime.jsxs("div", { className: "wb-tb", children: [
        jsxRuntime.jsxs("div", { className: "wb-tb-head", children: [
          jsxRuntime.jsx("div", { className: "wb-tb-tabs", children: WB_TB_TABS.map((t) => jsxRuntime.jsx("button", {
            type: "button",
            className: "wb-tb-tab" + (tab === t.id ? " wb-tb-tab-active" : ""),
            title: t.label,
            onClick: () => selectTab(t.id),
            children: t.label
          }, t.id)) }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-tb-close", title: "收起工具栏", onClick: onClose, children: jsxRuntime.jsx(primitives.IconChevronRightOutline14, { size: 14 }) })
        ] }),
        jsxRuntime.jsx("div", { className: "wb-tb-scroll", children: [
          tab === "info" && jsxRuntime.jsx(ToolbarInfo, { summary, preset, st }),
          tab === "files" && jsxRuntime.jsx(ToolbarFiles, { cwd: summary && summary.cwd }),
          tab === "git" && jsxRuntime.jsx(ToolbarGit, { cwd: summary && summary.cwd }),
          tab === "distill" && jsxRuntime.jsx(ToolbarDistill, {})
        ] })
      ] });
    }

    // ---- agent workspace: sessions column | conversation | toolbar ----
    function AgentWorkspace(props) {
      const { useStore, useSessions, useWorkspaces, actions, renderSlot, onToggleSessions } = props;
      const panels = useStore((s) => s);
      const currentId = useSessions((s) => (s.current === void 0 ? void 0 : s.byId[s.current] ? s.current : void 0));
      const frameRef = React.useRef(null);
      const [viewport, setViewport] = React.useState(() => window.innerWidth);
      React.useEffect(() => {
        const el = frameRef.current;
        if (el === null) return;
        let raf = null;
        const observer = new ResizeObserver(() => {
          raf ??= requestAnimationFrame(() => {
            raf = null;
            const width = el.getBoundingClientRect().width;
            if (width > 0) setViewport(width);
          });
        });
        observer.observe(el);
        return () => { observer.disconnect(); if (raf !== null) cancelAnimationFrame(raf); };
      }, []);
      const sidebarW = panels.sidebar > 0 ? clampWidth(panels.sidebar, 264, 420) : 0;
      const detailsW = currentId === void 0 ? 0 : (panels.details === 0 ? 0 : clampWidth(panels.details, 300, 520));
      const d = viewport > 860 && detailsW > 0 ? detailsW : 0;
      const sidebarBase = React.useRef(panels.sidebar || 280);
      const detailsBase = React.useRef(panels.details || 360);
      return jsxRuntime.jsxs("div", { className: "wb-agent", children: [
        jsxRuntime.jsxs("div", { ref: frameRef, className: "wb-agent-frame", style: { gridTemplateColumns: sidebarW + "px minmax(0, 1fr) " + d + "px" }, children: [
          sidebarW > 0 && jsxRuntime.jsx("div", { className: "wb-sp-col", style: { gridColumn: 1 }, children: jsxRuntime.jsx(SessionPanel, { useSessions, useWorkspaces, onClose: onToggleSessions }) }),
          sidebarW > 0 && jsxRuntime.jsx(DragHandle, { side: "sidebar", left: sidebarW, onStart: () => { sidebarBase.current = panels.sidebar; }, onDrag: (delta) => actions.setSidebar(sidebarBase.current + delta), onEnd: () => {} }),
          jsxRuntime.jsx(CenterColumn, { children: renderSlot("conversation", {}) }),
          d > 0 && jsxRuntime.jsx("div", { className: "wb-tb-col", style: { gridColumn: 3 }, children: jsxRuntime.jsx(WbToolbar, { useSessions, onClose: () => actions.closeDetails() }) }),
          d > 0 && jsxRuntime.jsx(DragHandle, { side: "details", left: viewport - d, onStart: () => { detailsBase.current = panels.details; }, onDrag: (delta) => actions.setDetails(detailsBase.current - delta), onEnd: () => {} })
        ] }),
        sidebarW === 0 && jsxRuntime.jsx("button", {
          type: "button",
          className: "wb-sp-reopen",
          title: "打开会话列表",
          onClick: onToggleSessions,
          children: jsxRuntime.jsx(primitives.IconPanelLeftOutline16, { size: 14 })
        }),
        d === 0 && viewport > 860 && jsxRuntime.jsx("button", {
          type: "button",
          className: "wb-tb-reopen",
          title: "打开工具栏",
          onClick: () => actions.openDetails(),
          children: jsxRuntime.jsx(primitives.IconThinkOutline16, { size: 14 })
        }),
        jsxRuntime.jsx("div", { className: appframeCss.overlayLayer, "data-shell-overlay": true, children: renderSlot("shell.overlay", {}) })
      ] });
    }

    function WorkbenchNav({ page, onSelect, expanded, onToggle, renderSlot, useSessions, useWorkspaces }) {
      const currentId = useSessions((s) => (s.current === void 0 ? void 0 : s.byId[s.current] ? s.current : void 0));
      const sessionsState = useSessions((s) => s);
      const workspacesState = useWorkspaces((s) => s);
      const summary = currentId === void 0 ? void 0 : sessionsState.byId[currentId];
      const projectPath = summary && summary.cwd ? summary.cwd : "";
      const store = useWorkbenchTasks(currentId, projectPath);
      const [taskCenterOpen, setTaskCenterOpen] = React.useState(false);
      const [taskCenterView, setTaskCenterView] = React.useState("today");
      const [selectedTaskId, setSelectedTaskId] = React.useState(null);
      const ideaScope = projectPath ? "current" : "global";
      const projectIdeas = wbTasksForScope(store.ideas, projectPath, ideaScope);
      const activeIdeas = projectIdeas.filter((item) => item.status !== "promoted" && item.status !== "archived").sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      const activeTasks = wbTasksForScope(store.tasks, projectPath, ideaScope).filter((item) => item.status !== "completed");
      const openTaskCenter = (view) => {
        const next = view || "today";
        setTaskCenterView(next);
        setTaskCenterOpen(true);
        setSelectedTaskId(null);
        try { localStorage.setItem("wb.taskCenterView", next); } catch (e) {}
      };
      React.useEffect(() => {
        const handleOpenTaskCenter = (event) => {
          const next = event && event.detail && event.detail.view ? event.detail.view : "today";
          setTaskCenterView(next); setTaskCenterOpen(true); setSelectedTaskId(null);
          try { localStorage.setItem("wb.taskCenterView", next); } catch (e) {}
        };
        window.addEventListener("wb:open-task-center", handleOpenTaskCenter);
        return () => window.removeEventListener("wb:open-task-center", handleOpenTaskCenter);
      }, []);
      React.useEffect(() => {
        const handleTasksChanged = () => store.refresh();
        window.addEventListener("wb:tasks-changed", handleTasksChanged);
        return () => window.removeEventListener("wb:tasks-changed", handleTasksChanged);
      }, [store.refresh]);
      const renderPageButton = (p, main) => jsxRuntime.jsxs("button", {
        type: "button",
        className: "wb-nav-btn" + (main ? " wb-nav-btn-main" : "") + (page === p.id && !taskCenterOpen ? " wb-nav-btn-active" : ""),
        title: p.label,
        onClick: () => onSelect(p.id),
        children: [
          jsxRuntime.jsx("span", { className: "wb-nav-btn-icon", children: jsxRuntime.jsx(p.icon, { size: 16 }) }),
          jsxRuntime.jsx("span", { className: "wb-nav-label", children: p.label })
        ]
      }, p.id);
      const taskCenter = taskCenterOpen && jsxRuntime.jsx(WorkbenchTaskCenter, { store, workspaceItems: workspacesState.items || [], selectedId: selectedTaskId, onSelectedId: setSelectedTaskId, initialView: taskCenterView, onClose: () => { setTaskCenterOpen(false); setSelectedTaskId(null); } });
      return jsxRuntime.jsxs(React.Fragment, { children: [
        jsxRuntime.jsxs("aside", {
          className: "wb-nav " + (expanded ? "wb-nav-expanded" : "wb-nav-collapsed"),
          "aria-label": "工作台导航",
          children: [
            jsxRuntime.jsxs("div", { className: "wb-nav-brand", children: [
              jsxRuntime.jsx(primitives.IconCordisPluginOutline14, { size: 17 }),
              jsxRuntime.jsx("span", { className: "wb-nav-brand-label", children: "工作台" })
            ] }),
            jsxRuntime.jsxs("div", { className: "wb-nav-main", children: [
              jsxRuntime.jsx("div", { className: "wb-nav-section-label", children: "工作区" }),
              renderPageButton(PAGES.find((item) => item.id === "agent"), true),
              jsxRuntime.jsxs("button", { type: "button", className: "wb-nav-btn wb-nav-btn-main" + (taskCenterOpen && taskCenterView !== "ideas" ? " wb-nav-btn-active" : ""), title: "任务中心", onClick: () => openTaskCenter("today"), children: [jsxRuntime.jsx("span", { className: "wb-nav-btn-icon", children: jsxRuntime.jsx(primitives.IconThinkOutline16, { size: 16 }) }), jsxRuntime.jsx("span", { className: "wb-nav-label", children: "任务中心" }), activeTasks.length > 0 && jsxRuntime.jsx("span", { className: "wb-nav-badge", children: activeTasks.length })] }),
              jsxRuntime.jsxs("button", { type: "button", className: "wb-nav-btn" + (taskCenterOpen && taskCenterView === "ideas" ? " wb-nav-btn-active" : ""), title: "想法库", onClick: () => openTaskCenter("ideas"), children: [jsxRuntime.jsx("span", { className: "wb-nav-btn-icon", children: jsxRuntime.jsx(primitives.IconPlusOutline16, { size: 16 }) }), jsxRuntime.jsx("span", { className: "wb-nav-label", children: "想法库" }), activeIdeas.length > 0 && jsxRuntime.jsx("span", { className: "wb-nav-badge", children: activeIdeas.length })] }),
              jsxRuntime.jsx("div", { className: "wb-nav-section-label", children: "资源与自动化" }),
              PAGES.filter((item) => item.group === "assets").map((p) => renderPageButton(p, false)),
              jsxRuntime.jsx("div", { className: "wb-nav-section-label", children: "个性与系统" }),
              PAGES.filter((item) => item.group === "system").map((p) => renderPageButton(p, false))
            ] }),
            jsxRuntime.jsx("div", { className: "wb-nav-sep" }),
            jsxRuntime.jsxs("div", { className: "wb-nav-foot", children: [
              jsxRuntime.jsx("div", { children: renderSlot("sidebar.footer.action", { wide: expanded }) }),
              jsxRuntime.jsx("div", { children: renderSlot("sidebar.settings", { wide: expanded }) }),
              jsxRuntime.jsx("button", {
                type: "button",
                className: "wb-nav-btn wb-nav-arrow",
                title: expanded ? "收起侧边栏" : "展开侧边栏",
                onClick: onToggle,
                children: [
                  jsxRuntime.jsx("span", { className: "wb-nav-btn-icon", children: jsxRuntime.jsx(expanded ? primitives.IconChevronLeftOutline14 : primitives.IconChevronRightOutline14, { size: 14 }) }),
                  jsxRuntime.jsx("span", { className: "wb-nav-label", children: expanded ? "收起侧边栏" : "展开侧边栏" })
                ]
              })
            ] })
          ]
        }),
        taskCenter
      ] });
    }

    function WorkbenchPage({ id }) {
      const meta = PAGE_META[id] || { title: id, desc: "" };
      return jsxRuntime.jsx("div", { className: "wb-page", children: jsxRuntime.jsxs("div", { className: "wb-page-inner", children: [
        jsxRuntime.jsx("span", { className: "wb-page-badge", children: "建设中 · P1" }),
        jsxRuntime.jsx("h1", { className: "wb-page-title", children: meta.title }),
        jsxRuntime.jsx("p", { className: "wb-page-desc", children: meta.desc }),
        jsxRuntime.jsx("div", { className: "wb-page-card", children: "页面骨架已就位，具体功能随对应阶段（P2–P6）逐步落地。" })
      ] }) });
    }

    // ---- experts page (P2): preset cards — invoke / edit / copy / remove ----
    function wbFetchPresetFile(id, file) {
      return fetch("/api/dsh-workbench/preset/read?id=" + encodeURIComponent(id) + "&file=" + encodeURIComponent(file))
        .then((r) => r.json()).then((b) => { if (b.error) throw new Error(b.message || b.error); return b.content; });
    }
    function wbWritePresetFile(id, file, content) {
      return fetch("/api/dsh-workbench/preset/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, file, content }) })
        .then((r) => r.json()).then((b) => { if (b.error) throw new Error(b.message || b.error); });
    }
    // Edit-dialog chat: system prompt carries the preset files the user is
    // editing (left pane, live), so the assistant's advice matches current state.
    function buildChatSystem(preset, cordis, presetYml) {
      return "你是「专家编辑器助手」。用户正在编辑专家「" + (preset.name || preset.id) + "」（id: " + preset.id + "）。\n" +
        "以下是当前配置（用户可能在左侧手动修改过，以最新为准）：\n" +
        "—— agent.cordis.yml ——\n" + (cordis || "（空）") + "\n" +
        "—— preset.yml ——\n" + (presetYml || "（空）") + "\n\n" +
        "用户会提出修改要求（人格、工具、描述、技能等）。请直接给出修改建议：agent.cordis.yml 和 preset.yml 各自用 ```yaml 代码块给出改动后的完整内容或需替换的片段，标注清楚。只输出修改建议文本，不要执行文件操作。";
    }

    function ExpertsPage({ useWorkspaces, useSessions, onSelect }) {
      const [rows, setRows] = React.useState(null);
      const [pageError, setPageError] = React.useState(null);
      const [busy, setBusy] = React.useState("");
      const [editing, setEditing] = React.useState(null);
      const [saveState, setSaveState] = React.useState("");
      const [chatMsgs, setChatMsgs] = React.useState([]);
      const [chatInput, setChatInput] = React.useState("");
      const [chatBusy, setChatBusy] = React.useState(false);
      const wsItems = useWorkspaces((s) => (s.items || []));
      const sessionsState = useSessions((s) => s);
      const currentSession = sessionsState.current === void 0 ? void 0 : sessionsState.byId[sessionsState.current];
      const load = React.useCallback(() => {
        if (!WB_SVC.api) { setRows([]); return; }
        WB_SVC.api.agentPresets.list({}).then((resp) => {
          if (resp && resp.result && resp.result.ok) setRows(resp.result.value.presets || []);
          else { setRows([]); setPageError("预设列表加载失败"); }
        }).catch((e) => { setRows([]); setPageError(String((e && e.message) || e)); });
      }, []);
      React.useEffect(load, [load]);

      const invoke = (preset) => {
        if (!WB_SVC.workspaces || !WB_SVC.sessions || !WB_SVC.api) return;
        const ws = wsItems.find((w) => currentSession && normPath(w.path) === normPath(currentSession.cwd)) || wsItems[0];
        if (!ws) { setPageError("请先在会话面板创建/选择项目，再用专家开新会话"); return; }
        setBusy(preset.id);
        setPageError(null);
        WB_SVC.workspaces.connectWorkspace(ws.workspaceId).then((sid) => {
          if (!sid) throw new Error("创建会话失败");
          if (WB_SVC.sessions) WB_SVC.sessions.open(sid);
          return WB_SVC.api.agentPresets.select({ sessionId: sid, agentPreset: preset.id }).then((resp) => {
            if (!resp.result.ok) throw new Error(resp.result.error.message);
          });
        }).then(() => { setBusy(""); })
          .catch((e) => { setBusy(""); setPageError("调用失败：" + String((e && e.message) || e)); });
      };
      const openEdit = (preset) => {
        setPageError(null);
        setChatMsgs([]);
        Promise.all([wbFetchPresetFile(preset.id, "agent.cordis.yml"), wbFetchPresetFile(preset.id, "preset.yml")])
          .then(([cordis, presetYml]) => setEditing({ id: preset.id, name: preset.name || preset.id, cordis, presetYml }))
          .catch((e) => setPageError("读取失败：" + String((e && e.message) || e)));
      };
      const saveEdit = () => {
        if (!editing) return;
        setSaveState("saving");
        setPageError(null);
        Promise.all([
          wbWritePresetFile(editing.id, "agent.cordis.yml", editing.cordis),
          wbWritePresetFile(editing.id, "preset.yml", editing.presetYml)
        ]).then(() => {
          setSaveState("saved");
          setTimeout(() => setSaveState(""), 2500);
        }).catch((e) => { setSaveState(""); setPageError("保存失败：" + String((e && e.message) || e)); });
      };
      const sendChat = () => {
        const text = chatInput.trim();
        if (!text || chatBusy || !editing) return;
        const next = [...chatMsgs, { role: "user", content: text }];
        setChatMsgs(next);
        setChatInput("");
        setChatBusy(true);
        fetch("/api/dsh-workbench/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            system: buildChatSystem(editing, editing.cordis, editing.presetYml),
            messages: next.map((m) => ({ role: m.role, content: m.content }))
          })
        }).then((r) => r.json()).then((b) => {
          if (b.error && !b.reply) throw new Error(b.error);
          setChatMsgs((prev) => [...prev, { role: "assistant", content: b.reply || "（无回复）" }]);
        }).catch((e) => setChatMsgs((prev) => [...prev, { role: "assistant", content: "（请求失败）" + String((e && e.message) || e) }]))
          .finally(() => setChatBusy(false));
      };
      const copyReply = (text) => {
        try { navigator.clipboard.writeText(text); } catch (e) { /* noop */ }
      };
      const copyPreset = (preset) => {
        const newId = preset.id + "-copy-" + Date.now().toString(36);
        setBusy(preset.id + ":copy");
        setPageError(null);
        WB_SVC.api.agentPresets.copy({ from: preset.id, agentPreset: newId, name: (preset.name || preset.id) + " 副本" }).then((resp) => {
          if (!resp.result.ok) throw new Error(resp.result.error.message);
          load();
        }).catch((e) => setPageError("复制失败：" + String((e && e.message) || e)))
          .finally(() => setBusy(""));
      };
      const removePreset = (preset) => {
        if (preset.trust === "system") return;
        if (!window.confirm("确定删除专家「" + (preset.name || preset.id) + "」？该操作不可恢复。")) return;
        setBusy(preset.id + ":remove");
        setPageError(null);
        WB_SVC.api.agentPresets.remove({ agentPreset: preset.id }).then((resp) => {
          if (!resp.result.ok) throw new Error(resp.result.error.message);
          load();
        }).catch((e) => setPageError("删除失败：" + String((e && e.message) || e)))
          .finally(() => setBusy(""));
      };
      return jsxRuntime.jsxs("div", { className: "wb-page", children: [jsxRuntime.jsxs("div", { className: "wb-page-inner", children: [
        jsxRuntime.jsx("h1", { className: "wb-page-title", children: "专家" }),
        jsxRuntime.jsx("p", { className: "wb-page-desc", children: "每位专家 = 一套预设（人格 + 工具组合）。点击「调用」用该专家开新会话；「编辑」会打开一个对话窗口，直接跟 AI 说想怎么改；已产出内容的会话不能中途换专家（原生限制）。" }),
        pageError && jsxRuntime.jsx("div", { className: "wb-page-card wb-exp-error", children: pageError }),
        rows === null ? jsxRuntime.jsx("div", { className: "wb-page-card", children: "加载中…" }) : rows.length === 0 ? jsxRuntime.jsx("div", { className: "wb-page-card", children: "暂无可用专家。" }) : jsxRuntime.jsx("div", { className: "wb-exp-grid", children: rows.map((p) => jsxRuntime.jsxs("div", { className: "wb-exp-card", children: [
          jsxRuntime.jsxs("div", { className: "wb-exp-head", children: [
            jsxRuntime.jsx("span", { className: "wb-exp-name", children: p.name || p.id }),
            p.trust === "system" && jsxRuntime.jsx("span", { className: "wb-exp-badge", children: "系统" }),
            p.isDefault && jsxRuntime.jsx("span", { className: "wb-exp-badge", children: "默认" }),
            p.broken && jsxRuntime.jsx("span", { className: "wb-exp-badge wb-exp-badge-danger", children: "配置损坏" })
          ] }),
          jsxRuntime.jsx("div", { className: "wb-exp-desc", children: p.description || "（无描述）" }),
          jsxRuntime.jsxs("div", { className: "wb-exp-actions", children: [
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: busy !== "", onClick: () => invoke(p), children: "调用" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy !== "" || p.trust === "system", title: p.trust === "system" ? "系统预设只读（可复制后编辑副本）" : "打开编辑窗口", onClick: () => openEdit(p), children: "编辑" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy !== "", onClick: () => copyPreset(p), children: "复制" }),
            jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn", disabled: busy !== "" || p.trust === "system", title: p.trust === "system" ? "系统预设不可删除" : "删除", onClick: () => removePreset(p), children: "删除" })
          ] })
        ] }, p.id)) })
      ] }),
      editing && jsxRuntime.jsx("div", { className: "wb-exp-modal", onClick: (e) => { if (e.target === e.currentTarget) setEditing(null); }, children: jsxRuntime.jsxs("div", { className: "wb-exp-modal-box", children: [
        jsxRuntime.jsxs("div", { className: "wb-exp-modal-head", children: [
          jsxRuntime.jsx("span", { className: "wb-exp-name", children: "编辑「" + editing.name + "」" }),
          jsxRuntime.jsx("button", { type: "button", className: "wb-tb-close", title: "关闭", onClick: () => setEditing(null), children: "✕" })
        ] }),
        jsxRuntime.jsxs("div", { className: "wb-exp-modal-body", children: [
          jsxRuntime.jsxs("div", { className: "wb-exp-left", children: [
            jsxRuntime.jsx("label", { className: "wb-exp-label", children: "agent.cordis.yml（人格与工具组合）" }),
            jsxRuntime.jsx("textarea", { className: "wb-exp-textarea", spellCheck: false, value: editing.cordis, onChange: (e) => setEditing((v) => ({ ...v, cordis: e.target.value })) }),
            jsxRuntime.jsx("label", { className: "wb-exp-label", children: "preset.yml（名称 / 描述）" }),
            jsxRuntime.jsx("textarea", { className: "wb-exp-textarea wb-exp-textarea-sm", spellCheck: false, value: editing.presetYml, onChange: (e) => setEditing((v) => ({ ...v, presetYml: e.target.value })) }),
            jsxRuntime.jsxs("div", { className: "wb-exp-modal-foot", children: [
              jsxRuntime.jsx("span", { className: "wb-fs-saved", children: saveState === "saved" ? "已保存 ✓（重启桌面端后生效）" : saveState === "saving" ? "保存中…" : "右侧 AI 建议可直接复制到此处" }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: saveState === "saving", onClick: saveEdit, children: "保存" })
            ] })
          ] }),
          jsxRuntime.jsxs("div", { className: "wb-exp-right", children: [
            jsxRuntime.jsx("div", { className: "wb-exp-chat-title", children: "AI 编辑助手（临时对话，不占用会话）" }),
            jsxRuntime.jsx("div", { className: "wb-exp-chat-list", children: chatMsgs.length === 0 ? jsxRuntime.jsx("div", { className: "wb-exp-empty", children: "描述你的修改需求，AI 会给出修改建议，复制到左侧即可。\n例如：「把人格改成更口语化」「加一个减脂期饮食技能」" }) : chatMsgs.map((m, i) => jsxRuntime.jsxs("div", { className: "wb-exp-msg" + (m.role === "user" ? " wb-exp-msg-user" : " wb-exp-msg-ai"), children: [
              jsxRuntime.jsx("pre", { children: m.content }),
              m.role === "assistant" && jsxRuntime.jsx("button", { type: "button", className: "wb-exp-msg-copy", onClick: () => copyReply(m.content), children: "复制" })
            ] }, i)) }),
            jsxRuntime.jsxs("div", { className: "wb-exp-chat-input", children: [
              jsxRuntime.jsx("textarea", { placeholder: "比如：把人格改成更口语化的健身教练风格…", value: chatInput, onChange: (e) => setChatInput(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } } }),
              jsxRuntime.jsx("button", { type: "button", className: "wb-sp-btn wb-sp-btn-primary", disabled: chatBusy || chatInput.trim() === "", onClick: sendChat, children: chatBusy ? "思考中…" : "发送" })
            ] })
          ] })
        ] })
      ] }) })
      ] });
    }

    // ---- error boundary: never let the whole page go blank ----
    var WbErrorBoundary = class extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        console.error("[dsh-workbench] render error", error);
      }
      render() {
        if (this.state.error) {
          const err = this.state.error;
          return jsxRuntime.jsxs("div", {
            style: { padding: 24, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap", color: "#ff453a", background: "#fff", minHeight: "100vh", boxSizing: "border-box" },
            children: [
              "[dsh-workbench] 渲染出错：\n\n" + String((err && err.stack) || err),
              jsxRuntime.jsxs("div", { style: { marginTop: 16, display: "flex", gap: 8 }, children: [
                jsxRuntime.jsx("button", { style: { padding: "8px 14px", cursor: "pointer", font: "12px sans-serif" }, onClick: function () { try { localStorage.setItem("wb.safe", "1"); } catch (e) {} location.reload(); }, children: "进入安全模式（暂时停用工作台 UI）" }),
                jsxRuntime.jsx("button", { style: { padding: "8px 14px", cursor: "pointer", font: "12px sans-serif", background: "#e8f0fe", border: "1px solid #1a73e8" }, onClick: wbResetUI, children: "重置工作台界面（清空页面状态）" })
              ] })
            ]
          });
        }
        return this.props.children;
      }
    };

    // ---- diagnostics strip (P1): currently a no-op stub — implement later ----
    // Receives { useStore, useSessions } for a session/store status strip.
    function WbDiag() {
      return null;
    }

    function WorkbenchRoot(props) {
      const { useStore, useSessions, useWorkspaces, actions, renderSlot } = props;
      const [page, setPage] = React.useState(() => {
        try { return localStorage.getItem("wb.page") || "agent"; } catch (e) { return "agent"; }
      });
      // Start every desktop launch in a focused layout. Expansion remains
      // user-controlled for the current mounted shell, but is not restored on
      // the next launch so the navigation and tools do not crowd the canvas.
      const [navExpanded, setNavExpanded] = React.useState(false);
      const onSelect = React.useCallback((id) => { setPage(id); try { localStorage.setItem("wb.page", id); } catch (e) {} }, []);
      const onToggleNav = React.useCallback(() => {
        setNavExpanded((v) => !v);
      }, []);
      const onToggleSessions = React.useCallback(() => { actions.toggleSidebar(); }, [actions]);
      return jsxRuntime.jsx(WbErrorBoundary, { children: jsxRuntime.jsxs("div", { className: "wb-root " + (navExpanded ? "wb-root-nav-expanded" : "wb-root-nav-collapsed"), children: [
        jsxRuntime.jsx(WorkbenchNav, { page, onSelect, expanded: navExpanded, onToggle: onToggleNav, renderSlot, useSessions, useWorkspaces }),
        jsxRuntime.jsx(WbDiag, { useStore, useSessions }),
        jsxRuntime.jsx("div", { className: "wb-content", children: page === "agent"
          ? jsxRuntime.jsx(AgentWorkspace, { useStore, useSessions, useWorkspaces, actions, renderSlot, onToggleSessions })
          : page === "experts"
            ? jsxRuntime.jsx(ExpertsPage, { useWorkspaces, useSessions, onSelect })
            : jsxRuntime.jsx(WorkbenchPage, { id: page })
        })
      ] }) });
    }

    // ---- root wrapper: safe-mode check + error boundary so one bad edit
    // never blanks the whole window ----
    function WorkbenchRootSafe(props) {
      if (wbSafeModeActive()) return jsxRuntime.jsx(SafeFallback, {});
      return jsxRuntime.jsx(WbErrorBoundary, { children: jsxRuntime.jsx(WorkbenchRoot, props) });
    }

    // =====================================================================
    // Plugin surface
    // =====================================================================
    var inject = ["slots", "theme", "sessions", "workspaces", "remote", "remote.goals"];

    function apply(ctx) {
      WB_SVC.sessions = ctx.sessions;
      WB_SVC.workspaces = ctx.workspaces;
      WB_SVC.remote = ctx.remote || null;
      try { WB_SVC.api = ctx.get("connection").api; } catch (e) { WB_SVC.api = null; }
      const layout = new LayoutController();
      ctx.effect(() => {
        const disposeService = ctx.reflect.provide("layout", layout);
        const disposeRegistration = ctx.slots.register({
          name: "root",
          children: {
            "sidebar": { kind: "single", scope: "root" },
            "conversation": { kind: "single", scope: "session-maybe" },
            "details": { kind: "single", scope: "session" },
            "shell.overlay": { kind: "list", scope: "root" },
            // Native footer slots, re-homed under root so the nav rail can
            // render the plugin-store button and the settings trigger here
            // (ui-sidebar is disabled; these slots had no other declaration).
            "sidebar.footer.action": { kind: "list", scope: "root" },
            "sidebar.settings": { kind: "single", scope: "root" }
          },
          store: createLayoutStore,
          inject: (actions) => {
            layout.attachPanels(actions);
            return {};
          }
        }, WorkbenchRootSafe);
        return () => { disposeRegistration(); disposeService(); };
      }, "dsh-workbench: service + root registration");
      ctx.effect(() => {
        const presenter = new ThemePresenter();
        presenter.apply(ctx.theme.getTheme());
        const off = ctx.on("theme/change", (snapshot) => { presenter.apply(snapshot); });
        return () => { off(); presenter.dispose(); };
      }, "dsh-workbench: theme presenter");
    }

    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      default: () => index_default,
      inject: () => inject
    });
    var index_default = { apply, inject };
    module.exports = __toCommonJS(index_exports);
    return module.exports;
  }
});
