window.__ModuleLoader__.load({
	id: "@abcdefu_cja/dsh-usage-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/** 拉取区间汇总（不带 sessionId：纯区间总量，perSession 恒 null）。 */
		async function fetchSummary(from, to, signal) {
			const url = `/api/dsh-usage-stats/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
			const response = await fetch(url, { signal });
			if (!response.ok) throw new Error(`summary HTTP ${response.status}`);
			return response.json();
		}
		/** 拉取指定会话的用量明细（会话页用量面板用；区间字段无意义，取今日兜底）。 */
		async function fetchSessionUsage(sessionId, signal) {
			const url = `/api/dsh-usage-stats/summary?sessionId=${encodeURIComponent(sessionId)}`;
			const response = await fetch(url, { signal });
			if (!response.ok) throw new Error(`session usage HTTP ${response.status}`);
			return (await response.json()).perSession;
		}
		/** 拉取全部 provider 的余额/配额快照（host 定时刷新，此处只读）。 */
		async function fetchBalance(signal) {
			const response = await fetch("/api/dsh-usage-stats/balance", { signal });
			if (!response.ok) throw new Error(`balance HTTP ${response.status}`);
			return (await response.json()).providers;
		}
		/** 手动触发一次全量余额/配额刷新并返回新快照表。 */
		async function refreshBalance() {
			const response = await fetch("/api/dsh-usage-stats/balance/refresh", { method: "POST" });
			if (!response.ok) throw new Error(`refresh HTTP ${response.status}`);
			return (await response.json()).providers;
		}
		//#endregion
		//#region \0dsh-css:D:\VibeCoding\whatever\dsh-usage-stats\src\client\card.module.css.mjs
		const css = ".aYL_6G_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:6px;min-width:0;list-style:none;transition:border-color .16s,background .16s;overflow:hidden}.aYL_6G_content{flex-direction:column;gap:14px;min-width:0;display:flex}.aYL_6G_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.aYL_6G_header{width:100%;min-height:70.5px;color:inherit;cursor:pointer;text-align:left;font:inherit;background:0 0;border:0;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;display:flex}.aYL_6G_header:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.aYL_6G_header:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}.aYL_6G_header:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-button-info-fill);outline:none}.aYL_6G_headText{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex;overflow:hidden}.aYL_6G_nameRow{align-items:center;gap:8px;min-width:0;display:flex}.aYL_6G_name{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-weight:600;overflow:hidden}.aYL_6G_iconBadge{background:var(--dsw-alias-button-info-fill);width:32px;height:32px;color:var(--dsw-alias-label-primary-foreground);border-radius:8px;flex:none;justify-content:center;align-items:center;display:inline-flex;box-shadow:0 1px 2px #0000001f}.aYL_6G_activeBadge{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent);border-radius:999px;flex:none;padding:1px 8px;font-size:10px;font-weight:600;line-height:1.5}.aYL_6G_description{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:1.35;overflow:hidden}.aYL_6G_pending{color:var(--dsw-alias-state-warn-primary);white-space:nowrap;flex:none;font-size:12px}.aYL_6G_chevron{color:var(--dsw-alias-label-tertiary);flex:none;margin-left:10px;font-size:13px;transition:transform .12s}.aYL_6G_body{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:14px;padding:2px 12px 12px;display:flex}.aYL_6G_readOnly{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.aYL_6G_footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}.aYL_6G_failed{color:var(--dsw-alias-state-error-primary);margin:0 auto 0 0;font-size:12px}.aYL_6G_discard,.aYL_6G_save{font:inherit;cursor:pointer;border-radius:6px;padding:5px 12px;font-size:13px;transition:background-color .13s,border-color .13s,color .13s}.aYL_6G_discard{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.aYL_6G_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.aYL_6G_discard:active:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-active)}.aYL_6G_discard:focus-visible,.aYL_6G_save:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.aYL_6G_save{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}.aYL_6G_save:hover:not(:disabled),.aYL_6G_save:active:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}.aYL_6G_discard:disabled,.aYL_6G_save:disabled{opacity:.5;cursor:default}.aYL_6G_field{flex-direction:column;gap:4px;min-width:0;display:flex}.aYL_6G_head{align-items:center;gap:8px;display:flex}.aYL_6G_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}.aYL_6G_badges{flex:none;align-items:center;gap:6px;min-width:0;margin-left:auto;display:flex}.aYL_6G_badge{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-state-business-primary);white-space:nowrap;border-radius:999px;flex:none;padding:1px 6px;font-size:11px}.aYL_6G_reset{color:var(--dsw-alias-state-business-primary);cursor:pointer;white-space:nowrap;background:0 0;border:0;flex:none;padding:0;font-size:11px}.aYL_6G_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.aYL_6G_reset:active:not(:disabled){color:var(--dsw-alias-state-business-primary)}.aYL_6G_reset:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px}.aYL_6G_reset:disabled{opacity:.5;cursor:default}.aYL_6G_input,.aYL_6G_select{border:1px solid var(--dsw-alias-border-l2);font:inherit;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px;transition:border-color .13s,box-shadow .13s}.aYL_6G_input:hover:not(:disabled),.aYL_6G_select:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}.aYL_6G_input:focus-visible,.aYL_6G_select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.aYL_6G_inputInvalid{border:1px solid var(--dsw-alias-state-error-primary);font:inherit;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 8px;font-size:13px;transition:border-color .13s,box-shadow .13s}.aYL_6G_inputInvalid:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary)}.aYL_6G_inputInvalid:focus-visible{outline:2px solid var(--dsw-alias-state-error-primary);outline-offset:1px}.aYL_6G_input:disabled,.aYL_6G_select:disabled{opacity:.6;cursor:default}.aYL_6G_hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.aYL_6G_invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px}@media (prefers-reduced-motion:reduce){.aYL_6G_card,.aYL_6G_chevron,.aYL_6G_discard,.aYL_6G_save,.aYL_6G_input,.aYL_6G_select,.aYL_6G_inputInvalid{transition:none}}.aYL_6G_controlBar{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:8px;display:flex}.aYL_6G_timeSegment{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;align-items:center;gap:2px;padding:3px;display:flex}.aYL_6G_timeBtn,.aYL_6G_timeBtnActive{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:4px 10px;font-size:12px;transition:background-color .13s,color .13s}.aYL_6G_timeBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.aYL_6G_timeBtnActive{background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}.aYL_6G_providerRow{flex-wrap:wrap;align-items:center;gap:6px;min-width:0;display:flex}.aYL_6G_providerLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:11px}.aYL_6G_providerPill,.aYL_6G_providerPillActive{font:inherit;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:999px;padding:4px 10px;font-size:12px;transition:background-color .13s,border-color .13s,color .13s}.aYL_6G_providerPill:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.aYL_6G_providerPillActive{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}.aYL_6G_tabNav{border-bottom:1px solid var(--dsw-alias-border-l2);gap:2px;margin:0;padding:0;display:flex}.aYL_6G_tabBtn,.aYL_6G_tabBtnActive{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-bottom:2px solid #0000;margin-bottom:-1px;padding:7px 14px;font-size:12px;font-weight:500;transition:color .13s,border-color .13s}.aYL_6G_tabBtn:hover{color:var(--dsw-alias-label-primary)}.aYL_6G_tabBtnActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-button-info-fill);font-weight:600}.aYL_6G_customRow{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;align-items:center;gap:10px;font-size:12px;display:flex}.aYL_6G_customRow label{align-items:center;gap:6px;min-width:0;display:flex}.aYL_6G_customRow input{font:inherit;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:4px 6px;font-size:12px}.aYL_6G_status{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.aYL_6G_metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px;min-width:0;margin:0;display:grid}.aYL_6G_metrics>div{min-width:0}.aYL_6G_metrics dt{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;display:block;overflow:hidden}.aYL_6G_metrics dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;margin:0;font-size:13px;font-weight:600;display:block;overflow:hidden}.aYL_6G_tokenSplit{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:8px;min-width:0;font-size:12px;display:flex}.aYL_6G_tokenStacked{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;width:100%;height:10px;display:flex;overflow:hidden}.aYL_6G_tokenStackedSeg{min-width:0;height:100%;transition:width .3s}.aYL_6G_tokenLegend{flex-wrap:wrap;gap:6px 14px;display:flex}.aYL_6G_tokenShare{color:var(--dsw-alias-label-tertiary);font-size:10px}.aYL_6G_heading{color:var(--dsw-alias-label-primary);margin:0;font-size:12px;font-weight:600}.aYL_6G_trendChart{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:8px;flex-direction:column;gap:6px;min-width:0;padding:10px 12px 8px;display:flex}.aYL_6G_trendBody{align-items:stretch;gap:8px;min-width:0;display:flex}.aYL_6G_trendYAxis{flex:none;width:52px;height:140px;position:relative}.aYL_6G_trendYTick{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:10px;line-height:1;position:absolute;right:6px}.aYL_6G_trendPlot{flex:1;min-width:0;position:relative}.aYL_6G_trendSvg{width:100%;height:140px;display:block}.aYL_6G_trendHit{cursor:pointer}.aYL_6G_trendTooltip{z-index:5;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);pointer-events:none;border-radius:8px;min-width:200px;max-width:260px;padding:8px 10px;font-size:11px;position:absolute;top:4px;box-shadow:0 4px 16px #0000002e}.aYL_6G_tooltipDate{color:var(--dsw-alias-label-primary);margin-bottom:4px;font-size:12px;font-weight:700}.aYL_6G_tooltipRow{color:var(--dsw-alias-label-secondary);justify-content:space-between;align-items:center;gap:8px;line-height:1.5;display:flex}.aYL_6G_tooltipRow strong{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600}.aYL_6G_tooltipModels{border-top:1px dashed var(--dsw-alias-border-l2);border-bottom:1px dashed var(--dsw-alias-border-l2);flex-direction:column;gap:2px;margin:4px 0;padding:4px 0;display:flex}.aYL_6G_tooltipModel{align-items:center;gap:6px;line-height:1.6;display:flex}.aYL_6G_tooltipModelName{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);flex:1;overflow:hidden}.aYL_6G_tooltipModel strong{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600}.aYL_6G_trendAxis{border-top:1px solid var(--dsw-alias-border-l2);justify-content:space-between;gap:2px;margin-left:60px;padding-top:6px;display:flex}.aYL_6G_trendTick{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:10px}.aYL_6G_tableCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:8px;min-width:0;overflow:hidden}.aYL_6G_table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;min-width:0;font-size:12px}.aYL_6G_table th,.aYL_6G_table td{border-bottom:1px solid var(--dsw-alias-border-l2);text-align:left;white-space:nowrap;text-overflow:ellipsis;padding:6px 10px;overflow:hidden}.aYL_6G_table thead th{background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 60%, transparent)}.aYL_6G_table th{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500}.aYL_6G_table td{color:var(--dsw-alias-label-primary)}.aYL_6G_table tbody tr:last-child td{border-bottom:0}.aYL_6G_thRight{text-align:right}.aYL_6G_tdRight{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}.aYL_6G_tdStrong{font-weight:600}.aYL_6G_trHover:hover td{background:color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 6%, transparent)}.aYL_6G_modelDot{vertical-align:middle;border-radius:50%;width:8px;height:8px;margin-right:6px;display:inline-block}.aYL_6G_balance{flex-direction:column;gap:4px;display:flex}.aYL_6G_refresh{font:inherit;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;align-self:flex-start;padding:3px 10px;font-size:12px;transition:background-color .13s,border-color .13s,color .13s}.aYL_6G_refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.aYL_6G_refresh:disabled{opacity:.5;cursor:default}.aYL_6G_kpiGrid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;min-width:0;display:grid}.aYL_6G_kpiCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;flex-direction:column;gap:3px;min-width:0;padding:12px 14px 10px;transition:border-color .16s,background .16s;display:flex;position:relative;overflow:hidden}.aYL_6G_kpiCard:hover{border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.aYL_6G_kpiTop{min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;justify-content:space-between;align-items:center;gap:6px;font-size:11px;font-weight:500;display:flex}.aYL_6G_kpiTop svg{color:var(--dsw-alias-label-tertiary);flex:none}.aYL_6G_kpiValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);letter-spacing:-.02em;white-space:nowrap;text-overflow:ellipsis;margin:0;font-size:20px;font-weight:700;overflow:hidden}.aYL_6G_kpiSub{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;min-height:13px;margin:2px 0 0;font-size:10px;overflow:hidden}.aYL_6G_kpiCostVal{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary));font-variant-numeric:tabular-nums;font-weight:600}.aYL_6G_kpiValueEmerald{font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-success-primary);letter-spacing:-.02em;white-space:nowrap;text-overflow:ellipsis;margin:0;font-size:20px;font-weight:700;overflow:hidden}.aYL_6G_kpiCardDynamic{border:1px solid color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 40%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 8%, var(--dsw-alias-bg-layer-2));border-radius:10px;flex-direction:column;gap:3px;min-width:0;padding:12px 14px 10px;display:flex;position:relative;overflow:hidden}.aYL_6G_kpiTopRow{justify-content:space-between;align-items:center;gap:6px;min-width:0;display:flex}.aYL_6G_kpiDynamicLabel{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;font-weight:600;overflow:hidden}.aYL_6G_kpiValueAccent{font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary));letter-spacing:-.02em;white-space:nowrap;text-overflow:ellipsis;margin:0;font-size:20px;font-weight:700;overflow:hidden}.aYL_6G_chip{white-space:nowrap;border-radius:999px;flex:none;padding:1px 7px;font-size:10px;font-weight:700}.aYL_6G_chipBlue{background:color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 14%, transparent);color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary));border:1px solid color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 30%, transparent)}.aYL_6G_chipEmerald{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent)}.aYL_6G_chipAmber{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);color:var(--dsw-alias-state-warn-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent)}.aYL_6G_chipError{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent)}.aYL_6G_tokenItem{align-items:center;gap:6px;display:inline-flex}.aYL_6G_dot{border-radius:9999px;flex:none;width:8px;height:8px}.aYL_6G_cacheDiag{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent);color:var(--dsw-alias-state-success-primary);border-radius:8px;flex-direction:column;gap:4px;padding:10px 12px;font-size:12px;display:flex}.aYL_6G_cacheDiag strong{font-weight:700}.aYL_6G_cacheDiag span{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}.aYL_6G_cacheDiagRows{border-top:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent);flex-direction:column;gap:4px;margin-top:2px;padding-top:6px;display:flex}.aYL_6G_cacheDiagRow{color:var(--dsw-alias-label-secondary);justify-content:space-between;align-items:center;gap:8px;font-size:11px;display:flex}.aYL_6G_cacheDiagRow strong{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums;font-weight:600}.aYL_6G_chartRow{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;min-width:0;display:grid}.aYL_6G_chartCell{flex-direction:column;gap:8px;min-width:0;display:flex}.aYL_6G_donutWrap{align-items:center;gap:12px;min-width:0;display:flex}.aYL_6G_donutSvgWrap{flex:none;width:92px;height:92px;position:relative}.aYL_6G_donutSvg{width:100%;height:100%;display:block;transform:rotate(-90deg)}.aYL_6G_donutHole{pointer-events:none;background:0 0;border-radius:50%;flex-direction:column;justify-content:center;align-items:center;gap:0;display:flex;position:absolute;inset:22%}.aYL_6G_donutTotal{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:700;line-height:1.1}.aYL_6G_donutTotalLabel{color:var(--dsw-alias-label-tertiary);font-size:9px}.aYL_6G_legend{flex-direction:column;flex:1;gap:3px;min-width:0;margin:0;padding:0;list-style:none;display:flex}.aYL_6G_legend li{min-width:0;color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:11px;display:flex}.aYL_6G_legendDot{border-radius:2px;flex:none;width:8px;height:8px}.aYL_6G_legendModel{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;overflow:hidden}.aYL_6G_legendShare{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);flex:none}.aYL_6G_sessionUsageRoot{text-align:left;display:inline-block;position:relative}.aYL_6G_sessionUsage,.aYL_6G_sessionUsageActive{white-space:nowrap;background-color:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:.5rem;flex-wrap:nowrap;flex:none;align-items:center;gap:.5rem;padding:.375rem .75rem;font-size:.75rem;font-weight:500;transition:background-color .2s cubic-bezier(.16,1,.3,1),border-color .2s cubic-bezier(.16,1,.3,1),color .2s cubic-bezier(.16,1,.3,1);display:inline-flex;box-shadow:0 1px 2px #00000014}.aYL_6G_sessionUsage>span,.aYL_6G_sessionUsageActive>span{white-space:nowrap;flex:none}.aYL_6G_sessionUsage:hover{background-color:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-label-dimmed)}.aYL_6G_sessionUsage:focus-visible,.aYL_6G_sessionUsageActive:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.aYL_6G_sessionUsageActive{border-color:var(--dsw-alias-state-business-primary)}.aYL_6G_pulseDotContainer{width:.5rem;height:.5rem;display:flex;position:relative}.aYL_6G_pulseDotPing{background-color:var(--dsw-alias-state-success-primary);opacity:.75;border-radius:9999px;width:100%;height:100%;animation:1.5s cubic-bezier(0,0,.2,1) infinite aYL_6G_usagePing;display:inline-flex;position:absolute}.aYL_6G_pulseDot{background-color:var(--dsw-alias-state-success-primary);border-radius:9999px;width:.5rem;height:.5rem;display:inline-flex;position:relative}@keyframes aYL_6G_usagePing{75%,to{opacity:0;transform:scale(2)}}.aYL_6G_labelMuted{color:var(--dsw-alias-label-tertiary)}.aYL_6G_valHighlightTokens{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:700}.aYL_6G_valHighlightCost{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary));font-variant-numeric:tabular-nums;font-weight:500}.aYL_6G_valSeparator{color:var(--dsw-alias-label-dimmed)}.aYL_6G_chevronIcon{width:.875rem;height:.875rem;color:var(--dsw-alias-label-tertiary);transition:transform .2s}.aYL_6G_chevronOpen{transform:rotate(180deg)}.aYL_6G_sessionUsagePanel{background-color:var(--dsw-alias-bg-layer-3);width:330px;max-width:calc(100vw - 32px);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);z-index:100;transform-origin:100% 0;border-radius:1rem;margin-top:.5rem;animation:.2s cubic-bezier(.34,1.56,.64,1) forwards aYL_6G_usagePanelEnter;position:absolute;right:0;overflow:hidden;box-shadow:0 20px 25px -5px #02061780,0 8px 10px -6px #0206174d}@keyframes aYL_6G_usagePanelEnter{0%{opacity:0;transform:translateY(-6px)scale(.9)}to{opacity:1;transform:translateY(0)scale(1)}}.aYL_6G_panelHeader{background-color:var(--dsw-alias-bg-layer-3);border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;padding:.75rem 1rem;display:flex}.aYL_6G_panelTitleGroup{align-items:center;gap:.5rem;display:flex}.aYL_6G_panelTitle{color:var(--dsw-alias-label-primary);letter-spacing:-.01em;font-size:.875rem;font-weight:700}.aYL_6G_statusBadge{background-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent);border-radius:.25rem;align-items:center;gap:.25rem;padding:.125rem .5rem;font-size:.625rem;font-weight:600;display:flex}.aYL_6G_panelBody{flex-direction:column;gap:.75rem;padding:.875rem;display:flex}.aYL_6G_panelStatus{color:var(--dsw-alias-label-secondary);margin:0;padding:.75rem 1rem;font-size:12px}.aYL_6G_sectionHeader{justify-content:space-between;align-items:center;margin-bottom:.375rem;display:flex}.aYL_6G_sectionTitle{color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.05em;font-size:.6875rem;font-weight:700}.aYL_6G_heroCard{background:linear-gradient(180deg, var(--dsw-alias-bg-layer-2) 0%, color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent) 100%);border:1px solid var(--dsw-alias-border-l2);border-radius:.75rem;padding:.75rem;box-shadow:0 1px 2px #00000014}.aYL_6G_heroTopGrid{border-bottom:1px solid var(--dsw-alias-border-l2);text-align:center;grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:.625rem;display:grid}.aYL_6G_heroCol{padding:0 .5rem}.aYL_6G_heroCol:first-child{border-right:1px solid var(--dsw-alias-border-l2)}.aYL_6G_statNumGroup{justify-content:center;align-items:baseline;display:flex}.aYL_6G_statNumber{color:var(--dsw-alias-label-primary);letter-spacing:-.025em;font-variant-numeric:tabular-nums;font-size:1.5rem;font-weight:700}.aYL_6G_statNumberCost{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary))}.aYL_6G_statUnit{color:var(--dsw-alias-label-secondary);margin-left:.125rem;font-size:.75rem;font-weight:600}.aYL_6G_statLabel{color:var(--dsw-alias-label-secondary);margin-top:.125rem;font-size:.6875rem;font-weight:500}.aYL_6G_heroBottomGrid{text-align:center;grid-template-columns:repeat(2,minmax(0,1fr));padding-top:.625rem;font-size:.6875rem;display:grid}.aYL_6G_metaCol{padding:0 .5rem}.aYL_6G_metaCol:first-child{border-right:1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 60%, transparent)}.aYL_6G_metaLabel{color:var(--dsw-alias-label-tertiary);margin-bottom:.25rem;font-size:.625rem;line-height:1;display:block}.aYL_6G_metaValText{color:var(--dsw-alias-label-primary);font-weight:600}.aYL_6G_metaValEmerald{color:var(--dsw-alias-state-success-primary);font-weight:600}.aYL_6G_recentCard{background-color:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:.75rem;flex-direction:column;gap:.375rem;padding:.625rem;display:flex;box-shadow:0 1px 2px #00000014}.aYL_6G_recentGrid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:baseline;gap:.3125rem .75rem;font-size:.6875rem;display:grid}.aYL_6G_recentLabel{color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.aYL_6G_recentValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-weight:600;overflow:hidden}.aYL_6G_recentValueEmerald{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums;text-align:right;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-weight:600;overflow:hidden}.aYL_6G_recentValueCost{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary))}.aYL_6G_unpricedHint{color:var(--dsw-alias-state-warn-primary);margin:.375rem 0 0;font-size:.6875rem;line-height:1.4}.aYL_6G_strongText{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600}.aYL_6G_panelFooter{background-color:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 70%, transparent);border-top:1px solid var(--dsw-alias-border-l2);padding:.625rem .875rem;font-size:.75rem}.aYL_6G_footerFlex{align-items:center;display:flex}.aYL_6G_balanceText{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:.6875rem;font-weight:500;overflow:hidden}.aYL_6G_balanceVal{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:700}.aYL_6G_quotaRows{flex-direction:column;gap:3px;margin-bottom:6px;display:flex}.aYL_6G_quotaRow{grid-template-columns:minmax(0,1fr) 3.25rem minmax(0,1fr);align-items:baseline;gap:.75rem;font-size:.6875rem;display:grid}.aYL_6G_quotaLabel{color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;font-weight:500;overflow:hidden}.aYL_6G_quotaPercent{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;font-weight:700}.aYL_6G_quotaReset{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right;text-overflow:ellipsis;overflow:hidden}.aYL_6G_quotaView{flex-direction:column;gap:12px;min-width:0;display:flex}.aYL_6G_quotaGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;min-width:0;display:grid}.aYL_6G_noticeBar{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:8px;align-items:flex-start;gap:8px;padding:10px 12px;font-size:11px;line-height:1.5;display:flex}.aYL_6G_noticeIcon{width:14px;height:14px;color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary));flex:none;margin-top:1px}.aYL_6G_quotaCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:.75rem;flex-direction:column;gap:.5rem;min-width:0;padding:.875rem;transition:border-color .16s,box-shadow .16s;display:flex}.aYL_6G_quotaCard:hover{box-shadow:0 1px 3px #0000000f}.aYL_6G_quotaCardActive{border-color:color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 45%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 6%, var(--dsw-alias-bg-layer-2))}.aYL_6G_quotaCardTop{justify-content:space-between;align-items:center;gap:.5rem;min-width:0;display:flex}.aYL_6G_quotaCardLabel{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:.75rem;font-weight:700;overflow:hidden}.aYL_6G_chipNeutral{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent);color:var(--dsw-alias-label-secondary);border:1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent)}.aYL_6G_quotaCardValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;align-items:baseline;gap:2px;font-size:1.75rem;font-weight:900;line-height:1.1;display:flex}.aYL_6G_quotaCardUnit{color:var(--dsw-alias-label-secondary);font-size:.875rem;font-weight:400}.aYL_6G_progressBarBg{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent);border-radius:9999px;width:100%;height:.5rem;overflow:hidden}.aYL_6G_progressBarFill{border-radius:9999px;height:100%;transition:width .3s}.aYL_6G_quotaCardReset{border-top:1px dashed color-mix(in srgb, var(--dsw-alias-border-l2) 80%, transparent);color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:.5rem;min-width:0;padding-top:.5rem;font-size:.6875rem;display:flex}.aYL_6G_quotaCardReset strong{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis;font-weight:600;overflow:hidden}.aYL_6G_deepseekCard{border:1px solid color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 40%, var(--dsw-alias-border-l2));background:linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary)) 10%, var(--dsw-alias-bg-layer-2)), var(--dsw-alias-bg-layer-2));border-radius:.75rem;flex-direction:column;gap:.5rem;min-width:0;padding:1rem 1.25rem;display:flex}.aYL_6G_deepseekRow{justify-content:space-between;align-items:center;gap:.5rem;min-width:0;display:flex}.aYL_6G_deepseekLabel{color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;font-size:.75rem;overflow:hidden}.aYL_6G_deepseekAmount{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-state-business-primary));font-variant-numeric:tabular-nums;letter-spacing:-.02em;font-size:2rem;font-weight:700;line-height:1.1}.aYL_6G_deepseekCurrency{color:var(--dsw-alias-label-secondary);font-size:.875rem;font-weight:400}.aYL_6G_deepseekEstimate{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums;background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, transparent);border-radius:6px;align-self:flex-start;padding:2px 8px;font-size:.75rem;font-weight:600}.aYL_6G_deepseekActions{align-items:stretch;gap:.5rem;margin-top:.25rem;display:flex}.aYL_6G_btnPrimary{font:inherit;border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;border-radius:6px;justify-content:center;align-items:center;padding:4px 14px;font-size:12px;font-weight:600;text-decoration:none;transition:filter .13s;display:inline-flex}.aYL_6G_btnPrimary:hover{filter:brightness(1.1)}@media (prefers-reduced-motion:reduce){.aYL_6G_kpiCard,.aYL_6G_tokenStackedSeg,.aYL_6G_sessionUsage,.aYL_6G_sessionUsageActive,.aYL_6G_chevronIcon{transition:none}.aYL_6G_sessionUsagePanel{animation:none}.aYL_6G_pulseDotPing{opacity:0;animation:none}}.aYL_6G_sectionPage{flex-direction:column;gap:16px;min-width:0;padding:4px 2px 16px;display:flex}.aYL_6G_sectionHeaderRow{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:12px;min-width:0;padding-bottom:14px;display:flex}.aYL_6G_sectionIconBadge{background:var(--dsw-alias-button-info-fill);width:40px;height:40px;color:var(--dsw-alias-label-primary-foreground);border-radius:10px;flex:none;justify-content:center;align-items:center;display:inline-flex;box-shadow:0 2px 4px #0000001f}.aYL_6G_sectionHeaderText{flex-direction:column;gap:2px;min-width:0;display:flex}.aYL_6G_sectionPageTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:700}.aYL_6G_sectionPageDesc{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}";
		const tagId = "@abcdefu_cja/dsh-usage-stats/card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@abcdefu_cja/dsh-usage-stats";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var card_module_css_default = {
			"activeBadge": "aYL_6G_activeBadge",
			"badge": "aYL_6G_badge",
			"badges": "aYL_6G_badges",
			"balance": "aYL_6G_balance",
			"balanceText": "aYL_6G_balanceText",
			"balanceVal": "aYL_6G_balanceVal",
			"body": "aYL_6G_body",
			"btnPrimary": "aYL_6G_btnPrimary",
			"cacheDiag": "aYL_6G_cacheDiag",
			"cacheDiagRow": "aYL_6G_cacheDiagRow",
			"cacheDiagRows": "aYL_6G_cacheDiagRows",
			"card": "aYL_6G_card",
			"cardOpen": "aYL_6G_cardOpen",
			"chartCell": "aYL_6G_chartCell",
			"chartRow": "aYL_6G_chartRow",
			"chevron": "aYL_6G_chevron",
			"chevronIcon": "aYL_6G_chevronIcon",
			"chevronOpen": "aYL_6G_chevronOpen",
			"chip": "aYL_6G_chip",
			"chipAmber": "aYL_6G_chipAmber",
			"chipBlue": "aYL_6G_chipBlue",
			"chipEmerald": "aYL_6G_chipEmerald",
			"chipError": "aYL_6G_chipError",
			"chipNeutral": "aYL_6G_chipNeutral",
			"content": "aYL_6G_content",
			"controlBar": "aYL_6G_controlBar",
			"customRow": "aYL_6G_customRow",
			"deepseekActions": "aYL_6G_deepseekActions",
			"deepseekAmount": "aYL_6G_deepseekAmount",
			"deepseekCard": "aYL_6G_deepseekCard",
			"deepseekCurrency": "aYL_6G_deepseekCurrency",
			"deepseekEstimate": "aYL_6G_deepseekEstimate",
			"deepseekLabel": "aYL_6G_deepseekLabel",
			"deepseekRow": "aYL_6G_deepseekRow",
			"description": "aYL_6G_description",
			"discard": "aYL_6G_discard",
			"donutHole": "aYL_6G_donutHole",
			"donutSvg": "aYL_6G_donutSvg",
			"donutSvgWrap": "aYL_6G_donutSvgWrap",
			"donutTotal": "aYL_6G_donutTotal",
			"donutTotalLabel": "aYL_6G_donutTotalLabel",
			"donutWrap": "aYL_6G_donutWrap",
			"dot": "aYL_6G_dot",
			"failed": "aYL_6G_failed",
			"field": "aYL_6G_field",
			"footer": "aYL_6G_footer",
			"footerFlex": "aYL_6G_footerFlex",
			"head": "aYL_6G_head",
			"headText": "aYL_6G_headText",
			"header": "aYL_6G_header",
			"heading": "aYL_6G_heading",
			"heroBottomGrid": "aYL_6G_heroBottomGrid",
			"heroCard": "aYL_6G_heroCard",
			"heroCol": "aYL_6G_heroCol",
			"heroTopGrid": "aYL_6G_heroTopGrid",
			"hint": "aYL_6G_hint",
			"iconBadge": "aYL_6G_iconBadge",
			"input": "aYL_6G_input",
			"inputInvalid": "aYL_6G_inputInvalid",
			"invalid": "aYL_6G_invalid",
			"kpiCard": "aYL_6G_kpiCard",
			"kpiCardDynamic": "aYL_6G_kpiCardDynamic",
			"kpiCostVal": "aYL_6G_kpiCostVal",
			"kpiDynamicLabel": "aYL_6G_kpiDynamicLabel",
			"kpiGrid": "aYL_6G_kpiGrid",
			"kpiSub": "aYL_6G_kpiSub",
			"kpiTop": "aYL_6G_kpiTop",
			"kpiTopRow": "aYL_6G_kpiTopRow",
			"kpiValue": "aYL_6G_kpiValue",
			"kpiValueAccent": "aYL_6G_kpiValueAccent",
			"kpiValueEmerald": "aYL_6G_kpiValueEmerald",
			"label": "aYL_6G_label",
			"labelMuted": "aYL_6G_labelMuted",
			"legend": "aYL_6G_legend",
			"legendDot": "aYL_6G_legendDot",
			"legendModel": "aYL_6G_legendModel",
			"legendShare": "aYL_6G_legendShare",
			"metaCol": "aYL_6G_metaCol",
			"metaLabel": "aYL_6G_metaLabel",
			"metaValEmerald": "aYL_6G_metaValEmerald",
			"metaValText": "aYL_6G_metaValText",
			"metrics": "aYL_6G_metrics",
			"modelDot": "aYL_6G_modelDot",
			"name": "aYL_6G_name",
			"nameRow": "aYL_6G_nameRow",
			"noticeBar": "aYL_6G_noticeBar",
			"noticeIcon": "aYL_6G_noticeIcon",
			"panelBody": "aYL_6G_panelBody",
			"panelFooter": "aYL_6G_panelFooter",
			"panelHeader": "aYL_6G_panelHeader",
			"panelStatus": "aYL_6G_panelStatus",
			"panelTitle": "aYL_6G_panelTitle",
			"panelTitleGroup": "aYL_6G_panelTitleGroup",
			"pending": "aYL_6G_pending",
			"progressBarBg": "aYL_6G_progressBarBg",
			"progressBarFill": "aYL_6G_progressBarFill",
			"providerLabel": "aYL_6G_providerLabel",
			"providerPill": "aYL_6G_providerPill",
			"providerPillActive": "aYL_6G_providerPillActive",
			"providerRow": "aYL_6G_providerRow",
			"pulseDot": "aYL_6G_pulseDot",
			"pulseDotContainer": "aYL_6G_pulseDotContainer",
			"pulseDotPing": "aYL_6G_pulseDotPing",
			"quotaCard": "aYL_6G_quotaCard",
			"quotaCardActive": "aYL_6G_quotaCardActive",
			"quotaCardLabel": "aYL_6G_quotaCardLabel",
			"quotaCardReset": "aYL_6G_quotaCardReset",
			"quotaCardTop": "aYL_6G_quotaCardTop",
			"quotaCardUnit": "aYL_6G_quotaCardUnit",
			"quotaCardValue": "aYL_6G_quotaCardValue",
			"quotaGrid": "aYL_6G_quotaGrid",
			"quotaLabel": "aYL_6G_quotaLabel",
			"quotaPercent": "aYL_6G_quotaPercent",
			"quotaReset": "aYL_6G_quotaReset",
			"quotaRow": "aYL_6G_quotaRow",
			"quotaRows": "aYL_6G_quotaRows",
			"quotaView": "aYL_6G_quotaView",
			"readOnly": "aYL_6G_readOnly",
			"recentCard": "aYL_6G_recentCard",
			"recentGrid": "aYL_6G_recentGrid",
			"recentLabel": "aYL_6G_recentLabel",
			"recentValue": "aYL_6G_recentValue",
			"recentValueCost": "aYL_6G_recentValueCost",
			"recentValueEmerald": "aYL_6G_recentValueEmerald",
			"refresh": "aYL_6G_refresh",
			"reset": "aYL_6G_reset",
			"save": "aYL_6G_save",
			"sectionHeader": "aYL_6G_sectionHeader",
			"sectionHeaderRow": "aYL_6G_sectionHeaderRow",
			"sectionHeaderText": "aYL_6G_sectionHeaderText",
			"sectionIconBadge": "aYL_6G_sectionIconBadge",
			"sectionPage": "aYL_6G_sectionPage",
			"sectionPageDesc": "aYL_6G_sectionPageDesc",
			"sectionPageTitle": "aYL_6G_sectionPageTitle",
			"sectionTitle": "aYL_6G_sectionTitle",
			"select": "aYL_6G_select",
			"sessionUsage": "aYL_6G_sessionUsage",
			"sessionUsageActive": "aYL_6G_sessionUsageActive",
			"sessionUsagePanel": "aYL_6G_sessionUsagePanel",
			"sessionUsageRoot": "aYL_6G_sessionUsageRoot",
			"statLabel": "aYL_6G_statLabel",
			"statNumGroup": "aYL_6G_statNumGroup",
			"statNumber": "aYL_6G_statNumber",
			"statNumberCost": "aYL_6G_statNumberCost",
			"statUnit": "aYL_6G_statUnit",
			"status": "aYL_6G_status",
			"statusBadge": "aYL_6G_statusBadge",
			"strongText": "aYL_6G_strongText",
			"tabBtn": "aYL_6G_tabBtn",
			"tabBtnActive": "aYL_6G_tabBtnActive",
			"tabNav": "aYL_6G_tabNav",
			"table": "aYL_6G_table",
			"tableCard": "aYL_6G_tableCard",
			"tdRight": "aYL_6G_tdRight",
			"tdStrong": "aYL_6G_tdStrong",
			"thRight": "aYL_6G_thRight",
			"timeBtn": "aYL_6G_timeBtn",
			"timeBtnActive": "aYL_6G_timeBtnActive",
			"timeSegment": "aYL_6G_timeSegment",
			"tokenItem": "aYL_6G_tokenItem",
			"tokenLegend": "aYL_6G_tokenLegend",
			"tokenShare": "aYL_6G_tokenShare",
			"tokenSplit": "aYL_6G_tokenSplit",
			"tokenStacked": "aYL_6G_tokenStacked",
			"tokenStackedSeg": "aYL_6G_tokenStackedSeg",
			"tooltipDate": "aYL_6G_tooltipDate",
			"tooltipModel": "aYL_6G_tooltipModel",
			"tooltipModelName": "aYL_6G_tooltipModelName",
			"tooltipModels": "aYL_6G_tooltipModels",
			"tooltipRow": "aYL_6G_tooltipRow",
			"trHover": "aYL_6G_trHover",
			"trendAxis": "aYL_6G_trendAxis",
			"trendBody": "aYL_6G_trendBody",
			"trendChart": "aYL_6G_trendChart",
			"trendHit": "aYL_6G_trendHit",
			"trendPlot": "aYL_6G_trendPlot",
			"trendSvg": "aYL_6G_trendSvg",
			"trendTick": "aYL_6G_trendTick",
			"trendTooltip": "aYL_6G_trendTooltip",
			"trendYAxis": "aYL_6G_trendYAxis",
			"trendYTick": "aYL_6G_trendYTick",
			"unpricedHint": "aYL_6G_unpricedHint",
			"usagePanelEnter": "aYL_6G_usagePanelEnter",
			"usagePing": "aYL_6G_usagePing",
			"valHighlightCost": "aYL_6G_valHighlightCost",
			"valHighlightTokens": "aYL_6G_valHighlightTokens",
			"valSeparator": "aYL_6G_valSeparator"
		};
		//#endregion
		//#region src/client/UsageStatsCard.tsx
		const RANGES = [
			{
				key: "last7",
				days: 7
			},
			{
				key: "last14",
				days: 14
			},
			{
				key: "last30",
				days: 30
			},
			{
				key: "last90",
				days: 90
			}
		];
		function formatTokens(tokens) {
			if (tokens >= 1e6) return (tokens / 1e6).toFixed(2) + "M";
			if (tokens >= 1e3) return (tokens / 1e3).toFixed(1) + "K";
			return String(tokens);
		}
		function formatCost$1(cost) {
			return cost.toFixed(4);
		}
		/** 命中率展示：百分比保留两位小数（如 99.84%）。 */
		function formatRate(rate) {
			return (rate * 100).toFixed(2) + "%";
		}
		/** donut 段色：从主题语义色派生（段 1-5 + 其他）。 */
		const DONUT_SEGMENT_VARS = [
			"var(--dsw-alias-state-business-primary)",
			"var(--dsw-alias-state-success-primary)",
			"var(--dsw-alias-state-warn-primary)",
			"var(--dsw-alias-state-error-primary)",
			"var(--dsw-alias-state-info-primary, var(--dsw-alias-state-business-primary))",
			"var(--dsw-alias-label-tertiary)"
		];
		/** 按请求数取模型占比段：Top 5 + 「其他」聚合；返回段与图例行。 */
		function donutSegments(models) {
			const total = models.reduce((sum, m) => sum + m.requests, 0);
			if (total <= 0) return [];
			const top = models.slice(0, 5);
			const rest = models.slice(5).reduce((sum, m) => sum + m.requests, 0);
			return (rest > 0 ? [...top, {
				model: "__other__",
				requests: rest
			}] : top).map((m, i) => ({
				model: m.model,
				requests: m.requests,
				share: m.requests / total,
				colorVar: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length]
			}));
		}
		/** 模型占比 SVG 环形图（参考原型 stroke-dasharray donut，无库）。 */
		function DonutChart(props) {
			const { t, segments, total, centerLabel } = props;
			const R = 15.9155;
			const track = `M 18 2.0845 a ${R} ${R} 0 0 1 0 31.831 a ${R} ${R} 0 0 1 0 -31.831`;
			let cursor = 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.donutWrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.donutSvgWrap,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						viewBox: "0 0 36 36",
						className: card_module_css_default.donutSvg,
						role: "img",
						"aria-label": segments.map((s) => `${s.model}: ${Math.round(s.share * 100)}%`).join("; "),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: track,
							fill: "none",
							stroke: "var(--dsw-alias-border-l2)",
							strokeWidth: "4"
						}), segments.map((s) => {
							const offset = cursor * 100;
							cursor += s.share;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: track,
								fill: "none",
								stroke: s.colorVar,
								strokeWidth: "4",
								strokeDasharray: `${Math.max(.4, s.share * 100)} 100`,
								strokeDashoffset: `${-offset}`
							}, s.model);
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.donutHole,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.donutTotal,
							children: total
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.donutTotalLabel,
							children: centerLabel
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: card_module_css_default.legend,
					children: segments.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.legendDot,
							style: { background: s.colorVar }
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.legendModel,
							children: s.model === "__other__" ? t("chart.other") : s.model
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: card_module_css_default.legendShare,
							children: [Math.round(s.share * 100), "%"]
						})
					] }, s.model))
				})]
			});
		}
		/** KPI 卡内联图标（无外部依赖、无 emoji）。 */
		function KpiIcon(props) {
			const { kind } = props;
			if (kind === "chart") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 3v18h18" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "7",
						y: "12",
						width: "3",
						height: "6",
						rx: "0.8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "13",
						y: "8",
						width: "3",
						height: "10",
						rx: "0.8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "19",
						y: "5",
						width: "3",
						height: "13",
						rx: "0.8"
					})
				]
			});
			if (kind === "send") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M22 2 11 13" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M22 2 15 22l-4-9-9-4Z" })]
			});
			if (kind === "bolt") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M13 2 3 14h7l-1 8 10-12h-7l1-8Z" })
			});
			if (kind === "turns") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 1 1-9-9" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 3v6h-6" })]
			});
			if (kind === "days") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						width: "18",
						height: "18",
						x: "3",
						y: "4",
						rx: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M16 2v4" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2v4" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 10h18" })
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" })
				]
			});
		}
		/** 费用计价货币符号：CNY → ¥，USD → $，其他货币原样前缀。 */
		function costSymbol$1(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return currency === "" ? "" : `${currency} `;
		}
		/** Token 四分色（参考原型配色：输入蓝 / 缓存读绿 / 缓存写黄 / 输出紫）。 */
		const TOKEN_SPLIT_COLORS = [
			"#3b82f6",
			"#10b981",
			"#f59e0b",
			"#6366f1"
		];
		/** Token 四分色堆叠拆分条 + 图例（参考原型 tokenSplitBar）。 */
		function TokenSplitBar(props) {
			const { t, buckets } = props;
			const total = buckets.reduce((sum, b) => sum + b.tokens, 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.tokenSplit,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: card_module_css_default.tokenStacked,
					role: "img",
					"aria-label": buckets.map((b, i) => `${b.label}: ${formatTokens(b.tokens)} (${total > 0 ? Math.round(b.tokens / total * 100) : 0}%)`).join("; "),
					children: buckets.map((b, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: card_module_css_default.tokenStackedSeg,
						style: {
							width: total > 0 ? `${b.tokens / total * 100}%` : "0%",
							background: TOKEN_SPLIT_COLORS[i % TOKEN_SPLIT_COLORS.length]
						}
					}, b.label))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: card_module_css_default.tokenLegend,
					children: buckets.map((b, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: card_module_css_default.tokenItem,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: card_module_css_default.dot,
								style: { background: TOKEN_SPLIT_COLORS[i % TOKEN_SPLIT_COLORS.length] }
							}),
							b.label,
							" ",
							formatTokens(b.tokens),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: card_module_css_default.tokenShare,
								children: total > 0 ? `${Math.round(b.tokens / total * 100)}%` : "0%"
							})
						]
					}, b.label))
				})]
			});
		}
		/** 中文 token 单位：≥1 亿显示亿（两位小数），≥1 万显示万（一位小数），否则原样。 */
		function formatCnTokens(tokens) {
			if (tokens >= 1e8) return `${(tokens / 1e8).toFixed(2)}亿`;
			if (tokens >= 1e4) return `${(tokens / 1e4).toFixed(1)}万`;
			return String(tokens);
		}
		/** 桶内模型分段：tokens 降序 Top 5 + 「其他」聚合，取色与模型占比 Donut 一致。 */
		function bucketSegments(point, t) {
			const label = (model) => model === "__unknown__" ? t("model.unknown") : model;
			const sorted = [...point.byModel].sort((a, b) => b.tokens - a.tokens);
			if (sorted.length <= 5) return sorted.map((m, i) => ({
				model: label(m.model),
				tokens: m.tokens,
				colorVar: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length]
			}));
			const top = sorted.slice(0, 5);
			const rest = sorted.slice(5).reduce((sum, m) => sum + m.tokens, 0);
			return [...top.map((m, i) => ({
				model: label(m.model),
				tokens: m.tokens,
				colorVar: DONUT_SEGMENT_VARS[i]
			})), {
				model: t("chart.other"),
				tokens: rest,
				colorVar: DONUT_SEGMENT_VARS[5]
			}];
		}
		/** 用量趋势堆叠柱状图（无库 SVG + CSS）：Y 轴刻度 + 按模型分段 + hover 明细 tooltip。 */
		function TrendAreaChart(props) {
			const { t, costCurrency, series } = props;
			const [hover, setHover] = (0, react.useState)(null);
			const width = 600;
			const height = 140;
			const padY = 12;
			const padX = 4;
			if (series.length < 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: card_module_css_default.status,
				children: t("chart.insufficientData")
			});
			const dataMax = Math.max(...series.map((p) => p.tokens), 0);
			const axisMax = dataMax <= 0 ? 1 : dataMax / .8;
			const innerH = 116;
			const y = (v) => 128 - v / axisMax * innerH;
			const ticks = [
				0,
				.25,
				.5,
				.75,
				1
			].map((f) => axisMax * f);
			const colW = 592 / series.length;
			const barW = Math.max(3, colW * .45);
			const barX = (i) => padX + i * colW + (colW - barW) / 2;
			const tickStep = Math.max(1, Math.ceil(series.length / 12));
			const xTicks = series.filter((_, i) => i % tickStep === 0 || i === series.length - 1 && (series.length - 1) % tickStep !== 0);
			const hovered = hover !== null ? series[hover] : null;
			const hoverCenter = hover !== null ? (hover + .5) / series.length * 100 : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.trendChart,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.trendBody,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: card_module_css_default.trendYAxis,
						"aria-hidden": "true",
						children: ticks.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.trendYTick,
							style: {
								top: `${y(v) / height * 100}%`,
								transform: v === 0 ? "translateY(0)" : v === axisMax ? "translateY(-100%)" : "translateY(-50%)"
							},
							children: formatCnTokens(v)
						}, v))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.trendPlot,
						onMouseLeave: () => setHover(null),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							className: card_module_css_default.trendSvg,
							viewBox: `0 0 ${width} ${height}`,
							preserveAspectRatio: "none",
							role: "img",
							"aria-label": series.map((p) => `${p.bucket}: ${formatCnTokens(p.tokens)}`).join("; "),
							children: [ticks.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
								x1: padX,
								x2: 596,
								y1: y(v).toFixed(1),
								y2: y(v).toFixed(1),
								stroke: "var(--dsw-alias-border-l2)",
								strokeWidth: "1",
								vectorEffect: "non-scaling-stroke"
							}, v)), series.map((p, i) => {
								const segs = bucketSegments(p, t);
								let base = 128;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
									onMouseEnter: () => setHover(i),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											"data-trend-hit": "true",
											className: card_module_css_default.trendHit,
											x: padX + i * colW,
											y: padY,
											width: colW,
											height: innerH,
											fill: "transparent"
										}),
										hover === i ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: padX + i * colW,
											y: padY,
											width: colW,
											height: innerH,
											fill: "var(--dsw-alias-state-business-primary)",
											opacity: "0.06"
										}) : null,
										segs.map((s) => {
											const segH = s.tokens / axisMax * innerH;
											const top = base - segH;
											base = top;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
												x: barX(i),
												y: top,
												width: barW,
												height: Math.max(0, segH),
												fill: s.colorVar
											}, s.model);
										})
									]
								}, p.bucket);
							})]
						}), hovered !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.trendTooltip,
							style: {
								left: `${hoverCenter}%`,
								transform: hoverCenter > 78 ? "translateX(-100%)" : "translateX(-50%)"
							},
							role: "tooltip",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: card_module_css_default.tooltipDate,
									children: hovered.bucket
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.tooltipRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("trend.total") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatCnTokens(hovered.tokens) })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.tooltipRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("trend.cost") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [costSymbol$1(costCurrency), formatCost$1(hovered.cost)] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: card_module_css_default.tooltipModels,
									children: bucketSegments(hovered, t).map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: card_module_css_default.tooltipModel,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.dot,
												style: { background: s.colorVar }
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.tooltipModelName,
												children: s.model
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatCnTokens(s.tokens) })
										]
									}, s.model))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.tooltipRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("trend.hitRate") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatRate(hovered.hitRate) })]
								})
							]
						}) : null]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: card_module_css_default.trendAxis,
					children: xTicks.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: card_module_css_default.trendTick,
						children: p.bucket.slice(5)
					}, p.bucket))
				})]
			});
		}
		const PROVIDERS = [{
			key: "opencode",
			labelKey: "provider.opencode"
		}, {
			key: "deepseek",
			labelKey: "provider.deepseek"
		}];
		/** 常驻 KPI 区：4 张 KPI 卡 + Token 四分色拆分（不随 Tab 切换）。 */
		function KpiOverview(props) {
			const { t, summary, provider, balance } = props;
			let dynamicValue = "-";
			let dynamicChip = "";
			let dynamicSub = "";
			if (provider === "opencode") {
				dynamicValue = balance?.quota?.weekly?.percent !== null && balance?.quota?.weekly?.percent !== void 0 ? `${balance.quota.weekly.percent}%` : "-";
				dynamicChip = t("provider.weeklyQuota");
				dynamicSub = balance?.quota?.weekly?.resetsAt !== null && balance?.quota?.weekly?.resetsAt !== void 0 ? `${t("kpi.quotaUsed")} ${dynamicValue}` : t("provider.notConnected");
			} else if (provider === "deepseek") {
				dynamicValue = balance?.balance !== null && balance?.balance !== void 0 ? `${balance.balance} ${balance.currency}` : "-";
				dynamicChip = t("provider.prepay");
				dynamicSub = balance?.updatedAt !== null && balance?.updatedAt !== void 0 ? `${t("balance.updated")} ${new Date(balance.updatedAt).toLocaleString()}` : t("provider.notConnected");
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.kpiGrid,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.kpiCard,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.kpiTop,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("metric.tokens") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiIcon, { kind: "chart" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiValue,
								title: t("metric.tokensHint"),
								children: formatTokens(summary.tokens.total)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
								className: card_module_css_default.kpiSub,
								children: [
									t("kpi.costPrefix"),
									": ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
										className: card_module_css_default.kpiCostVal,
										children: [costSymbol$1(balance?.costCurrency ?? ""), formatCost$1(summary.cost)]
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.kpiCard,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.kpiTop,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("metric.requests") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiIcon, { kind: "send" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiValue,
								children: summary.requests
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiSub,
								children: summary.uncountedRequests > 0 ? `${t("metric.uncounted")} ${summary.uncountedRequests}` : ""
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.kpiCard,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.kpiTop,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("metric.turns") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiIcon, { kind: "turns" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiValue,
								children: summary.turns
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiSub,
								children: t("metric.turns")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.kpiCard,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.kpiTop,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("metric.activeDays") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiIcon, { kind: "days" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiValue,
								children: summary.activeDays
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiSub,
								children: t("kpi.daysUnit")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.kpiCard,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.kpiTop,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("metric.avgHitRate") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiIcon, { kind: "bolt" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiValueEmerald,
								children: formatRate(summary.avgCacheHitRate)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
								className: card_module_css_default.kpiSub,
								children: [
									t("kpi.hitTokens"),
									" ",
									formatTokens(summary.tokens.cacheReadTokens)
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.kpiCardDynamic,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.kpiTopRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: card_module_css_default.kpiDynamicLabel,
									children: provider === "opencode" ? t("provider.opencode") : t("provider.deepseek")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `${card_module_css_default.chip} ${card_module_css_default.chipBlue}`,
									children: dynamicChip
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiValueAccent,
								children: dynamicValue
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: card_module_css_default.kpiSub,
								children: dynamicSub
							})
						]
					})
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TokenSplitBar, {
				t,
				buckets: [
					{
						label: t("tokens.input"),
						tokens: summary.tokens.uncachedInputTokens
					},
					{
						label: t("tokens.cacheRead"),
						tokens: summary.tokens.cacheReadTokens
					},
					{
						label: t("tokens.cacheWrite"),
						tokens: summary.tokens.cacheWriteTokens
					},
					{
						label: t("tokens.output"),
						tokens: summary.tokens.outputTokens
					}
				]
			})] });
		}
		/** 用量概览 Tab 内容：趋势面积图 + 会话指标 + 模型明细（KPI 与 Token 拆分在 Tab 上方常驻）。 */
		function OverviewTab(props) {
			const { t, summary, costCurrency } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: card_module_css_default.heading,
					children: t("trend.title")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrendAreaChart, {
					t,
					costCurrency,
					series: summary.series
				}),
				summary.perSession !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
					className: card_module_css_default.metrics,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("metric.lastHit") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: summary.perSession.lastRequestHitRate === null ? "-" : formatRate(summary.perSession.lastRequestHitRate) })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("metric.lastCost") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: summary.perSession.lastRequestCost === null ? "-" : formatCost$1(summary.perSession.lastRequestCost) })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("metric.sessionTurns") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: summary.perSession.turns })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("metric.sessionCost") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatCost$1(summary.perSession.cost) })] })
					]
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: card_module_css_default.heading,
					children: t("model.table")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: card_module_css_default.tableCard,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: card_module_css_default.table,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("metric.topModel") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								className: card_module_css_default.thRight,
								children: t("metric.requests")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								className: card_module_css_default.thRight,
								children: t("metric.tokens")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								className: card_module_css_default.thRight,
								children: t("metric.cost")
							})
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: summary.byModel.map((m, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
							className: card_module_css_default.trHover,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: card_module_css_default.modelDot,
									style: { background: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length] }
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: m.model === "__unknown__" ? t("model.unknown") : m.model })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: card_module_css_default.tdRight,
									children: m.requests
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: `${card_module_css_default.tdRight} ${card_module_css_default.tdStrong}`,
									children: formatTokens(m.tokens)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: card_module_css_default.tdRight,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: card_module_css_default.kpiCostVal,
										children: [costSymbol$1(costCurrency), formatCost$1(m.cost)]
									})
								})
							]
						}, m.model)) })]
					})
				}),
				summary.uncountedRequests > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: card_module_css_default.status,
					children: [
						t("metric.uncounted"),
						": ",
						summary.uncountedRequests
					]
				}) : null
			] });
		}
		/** 模型与缓存 Tab：donut 占比 + 缓存效率诊断。 */
		function ModelsTab(props) {
			const { t, summary, segments } = props;
			const inputTotal = summary.tokens.uncachedInputTokens + summary.tokens.cacheReadTokens + summary.tokens.cacheWriteTokens;
			const savedRatio = inputTotal > 0 ? summary.tokens.cacheReadTokens / inputTotal * 100 : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.chartRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.chartCell,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: card_module_css_default.heading,
						children: t("chart.donut")
					}), segments.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: card_module_css_default.status,
						children: t("chart.noData")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DonutChart, {
						t,
						segments,
						total: summary.requests,
						centerLabel: t("metric.requests")
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.chartCell,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: card_module_css_default.heading,
						children: t("chart.cacheDiag")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.cacheDiag,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
								t("chart.cacheHigh"),
								" (",
								formatRate(summary.avgCacheHitRate),
								")"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("chart.cacheSaved"),
								" ",
								formatTokens(summary.tokens.cacheReadTokens)
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.cacheDiagRows,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.cacheDiagRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("kpi.hitTokens") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatTokens(summary.tokens.cacheReadTokens) })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.cacheDiagRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("chart.savedRatio") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [savedRatio.toFixed(1), "%"] })]
								})]
							})
						]
					})]
				})]
			});
		}
		/** 配额窗口状态分级：百分比 → chip 文案键、chip 类与进度条颜色。 */
		function quotaLevel(percent) {
			if (percent >= 85) return {
				labelKey: "quota.high",
				colorVar: "var(--dsw-alias-state-error-primary)",
				chipClass: "chipError"
			};
			if (percent >= 60) return {
				labelKey: "quota.elevated",
				colorVar: "var(--dsw-alias-state-warn-primary)",
				chipClass: "chipAmber"
			};
			if (percent >= 30) return {
				labelKey: "quota.normal",
				colorVar: "var(--dsw-alias-state-info-primary, var(--dsw-alias-state-business-primary))",
				chipClass: "chipBlue"
			};
			return {
				labelKey: "quota.abundant",
				colorVar: "var(--dsw-alias-state-success-primary)",
				chipClass: "chipEmerald"
			};
		}
		/** 单个配额窗口进度条卡（滚动/每周/每月，参考原型 quotaCard）。 */
		function QuotaWindowCard(props) {
			const { t, label, window, highlight } = props;
			if (window === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${card_module_css_default.quotaCard} ${highlight ? card_module_css_default.quotaCardActive : ""}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.quotaCardTop,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.quotaCardLabel,
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `${card_module_css_default.chip} ${card_module_css_default.chipNeutral}`,
							children: "-"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: card_module_css_default.quotaCardValue,
						children: "-"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: card_module_css_default.progressBarBg,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: card_module_css_default.progressBarFill,
							style: {
								width: "0%",
								background: "var(--dsw-alias-label-tertiary)"
							}
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.quotaCardReset,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("quota.resetLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "-" })]
					})
				]
			});
			const level = quotaLevel(window.percent);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${card_module_css_default.quotaCard} ${highlight ? card_module_css_default.quotaCardActive : ""}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.quotaCardTop,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.quotaCardLabel,
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `${card_module_css_default.chip} ${card_module_css_default[level.chipClass]}`,
							children: t(level.labelKey)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.quotaCardValue,
						children: [window.percent, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.quotaCardUnit,
							children: "%"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: card_module_css_default.progressBarBg,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: card_module_css_default.progressBarFill,
							style: {
								width: `${Math.min(100, window.percent)}%`,
								background: level.colorVar
							}
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.quotaCardReset,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("quota.resetLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatResetCountdown(window.resetsAt, t) })]
					})
				]
			});
		}
		/** 余额与配额 Tab：按提供商展示余额/配额（参考原型 Tab 3）。 */
		function QuotaTab(props) {
			const { t, provider, summary, balance, balanceRefreshing, onRefreshBalance } = props;
			const quota = balance?.quota ?? null;
			if (balance === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: card_module_css_default.status,
				children: t("loading")
			});
			if (provider === "opencode") {
				if (quota === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: card_module_css_default.status,
					children: [t("balance.unavailable"), balance.error !== null ? `: ${balance.error}` : ""]
				});
				const rows = [
					{
						key: "rolling",
						label: t("quota.rolling"),
						window: quota.rolling
					},
					{
						key: "weekly",
						label: t("quota.weekly"),
						window: quota.weekly
					},
					{
						key: "monthly",
						label: t("quota.monthly"),
						window: quota.monthly
					}
				];
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.quotaView,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: card_module_css_default.quotaGrid,
						children: rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaWindowCard, {
							t,
							label: row.label,
							window: row.window,
							highlight: row.key === "weekly"
						}, row.key))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.noticeBar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							className: card_module_css_default.noticeIcon,
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "2",
							strokeLinecap: "round",
							strokeLinejoin: "round",
							"aria-hidden": "true",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "10"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 16v-4" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 8h.01" })
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("quota.notice") })]
					})]
				});
			}
			if (provider === "deepseek") {
				if (balance.balance === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: card_module_css_default.status,
					children: [t("balance.unavailable"), balance.error !== null ? `: ${balance.error}` : ""]
				});
				const dailyCost = summary.activeDays > 0 ? summary.cost / summary.activeDays : 0;
				const estDays = dailyCost > 0 ? Math.floor(balance.balance / dailyCost) : null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.deepseekCard,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.deepseekRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: card_module_css_default.deepseekLabel,
								children: [
									t("provider.deepseek"),
									" · ",
									t("balance.amount")
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${card_module_css_default.chip} ${card_module_css_default.chipBlue}`,
								children: t("provider.prepay")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.deepseekAmount,
							children: [
								balance.balance,
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: card_module_css_default.deepseekCurrency,
									children: balance.currency
								})
							]
						}),
						balance.balance <= 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: card_module_css_default.deepseekEstimate,
							children: t("balance.negative")
						}) : estDays !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.deepseekEstimate,
							children: [
								t("balance.estimate"),
								" ",
								estDays,
								" ",
								t("balance.days"),
								" · ",
								t("balance.sufficient")
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.deepseekActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: card_module_css_default.btnPrimary,
								href: "https://platform.deepseek.com/top_up",
								target: "_blank",
								rel: "noopener noreferrer",
								onClick: (e) => {
									e.preventDefault();
									window.open("https://platform.deepseek.com/top_up", "_blank", "noopener,noreferrer");
								},
								children: t("balance.recharge")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: card_module_css_default.refresh,
								disabled: balanceRefreshing,
								onClick: onRefreshBalance,
								children: balanceRefreshing ? t("balance.refreshing") : t("balance.refresh")
							})]
						}),
						balance.updatedAt !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: card_module_css_default.status,
							children: [
								t("balance.updated"),
								": ",
								new Date(balance.updatedAt).toLocaleString()
							]
						}) : null,
						balance.source !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: card_module_css_default.status,
							children: [
								t("balance.source"),
								": ",
								balance.source.source
							]
						}) : null
					]
				});
			}
			return null;
		}
		/** 重置倒计时文案：'2 天 3 小时后重置' / '5 小时后重置' / '30 分钟后重置'。 */
		function formatResetCountdown(resetsAt, t) {
			if (resetsAt === null) return "";
			const ms = Date.parse(resetsAt) - Date.now();
			if (!Number.isFinite(ms) || ms <= 0) return t("quota.resetSoon");
			const totalMinutes = Math.floor(ms / 6e4);
			if (totalMinutes < 60) return `${totalMinutes} ${t("quota.minutes")}${t("quota.after")}`;
			const hours = Math.floor(totalMinutes / 60);
			const days = Math.floor(hours / 24);
			if (days > 0) {
				const restHours = hours - days * 24;
				return restHours > 0 ? `${days} ${t("quota.days")} ${restHours} ${t("quota.hours")}${t("quota.after")}` : `${days} ${t("quota.days")}${t("quota.after")}`;
			}
			return `${hours} ${t("quota.hours")}${t("quota.after")}`;
		}
		/** 统计卡片主体：折叠卡头 + 控制栏 + 4 KPI 卡 + 三级 Tab。 */
		function UsageStatsCard(props) {
			const { t, summary, balances, loading, error } = props;
			const [activeTab, setActiveTab] = (0, react.useState)("overview");
			const [provider, setProvider] = (0, react.useState)("opencode");
			const balance = balances?.[provider] ?? null;
			const segments = (0, react.useMemo)(() => summary === null ? [] : donutSegments(summary.byModel), [summary]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.content,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.controlBar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.timeSegment,
							children: [RANGES.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: props.rangeDays === r.days ? card_module_css_default.timeBtnActive : card_module_css_default.timeBtn,
								onClick: () => props.onRangeDays(r.days),
								children: t("range." + r.key)
							}, r.key)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: props.rangeDays === "custom" ? card_module_css_default.timeBtnActive : card_module_css_default.timeBtn,
								onClick: () => props.onRangeDays("custom"),
								children: t("range.custom")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.providerRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: card_module_css_default.providerLabel,
								children: t("provider.switch")
							}), PROVIDERS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: provider === p.key ? card_module_css_default.providerPillActive : card_module_css_default.providerPill,
								onClick: () => setProvider(p.key),
								children: t(p.labelKey)
							}, p.key))]
						})]
					}),
					props.rangeDays === "custom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.customRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("range.from"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "date",
							value: props.customFrom,
							onChange: (e) => props.onCustomFrom(e.target.value)
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("range.to"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "date",
							value: props.customTo,
							onChange: (e) => props.onCustomTo(e.target.value)
						})] })]
					}) : null,
					loading && summary === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: card_module_css_default.status,
						children: t("loading")
					}) : null,
					error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: card_module_css_default.status,
						children: [
							t("error"),
							": ",
							error
						]
					}) : null,
					summary !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiOverview, {
							t,
							summary,
							provider,
							balance
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: card_module_css_default.tabNav,
							children: [
								{
									key: "overview",
									labelKey: "tab.overview"
								},
								{
									key: "models",
									labelKey: "tab.models"
								},
								{
									key: "quota",
									labelKey: "tab.quota"
								}
							].map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: activeTab === tab.key ? card_module_css_default.tabBtnActive : card_module_css_default.tabBtn,
								onClick: () => setActiveTab(tab.key),
								children: t(tab.labelKey)
							}, tab.key))
						}),
						activeTab === "overview" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewTab, {
							t,
							summary,
							costCurrency: balance?.costCurrency ?? ""
						}) : null,
						activeTab === "models" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelsTab, {
							t,
							summary,
							segments
						}) : null,
						activeTab === "quota" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaTab, {
							t,
							provider,
							summary,
							balance,
							balanceRefreshing: props.balanceRefreshing,
							onRefreshBalance: props.onRefreshBalance
						}) : null
					] }) : null
				]
			});
		}
		let statsShared = null;
		function setStatsShared(shared) {
			statsShared = shared;
		}
		const REFRESH_INTERVAL_MS$1 = 3e4;
		function fmtDate(d) {
			const mm = String(d.getMonth() + 1).padStart(2, "0");
			const dd = String(d.getDate()).padStart(2, "0");
			return `${d.getFullYear()}-${mm}-${dd}`;
		}
		/** 统计卡片 controller：持有范围与数据状态，展开时 30s 轮询 summary/balance。 */
		var UsageStatsCardController = class {
			store;
			rangeDays = 7;
			customFrom = "";
			customTo = "";
			summary = null;
			balances = null;
			loading = false;
			error = null;
			balanceRefreshing = false;
			expanded = false;
			abort = null;
			timer = null;
			constructor() {
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.projection());
			}
			/** 计算当前范围起点；自定义且未填时返回 null。 */
			currentFrom() {
				if (this.rangeDays === "custom") return this.customFrom === "" ? null : this.customFrom;
				const base = /* @__PURE__ */ new Date();
				base.setDate(base.getDate() - (this.rangeDays - 1));
				return fmtDate(base);
			}
			/** 计算当前范围终点；自定义且未填时返回 null。 */
			currentTo() {
				if (this.rangeDays === "custom") return this.customTo === "" ? null : this.customTo;
				return fmtDate(/* @__PURE__ */ new Date());
			}
			projection() {
				return {
					summary: this.summary,
					balances: this.balances,
					loading: this.loading,
					error: this.error,
					rangeDays: this.rangeDays,
					customFrom: this.customFrom,
					customTo: this.customTo,
					balanceRefreshing: this.balanceRefreshing,
					expanded: this.expanded
				};
			}
			publish() {
				this.store.set(this.projection());
			}
			startPolling() {
				if (this.timer !== null) return;
				this.pollSummary();
				this.pollBalance();
				this.timer = setInterval(() => {
					this.pollSummary();
					this.pollBalance();
				}, REFRESH_INTERVAL_MS$1);
			}
			stopPolling() {
				if (this.timer !== null) {
					clearInterval(this.timer);
					this.timer = null;
				}
				this.abort?.abort();
			}
			/** 切换展开状态：展开即拉取并定时刷新，收起即停止轮询并中止在途请求。 */
			toggleExpanded() {
				this.expanded = !this.expanded;
				if (this.expanded) this.startPolling();
				else this.stopPolling();
				this.publish();
			}
			async pollSummary() {
				const from = this.currentFrom();
				const to = this.currentTo();
				if (from === null || to === null) {
					this.loading = true;
					this.publish();
					return;
				}
				this.abort?.abort();
				const controller = new AbortController();
				this.abort = controller;
				this.loading = true;
				this.publish();
				try {
					const summary = await fetchSummary(from, to, controller.signal);
					if (controller.signal.aborted) return;
					this.summary = summary;
					this.error = null;
				} catch (e) {
					if (controller.signal.aborted) return;
					this.error = String(e?.message ?? e);
				} finally {
					if (!controller.signal.aborted) {
						this.loading = false;
						this.publish();
					}
				}
			}
			async pollBalance() {
				try {
					this.balances = await fetchBalance();
				} catch (e) {
					const error = String(e?.message ?? e);
					this.balances = {
						opencode: {
							balance: null,
							currency: "",
							updatedAt: null,
							error,
							source: null,
							quota: null,
							costCurrency: "CNY"
						},
						deepseek: {
							balance: null,
							currency: "CNY",
							updatedAt: null,
							error,
							source: null,
							quota: null,
							costCurrency: "CNY"
						}
					};
				}
				this.publish();
			}
			/** 构建插槽注册侧注入面。 */
			inject() {
				return {
					hooks: { usageStatsCard: this.store },
					onRangeDays: (days) => {
						this.rangeDays = days;
						this.pollSummary();
					},
					onCustomFrom: (value) => {
						this.customFrom = value;
						if (this.rangeDays === "custom") this.pollSummary();
					},
					onCustomTo: (value) => {
						this.customTo = value;
						if (this.rangeDays === "custom") this.pollSummary();
					},
					onRefreshBalance: () => {
						if (this.balanceRefreshing) return;
						this.balanceRefreshing = true;
						this.publish();
						(async () => {
							try {
								this.balances = await refreshBalance();
							} catch (e) {
								const error = String(e?.message ?? e);
								this.balances = {
									opencode: {
										balance: null,
										currency: "",
										updatedAt: null,
										error,
										source: null,
										quota: null,
										costCurrency: "CNY"
									},
									deepseek: {
										balance: null,
										currency: "CNY",
										updatedAt: null,
										error,
										source: null,
										quota: null,
										costCurrency: "CNY"
									}
								};
							}
							this.balanceRefreshing = false;
							this.publish();
						})();
					},
					onToggleExpanded: () => this.toggleExpanded()
				};
			}
		};
		//#endregion
		//#region src/client/UsageStatsSection.tsx
		/**
		* 设置页左侧导航独立 Tab（settings.section）整页组件。
		* section 槽不提供 inject face（官方 GeneralSection 同），组件通过
		* useSyncExternalStore 直接订阅 apply 注入的共享 controller store。
		*/
		function UsageStatsSection(_props) {
			const shared = statsShared;
			if (shared === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {});
			const state = (0, react.useSyncExternalStore)((cb) => shared.face.hooks.usageStatsCard.subscribe(cb), () => shared.face.hooks.usageStatsCard.getSnapshot());
			const t = shared.t;
			(0, react.useEffect)(() => {
				if (!shared.face.hooks.usageStatsCard.getSnapshot().expanded) shared.face.onToggleExpanded();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.sectionPage,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.sectionHeaderRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: card_module_css_default.sectionIconBadge,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "18",
							height: "18",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "2.2",
							strokeLinecap: "round",
							strokeLinejoin: "round",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 3v18h18" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
									x: "7",
									y: "12",
									width: "3",
									height: "6",
									rx: "0.8"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
									x: "13",
									y: "8",
									width: "3",
									height: "10",
									rx: "0.8"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
									x: "19",
									y: "5",
									width: "3",
									height: "13",
									rx: "0.8"
								})
							]
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: card_module_css_default.sectionHeaderText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: card_module_css_default.sectionPageTitle,
							children: t("settings.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: card_module_css_default.sectionPageDesc,
							children: t("settings.description")
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageStatsCard, {
					t,
					summary: state.summary,
					balances: state.balances,
					loading: state.loading,
					error: state.error,
					rangeDays: state.rangeDays,
					customFrom: state.customFrom,
					customTo: state.customTo,
					onRangeDays: shared.face.onRangeDays,
					onCustomFrom: shared.face.onCustomFrom,
					onCustomTo: shared.face.onCustomTo,
					onRefreshBalance: shared.face.onRefreshBalance,
					balanceRefreshing: state.balanceRefreshing
				})]
			});
		}
		//#endregion
		//#region src/client/session-usage.tsx
		const REFRESH_INTERVAL_MS = 3e4;
		/** 会话平均命中率：cacheRead / 全部输入类 token。 */
		function sessionHitRate(session) {
			const input = session.uncachedInputTokens + session.cacheReadTokens + session.cacheWriteTokens;
			return input <= 0 ? 0 : session.cacheReadTokens / input;
		}
		function formatCost(cost) {
			return cost.toFixed(4);
		}
		/** 费用计价货币符号：CNY → ¥，USD → $，其他货币原样前缀。 */
		function costSymbol(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return currency === "" ? "" : `${currency} `;
		}
		/** 会话用量 controller：面板开合 + 展开时轮询会话明细与余额。 */
		var SessionUsageController = class {
			store;
			open = false;
			perSession = null;
			balance = null;
			loading = false;
			error = null;
			abort = null;
			timer = null;
			sessionId = null;
			constructor() {
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.projection());
			}
			projection() {
				return {
					open: this.open,
					perSession: this.perSession,
					balance: this.balance,
					loading: this.loading,
					error: this.error
				};
			}
			publish() {
				this.store.set(this.projection());
			}
			async poll() {
				const sessionId = this.sessionId;
				if (sessionId === null) return;
				this.abort?.abort();
				const controller = new AbortController();
				this.abort = controller;
				this.loading = true;
				this.publish();
				const [session, balance] = await Promise.all([fetchSessionUsage(sessionId, controller.signal).catch((e) => {
					if (controller.signal.aborted) return null;
					this.error = String(e?.message ?? e);
					return null;
				}), fetchBalance(controller.signal).then((map) => map["deepseek"] ?? map["opencode"] ?? null).catch((e) => {
					if (controller.signal.aborted) return null;
					return {
						balance: null,
						currency: "CNY",
						updatedAt: null,
						error: String(e?.message ?? e),
						source: null
					};
				})]);
				if (controller.signal.aborted) return;
				if (session !== null) {
					this.perSession = session;
					this.error = null;
				}
				if (balance !== null) this.balance = balance;
				this.loading = false;
				this.publish();
			}
			startPolling() {
				if (this.timer !== null) return;
				this.poll();
				this.timer = setInterval(() => {
					this.poll();
				}, REFRESH_INTERVAL_MS);
			}
			stopPolling() {
				if (this.timer !== null) {
					clearInterval(this.timer);
					this.timer = null;
				}
				this.abort?.abort();
			}
			toggle() {
				this.open = !this.open;
				if (this.open) this.startPolling();
				else this.stopPolling();
				this.publish();
			}
			/**
			* session scope 注入：框架对每个会话的 inject face 做 identity 缓存
			* （provide bundle 稳定，切回原会话时不再调用 inject），所以会话切换
			* 的实时性由组件层 rebind 保证；这里仅处理首次绑定与切换时的拉取。
			* 会话绑定/切换时立即清空旧数据并拉取一次（不依赖面板是否打开）：
			* 按钮上始终显示当前会话用量，重启/刷新后不会停留在 0。
			* 面板打开时另有 30s 轮询。
			*/
			inject(sessionId) {
				if (this.sessionId !== sessionId) {
					this.sessionId = sessionId;
					this.perSession = null;
					this.error = null;
					this.poll();
					this.publish();
				}
				return {
					hooks: { sessionUsage: this.store },
					onToggle: () => this.toggle(),
					rebind: (nextSessionId) => {
						if (nextSessionId !== this.sessionId) {
							this.sessionId = nextSessionId;
							this.perSession = null;
							this.error = null;
							this.poll();
							this.publish();
						}
					}
				};
			}
		};
		/** 触发按钮图标（内联 SVG，无外部依赖）。 */
		function ChevronDownIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className: props.open ? card_module_css_default.chevronOpen : card_module_css_default.chevronIcon,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 9 6 6 6-6" })
			});
		}
		function PulseDot() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: card_module_css_default.pulseDotContainer,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: card_module_css_default.pulseDotPing }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: card_module_css_default.pulseDot })]
			});
		}
		/** 自适应 token 缩写：≥1M 用 M，否则 K。 */
		function formatCompactTokens(tokens) {
			if (tokens >= 1e6) return {
				value: (tokens / 1e6).toFixed(2),
				unit: "M"
			};
			if (tokens >= 1e3) return {
				value: (tokens / 1e3).toFixed(1),
				unit: "K"
			};
			return {
				value: String(tokens),
				unit: ""
			};
		}
		/** 受控的用量按钮 + 展开面板（外部点击 / Escape 关闭）。 */
		function SessionUsageButton(props) {
			const { t, state, onToggle } = props;
			const rootRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!state.open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (rootRef.current !== null && !rootRef.current.contains(target)) onToggle();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") onToggle();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [state.open, onToggle]);
			const session = state.perSession;
			const tokensTotal = session === null ? 0 : session.uncachedInputTokens + session.cacheReadTokens + session.cacheWriteTokens + session.outputTokens;
			const tokens = session === null ? null : formatCompactTokens(tokensTotal);
			const avgHit = session === null ? 0 : sessionHitRate(session) * 100;
			const recentHit = session?.lastRequestHitRate === null || session?.lastRequestHitRate === void 0 ? null : session.lastRequestHitRate * 100;
			const recentTokens = session?.lastRequestTokens === null || session?.lastRequestTokens === void 0 ? null : session.lastRequestTokens;
			recentTokens === null || formatCompactTokens(recentTokens);
			const currentTurn = session?.currentTurn ?? null;
			const turnTokens = currentTurn !== null ? currentTurn.tokens : session?.lastTurnTokens ?? null;
			const turnCost = currentTurn !== null ? currentTurn.cost : session?.lastTurnCost ?? null;
			const turnTokensCompact = turnTokens === null ? null : formatCompactTokens(turnTokens);
			const balance = state.balance;
			const costSym = costSymbol(balance?.costCurrency ?? "");
			const unpriced = session !== null && session.cost === 0 && tokensTotal > 0;
			/** 重置倒计时：'2 天 3 小时后重置' / '5 小时后重置' / '30 分钟后重置'。 */
			const formatReset = (resetsAt) => {
				if (resetsAt === null) return "";
				const ms = Date.parse(resetsAt) - Date.now();
				if (!Number.isFinite(ms) || ms <= 0) return t("quota.resetSoon");
				const totalMinutes = Math.floor(ms / 6e4);
				if (totalMinutes < 60) return `${totalMinutes} ${t("quota.minutes")}${t("quota.after")}`;
				const hours = Math.floor(totalMinutes / 60);
				const days = Math.floor(hours / 24);
				if (days > 0) {
					const restHours = hours - days * 24;
					return restHours > 0 ? `${days} ${t("quota.days")} ${restHours} ${t("quota.hours")}${t("quota.after")}` : `${days} ${t("quota.days")}${t("quota.after")}`;
				}
				return `${hours} ${t("quota.hours")}${t("quota.after")}`;
			};
			const quota = balance?.quota ?? null;
			const quotaRows = quota === null ? [] : [
				{
					key: "rolling",
					label: t("quota.rolling"),
					window: quota.rolling
				},
				{
					key: "weekly",
					label: t("quota.weekly"),
					window: quota.weekly
				},
				{
					key: "monthly",
					label: t("quota.monthly"),
					window: quota.monthly
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: card_module_css_default.sessionUsageRoot,
				ref: rootRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: state.open ? card_module_css_default.sessionUsageActive : card_module_css_default.sessionUsage,
					"aria-expanded": state.open,
					"aria-haspopup": "true",
					onClick: onToggle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PulseDot, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.labelMuted,
							children: t("session.usageLabel")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.valHighlightTokens,
							children: tokens === null ? "-" : `${tokens.value}${tokens.unit}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.valSeparator,
							children: "|"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: card_module_css_default.valHighlightCost,
							children: session === null ? "-" : `${costSym}${formatCost(session.cost)}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronDownIcon, { open: state.open })
					]
				}), state.open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: card_module_css_default.sessionUsagePanel,
					role: "dialog",
					"aria-label": t("session.panelTitle"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: card_module_css_default.panelHeader,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.panelTitleGroup,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PulseDot, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: card_module_css_default.panelTitle,
									children: t("session.panelTitle")
								})]
							})
						}),
						state.loading && session === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: card_module_css_default.panelStatus,
							children: t("loading")
						}) : null,
						state.error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: card_module_css_default.panelStatus,
							children: [
								t("error"),
								": ",
								state.error
							]
						}) : null,
						!state.loading && state.error === null && session === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: card_module_css_default.panelStatus,
							children: t("session.noRecord")
						}) : null,
						session !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.panelBody,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: card_module_css_default.sectionHeader,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: card_module_css_default.sectionTitle,
									children: t("session.heroTitle")
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: card_module_css_default.heroCard,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.heroTopGrid,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: card_module_css_default.heroCol,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: card_module_css_default.statNumGroup,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.statNumber,
												children: tokens?.value
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.statUnit,
												children: tokens?.unit
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: card_module_css_default.statLabel,
											children: t("session.heroTokens")
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: card_module_css_default.heroCol,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: card_module_css_default.statNumGroup,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: `${card_module_css_default.statNumber} ${card_module_css_default.statNumberCost}`,
												children: [
													costSym,
													formatCost(session.cost),
													unpriced ? "*" : ""
												]
											})
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: card_module_css_default.statLabel,
											children: t("session.heroCost")
										})]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.heroBottomGrid,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: card_module_css_default.metaCol,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: card_module_css_default.metaLabel,
											children: t("session.heroRounds")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: card_module_css_default.metaValText,
											children: [session.turns, " 次"]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: card_module_css_default.metaCol,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: card_module_css_default.metaLabel,
											children: t("session.heroAvgHit")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: card_module_css_default.metaValEmerald,
											children: [avgHit.toFixed(2), "%"]
										})]
									})]
								})]
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: card_module_css_default.sectionTitle,
									style: { marginBottom: "6px" },
									children: t("session.recentTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: card_module_css_default.recentCard,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: card_module_css_default.recentGrid,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentLabel,
												children: t("session.recentModel")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentValue,
												title: session.lastModel ?? void 0,
												children: session.lastModel ?? "-"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentLabel,
												children: t("session.recentHit")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentValueEmerald,
												children: recentHit === null ? "-" : `${recentHit.toFixed(2)}%`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentLabel,
												children: t("session.recentTokens")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentValue,
												children: turnTokensCompact === null ? "-" : `${turnTokensCompact.value}${turnTokensCompact.unit} Tokens`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: card_module_css_default.recentLabel,
												children: t("session.recentCost")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `${card_module_css_default.recentValue} ${card_module_css_default.recentValueCost}`,
												children: turnCost === null ? "-" : `${costSym}${formatCost(turnCost)}`
											})
										]
									})
								}),
								unpriced ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: card_module_css_default.unpricedHint,
									children: t("session.unpricedHint")
								}) : null
							] })]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: card_module_css_default.panelFooter,
							children: [quotaRows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: card_module_css_default.quotaRows,
								children: quotaRows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: card_module_css_default.quotaRow,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: card_module_css_default.quotaLabel,
											children: row.label
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: card_module_css_default.quotaPercent,
											children: row.window === null ? "-" : `${row.window.percent}%`
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: card_module_css_default.quotaReset,
											children: row.window === null ? "" : formatReset(row.window.resetsAt)
										})
									]
								}, row.key))
							}) : null, quota === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: card_module_css_default.footerFlex,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: card_module_css_default.balanceText,
									children: [
										t("session.balance"),
										": ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											className: card_module_css_default.balanceVal,
											children: balance === null ? "-" : balance.balance === null ? balance.error ?? t("balance.unavailable") : `${balance.balance} ${balance.currency}`
										})
									]
								})
							}) : null]
						})
					]
				}) : null]
			});
		}
		/** 插槽适配：bridge 注入面到受控按钮组件。 */
		function SessionUsageSlotButton(props) {
			const state = props.useSessionUsage((s) => s);
			const t = props.t;
			const sessionId = props.sessionId;
			(0, react.useEffect)(() => {
				props.rebind(sessionId);
			}, [sessionId]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionUsageButton, {
				t,
				state,
				onToggle: props.onToggle
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** 简体中文字典（键集基准）。 */
		const zh = {
			"settings.title": "API 用量统计",
			"settings.description": "Token、请求、轮次、缓存命中、费用估算与余额。",
			"nav.usage": "用量统计",
			"settings.enabled": "启用用量统计",
			"settings.enabledHint": "关闭后停止统计与余额刷新。",
			"card.active": "已激活",
			"tab.overview": "用量概览",
			"tab.models": "模型与缓存",
			"tab.quota": "余额与配额",
			"provider.switch": "切换提供商",
			"provider.opencode": "OpenCode Go",
			"provider.deepseek": "DeepSeek 官方",
			"provider.weeklyQuota": "周配额",
			"provider.prepay": "预付费",
			"provider.notConnected": "未接入",
			"kpi.hitTokens": "命中",
			"kpi.daysUnit": "天",
			"kpi.costPrefix": "费用",
			"kpi.quotaUsed": "已用",
			"chart.cacheDiag": "缓存效率诊断",
			"chart.cacheHigh": "缓存命中效率高",
			"chart.cacheSaved": "近 7 天通过缓存避免重算",
			"session.usageLabel": "用量:",
			"session.panelTitle": "用量与开销",
			"session.statusOk": "服务正常",
			"session.heroTitle": "会话累计消耗",
			"session.heroTokens": "Tokens 用量",
			"session.heroCost": "会话总费用",
			"session.heroRounds": "完成轮次",
			"session.heroAvgHit": "平均命中",
			"session.recentTitle": "最近单次请求",
			"session.recentModel": "模型",
			"session.recentHit": "缓存命中率",
			"session.recentTokens": "本次消耗",
			"session.recentCost": "本次费用",
			"session.balance": "账户余额",
			"session.unpricedHint": "* 该模型未配置单价，费用按 0 计（可在插件设置中配置价格）",
			"session.noRecord": "该会话无用量记录（插件开始计量前的历史会话不回填）",
			"quota.monthly": "每月用量",
			"quota.weekly": "每周用量",
			"quota.rolling": "滚动用量",
			"quota.days": "天",
			"quota.hours": "小时",
			"quota.minutes": "分钟",
			"quota.after": "后",
			"quota.resetSoon": "即将重置",
			"quota.abundant": "充沛",
			"quota.normal": "正常",
			"quota.elevated": "偏高",
			"quota.high": "告警",
			"quota.used": "已用",
			"quota.resetLabel": "重置时间",
			"quota.notice": "在 opencode 配置中选择「OpenCode Go」作为提供商即可自动激活限额机制。",
			"quota.remaining": "额度剩余",
			"balance.estimate": "预计可支撑约",
			"balance.negative": "余额不足，请充值后继续使用",
			"balance.days": "天消耗",
			"balance.sufficient": "余额充足",
			"balance.recharge": "充值余额",
			"chart.savedRatio": "节省比例",
			"range.last7": "最近 7 天",
			"range.last14": "最近 14 天",
			"range.last30": "最近 30 天",
			"range.last90": "最近 90 天",
			"range.custom": "自定义",
			"range.from": "开始日期",
			"range.to": "结束日期",
			"metric.tokens": "Tokens 用量",
			"metric.tokensHint": "输入 / 缓存读 / 缓存写 / 输出分项与合计。",
			"metric.requests": "请求数量",
			"metric.turns": "完成轮次",
			"metric.activeDays": "活跃天数",
			"metric.avgHitRate": "平均缓存命中率",
			"metric.topModel": "最常用模型",
			"metric.cost": "费用估算",
			"metric.uncounted": "未计价请求",
			"metric.lastHit": "本次命中",
			"metric.lastCost": "本次费用",
			"metric.sessionTurns": "当前会话轮次",
			"metric.sessionCost": "会话费用",
			"balance.title": "账户余额",
			"balance.amount": "余额",
			"balance.updated": "更新时间",
			"balance.refresh": "刷新",
			"balance.refreshing": "刷新中…",
			"balance.unavailable": "余额不可用",
			"balance.source": "来源",
			"model.table": "模型明细",
			"model.unknown": "未标记模型",
			"trend.title": "用量趋势",
			"trend.total": "总用量",
			"trend.cost": "费用",
			"trend.hitRate": "缓存命中率",
			"chart.donut": "模型占比",
			"chart.other": "其他",
			"chart.noData": "暂无数据",
			"chart.insufficientData": "数据点不足，暂不展示趋势",
			"loading": "加载中…",
			"error": "加载失败",
			"tokens.input": "输入",
			"tokens.cacheRead": "缓存读",
			"tokens.cacheWrite": "缓存写",
			"tokens.output": "输出",
			"tokens.total": "合计",
			"settings.overridden": "已覆盖",
			"settings.reset": "恢复默认",
			"settings.readOnly": "当前部署的设置只读。",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.discard": "放弃",
			"settings.unsaved": "未保存",
			"settings.saveFailed": "部署未接受这些值，已保留供你修改。",
			"settings.invalidNumber": "请输入数字，留空则使用默认值。"
		};
		/** 英文字典（与 zh 键集完全一致）。 */
		const en = {
			"settings.title": "API usage stats",
			"settings.description": "Tokens, requests, turns, cache hits, cost estimates and balance.",
			"nav.usage": "Usage stats",
			"settings.enabled": "Enable usage stats",
			"settings.enabledHint": "When off, tracking and balance refresh stop.",
			"card.active": "Active",
			"tab.overview": "Overview",
			"tab.models": "Models & cache",
			"tab.quota": "Balance & quota",
			"provider.switch": "Provider",
			"provider.opencode": "OpenCode Go",
			"provider.deepseek": "DeepSeek",
			"provider.weeklyQuota": "Weekly quota",
			"provider.prepay": "Prepaid",
			"provider.notConnected": "Not connected",
			"kpi.hitTokens": "hit",
			"kpi.daysUnit": "d",
			"kpi.costPrefix": "Cost",
			"kpi.quotaUsed": "used",
			"chart.cacheDiag": "Cache efficiency",
			"chart.cacheHigh": "High cache hit efficiency",
			"chart.cacheSaved": "Cache avoided recompute in the last 7 days",
			"session.usageLabel": "Usage:",
			"session.panelTitle": "Usage & cost",
			"session.statusOk": "All systems normal",
			"session.heroTitle": "Session totals",
			"session.heroTokens": "Tokens used",
			"session.heroCost": "Session cost",
			"session.heroRounds": "Rounds",
			"session.heroAvgHit": "Avg hit",
			"session.recentTitle": "Last request",
			"session.recentModel": "Model",
			"session.recentHit": "Cache hit rate",
			"session.recentTokens": "Tokens this request",
			"session.recentCost": "Cost this request",
			"session.balance": "Account balance",
			"session.unpricedHint": "* Model has no configured price; cost counted as 0 (configure prices in plugin settings)",
			"session.noRecord": "No usage record for this session (history before the plugin started metering is not backfilled)",
			"quota.monthly": "Monthly usage",
			"quota.weekly": "Weekly usage",
			"quota.rolling": "Rolling usage",
			"quota.days": "d",
			"quota.hours": "h",
			"quota.minutes": "min",
			"quota.after": " later",
			"quota.resetSoon": "Resets soon",
			"quota.abundant": "Abundant",
			"quota.normal": "Normal",
			"quota.elevated": "Elevated",
			"quota.high": "High",
			"quota.used": "used",
			"quota.resetLabel": "Reset at",
			"quota.notice": "Choose \"OpenCode Go\" as the provider in opencode config to activate the quota mechanism.",
			"quota.remaining": "remaining",
			"balance.estimate": "Estimated to cover about",
			"balance.negative": "Insufficient balance, please recharge",
			"balance.days": "days of usage",
			"balance.sufficient": "Sufficient balance",
			"balance.recharge": "Recharge",
			"chart.savedRatio": "Saved ratio",
			"range.last7": "Last 7 days",
			"range.last14": "Last 14 days",
			"range.last30": "Last 30 days",
			"range.last90": "Last 90 days",
			"range.custom": "Custom",
			"range.from": "From",
			"range.to": "To",
			"metric.tokens": "Tokens used",
			"metric.tokensHint": "Input / cache read / cache write / output split and total.",
			"metric.requests": "Requests",
			"metric.turns": "Turns completed",
			"metric.activeDays": "Active days",
			"metric.avgHitRate": "Avg cache hit rate",
			"metric.topModel": "Top model",
			"metric.cost": "Estimated cost",
			"metric.uncounted": "Unpriced requests",
			"metric.lastHit": "Last hit rate",
			"metric.lastCost": "Last request cost",
			"metric.sessionTurns": "Session turns",
			"metric.sessionCost": "Session cost",
			"balance.title": "Account balance",
			"balance.amount": "Balance",
			"balance.updated": "Updated",
			"balance.refresh": "Refresh",
			"balance.refreshing": "Refreshing…",
			"balance.unavailable": "Balance unavailable",
			"balance.source": "Source",
			"model.table": "Model breakdown",
			"model.unknown": "Unmarked model",
			"trend.title": "Usage trend",
			"trend.total": "Total usage",
			"trend.cost": "Cost",
			"trend.hitRate": "Cache hit rate",
			"chart.donut": "Model share",
			"chart.other": "Others",
			"chart.noData": "No data yet",
			"chart.insufficientData": "Not enough data points for a trend",
			"loading": "Loading…",
			"error": "Load failed",
			"tokens.input": "Input",
			"tokens.cacheRead": "Cache read",
			"tokens.cacheWrite": "Cache write",
			"tokens.output": "Output",
			"tokens.total": "Total",
			"settings.overridden": "Overridden",
			"settings.reset": "Reset to default",
			"settings.readOnly": "This deployment stores settings read-only.",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.expand": "Show settings",
			"settings.collapse": "Hide settings",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved",
			"settings.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"settings.invalidNumber": "Enter a number, or leave blank to use the default."
		};
		//#endregion
		//#region src/client/index.ts
		const name = "usage-stats";
		const inject = [
			"slots",
			"locale",
			"connection",
			"settingsScope",
			"remote"
		];
		const NS = "usage-stats";
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "usage-stats: dictionaries");
			const bound = ctx.locale.bind(NS);
			const t = (key) => bound(key);
			setStatsShared({
				face: new UsageStatsCardController().inject(),
				t
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "usage-stats",
				order: 40,
				label: () => t("nav.usage"),
				locale: NS
			}, UsageStatsSection));
			const sessionController = new SessionUsageController();
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "usage-stats-session",
				order: 20,
				locale: NS,
				inject: (sessionId) => sessionController.inject(sessionId)
			}, SessionUsageSlotButton));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map