import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
/** 缓存命中率口径：cacheRead / (uncached + cacheRead + cacheWrite)；无输入为 0。 */
function hitRateOf(buckets) {
	const input = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
	return input <= 0 ? 0 : buckets.cacheReadTokens / input;
}
/** 本地时区 YYYY-MM-DD（按当日 12 时取键，避免 DST 边界抖动）。 */
function localDateKey(timeMs) {
	const d = new Date(timeMs);
	const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
	return `${noon.getFullYear()}-${String(noon.getMonth() + 1).padStart(2, "0")}-${String(noon.getDate()).padStart(2, "0")}`;
}
function createEmptyBucket() {
	return {
		uncachedInputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		requests: 0,
		turns: 0,
		cost: 0
	};
}
function addInto(target, delta) {
	for (const key of [
		"uncachedInputTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"outputTokens",
		"requests",
		"turns",
		"cost"
	]) target[key] += delta[key] ?? 0;
	if (delta.lastRequestAt !== void 0) target.lastRequestAt = delta.lastRequestAt;
	if (delta.lastRequestCost !== void 0) target.lastRequestCost = delta.lastRequestCost;
	if (delta.lastRequestHitRate !== void 0) target.lastRequestHitRate = delta.lastRequestHitRate;
	if (delta.lastModel !== void 0) target.lastModel = delta.lastModel;
}
var UsageStatsMeter = class {
	data;
	folds = /* @__PURE__ */ new Map();
	getPrice;
	constructor(opts = {}) {
		this.data = {
			totals: createEmptyBucket(),
			byDay: {},
			sessions: {}
		};
		this.getPrice = opts.getPrice ?? (() => 0);
	}
	/** 深拷贝快照（路由/持久化读取用）。 */
	state() {
		return JSON.parse(JSON.stringify(this.data));
	}
	applyEvent(sessionId, workspace, event) {
		const fold = this.foldOf(sessionId, workspace);
		const date = localDateKey(event.time);
		switch (event.type) {
			case "turn/start":
				fold.turnTokens = 0;
				fold.turnCost = 0;
				break;
			case "turn/end": {
				const session = this.sessionOf(sessionId);
				session.lastTurnTokens = fold.turnTokens;
				session.lastTurnCost = fold.turnCost;
				if (event.data.reason.kind !== "completed") break;
				addInto(this.data.totals, { turns: 1 });
				addInto(this.day(date).bucket, { turns: 1 });
				session.turns += 1;
				break;
			}
			case "step/start": {
				const model = fold.currentModel ?? "__unknown__";
				addInto(this.data.totals, { requests: 1 });
				const day = this.day(date);
				addInto(day.bucket, { requests: 1 });
				addInto(this.modelBucket(day, model), { requests: 1 });
				this.sessionOf(sessionId).requests += 1;
				fold.pending = null;
				break;
			}
			case "request/header":
				fold.currentModel = event.data.header.config.model;
				break;
			case "assistant/chunk":
				if (event.data.chunk.type === "usage") this.settle(sessionId, fold, date, event.data.turn, event.data.step, event.data.chunk.usage, event.time);
				break;
			case "assistant/message":
				if (event.data.usage !== void 0) this.settle(sessionId, fold, date, event.data.turn, event.data.step, event.data.usage, event.time);
				break;
			case "step/end": fold.pending = null;
		}
	}
	/** 替换语义记账：同 (turn,step) 时减旧加新，否则直接累加。 */
	settle(sessionId, fold, date, turn, step, usage, time) {
		const buckets = {
			uncachedInputTokens: usage.inputTokens,
			cacheReadTokens: usage.cacheReadTokens ?? 0,
			cacheWriteTokens: usage.cacheWriteTokens ?? 0,
			outputTokens: usage.outputTokens
		};
		const model = fold.currentModel ?? "__unknown__";
		const rawCost = this.getPrice(model, buckets, time);
		const cost = Number.isFinite(rawCost) ? rawCost : 0;
		const rate = hitRateOf(buckets);
		const prev = fold.pending;
		if (prev !== null && prev.turn === turn && prev.step === step) {
			const delta = {
				uncachedInputTokens: buckets.uncachedInputTokens - prev.buckets.uncachedInputTokens,
				cacheReadTokens: buckets.cacheReadTokens - prev.buckets.cacheReadTokens,
				cacheWriteTokens: buckets.cacheWriteTokens - prev.buckets.cacheWriteTokens,
				outputTokens: buckets.outputTokens - prev.buckets.outputTokens,
				cost: cost - prev.cost
			};
			addInto(this.data.totals, delta);
			const day = this.day(date);
			addInto(day.bucket, delta);
			addInto(this.modelBucket(day, model), delta);
		} else {
			const delta = {
				...buckets,
				cost
			};
			addInto(this.data.totals, delta);
			const day = this.day(date);
			addInto(day.bucket, delta);
			addInto(this.modelBucket(day, model), delta);
		}
		const last = {
			lastRequestAt: new Date(time).toISOString(),
			lastRequestCost: cost,
			lastRequestHitRate: rate,
			lastModel: model
		};
		addInto(this.data.totals, last);
		const day = this.day(date);
		addInto(day.bucket, last);
		addInto(this.modelBucket(day, model), last);
		const session = this.sessionOf(sessionId);
		session.lastRequestAt = new Date(time).toISOString();
		session.lastModel = model;
		session.lastRequestCost = cost;
		session.lastRequestHitRate = rate;
		session.lastRequestTokens = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens;
		fold.turnTokens += buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens - (prev?.buckets.uncachedInputTokens ?? 0) - (prev?.buckets.cacheReadTokens ?? 0) - (prev?.buckets.cacheWriteTokens ?? 0) - (prev?.buckets.outputTokens ?? 0);
		fold.turnCost += cost - (prev?.cost ?? 0);
		session.cost += cost - (prev?.cost ?? 0);
		session.uncachedInputTokens += buckets.uncachedInputTokens - (prev?.buckets.uncachedInputTokens ?? 0);
		session.cacheReadTokens += buckets.cacheReadTokens - (prev?.buckets.cacheReadTokens ?? 0);
		session.cacheWriteTokens += buckets.cacheWriteTokens - (prev?.buckets.cacheWriteTokens ?? 0);
		session.outputTokens += buckets.outputTokens - (prev?.buckets.outputTokens ?? 0);
		fold.pending = {
			turn,
			step,
			buckets,
			cost,
			hitRate: rate
		};
	}
	/** 用持久化状态重建（清空会话折叠态；旧版本数据补齐会话 token 分项）。 */
	restore(state) {
		this.data.totals = {
			...createEmptyBucket(),
			...state.totals
		};
		this.data.byDay = state.byDay;
		this.data.sessions = state.sessions;
		for (const record of Object.values(this.data.sessions)) {
			record.uncachedInputTokens ??= 0;
			record.cacheReadTokens ??= 0;
			record.cacheWriteTokens ??= 0;
			record.outputTokens ??= 0;
			record.lastRequestTokens ??= null;
			record.lastTurnTokens ??= null;
			record.lastTurnCost ??= null;
		}
		this.folds.clear();
	}
	/**
	* 当前轮的实时消耗（进行中的 turn 累计；无进行中轮时返回 null）。
	* 供会话页"本次消耗"展示：每发一次信息（新一轮）自动重置。
	*/
	currentTurnUsage(sessionId) {
		const fold = this.folds.get(sessionId);
		if (fold === void 0) return null;
		return {
			tokens: fold.turnTokens,
			cost: fold.turnCost
		};
	}
	/** 替换费用计算器（配置热更新用）。 */
	setPriceResolver(fn) {
		this.getPrice = fn;
	}
	day(date) {
		let day = this.data.byDay[date];
		if (day === void 0) {
			day = {
				bucket: createEmptyBucket(),
				byModel: {}
			};
			this.data.byDay[date] = day;
		}
		return day;
	}
	modelBucket(day, model) {
		let bucket = day.byModel[model];
		if (bucket === void 0) {
			bucket = createEmptyBucket();
			day.byModel[model] = bucket;
		}
		return bucket;
	}
	sessionOf(sessionId) {
		let session = this.data.sessions[sessionId];
		if (session === void 0) {
			session = {
				sessionId,
				workspace: null,
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				turns: 0,
				requests: 0,
				cost: 0,
				uncachedInputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				lastRequestAt: null,
				lastModel: null,
				lastRequestCost: null,
				lastRequestHitRate: null,
				lastRequestTokens: null,
				lastTurnTokens: null,
				lastTurnCost: null
			};
			this.data.sessions[sessionId] = session;
		}
		return session;
	}
	foldOf(sessionId, workspace) {
		let fold = this.folds.get(sessionId);
		if (fold === void 0) {
			fold = {
				currentModel: null,
				pending: null,
				turnTokens: 0,
				turnCost: 0
			};
			this.folds.set(sessionId, fold);
		}
		const session = this.sessionOf(sessionId);
		if (session.workspace === null && workspace !== null) session.workspace = workspace;
		return fold;
	}
};
//#endregion
//#region src/pricing.ts
/**
* 内置价格表（每百万 token）。DeepSeek 官方价按 CNY；OpenCode Zen Go
* （opencode-go provider）价格取自 pi-ai 官方 catalog（USD 口径）。
* 货币标签以插件设置 currency 为准；混用两套计价时费用为估算值。
*/
const DEFAULT_DEEPSEEK_PRICES = {
	"deepseek-chat": {
		input: 2,
		cacheRead: .5,
		cacheWrite: 2,
		output: 8
	},
	"deepseek-reasoner": {
		input: 4,
		cacheRead: 1,
		cacheWrite: 4,
		output: 16
	},
	"deepseek-v4-flash": {
		input: 1.5,
		cacheRead: .05,
		cacheWrite: 0,
		output: 4.5,
		peak: {
			input: 3,
			cacheRead: .1,
			cacheWrite: 0,
			output: 9
		}
	},
	"deepseek-v4-pro": {
		input: 4.5,
		cacheRead: .15,
		cacheWrite: 0,
		output: 13.5,
		peak: {
			input: 9,
			cacheRead: .3,
			cacheWrite: 0,
			output: 27
		}
	},
	"glm-5.1": {
		input: 1.4,
		cacheRead: .26,
		cacheWrite: 0,
		output: 4.4
	},
	"glm-5.2": {
		input: 1.4,
		cacheRead: .26,
		cacheWrite: 0,
		output: 4.4
	},
	"hy3": {
		input: .14,
		cacheRead: .035,
		cacheWrite: 0,
		output: .58
	},
	"kimi-k2.6": {
		input: .95,
		cacheRead: .16,
		cacheWrite: 0,
		output: 4
	},
	"kimi-k2.7-code": {
		input: .95,
		cacheRead: .19,
		cacheWrite: 0,
		output: 4
	},
	"kimi-k3": {
		input: 3,
		cacheRead: .3,
		cacheWrite: 0,
		output: 15
	},
	"mimo-v2.5": {
		input: .14,
		cacheRead: .0028,
		cacheWrite: 0,
		output: .28
	},
	"mimo-v2.5-pro": {
		input: .435,
		cacheRead: .003625,
		cacheWrite: 0,
		output: .87
	},
	"minimax-m2.7": {
		input: .3,
		cacheRead: .06,
		cacheWrite: 0,
		output: 1.2
	},
	"minimax-m3": {
		input: .3,
		cacheRead: .06,
		cacheWrite: 0,
		output: 1.2
	},
	"qwen3.6-plus": {
		input: .5,
		cacheRead: .05,
		cacheWrite: .625,
		output: 3
	},
	"qwen3.7-max": {
		input: 2.5,
		cacheRead: .5,
		cacheWrite: 3.125,
		output: 7.5
	},
	"qwen3.7-plus": {
		input: .4,
		cacheRead: .04,
		cacheWrite: .5,
		output: 1.6
	},
	"grok-4.5": {
		input: 2,
		cacheRead: .5,
		cacheWrite: 0,
		output: 6
	}
};
/**
* 合并价格表：内置表打底，用户覆盖优先。
* @param userPrices 用户自定义价格，覆盖同名字典项。
*/
function resolvePrices(userPrices) {
	return {
		...DEFAULT_DEEPSEEK_PRICES,
		...userPrices
	};
}
/**
* 按每百万 token 单价估算一次用量的费用。各分项除以 1e6 后乘以对应单价，
* 四项累加。未知模型且未提供兜底价时返回 0。
*
* 防御：defaultPrice 可能是 schemastery 对未配置对象字段解析出的空对象 {}，
* 其单价字段为 undefined，直接参与乘法会产生 NaN 污染累计状态（NaN 经
* JSON 序列化为 null）——空对象、缺失或非有限单价一律视为无价格，返回 0。
*/
function priceBuckets(model, buckets, prices, defaultPrice) {
	const price = prices[model] ?? defaultPrice;
	if (price === void 0 || price === null || typeof price !== "object") return 0;
	const { input, cacheRead, cacheWrite, output } = price;
	if (!Number.isFinite(input) || !Number.isFinite(cacheRead) || !Number.isFinite(cacheWrite) || !Number.isFinite(output)) return 0;
	const perMillion = 1e6;
	return buckets.uncachedInputTokens / perMillion * input + buckets.cacheReadTokens / perMillion * cacheRead + buckets.cacheWriteTokens / perMillion * cacheWrite + buckets.outputTokens / perMillion * output;
}
/** 默认高峰时段（北京时间小时，[startHour, endHour)）。DeepSeek 官方公告：每日 9:00、14:00 起。 */
const DEFAULT_PEAK_HOURS = [
	[9, 10],
	[14, 15]
];
/** 判断 timeMs（epoch 毫秒）是否落在高峰时段（按北京时区 UTC+8）。 */
function isPeakHour(timeMs, peakHours = DEFAULT_PEAK_HOURS) {
	const hour = new Date(timeMs + 8 * 36e5).getUTCHours();
	return peakHours.some(([start, end]) => hour >= start && hour < end);
}
/** 单价是否完整有效（四项均为有限数；空对象/缺失/非有限一律视为无效）。 */
function isValidPrice(price) {
	if (price === void 0 || price === null || typeof price !== "object") return false;
	return Number.isFinite(price.input) && Number.isFinite(price.cacheRead) && Number.isFinite(price.cacheWrite) && Number.isFinite(price.output);
}
/** 按请求时间选价估算：高峰时段优先用模型的 peak 价（无效则回退基础价），空闲时段用基础价。 */
function priceBucketsAt(model, buckets, prices, defaultPrice, timeMs, peakHours = DEFAULT_PEAK_HOURS) {
	const price = prices[model] ?? defaultPrice;
	if (!isValidPrice(price)) return 0;
	const effective = timeMs !== void 0 && isPeakHour(timeMs, peakHours) && isValidPrice(price.peak) ? price.peak : price;
	const perMillion = 1e6;
	return buckets.uncachedInputTokens / perMillion * effective.input + buckets.cacheReadTokens / perMillion * effective.cacheRead + buckets.cacheWriteTokens / perMillion * effective.cacheWrite + buckets.outputTokens / perMillion * effective.output;
}
/** 就地裁剪 byDay：只保留最近 730 个日期键。 */
function trimByDay(byDay, now) {
	const cutoff = localDateKey(now - 629856e5);
	for (const key of Object.keys(byDay)) if (key < cutoff) delete byDay[key];
}
/** 就地裁剪 sessions：按 lastRequestAt 升序淘汰最旧，保留最近 max 条。 */
function trimSessions(sessions, max = 500) {
	const keys = Object.keys(sessions);
	if (keys.length <= max) return;
	const sorted = keys.map((id) => ({
		id,
		at: sessions[id].lastRequestAt ?? ""
	})).sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
	for (const entry of sorted.slice(0, sorted.length - max)) delete sessions[entry.id];
}
var UsageStatsStore = class {
	filePath;
	lastInstalled = null;
	constructor(filePath) {
		this.filePath = filePath;
	}
	/** 读取持久化状态；不存在/损坏/版本不符返回 null（损坏时备份 .bak）。 */
	load() {
		if (!existsSync(this.filePath)) return null;
		let raw;
		try {
			raw = readFileSync(this.filePath, "utf8");
		} catch {
			return null;
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.backup();
			return null;
		}
		if (parsed.version !== 1 || typeof parsed.totals !== "object" || parsed.totals === null) {
			this.backup();
			return null;
		}
		this.lastInstalled = parsed.meta?.installedAt ?? null;
		return {
			totals: {
				...createEmptyBucket(),
				...parsed.totals
			},
			byDay: parsed.byDay ?? {},
			sessions: parsed.sessions ?? {}
		};
	}
	/** load 时记录 meta.installedAt；从未 load 返回 null。 */
	lastInstalledAt() {
		return this.lastInstalled;
	}
	/** 裁剪后原子写盘（tmp + rename）。失败抛错，由调用方告警。 */
	save(state, installedAt) {
		const now = Date.now();
		const byDay = { ...state.byDay };
		trimByDay(byDay, now);
		const sessions = { ...state.sessions };
		trimSessions(sessions);
		const file = {
			version: 1,
			meta: {
				installedAt: installedAt ?? new Date(now).toISOString(),
				lastSavedAt: new Date(now).toISOString()
			},
			totals: state.totals,
			byDay,
			sessions
		};
		const dir = dirname(this.filePath);
		mkdirSync(dir, { recursive: true });
		const tmp = join(dir, ".dsh-usage-stats.tmp");
		writeFileSync(tmp, JSON.stringify(file), "utf8");
		renameSync(tmp, this.filePath);
	}
	backup() {
		try {
			renameSync(this.filePath, this.filePath + ".bak");
		} catch {}
	}
};
//#endregion
//#region src/query.ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 730;
/** 真实日期校验：格式 + 回读比对（拒绝 2026-02-30 之类越界值）。 */
function isValidDate(raw) {
	if (!DATE_RE.test(raw)) return false;
	const [y, m, d] = raw.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
/** 解析 from/to 查询参数；缺省为今日；非法/超界返回错误。 */
function parseRange(fromRaw, toRaw, now) {
	const today = localDateKey(now);
	const from = fromRaw ?? today;
	const to = toRaw ?? today;
	if (!isValidDate(from)) return {
		ok: false,
		error: "invalid from date"
	};
	if (!isValidDate(to)) return {
		ok: false,
		error: "invalid to date"
	};
	if (from > to) return {
		ok: false,
		error: "from must not be after to"
	};
	const spanDays = Math.round((Date.parse(to + "T12:00:00") - Date.parse(from + "T12:00:00")) / 864e5) + 1;
	if (spanDays > MAX_RANGE_DAYS) return {
		ok: false,
		error: "range too large (max 730 days)"
	};
	return {
		ok: true,
		query: {
			from,
			to,
			granularity: spanDays <= 31 ? "day" : "week"
		}
	};
}
/** 自然周键：该周周一（inclusive）的日期（YYYY-MM-DD）。 */
function weekKey(dateKey) {
	const [y, m, d] = dateKey.split("-").map(Number);
	const date = new Date(y, m - 1, d, 12);
	const day = (date.getDay() + 6) % 7;
	date.setDate(date.getDate() - day);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const EMPTY_TOKENS = () => ({
	uncachedInputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	outputTokens: 0,
	total: 0
});
/** 对区间内 byDay 条目聚合：总量指标、分模型、趋势序列。 */
function summarizeRange(state, query) {
	const tokens = EMPTY_TOKENS();
	const byModel = /* @__PURE__ */ new Map();
	const series = /* @__PURE__ */ new Map();
	const bucketInput = /* @__PURE__ */ new Map();
	const bucketModels = /* @__PURE__ */ new Map();
	const DAY_MS = 864e5;
	if (query.granularity === "day") for (let t = Date.parse(query.from + "T12:00:00"); t <= Date.parse(query.to + "T12:00:00"); t += DAY_MS) {
		const bucket = localDateKey(t);
		series.set(bucket, {
			bucket,
			requests: 0,
			tokens: 0,
			cost: 0,
			hitRate: 0,
			byModel: []
		});
	}
	else for (let t = Date.parse(weekKey(query.from) + "T12:00:00"); t <= Date.parse(weekKey(query.to) + "T12:00:00"); t += 7 * DAY_MS) {
		const bucket = localDateKey(t);
		series.set(bucket, {
			bucket,
			requests: 0,
			tokens: 0,
			cost: 0,
			hitRate: 0,
			byModel: []
		});
	}
	let requests = 0;
	let turns = 0;
	let cost = 0;
	let uncountedRequests = 0;
	let activeDays = 0;
	let sumCacheRead = 0;
	let sumInput = 0;
	for (const [date, day] of Object.entries(state.byDay)) {
		if (date < query.from || date > query.to) continue;
		const b = day.bucket;
		requests += b.requests;
		turns += b.turns;
		cost += b.cost;
		tokens.uncachedInputTokens += b.uncachedInputTokens;
		tokens.cacheReadTokens += b.cacheReadTokens;
		tokens.cacheWriteTokens += b.cacheWriteTokens;
		tokens.outputTokens += b.outputTokens;
		sumCacheRead += b.cacheReadTokens;
		sumInput += b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens;
		if (b.requests > 0) activeDays += 1;
		for (const [model, mb] of Object.entries(day.byModel)) {
			const entry = byModel.get(model) ?? {
				requests: 0,
				tokens: 0,
				cost: 0
			};
			entry.requests += mb.requests;
			entry.tokens += mb.uncachedInputTokens + mb.cacheReadTokens + mb.cacheWriteTokens + mb.outputTokens;
			entry.cost += mb.cost;
			byModel.set(model, entry);
			if (model === "__unknown__") uncountedRequests += mb.requests;
		}
		const bucketKey = query.granularity === "day" ? date : weekKey(date);
		const point = series.get(bucketKey);
		if (point === void 0) continue;
		point.requests += b.requests;
		point.tokens += b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens + b.outputTokens;
		point.cost += b.cost;
		point.hitRate += b.cacheReadTokens;
		bucketInput.set(bucketKey, (bucketInput.get(bucketKey) ?? 0) + b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens);
		let models = bucketModels.get(bucketKey);
		if (models === void 0) {
			models = /* @__PURE__ */ new Map();
			bucketModels.set(bucketKey, models);
		}
		for (const [model, mb] of Object.entries(day.byModel)) models.set(model, (models.get(model) ?? 0) + mb.uncachedInputTokens + mb.cacheReadTokens + mb.cacheWriteTokens + mb.outputTokens);
	}
	tokens.total = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens;
	for (const point of series.values()) {
		const input = bucketInput.get(point.bucket) ?? 0;
		point.hitRate = input <= 0 ? 0 : point.hitRate / input;
		const models = bucketModels.get(point.bucket);
		point.byModel = models === void 0 ? [] : [...models.entries()].map(([model, tokens]) => ({
			model,
			tokens
		})).sort((a, b) => b.tokens - a.tokens);
	}
	const modelList = [...byModel.entries()].map(([model, v]) => ({
		model,
		...v
	})).sort((a, b) => b.requests - a.requests);
	const topModel = modelList.length > 0 ? modelList[0].model : null;
	return {
		from: query.from,
		to: query.to,
		requests,
		turns,
		tokens,
		cost,
		activeDays,
		avgCacheHitRate: sumInput <= 0 ? 0 : sumCacheRead / sumInput,
		topModel,
		uncountedRequests,
		byModel: modelList,
		series: [...series.values()].sort((a, b) => a.bucket < b.bucket ? -1 : 1)
	};
}
//#endregion
//#region src/routes.ts
/** Loopback literal check plus browser same-origin markers (mirrors the pairing routes' fence). */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** 一条 JSON 响应。 */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
/** 从当前纤程 ctx 上读取宿主挂载的 meter（Task 4 在 apply 内挂载）。 */
function meterOf(ctx) {
	return ctx[USAGE_STATS_METER_KEY];
}
/** 构造 usage-stats 全部只读路由（loopback 围栏，全部先过 isLoopbackRequest）。 */
function makeRoutes(ctx, balance) {
	return [
		{
			kind: "exact",
			path: "/api/dsh-usage-stats/summary",
			handler: (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: "method not allowed" });
					return;
				}
				const url = new URL(req.url ?? "/", "http://localhost");
				const parsed = parseRange(url.searchParams.get("from") ?? void 0, url.searchParams.get("to") ?? void 0, Date.now());
				if (!parsed.ok) {
					writeJson(res, 400, { error: parsed.error });
					return;
				}
				const meter = meterOf(ctx);
				const summary = summarizeRange(meter.state(), parsed.query);
				const sessionId = url.searchParams.get("sessionId");
				let perSession = null;
				if (sessionId !== null) {
					const record = meter.state().sessions[sessionId] ?? null;
					const currentTurn = meter.currentTurnUsage(sessionId);
					perSession = record === null ? null : {
						...record,
						currentTurn
					};
				}
				writeJson(res, 200, {
					...summary,
					perSession
				});
			}
		},
		{
			kind: "prefix",
			path: "/api/dsh-usage-stats/sessions",
			handler: (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: "method not allowed" });
					return;
				}
				const id = (req.url ?? "").split("?")[0].split("/").pop() ?? "";
				writeJson(res, 200, { session: meterOf(ctx).state().sessions[id] ?? null });
			}
		},
		{
			kind: "exact",
			path: "/api/dsh-usage-stats/balance",
			handler: (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden" });
					return;
				}
				if (req.method !== "GET") {
					writeJson(res, 405, { error: "method not allowed" });
					return;
				}
				writeJson(res, 200, { providers: balance.snapshot() });
			}
		},
		{
			kind: "exact",
			path: "/api/dsh-usage-stats/balance/refresh",
			handler: async (req, res) => {
				if (!isLoopbackRequest(req)) {
					writeJson(res, 403, { error: "forbidden" });
					return;
				}
				if (req.method !== "POST") {
					writeJson(res, 405, { error: "method not allowed" });
					return;
				}
				writeJson(res, 200, { providers: await balance.refresh() });
			}
		}
	];
}
//#endregion
//#region src/balance.ts
const publicSource = (source) => ({
	baseUrl: source.baseUrl,
	path: source.path,
	source: source.source
});
const FAIL = (error, source, costCurrency = "CNY") => ({
	balance: null,
	currency: "CNY",
	updatedAt: null,
	error,
	source,
	quota: null,
	costCurrency
});
function trustedBalanceRequest(endpoint) {
	let url;
	try {
		url = new URL(`${endpoint.baseUrl.replace(/\/+$/, "")}/${endpoint.path.replace(/^\/+/, "")}`);
	} catch {
		return null;
	}
	const href = url.href.replace(/\/$/, "");
	if (href === "https://api.deepseek.com/user/balance" && endpoint.apiKeyEnv === "DEEPSEEK_API_KEY") return { url: href };
	if (href === "https://opencode.ai/zen/go/v1/usage" && endpoint.apiKeyEnv === "OPENCODE_GO_API_KEY") return { url: href };
	return null;
}
/** 解析 DeepSeek 兼容余额响应；格式不符返回 null。 */
function parseBalanceResponse(body) {
	if (typeof body !== "object" || body === null) return null;
	const infos = body.balance_infos;
	if (!Array.isArray(infos)) return null;
	const info = infos.find((i) => typeof i === "object" && i !== null && i.currency === "CNY") ?? infos[0];
	if (typeof info !== "object" || info === null) return null;
	const total = info.total_balance;
	const balance = typeof total === "string" ? Number(total) : typeof total === "number" ? total : NaN;
	if (!Number.isFinite(balance)) return null;
	return {
		balance,
		currency: typeof info.currency === "string" ? info.currency : "CNY"
	};
}
/**
* 解析 OpenCode 订阅配额响应（GET /v1/usage → { usage: { rolling/weekly/monthly:
* { status, percent, resetsAt } } }）。三个窗口全部提取；窗口缺失或格式
* 不符时为 null。整体格式不符（无任何窗口）返回 null。
*/
function parseOpenCodeUsage(body) {
	if (typeof body !== "object" || body === null) return null;
	const usage = body.usage;
	if (typeof usage !== "object" || usage === null) return null;
	const record = usage;
	const quota = {
		rolling: null,
		weekly: null,
		monthly: null
	};
	let found = false;
	for (const window of [
		"rolling",
		"weekly",
		"monthly"
	]) {
		const entry = record[window];
		if (typeof entry !== "object" || entry === null) continue;
		const percent = entry.percent;
		const numeric = typeof percent === "number" ? percent : typeof percent === "string" ? Number(percent) : NaN;
		if (!Number.isFinite(numeric)) continue;
		quota[window] = {
			percent: numeric,
			resetsAt: typeof entry.resetsAt === "string" ? entry.resetsAt : null
		};
		found = true;
	}
	return found ? quota : null;
}
var BalanceClient = class {
	deps;
	settings = { mode: "off" };
	detect = () => ({});
	last = {};
	constructor(deps) {
		this.deps = deps;
	}
	setSettings(settings) {
		this.settings = settings;
	}
	setDetect(fn) {
		this.detect = fn;
	}
	/** 最近一次各 provider 快照（provider id → 快照；未检测到的 provider 不在表内）。 */
	snapshot() {
		return this.last;
	}
	/** 费用计价货币（设置 currency 实时读取）。 */
	costCurrency() {
		return this.deps.getCostCurrency?.() ?? "CNY";
	}
	/** 并行刷新全部检测到的 provider 快照；单个 provider 失败不影响其他。 */
	async refresh() {
		const detected = this.detect();
		const next = { ...this.last };
		await Promise.all(Object.entries(detected).map(async ([provider, result]) => {
			next[provider] = result.ok ? await this.fetchEndpoint(result.endpoint) : FAIL(result.reason, null, this.costCurrency());
		}));
		this.last = next;
		return this.last;
	}
	/** 拉取并解析单个端点的快照（key 缺失、网络错误、格式不符均落 FAIL）。 */
	async fetchEndpoint(endpoint) {
		const trusted = trustedBalanceRequest(endpoint);
		if (trusted === null) return FAIL("untrusted balance endpoint blocked", null, this.costCurrency());
		const key = this.deps.getEnv(endpoint.apiKeyEnv);
		if (key === void 0 || key === "") return FAIL("missing API key", publicSource(endpoint), this.costCurrency());
		let response;
		try {
			response = await this.deps.fetchFn(trusted.url, {
				headers: {
					authorization: `Bearer ${key}`,
					"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
				},
				signal: AbortSignal.timeout(25e3),
				redirect: "error"
			});
		} catch (error) {
			return FAIL(`network error: ${String(error)}`, publicSource(endpoint), this.costCurrency());
		}
		if (!response.ok) return FAIL(`HTTP ${response.status}`, publicSource(endpoint), this.costCurrency());
		let body;
		try {
			body = await response.json();
		} catch {
			return FAIL("unexpected response", publicSource(endpoint), this.costCurrency());
		}
		if (endpoint.path.includes("/usage")) {
			const quota = parseOpenCodeUsage(body);
			if (quota === null) return FAIL("unexpected response", publicSource(endpoint), this.costCurrency());
			return {
				balance: null,
				currency: "",
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				error: null,
				source: publicSource(endpoint),
				quota,
				costCurrency: this.costCurrency()
			};
		}
		const parsed = parseBalanceResponse(body);
		if (parsed === null) return FAIL("unexpected response", publicSource(endpoint), this.costCurrency());
		return {
			balance: parsed.balance,
			currency: parsed.currency,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			error: null,
			source: publicSource(endpoint),
			quota: null,
			costCurrency: this.costCurrency()
		};
	}
	/** 立即刷新一次并定时刷新；返回定时器 disposer。 */
	start(intervalMs) {
		this.refresh();
		const timer = setInterval(() => {
			this.refresh();
		}, intervalMs);
		return () => clearInterval(timer);
	}
};
const DEFAULT_BALANCE_PATH = "/user/balance";
/** 已知 provider 的内置端点表：profile 不暴露 baseURL（适配器内置端点）时
*  也能推断余额/配额接口。key 为 llm 的 provider id；apiKeyEnv 可被
*  profile 中同名配置覆盖。 */
const knownProviderEndpoints = {
	"opencode-go": {
		baseUrl: "https://opencode.ai/zen/go/v1",
		path: "/usage",
		apiKeyEnv: "OPENCODE_GO_API_KEY"
	},
	"deepseek": {
		baseUrl: "https://api.deepseek.com",
		path: "/user/balance",
		apiKeyEnv: "DEEPSEEK_API_KEY"
	}
};
function isDeepSeekHost(hostname) {
	return hostname === "api.deepseek.com" || hostname.endsWith(".deepseek.com");
}
/**
* 安全读取 ctx 服务：cordis 4 的 ctx 是 Proxy，未注入的服务名即使存在也
* 会在属性读取时抛 "cannot get property X without inject"（可选链拦不住
* getter）。detect 的调用方可能持有一个未声明这些服务的 ctx（测试），
* 这里把读取失败视为服务缺失，返回 undefined 走 reason 分支。
*/
function serviceOrUndefined(ctx, name) {
	try {
		return ctx[name];
	} catch {
		return;
	}
}
/** 对单个 provider 推断余额端点（auto 模式共用内核）。 */
function detectProviderEndpoint(ctx, provider, settingsService) {
	const entry = (serviceOrUndefined(ctx, "llm")?.listConfigurableProviders() ?? []).find((e) => e.provider === provider);
	if (entry === void 0) {
		const known = knownProviderEndpoints[provider];
		if (known !== void 0) return {
			ok: true,
			endpoint: {
				...known,
				source: `auto:${provider}`
			}
		};
		return {
			ok: false,
			reason: `provider ${provider} not found`
		};
	}
	let profile = (settingsService ?? serviceOrUndefined(ctx, "settings"))?.get(settingsNamespace(entry.settingsNs));
	for (const key of entry.settingsPath) {
		if (typeof profile !== "object" || profile === null) {
			profile = void 0;
			break;
		}
		profile = profile[key];
	}
	const record = typeof profile === "object" && profile !== null ? profile : {};
	const baseURL = typeof record.baseURL === "string" ? record.baseURL : typeof record.baseUrl === "string" ? record.baseUrl : void 0;
	const apiKeyEnv = typeof record.apiKeyEnv === "string" ? record.apiKeyEnv : void 0;
	if (baseURL === void 0) {
		const known = knownProviderEndpoints[provider];
		if (known !== void 0) return {
			ok: true,
			endpoint: {
				baseUrl: known.baseUrl,
				path: known.path,
				apiKeyEnv: known.apiKeyEnv,
				source: `auto:${provider}`
			}
		};
		return {
			ok: false,
			reason: "provider does not expose an endpoint"
		};
	}
	let hostname;
	try {
		hostname = new URL(baseURL).hostname;
	} catch {
		return {
			ok: false,
			reason: "provider endpoint is not a valid URL"
		};
	}
	if (isDeepSeekHost(hostname)) return {
		ok: true,
		endpoint: {
			baseUrl: new URL(baseURL).origin,
			path: DEFAULT_BALANCE_PATH,
			apiKeyEnv: "DEEPSEEK_API_KEY",
			source: `auto:${provider}`
		}
	};
	if (hostname === "opencode.ai" || hostname.endsWith(".opencode.ai")) return {
		ok: true,
		endpoint: {
			baseUrl: knownProviderEndpoints["opencode-go"].baseUrl,
			path: knownProviderEndpoints["opencode-go"].path,
			apiKeyEnv: knownProviderEndpoints["opencode-go"].apiKeyEnv,
			source: `auto:${provider}`
		}
	};
	return {
		ok: false,
		reason: "provider has no known balance endpoint"
	};
}
/**
* 解析全部可拉取的余额/配额端点（多 provider 快照用）：
* - manual：仅 manual 端点（key 为 'manual'）
* - auto：llm 可配置 provider 全量 + 已知端点表兜底（opencode-go / deepseek），
*   每个 provider 独立推断，失败以 reason 记录、不影响其他 provider。
*/
function detectBalanceEndpoints(ctx, settings, settingsService) {
	if (settings.mode === "off") return {};
	if (settings.mode === "manual") {
		if (settings.baseUrl === void 0 || settings.baseUrl === "") return { manual: {
			ok: false,
			reason: "manual balance requires baseUrl"
		} };
		return { manual: {
			ok: true,
			endpoint: {
				baseUrl: settings.baseUrl,
				path: settings.path ?? DEFAULT_BALANCE_PATH,
				apiKeyEnv: settings.apiKeyEnv ?? "DEEPSEEK_API_KEY",
				source: "manual"
			}
		} };
	}
	const llm = serviceOrUndefined(ctx, "llm");
	const providers = new Set(llm?.listConfigurableProviders().map((e) => e.provider) ?? []);
	for (const key of Object.keys(knownProviderEndpoints)) providers.add(key);
	const result = {};
	for (const provider of providers) {
		const snapshotKey = provider === "opencode-go" ? "opencode" : provider;
		result[snapshotKey] = detectProviderEndpoint(ctx, provider, settingsService);
	}
	return result;
}
//#endregion
//#region src/index.ts
/**
* 读取 DSH 凭据文件（~/.dsh/.credentials.yaml，形如 "KEY: value" 行）。
* 失败/缺失返回空对象；结果缓存（凭据变更需重启）。
*/
function readCredentialsFile() {
	const file = join(homedir(), ".dsh", ".credentials.yaml");
	if (!existsSync(file)) return {};
	try {
		const entries = {};
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const match = /^([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line.trim());
			if (match !== null) entries[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
		}
		return entries;
	} catch {
		return {};
	}
}
const name = "usage-stats";
const inject = [
	"sessions",
	"webServer",
	"agentDefaultModel",
	"llm"
];
/** 宿主端在 ctx 上暴露 meter 的键（路由/余额任务读取）。 */
const USAGE_STATS_METER_KEY = Symbol("usage-stats.meter");
const USAGE_STATS_SETTINGS_NAMESPACE = settingsNamespace("usage-stats");
function safeUsageFilePath(value) {
	const dshRoot = resolve(homedir(), ".dsh");
	const legacy = resolve(dshRoot, "dsh-usage-stats.json");
	const managed = resolve(dshRoot, "usage-stats");
	if (value === void 0 || value.trim() === "") return legacy;
	const requested = resolve(value);
	const normalize = (path) => process.platform === "win32" ? path.toLowerCase() : path;
	const normalizedRequested = normalize(requested);
	if (normalizedRequested === normalize(legacy) || normalizedRequested.startsWith(`${normalize(managed)}${sep}`)) return requested;
	return legacy;
}
const priceSchema = z.object({
	input: z.number().min(0),
	cacheRead: z.number().min(0),
	cacheWrite: z.number().min(0),
	output: z.number().min(0),
	peak: z.object({
		input: z.number().min(0),
		cacheRead: z.number().min(0),
		cacheWrite: z.number().min(0),
		output: z.number().min(0)
	})
});
/** 运行时 schema（schemastery）。 */
const Config = z.object({
	enabled: z.boolean().default(true),
	filePath: z.string(),
	prices: z.dict(priceSchema),
	defaultPrice: priceSchema,
	currency: z.string().default("CNY"),
	peakHours: z.array(z.tuple([z.number(), z.number()])).default([
		[9, 10],
		[14, 15]
	]),
	balance: z.object({
		mode: z.union([
			z.const("auto"),
			z.const("manual"),
			z.const("off")
		]).default("auto"),
		baseUrl: z.string(),
		path: z.string(),
		apiKeyEnv: z.string(),
		refreshMs: z.number().min(1e3)
	})
});
const SAVE_DEBOUNCE_MS = 3e4;
const FLUSH_THROTTLE_MS = 5e3;
function apply(ctx, config = {}) {
	let current = () => config ?? {};
	let disposeFiber;
	let meter;
	let store;
	let installedAt = null;
	let saveTimer;
	let lastFlushSave = 0;
	const resolve = () => {
		const value = current();
		return {
			...value,
			enabled: value.enabled ?? true,
			filePath: safeUsageFilePath(value.filePath),
			currency: value.currency ?? "CNY"
		};
	};
	let settingsService;
	ctx.inject(["settings"], (injectedCtx) => {
		settingsService = injectedCtx.settings;
		balance.refresh();
	});
	const balance = new BalanceClient({
		fetchFn: fetch,
		getEnv: (name) => process.env[name] ?? readCredentialsFile()[name],
		getCostCurrency: () => resolve().currency
	});
	const syncBalance = () => {
		const value = resolve().balance ?? { mode: "auto" };
		balance.setSettings(value);
		balance.setDetect(() => {
			const detected = detectBalanceEndpoints(ctx, resolve().balance ?? { mode: "auto" }, settingsService);
			for (const [provider, result] of Object.entries(detected)) if (!result.ok) ctx.logger.warn(`usage-stats: balance detect failed for ${provider}: ${result.reason} (settings captured: ${settingsService !== void 0})`);
			return detected;
		});
		balance.refresh();
	};
	syncBalance();
	const stopBalance = balance.start(resolve().balance?.refreshMs ?? 6e5);
	ctx.effect(() => stopBalance, "usage-stats: balance timer");
	const syncPrices = (target) => {
		const value = resolve();
		const prices = resolvePrices(value.prices);
		target.setPriceResolver((model, buckets, timeMs) => priceBucketsAt(model, buckets, prices, value.defaultPrice, timeMs, value.peakHours));
	};
	/** 立即写盘；任何异常仅告警，不抛出。 */
	const saveNow = (target, file) => {
		try {
			file.save(target.state(), installedAt);
		} catch (error) {
			ctx.logger.warn(`usage-stats: 写盘失败: ${String(error)}`);
		}
	};
	/** 防抖 30s 写盘。 */
	const scheduleSave = (target, file) => {
		if (saveTimer !== void 0) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = void 0;
			saveNow(target, file);
		}, SAVE_DEBOUNCE_MS);
	};
	const unmount = () => {
		if (disposeFiber !== void 0) {
			if (saveTimer !== void 0) {
				clearTimeout(saveTimer);
				saveTimer = void 0;
			}
			disposeFiber();
			disposeFiber = void 0;
		}
	};
	const mount = () => {
		store = new UsageStatsStore(resolve().filePath);
		installedAt = store.lastInstalledAt() ?? null;
		const loaded = store.load();
		meter = new UsageStatsMeter();
		if (loaded !== null) {
			installedAt = store.lastInstalledAt() ?? installedAt;
			meter.restore(loaded);
		}
		syncPrices(meter);
		syncBalance();
		lastFlushSave = 0;
		const onEvent = (session, event) => {
			meter.applyEvent(session.id, session.header.cwd ?? null, event);
			scheduleSave(meter, store);
		};
		const onFlush = () => {
			const now = Date.now();
			if (now - lastFlushSave >= FLUSH_THROTTLE_MS) {
				lastFlushSave = now;
				saveNow(meter, store);
			}
		};
		const offEvent = ctx.on("session/event", onEvent, { global: true });
		const offFlush = ctx.on("session/flush", onFlush, { global: true });
		const routeDisposers = makeRoutes(ctx, balance).map((route) => ctx.webServer.register(route));
		const disposeEffect = ctx.effect(() => () => {
			saveNow(meter, store);
		}, "usage-stats: final save");
		ctx[USAGE_STATS_METER_KEY] = meter;
		disposeFiber = () => {
			for (const dispose of routeDisposers) dispose();
			offEvent();
			offFlush();
			disposeEffect();
		};
	};
	const remount = () => {
		unmount();
		if (!resolve().enabled) return;
		mount();
	};
	installSettingsSection(ctx, USAGE_STATS_SETTINGS_NAMESPACE, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
			remount();
		},
		onChange: remount
	});
	remount();
}
//#endregion
export { Config, USAGE_STATS_METER_KEY, USAGE_STATS_SETTINGS_NAMESPACE, apply, inject, name };
