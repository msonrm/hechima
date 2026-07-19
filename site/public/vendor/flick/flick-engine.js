(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.FlickEngine = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/flick/postmodify.ts
	const DEFAULT_POST_MODIFY_CYCLES = [
		"かが",
		"きぎ",
		"くぐ",
		"けげ",
		"こご",
		"さざ",
		"しじ",
		"すず",
		"せぜ",
		"そぞ",
		"ただ",
		"ちぢ",
		"つっづ",
		"てで",
		"とど",
		"はばぱ",
		"ひびぴ",
		"ふぶぷ",
		"へべぺ",
		"ほぼぽ",
		"あぁ",
		"いぃ",
		"うぅゔ",
		"えぇ",
		"おぉ",
		"やゃ",
		"ゆゅ",
		"よょ",
		"わゎ"
	];
	/** tail（末尾 1 字）の次のトグル字を返す。どのサイクルにも無ければ null */
	function nextPostModify(tail, cycles) {
		for (const cycle of cycles) {
			const chars = Array.from(cycle);
			const i = chars.indexOf(tail);
			if (i >= 0) return chars[(i + 1) % chars.length];
		}
		return null;
	}
	//#endregion
	//#region src/flick/flickmap-decoder.ts
	const ACTION_NAMES = /* @__PURE__ */ new Set([
		"deleteBack",
		"convert",
		"confirm",
		"escape",
		"undo",
		"moveLeft",
		"moveRight",
		"moveUp",
		"moveDown",
		"resizeLeft",
		"resizeRight",
		"setLayer",
		"postModify"
	]);
	const DIRS = [
		"up",
		"down",
		"left",
		"right"
	];
	function fail(msg) {
		throw new Error(`flickmap: ${msg}`);
	}
	function isObj(v) {
		return typeof v === "object" && v !== null && !Array.isArray(v);
	}
	/** _comment を除いた実キー一覧。allowed 外があれば例外 */
	function ownKeys(obj, allowed, where) {
		const keys = Object.keys(obj).filter((k) => !k.startsWith("_comment"));
		for (const k of keys) if (!allowed.includes(k)) fail(`${where} に未知のキー "${k}"`);
		return keys;
	}
	function optStr(obj, key, where) {
		const v = obj[key];
		if (v === void 0) return void 0;
		if (typeof v !== "string") fail(`${where}.${key} は文字列であるべき`);
		return v;
	}
	function optInt(obj, key, min, where) {
		const v = obj[key];
		if (v === void 0) return void 0;
		if (typeof v !== "number" || !Number.isInteger(v) || v < min) fail(`${where}.${key} は ${min} 以上の整数であるべき`);
		return v;
	}
	function decodeValue(v, where) {
		if (typeof v === "string") {
			if (v.length === 0) fail(`${where} が空文字列`);
			return v;
		}
		if (!isObj(v)) fail(`${where} は文字列かアクションであるべき`);
		ownKeys(v, ["action", "layer"], where);
		const action = v.action;
		if (typeof action !== "string" || !ACTION_NAMES.has(action)) fail(`${where} の action "${String(action)}" は未知`);
		const out = { action };
		if (action === "setLayer") {
			const layer = v.layer;
			if (typeof layer !== "string" || !layer) fail(`${where} の setLayer に layer が無い`);
			out.layer = layer;
		} else if (v.layer !== void 0) fail(`${where} の ${action} に layer は指定できない`);
		return out;
	}
	function decodeKey(raw, rows, cols, where) {
		if (!isObj(raw)) fail(`${where} はオブジェクトであるべき`);
		ownKeys(raw, [
			"row",
			"col",
			"rowSpan",
			"colSpan",
			"label",
			"composingLabel",
			"tap",
			"flick",
			"repeat"
		], where);
		const row = optInt(raw, "row", 0, where);
		const col = optInt(raw, "col", 0, where);
		if (row === void 0 || col === void 0) fail(`${where} に row/col が無い`);
		const rowSpan = optInt(raw, "rowSpan", 1, where) ?? 1;
		const colSpan = optInt(raw, "colSpan", 1, where) ?? 1;
		if (row + rowSpan > rows || col + colSpan > cols) fail(`${where} (row=${row}, col=${col}, span=${rowSpan}x${colSpan}) がグリッド ${rows}x${cols} をはみ出す`);
		const tap = raw.tap === void 0 ? null : decodeValue(raw.tap, `${where}.tap`);
		const flick = {};
		if (raw.flick !== void 0) {
			if (!isObj(raw.flick)) fail(`${where}.flick はオブジェクトであるべき`);
			const dirKeys = ownKeys(raw.flick, DIRS, `${where}.flick`);
			if (dirKeys.length === 0) fail(`${where}.flick が空`);
			for (const d of dirKeys) flick[d] = decodeValue(raw.flick[d], `${where}.flick.${d}`);
		}
		if (tap === null && Object.keys(flick).length === 0) fail(`${where} に tap も flick も無い`);
		const label = optStr(raw, "label", where) ?? (typeof tap === "string" ? tap : null);
		if (label === null) fail(`${where} はアクションキーなので label が必須`);
		const composingLabel = optStr(raw, "composingLabel", where);
		const repeat = raw.repeat === void 0 ? false : raw.repeat;
		if (typeof repeat !== "boolean") fail(`${where}.repeat は boolean であるべき`);
		return {
			row,
			col,
			rowSpan,
			colSpan,
			label,
			composingLabel,
			tap,
			flick,
			repeat
		};
	}
	function decodeLayer(name, raw, mapOutput, where) {
		if (!isObj(raw)) fail(`${where} はオブジェクトであるべき`);
		ownKeys(raw, [
			"grid",
			"keys",
			"output"
		], where);
		const grid = raw.grid;
		if (!isObj(grid)) fail(`${where}.grid が無い`);
		ownKeys(grid, ["rows", "cols"], `${where}.grid`);
		const rows = optInt(grid, "rows", 1, `${where}.grid`);
		const cols = optInt(grid, "cols", 1, `${where}.grid`);
		if (rows === void 0 || cols === void 0 || rows > 8 || cols > 8) fail(`${where}.grid は rows/cols 1〜8 であるべき`);
		const output = optStr(raw, "output", where) ?? mapOutput;
		if (output !== "kana" && output !== "romaji" && output !== "direct") fail(`${where}.output "${output}" は未知（kana / romaji / direct）`);
		if (!Array.isArray(raw.keys) || raw.keys.length === 0) fail(`${where}.keys が空`);
		const keys = raw.keys.map((k, i) => decodeKey(k, rows, cols, `${where}.keys[${i}]`));
		const occupied = /* @__PURE__ */ new Set();
		for (const k of keys) for (let r = k.row; r < k.row + k.rowSpan; r++) for (let c = k.col; c < k.col + k.colSpan; c++) {
			const cell = `${r},${c}`;
			if (occupied.has(cell)) fail(`${where} でセル (${cell}) が重複している`);
			occupied.add(cell);
		}
		for (const k of keys) {
			const values = [k.tap, ...Object.values(k.flick)].filter((v) => v != null);
			for (const v of values) if (typeof v === "string") {
				if (output === "romaji") {
					for (const ch of v) if (ch < " " || ch > "~") fail(`${where} romaji レイヤの値 "${v}" に非 ASCII 文字`);
				}
			} else if (v.action === "postModify" && output !== "kana") fail(`${where} postModify は kana 出力レイヤ専用`);
		}
		return {
			name,
			output,
			rows,
			cols,
			keys
		};
	}
	/** flickmap JSON をデコード・検証する。不正なら Error を投げる */
	function decodeFlickmap(json) {
		if (!isObj(json)) fail("トップレベルはオブジェクトであるべき");
		ownKeys(json, [
			"formatVersion",
			"name",
			"description",
			"author",
			"contributor",
			"basedOn",
			"license",
			"output",
			"flickConfig",
			"postModifyCycles",
			"initialLayer",
			"layers"
		], "トップレベル");
		if (json.formatVersion !== "flick-1") fail(`formatVersion "${String(json.formatVersion)}" は未対応（"flick-1" のみ）`);
		const name = optStr(json, "name", "トップレベル");
		if (!name) fail("name が無い");
		const mapOutput = optStr(json, "output", "トップレベル") ?? "kana";
		if (mapOutput !== "kana" && mapOutput !== "romaji") fail(`output "${mapOutput}" は未知（kana / romaji）`);
		let threshold = .35;
		let petalDelayMs = 0;
		let repeatDelayMs = 500;
		let repeatIntervalMs = 80;
		if (json.flickConfig !== void 0) {
			const fc = json.flickConfig;
			if (!isObj(fc)) fail("flickConfig はオブジェクトであるべき");
			ownKeys(fc, [
				"inputStyle",
				"threshold",
				"petalDelayMs",
				"repeat"
			], "flickConfig");
			const style = optStr(fc, "inputStyle", "flickConfig");
			if (style !== void 0 && style !== "flick") fail(`inputStyle "${style}" は未対応（flick-1 実装は "flick" のみ）`);
			if (fc.threshold !== void 0) {
				if (typeof fc.threshold !== "number" || fc.threshold < .1 || fc.threshold > 1) fail("flickConfig.threshold は 0.1〜1.0 の数値であるべき");
				threshold = fc.threshold;
			}
			petalDelayMs = optInt(fc, "petalDelayMs", 0, "flickConfig") ?? petalDelayMs;
			if (fc.repeat !== void 0) {
				if (!isObj(fc.repeat)) fail("flickConfig.repeat はオブジェクトであるべき");
				ownKeys(fc.repeat, ["delayMs", "intervalMs"], "flickConfig.repeat");
				repeatDelayMs = optInt(fc.repeat, "delayMs", 0, "flickConfig.repeat") ?? repeatDelayMs;
				repeatIntervalMs = optInt(fc.repeat, "intervalMs", 16, "flickConfig.repeat") ?? repeatIntervalMs;
			}
		}
		let postModifyCycles = [...DEFAULT_POST_MODIFY_CYCLES];
		if (json.postModifyCycles !== void 0) {
			const pc = json.postModifyCycles;
			if (!Array.isArray(pc) || pc.some((c) => typeof c !== "string" || Array.from(c).length < 2)) fail("postModifyCycles は 2 字以上の文字列の配列であるべき");
			postModifyCycles = pc;
		}
		if (!isObj(json.layers)) fail("layers が無い");
		const layerNames = Object.keys(json.layers).filter((k) => !k.startsWith("_comment"));
		if (layerNames.length === 0) fail("layers が空");
		const layers = {};
		for (const ln of layerNames) layers[ln] = decodeLayer(ln, json.layers[ln], mapOutput, `layers.${ln}`);
		for (const ln of layerNames) for (const k of layers[ln].keys) {
			const values = [k.tap, ...Object.values(k.flick)].filter((v) => v != null);
			for (const v of values) if (typeof v !== "string" && v.action === "setLayer" && !(v.layer in layers)) fail(`layers.${ln} の setLayer 先 "${v.layer}" が存在しない`);
		}
		const initialLayer = optStr(json, "initialLayer", "トップレベル") ?? ("kana" in layers ? "kana" : layerNames[0]);
		if (!(initialLayer in layers)) fail(`initialLayer "${initialLayer}" が存在しない`);
		return {
			name,
			description: optStr(json, "description", "トップレベル"),
			author: optStr(json, "author", "トップレベル"),
			license: optStr(json, "license", "トップレベル"),
			basedOn: optStr(json, "basedOn", "トップレベル"),
			initialLayer,
			threshold,
			petalDelayMs,
			repeatDelayMs,
			repeatIntervalMs,
			postModifyCycles,
			layers
		};
	}
	//#endregion
	//#region src/flick/resolver.ts
	/** アクション → 合成 KeyTap（keymap v1 specialActions と同じ意味論） */
	const ACTION_TAPS = {
		deleteBack: { key: "Backspace" },
		convert: { key: " " },
		confirm: { key: "Enter" },
		escape: { key: "Escape" },
		undo: {
			key: "Backspace",
			ctrlKey: true
		},
		moveLeft: { key: "ArrowLeft" },
		moveRight: { key: "ArrowRight" },
		moveUp: { key: "ArrowUp" },
		moveDown: { key: "ArrowDown" },
		resizeLeft: {
			key: "ArrowLeft",
			shiftKey: true
		},
		resizeRight: {
			key: "ArrowRight",
			shiftKey: true
		}
	};
	function createResolver(map, host = {}) {
		let current = map.initialLayer;
		function keyAt(row, col) {
			for (const k of map.layers[current].keys) if (row >= k.row && row < k.row + k.rowSpan && col >= k.col && col < k.col + k.colSpan) return k;
			return null;
		}
		function resolveValue(value) {
			if (typeof value === "string") {
				const output = map.layers[current].output;
				if (output === "kana") return [{
					type: "kana",
					text: value,
					replace: 0
				}];
				if (output === "romaji") return Array.from(value).map((ch) => ({
					type: "key",
					tap: { key: ch }
				}));
				return [{
					type: "text",
					text: value
				}];
			}
			if (value.action === "setLayer") {
				const target = value.layer;
				if (!(target in map.layers)) return [];
				current = target;
				return [{
					type: "layer",
					layer: target
				}];
			}
			if (value.action === "postModify") {
				const composing = host.getComposingTail?.() ?? "";
				const chars = Array.from(composing);
				if (chars.length === 0) return [];
				const next = nextPostModify(chars[chars.length - 1], map.postModifyCycles);
				if (next === null) return [];
				return [{
					type: "kana",
					text: next,
					replace: 1
				}];
			}
			const tap = ACTION_TAPS[value.action];
			return tap ? [{
				type: "key",
				tap: { ...tap }
			}] : [];
		}
		return {
			get layer() {
				return current;
			},
			setLayer(name) {
				if (!(name in map.layers)) return false;
				current = name;
				return true;
			},
			keyAt,
			resolve(gesture) {
				const key = keyAt(gesture.row, gesture.col);
				if (!key) return [];
				const value = gesture.kind === "tap" ? key.tap : gesture.dir !== void 0 ? key.flick[gesture.dir] ?? null : null;
				if (value == null) return [];
				return resolveValue(value);
			}
		};
	}
	//#endregion
	//#region src/flick/geometry.ts
	/**
	* pointerdown 起点からの変位 (dx, dy) を判定する。
	* - 距離 < threshold × cellWidth → tap
	* - 以上 → flick。方向は角度 45° 区切り（画面座標系: y は下向き正）
	*/
	function classifyGesture(dx, dy, cellWidth, threshold) {
		if (Math.hypot(dx, dy) < cellWidth * threshold) return { kind: "tap" };
		const deg = Math.atan2(dy, dx) * 180 / Math.PI;
		if (deg >= -135 && deg < -45) return {
			kind: "flick",
			dir: "up"
		};
		if (deg >= -45 && deg < 45) return {
			kind: "flick",
			dir: "right"
		};
		if (deg >= 45 && deg < 135) return {
			kind: "flick",
			dir: "down"
		};
		return {
			kind: "flick",
			dir: "left"
		};
	}
	//#endregion
	//#region src/flick/keyboard.ts
	const STYLE_ID = "flick-engine-style";
	const CSS = `
.fe-root { position: relative; display: grid; gap: 4px; padding: 6px;
  box-sizing: border-box; width: 100%; height: 100%;
  background: var(--fe-bg, #d1d5db); border-radius: 8px;
  touch-action: none; user-select: none; -webkit-user-select: none; }
.fe-key { display: flex; align-items: center; justify-content: center;
  background: var(--fe-key-bg, #ffffff); color: var(--fe-key-fg, #111827);
  border-radius: 6px; box-shadow: 0 1px 0 rgba(0,0,0,.25);
  font-size: clamp(14px, 3.2vmin, 22px); line-height: 1; cursor: pointer;
  touch-action: none; }
.fe-key.fe-fn { background: var(--fe-fn-bg, #9ca3af); color: var(--fe-fn-fg, #111827);
  font-size: clamp(11px, 2.4vmin, 16px); }
.fe-key.fe-active { background: var(--fe-active-bg, #93c5fd); }
.fe-petal { position: absolute; z-index: 10; pointer-events: none;
  display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); }
.fe-petal span { display: flex; align-items: center; justify-content: center;
  background: var(--fe-petal-bg, #374151); color: var(--fe-petal-fg, #ffffff);
  border-radius: 6px; font-size: clamp(13px, 3vmin, 20px); opacity: .95; }
.fe-petal span:empty { visibility: hidden; }
.fe-petal .fe-hot { background: var(--fe-petal-hot-bg, #2563eb); }
`;
	function ensureStyle(doc) {
		if (doc.getElementById(STYLE_ID)) return;
		const style = doc.createElement("style");
		style.id = STYLE_ID;
		style.textContent = CSS;
		doc.head.appendChild(style);
	}
	/** 値の表示文字列（アクションは petal に出さない = 空） */
	function petalLabel(key, dir) {
		const v = key.flick[dir];
		return typeof v === "string" ? v : "";
	}
	function mount(container, map, opts) {
		const doc = container.ownerDocument;
		ensureStyle(doc);
		const resolver = createResolver(map, opts);
		const root = doc.createElement("div");
		root.className = "fe-root";
		container.appendChild(root);
		let composing = false;
		const keyEls = /* @__PURE__ */ new Map();
		const labelFor = (key) => composing && key.composingLabel !== void 0 ? key.composingLabel : key.label;
		let press = null;
		function emitOps(ops) {
			for (const op of ops) {
				if (op.type === "layer") render();
				opts.onOp(op);
			}
		}
		function cellWidth() {
			const layer = map.layers[resolver.layer];
			return root.clientWidth / layer.cols;
		}
		function showPetal() {
			if (!press || press.petal) return;
			const { key, el } = press;
			const petal = doc.createElement("div");
			petal.className = "fe-petal";
			const center = typeof key.tap === "string" ? key.tap : key.label;
			const cells = [
				"",
				petalLabel(key, "up"),
				"",
				petalLabel(key, "left"),
				center,
				petalLabel(key, "right"),
				"",
				petalLabel(key, "down"),
				""
			];
			for (const text of cells) {
				const span = doc.createElement("span");
				span.textContent = text;
				petal.appendChild(span);
			}
			const rootRect = root.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			petal.style.left = `${r.left - rootRect.left - r.width}px`;
			petal.style.top = `${r.top - rootRect.top - r.height}px`;
			petal.style.width = `${r.width * 3}px`;
			petal.style.height = `${r.height * 3}px`;
			root.appendChild(petal);
			press.petal = petal;
		}
		function highlightPetal(dir) {
			if (!press?.petal) return;
			const order = [
				null,
				"up",
				null,
				"left",
				null,
				"right",
				null,
				"down",
				null
			];
			press.petal.querySelectorAll("span").forEach((span, i) => {
				span.classList.toggle("fe-hot", dir !== null && order[i] === dir);
			});
		}
		function clearPress() {
			if (!press) return;
			if (press.petalTimer !== null) clearTimeout(press.petalTimer);
			if (press.repeatTimer !== null) clearTimeout(press.repeatTimer);
			press.petal?.remove();
			press.el.classList.remove("fe-active");
			press = null;
		}
		function onDown(e, key, el) {
			if (press) return;
			e.preventDefault();
			el.setPointerCapture(e.pointerId);
			el.classList.add("fe-active");
			press = {
				pointerId: e.pointerId,
				key,
				el,
				startX: e.clientX,
				startY: e.clientY,
				cellW: cellWidth(),
				petal: null,
				petalTimer: null,
				repeatTimer: null,
				repeatFired: false
			};
			if (Object.keys(key.flick).length > 0) if (map.petalDelayMs <= 0) showPetal();
			else press.petalTimer = setTimeout(showPetal, map.petalDelayMs);
			if (key.repeat && key.tap !== null) {
				const fire = () => {
					if (!press) return;
					press.repeatFired = true;
					emitOps(resolver.resolve({
						row: key.row,
						col: key.col,
						kind: "tap"
					}));
					press.repeatTimer = setTimeout(fire, map.repeatIntervalMs);
				};
				press.repeatTimer = setTimeout(fire, map.repeatDelayMs);
			}
		}
		function onMove(e) {
			if (!press || e.pointerId !== press.pointerId) return;
			const g = classifyGesture(e.clientX - press.startX, e.clientY - press.startY, press.cellW, map.threshold);
			if (g.kind === "flick" && !press.petal && Object.keys(press.key.flick).length > 0) showPetal();
			highlightPetal(g.kind === "flick" ? g.dir : null);
			if (g.kind === "flick" && press.repeatTimer !== null && !press.repeatFired) {
				clearTimeout(press.repeatTimer);
				press.repeatTimer = null;
			}
		}
		function onUp(e) {
			if (!press || e.pointerId !== press.pointerId) return;
			const { key, startX, startY, cellW, repeatFired } = press;
			const g = classifyGesture(e.clientX - startX, e.clientY - startY, cellW, map.threshold);
			clearPress();
			if (repeatFired) return;
			emitOps(resolver.resolve({
				row: key.row,
				col: key.col,
				kind: g.kind,
				dir: g.dir
			}));
		}
		function onCancel(e) {
			if (!press || e.pointerId !== press.pointerId) return;
			clearPress();
		}
		function render() {
			root.querySelectorAll(".fe-key, .fe-petal").forEach((el) => el.remove());
			if (press) clearPress();
			keyEls.clear();
			const layer = map.layers[resolver.layer];
			root.style.gridTemplate = `repeat(${layer.rows}, 1fr) / repeat(${layer.cols}, 1fr)`;
			for (const key of layer.keys) {
				const el = doc.createElement("div");
				el.className = typeof key.tap === "string" ? "fe-key" : "fe-key fe-fn";
				el.textContent = labelFor(key);
				keyEls.set(el, key);
				el.style.gridRow = `${key.row + 1} / span ${key.rowSpan}`;
				el.style.gridColumn = `${key.col + 1} / span ${key.colSpan}`;
				el.addEventListener("pointerdown", (e) => onDown(e, key, el));
				root.appendChild(el);
			}
		}
		root.addEventListener("pointermove", onMove);
		root.addEventListener("pointerup", onUp);
		root.addEventListener("pointercancel", onCancel);
		root.addEventListener("touchend", (e) => e.preventDefault(), { passive: false });
		render();
		return {
			get element() {
				return root;
			},
			get layer() {
				return resolver.layer;
			},
			setLayer(name) {
				const ok = resolver.setLayer(name);
				if (ok) render();
				return ok;
			},
			setComposing(on) {
				on = !!on;
				if (composing === on) return;
				composing = on;
				for (const [el, key] of keyEls) el.textContent = labelFor(key);
			},
			destroy() {
				clearPress();
				root.remove();
			}
		};
	}
	//#endregion
	//#region src/flick/version.ts
	const FLICK_ENGINE_VERSION = "1.1.1";
	//#endregion
	exports.DEFAULT_POST_MODIFY_CYCLES = DEFAULT_POST_MODIFY_CYCLES;
	exports.classifyGesture = classifyGesture;
	exports.createResolver = createResolver;
	exports.decodeFlickmap = decodeFlickmap;
	exports.mount = mount;
	exports.nextPostModify = nextPostModify;
	exports.version = FLICK_ENGINE_VERSION;
});
