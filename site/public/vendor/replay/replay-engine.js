(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.ReplayEngine = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/replay/diff.ts
	/** prev → next の差分を 1 個返す。同一なら null。 */
	function diffText(prev, next) {
		if (prev === next) return null;
		const a = Array.from(prev);
		const b = Array.from(next);
		let head = 0;
		const maxHead = Math.min(a.length, b.length);
		while (head < maxHead && a[head] === b[head]) head++;
		let tail = 0;
		const maxTail = Math.min(a.length - head, b.length - head);
		while (tail < maxTail && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
		return {
			at: head,
			removed: a.length - head - tail,
			inserted: b.slice(head, b.length - tail).join("")
		};
	}
	/** 文字列をコードポイント数で数える（doc 層の offset はすべてこの単位）。 */
	function cpLength(text) {
		return Array.from(text).length;
	}
	/** コードポイント単位の slice。 */
	function cpSlice(text, start, end) {
		return Array.from(text).slice(start, end).join("");
	}
	//#endregion
	//#region src/replay/version.ts
	const REPLAY_ENGINE_VERSION = "0.8.0";
	//#endregion
	//#region src/replay/types.ts
	/** ログ形式の版。未知の版は読み込み時に明確なエラーで弾く（keymap v2 の版ゲートと同じ作法）。 */
	const HLOG_FORMAT = "hlog-1";
	const INPUT_KINDS = /* @__PURE__ */ new Set([
		"down",
		"up",
		"paste"
	]);
	const IME_KINDS = /* @__PURE__ */ new Set([
		"show",
		"cand",
		"sel",
		"add",
		"exp",
		"col",
		"hide",
		"commit"
	]);
	const DOC_KINDS = /* @__PURE__ */ new Set([
		"ins",
		"del",
		"car",
		"kf"
	]);
	function isInputEvent(ev) {
		return INPUT_KINDS.has(ev.k);
	}
	function isImeEvent(ev) {
		return IME_KINDS.has(ev.k);
	}
	function isDocEvent(ev) {
		return DOC_KINDS.has(ev.k);
	}
	/**
	* 読み込み時の版ゲート。未知の版は**明確なエラー**で弾く（黙って半分動くのが最悪）。
	* 形の妥当性も最低限だけ見る（events が配列か等）。
	*/
	function assertHlog(data) {
		if (typeof data !== "object" || data === null) throw new Error("hlog: オブジェクトではありません");
		const d = data;
		if (d.formatVersion !== "hlog-1") throw new Error(`hlog: 未対応の formatVersion "${String(d.formatVersion)}"（このエンジンが読めるのは "${HLOG_FORMAT}" のみ）`);
		if (!Array.isArray(d.events)) throw new Error("hlog: events が配列ではありません");
		if (typeof d.meta !== "object" || d.meta === null) throw new Error("hlog: meta がありません");
		if (d.annotations !== void 0 && !Array.isArray(d.annotations)) throw new Error("hlog: annotations が配列ではありません");
	}
	//#endregion
	//#region src/replay/recorder.ts
	/** 修飾キーを "scam" の順で圧縮する。修飾なしは undefined（フィールドごと省略）。 */
	function packMods(e) {
		let m = "";
		if (e.shiftKey) m += "s";
		if (e.ctrlKey) m += "c";
		if (e.altKey) m += "a";
		if (e.metaKey) m += "m";
		return m || void 0;
	}
	function sameList(a, b) {
		if (a === b) return true;
		if (!a || !b || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}
	/** 追加候補の同一判定用のキー（再送抑制のためだけに使う） */
	function additionalKey(a) {
		return a.map((x) => `${x.text}${x.annotation}`).join("");
	}
	/** ISO8601 の秒精度（ms は出さない）。 */
	function isoSeconds(d) {
		const pad = (n) => String(n).padStart(2, "0");
		const off = -d.getTimezoneOffset();
		const sign = off >= 0 ? "+" : "-";
		const oh = pad(Math.floor(Math.abs(off) / 60));
		const om = pad(Math.abs(off) % 60);
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
	}
	/** FNV-1a（32bit）。crypto.subtle が使えない環境のフォールバック。 */
	function fnv1a(text) {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h.toString(16).padStart(8, "0");
	}
	/**
	* 文書のハッシュ。secure context なら sha256、でなければ fnv1a。
	* どちらか分かるようプレフィックスを付ける（人間証明の足がかりとしては sha256 のみ有効）。
	*/
	async function hashDoc(text) {
		const subtle = globalThis.crypto?.subtle;
		if (subtle && typeof TextEncoder !== "undefined") try {
			const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
			return `sha256:${Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("")}`;
		} catch {}
		return `fnv1a:${fnv1a(text)}`;
	}
	function createRecorder(options = {}) {
		const nowFn = options.now ?? (() => typeof performance !== "undefined" ? performance.now() : Date.now());
		const kfIntervalMs = options.keyframeIntervalMs ?? 3e4;
		const kfIntervalEvents = options.keyframeIntervalEvents ?? 200;
		const maxEvents = options.maxEvents ?? 2e5;
		const ignoreRepeat = options.ignoreRepeat ?? true;
		let on = false;
		let overflowed = false;
		let t0 = 0;
		let events = [];
		let annotations = [];
		let startedAt = "";
		let keymap = null;
		let engines = {};
		let fronts = [];
		let lastText = "";
		let lastCaret = 0;
		let lastAnchor = null;
		let prevCands = /* @__PURE__ */ new Map();
		let imeActive = false;
		let lastKfTime = 0;
		let eventsSinceKf = 0;
		let kfPending = false;
		let keyCount = 0;
		let commitCount = 0;
		function t() {
			return Math.round(nowFn() - t0);
		}
		function push(ev) {
			if (!on) return;
			if (events.length >= maxEvents) {
				if (!overflowed) {
					overflowed = true;
					on = false;
				}
				return;
			}
			events.push(ev);
			eventsSinceKf++;
			if (ev.t - lastKfTime >= kfIntervalMs || eventsSinceKf >= kfIntervalEvents) kfPending = true;
		}
		/**
		* keyframe を打つ。**未確定中は打たない**（次に ime が空になるまで遅延する）。
		* こうするとシークが自明になる — keyframe 時点では必ず未確定表示が無いので、
		* 「keyframe から再適用する」だけで ime 状態も整合する（player.seek）。
		*
		* 呼ぶのは **文書が落ち着いた点だけ**（doc の末尾と hide の後）。push のたびに呼ぶと、
		* commit と その ins の間に割り込んで「確定前の文書を持つ keyframe」ができてしまう。
		*/
		function flushKeyframe(atTime) {
			if (!kfPending || imeActive) return;
			kfPending = false;
			lastKfTime = atTime;
			eventsSinceKf = 0;
			events.push({
				t: atTime,
				k: "kf",
				x: lastText,
				a: lastCaret
			});
		}
		function emitCaret(caret, anchor) {
			if (caret === lastCaret && anchor === lastAnchor) return;
			lastCaret = caret;
			lastAnchor = anchor;
			push(anchor === null || anchor === caret ? {
				t: t(),
				k: "car",
				a: caret
			} : {
				t: t(),
				k: "car",
				a: caret,
				b: anchor
			});
		}
		return {
			get recording() {
				return on;
			},
			get overflowed() {
				return overflowed;
			},
			get eventCount() {
				return events.length;
			},
			start(opts = {}) {
				on = true;
				overflowed = false;
				t0 = nowFn();
				events = [];
				annotations = [];
				startedAt = opts.recordedAt ?? isoSeconds(/* @__PURE__ */ new Date());
				keymap = opts.keymap ?? null;
				engines = {
					...opts.engines,
					replay: REPLAY_ENGINE_VERSION
				};
				fronts = opts.fronts ?? ["keyboard"];
				lastText = opts.text ?? "";
				lastCaret = opts.caret ?? cpLength(lastText);
				lastAnchor = null;
				prevCands = /* @__PURE__ */ new Map();
				imeActive = false;
				keyCount = 0;
				commitCount = 0;
				lastKfTime = 0;
				eventsSinceKf = 0;
				kfPending = false;
				events.push({
					t: 0,
					k: "kf",
					x: lastText,
					a: lastCaret
				});
			},
			async stop() {
				on = false;
				const duration = events.length > 0 ? events[events.length - 1].t : 0;
				const docHash = await hashDoc(lastText);
				const log = {
					formatVersion: HLOG_FORMAT,
					meta: {
						recordedAt: startedAt,
						duration,
						engines,
						keymap,
						fronts,
						counts: {
							keys: keyCount,
							commits: commitCount,
							chars: cpLength(lastText)
						},
						docHash
					},
					events
				};
				if (annotations.length > 0) log.annotations = annotations;
				return log;
			},
			discard() {
				on = false;
				events = [];
				annotations = [];
			},
			keyDown(e) {
				if (!on) return;
				if (ignoreRepeat && e.repeat) return;
				keyCount++;
				const m = packMods(e);
				push(m ? {
					t: t(),
					k: "down",
					c: e.code,
					key: e.key,
					m
				} : {
					t: t(),
					k: "down",
					c: e.code,
					key: e.key
				});
			},
			keyUp(e) {
				if (!on) return;
				push({
					t: t(),
					k: "up",
					c: e.code
				});
			},
			paste(charCount) {
				if (!on) return;
				push({
					t: t(),
					k: "paste",
					n: charCount
				});
			},
			show(segments) {
				if (!on) return;
				imeActive = true;
				const at = t();
				push({
					t: at,
					k: "show",
					s: segments.map((s) => ({
						x: s.text,
						d: s.kind
					}))
				});
				const next = /* @__PURE__ */ new Map();
				segments.forEach((seg, i) => {
					const cands = seg.candidates ?? [];
					const add = seg.additional ?? [];
					if (cands.length === 0 && add.length === 0) return;
					const sel = seg.candidateIndex ?? 0;
					const expanded = seg.expanded === true;
					const addSel = seg.additionalIndex;
					const addKey = additionalKey(add);
					const prev = prevCands.get(i);
					next.set(i, {
						list: cands,
						sel,
						expanded,
						addKey,
						addSel
					});
					if (cands.length > 0) {
						if (!prev || !sameList(prev.list, cands)) push({
							t: at,
							k: "cand",
							i,
							l: cands.slice(),
							s: sel,
							...seg.foldCount !== void 0 ? { f: seg.foldCount } : {}
						});
						else if (prev.sel !== sel) push({
							t: at,
							k: "sel",
							i,
							s: sel
						});
						if (prev && prev.expanded !== expanded) push({
							t: at,
							k: expanded ? "exp" : "col",
							i
						});
					}
					if (addKey !== (prev?.addKey ?? "") || addSel !== prev?.addSel) push({
						t: at,
						k: "add",
						i,
						l: add.map((x) => ({
							x: x.text,
							a: x.annotation
						})),
						...addSel !== void 0 ? { s: addSel } : {}
					});
				});
				prevCands = next;
			},
			hide() {
				if (!on) return;
				imeActive = false;
				prevCands = /* @__PURE__ */ new Map();
				push({
					t: t(),
					k: "hide"
				});
				flushKeyframe(t());
			},
			commit(text) {
				if (!on) return;
				commitCount++;
				imeActive = false;
				prevCands = /* @__PURE__ */ new Map();
				push({
					t: t(),
					k: "commit",
					x: text
				});
			},
			doc(text, caret, anchor = null) {
				if (!on) return;
				const d = diffText(lastText, text);
				if (d) {
					const at = t();
					lastText = text;
					lastCaret = d.at + cpLength(d.inserted);
					lastAnchor = null;
					if (d.removed > 0) push({
						t: at,
						k: "del",
						a: d.at,
						n: d.removed
					});
					if (d.inserted) push({
						t: at,
						k: "ins",
						a: d.at,
						x: d.inserted
					});
				}
				emitCaret(caret, anchor);
				flushKeyframe(t());
			},
			caret(caret, anchor = null) {
				if (!on) return;
				emitCaret(caret, anchor);
			},
			annotate(a) {
				annotations.push(a);
			}
		};
	}
	//#endregion
	//#region src/replay/state.ts
	function createState() {
		return {
			doc: {
				text: "",
				caret: 0,
				anchor: null
			},
			ime: {
				visible: false,
				segments: [],
				cands: /* @__PURE__ */ new Map()
			},
			pressed: /* @__PURE__ */ new Set()
		};
	}
	/** 状態のコピー（シークやプレビューで枝分かれさせたいとき用）。 */
	function cloneState(s) {
		return {
			doc: { ...s.doc },
			ime: {
				visible: s.ime.visible,
				segments: s.ime.segments.map((x) => ({ ...x })),
				cands: new Map(Array.from(s.ime.cands, ([k, v]) => [k, {
					...v,
					list: v.list.slice(),
					additional: v.additional?.map((a) => ({ ...a }))
				}]))
			},
			pressed: new Set(s.pressed)
		};
	}
	function clampOffset(text, at) {
		const len = cpLength(text);
		if (at < 0) return 0;
		return at > len ? len : at;
	}
	/**
	* イベントを 1 個適用する（破壊的）。
	*
	* doc 層は独立して完結させる（ime 層から導出しない）。native 編集・貼り付け・undo が
	* あるので、導出しようとすると再生器が編集セマンティクスを再実装する羽目になる。
	*/
	function applyEvent(s, ev) {
		switch (ev.k) {
			case "ins": {
				const at = clampOffset(s.doc.text, ev.a);
				s.doc.text = cpSlice(s.doc.text, 0, at) + ev.x + cpSlice(s.doc.text, at);
				s.doc.caret = at + cpLength(ev.x);
				s.doc.anchor = null;
				break;
			}
			case "del": {
				const at = clampOffset(s.doc.text, ev.a);
				s.doc.text = cpSlice(s.doc.text, 0, at) + cpSlice(s.doc.text, at + ev.n);
				s.doc.caret = at;
				s.doc.anchor = null;
				break;
			}
			case "car":
				s.doc.caret = clampOffset(s.doc.text, ev.a);
				s.doc.anchor = ev.b === void 0 ? null : clampOffset(s.doc.text, ev.b);
				break;
			case "kf":
				s.doc.text = ev.x;
				s.doc.caret = clampOffset(ev.x, ev.a);
				s.doc.anchor = null;
				break;
			case "show":
				s.ime.visible = true;
				s.ime.segments = ev.s.map((x) => ({
					text: x.x,
					kind: x.d
				}));
				break;
			case "cand":
				s.ime.cands.set(ev.i, {
					list: ev.l.slice(),
					sel: ev.s,
					fold: ev.f,
					expanded: false
				});
				break;
			case "sel": {
				const c = s.ime.cands.get(ev.i);
				if (c) c.sel = ev.s;
				break;
			}
			case "add": {
				let c = s.ime.cands.get(ev.i);
				if (!c) {
					c = {
						list: [],
						sel: 0,
						expanded: false
					};
					s.ime.cands.set(ev.i, c);
				}
				c.additional = ev.l.map((x) => ({
					text: x.x,
					annotation: x.a
				}));
				c.additionalIndex = ev.s;
				break;
			}
			case "exp": {
				const c = s.ime.cands.get(ev.i);
				if (c) c.expanded = true;
				break;
			}
			case "col": {
				const c = s.ime.cands.get(ev.i);
				if (c) c.expanded = false;
				break;
			}
			case "hide":
			case "commit":
				s.ime.visible = false;
				s.ime.segments = [];
				s.ime.cands.clear();
				break;
			case "down":
				s.pressed.add(ev.c);
				break;
			case "up":
				s.pressed.delete(ev.c);
				break;
			case "paste": break;
		}
	}
	/**
	* 候補窓の描画用ビュー。二層化しているときは一層目だけを既定で見せ、
	* 展開中は全部見せる（hechima の FoldOptions と同じ意味論）。
	*/
	function visibleCandidates(c) {
		const fold = c.fold === void 0 ? c.list.length : Math.min(c.fold, c.list.length);
		if (c.expanded || fold >= c.list.length) return {
			list: c.list,
			hidden: 0
		};
		return {
			list: c.list.slice(0, fold),
			hidden: c.list.length - fold
		};
	}
	//#endregion
	//#region src/replay/player.ts
	const CAPTION_DEFAULT_MS = 3e3;
	function createPlayer(log, options = {}) {
		assertHlog(log);
		const events = log.events;
		const annotations = log.annotations ?? [];
		const evenStepMs = options.evenStepMs ?? 40;
		const duration = events.length > 0 ? events[events.length - 1].t : 0;
		let state = createState();
		let index = 0;
		let time = 0;
		let playing = false;
		let rate = options.rate ?? 1;
		let mode = options.mode ?? "realtime";
		let raf = null;
		let lastFrame = 0;
		/** 直近の打鍵単位コマ送りで押されたキー（連続再生では空） */
		let strokeKeys = /* @__PURE__ */ new Set();
		/** pause 注釈による停止の残り ms */
		let pauseRemain = 0;
		/** 発火済みの注釈（pause / speed を二重に適用しない） */
		let firedAnnotations = /* @__PURE__ */ new Set();
		function currentCaption() {
			let found = null;
			for (const a of annotations) {
				if (a.k !== "caption") continue;
				const until = a.t + (a.ms ?? CAPTION_DEFAULT_MS);
				if (time >= a.t && time < until) found = a.x;
			}
			return found;
		}
		function currentChapter() {
			let found = null;
			for (const a of annotations) if (a.k === "chapter" && a.t <= time) found = a.x;
			return found;
		}
		const view = {
			get time() {
				return time;
			},
			get duration() {
				return duration;
			},
			get playing() {
				return playing;
			},
			get index() {
				return index;
			},
			get state() {
				return state;
			},
			get pressedForDisplay() {
				return strokeKeys.size > 0 ? strokeKeys : state.pressed;
			},
			get caption() {
				return currentCaption();
			},
			get chapter() {
				return currentChapter();
			}
		};
		function notify() {
			options.onUpdate?.(view);
		}
		/** keyframe の自己検証。差分適用にバグがあればここで落ちる。 */
		function verifyKeyframe(ev) {
			if (ev.k !== "kf" || !options.onMismatch) return;
			if (state.doc.text !== ev.x) options.onMismatch({
				at: ev.t,
				expected: ev.x,
				actual: state.doc.text
			});
		}
		/** 起点の kf を適用するときだけは検証しない（そこから状態を作るため） */
		function applyOne(ev, verify) {
			if (verify) verifyKeyframe(ev);
			applyEvent(state, ev);
		}
		/** 注釈のうち [from, to) を跨いだものを発火する。 */
		function fireAnnotations(from, to) {
			for (const a of annotations) {
				if (a.t < from || a.t >= to || firedAnnotations.has(a)) continue;
				firedAnnotations.add(a);
				if (a.k === "pause") pauseRemain += a.ms;
				else if (a.k === "speed") rate = a.rate;
			}
		}
		/** time までのイベントを適用する（前進のみ）。 */
		function advanceTo(target) {
			while (index < events.length && events[index].t <= target) {
				applyOne(events[index], true);
				index++;
			}
		}
		/**
		* events[target] を「次に適用するイベント」にした状態へ作り直す（後退の唯一の経路）。
		* 差分は逆適用しないので、直前の keyframe から前進で作り直す。
		*
		* 記録側は未確定中に keyframe を打たないので、keyframe 時点では ime 状態が空
		* ＝「keyframe から再適用する」だけで未確定表示も候補窓も整合する。
		*/
		function rebuildTo(target) {
			const stop = Math.max(0, Math.min(target, events.length));
			let kfIndex = 0;
			for (let i = 0; i < stop; i++) if (events[i].k === "kf") kfIndex = i;
			state = createState();
			index = kfIndex;
			if (events.length > 0) {
				applyOne(events[kfIndex], false);
				index++;
			}
			while (index < stop) {
				applyOne(events[index], true);
				index++;
			}
			time = index > 0 ? events[index - 1].t : 0;
			pauseRemain = 0;
			strokeKeys = /* @__PURE__ */ new Set();
		}
		function seek(ms) {
			const target = Math.max(0, Math.min(ms, duration));
			let stop = 0;
			while (stop < events.length && events[stop].t <= target) stop++;
			rebuildTo(stop);
			time = target;
			firedAnnotations = new Set(annotations.filter((a) => a.t < target));
			notify();
		}
		/** events 内の keydown の位置（打鍵単位のコマ送りの境界） */
		const downIdx = [];
		events.forEach((ev, i) => {
			if (ev.k === "down") downIdx.push(i);
		});
		/** i より前の最後の keydown 位置 */
		function lastDownBefore(i) {
			let found;
			for (const d of downIdx) {
				if (d >= i) break;
				found = d;
			}
			return found;
		}
		/**
		* 現在位置から「次の keydown の直前」まで前進し、その区間で押されたキーを控える
		* （keyup まで通り過ぎるので、押下状態から拾うことはできない）。
		*/
		function advanceOverOneKey() {
			if (index >= events.length) return;
			strokeKeys = /* @__PURE__ */ new Set();
			do {
				const ev = events[index];
				if (ev.k === "down") strokeKeys.add(ev.c);
				applyOne(ev, true);
				time = ev.t;
				index++;
			} while (index < events.length && events[index].k !== "down");
		}
		function tick(deltaMs) {
			if (deltaMs <= 0) return;
			strokeKeys = /* @__PURE__ */ new Set();
			if (pauseRemain > 0) {
				pauseRemain -= deltaMs;
				notify();
				return;
			}
			const from = time;
			let to;
			if (mode === "even") {
				const consumed = Math.floor(deltaMs / (evenStepMs / Math.max(rate, .01)));
				if (consumed <= 0) return;
				let n = consumed;
				while (n > 0 && index < events.length) {
					applyOne(events[index], true);
					time = events[index].t;
					index++;
					n--;
				}
				to = time;
			} else {
				to = Math.min(time + deltaMs * rate, duration);
				advanceTo(to);
				time = to;
			}
			fireAnnotations(from, Math.max(to, from) + 1);
			if (index >= events.length && (mode === "even" || time >= duration)) {
				time = duration;
				playing = false;
				stopLoop();
				notify();
				options.onEnd?.();
				return;
			}
			notify();
		}
		function loop(now) {
			if (!playing) return;
			const delta = lastFrame === 0 ? 16 : now - lastFrame;
			lastFrame = now;
			tick(delta);
			if (playing) raf = requestAnimationFrame(loop);
		}
		function startLoop() {
			if (typeof requestAnimationFrame !== "function") return;
			lastFrame = 0;
			raf = requestAnimationFrame(loop);
		}
		function stopLoop() {
			if (raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
			raf = null;
		}
		if (events.length > 0) seek(0);
		return {
			view,
			play() {
				if (playing) return;
				if (index >= events.length) seek(0);
				playing = true;
				startLoop();
				notify();
			},
			pause() {
				playing = false;
				stopLoop();
				notify();
			},
			toggle() {
				if (playing) this.pause();
				else this.play();
			},
			seek,
			step(n = 1) {
				if (n < 0) {
					rebuildTo(index + n);
					notify();
					return;
				}
				strokeKeys = /* @__PURE__ */ new Set();
				for (let i = 0; i < n && index < events.length; i++) {
					applyOne(events[index], true);
					time = events[index].t;
					index++;
				}
				notify();
			},
			stepKey(dir = 1) {
				if (downIdx.length === 0) {
					this.step(dir);
					return;
				}
				if (dir > 0) advanceOverOneKey();
				else {
					const cur = lastDownBefore(index);
					const prev = cur === void 0 ? void 0 : lastDownBefore(cur);
					if (prev === void 0) rebuildTo(0);
					else {
						rebuildTo(prev);
						advanceOverOneKey();
					}
				}
				notify();
			},
			setRate(r) {
				rate = Math.max(.01, r);
				notify();
			},
			setMode(m) {
				mode = m;
				notify();
			},
			tick,
			destroy() {
				playing = false;
				stopLoop();
			}
		};
	}
	//#endregion
	//#region src/replay/verify.ts
	/**
	* 全イベントを適用し、各段階の文書と keyframe 不一致を返す（同期・ハッシュは見ない）。
	*/
	function replayAll(log) {
		assertHlog(log);
		const state = createState();
		const texts = [];
		const mismatches = [];
		log.events.forEach((ev, i) => {
			if (ev.k === "kf" && i > 0 && state.doc.text !== ev.x) mismatches.push({
				index: i,
				at: ev.t,
				expected: ev.x,
				actual: state.doc.text
			});
			applyEvent(state, ev);
			texts.push(state.doc.text);
		});
		return {
			texts,
			mismatches,
			final: state
		};
	}
	/**
	* keyframe 検証 + docHash 照合。
	* ハッシュ方式が記録側と違う（sha256 / fnv1a）ときは照合をスキップして null を返す。
	*/
	async function verifyLog(log) {
		const { texts, mismatches, final } = replayAll(log);
		let hashOk = null;
		const recorded = log.meta?.docHash;
		if (typeof recorded === "string" && recorded.includes(":")) {
			const actual = await hashDoc(final.doc.text);
			hashOk = actual.split(":")[0] === recorded.split(":")[0] ? actual === recorded : null;
		}
		return {
			ok: mismatches.length === 0 && hashOk !== false,
			texts,
			mismatches,
			hashOk,
			final
		};
	}
	//#endregion
	//#region src/replay/keyboard/profiles.ts
	/** 行を左から並べる。`[code, label, w?]` の並びを x 累積で展開する */
	function row(y, startX, defs) {
		let x = startX;
		return defs.map(([code, label, w = 1]) => {
			const k = {
				code,
				x,
				y,
				w,
				h: 1,
				label
			};
			x += w;
			return k;
		});
	}
	/** 英字キーの並び（"QWERTY" → KeyQ, KeyW, …） */
	function letters(codes) {
		return Array.from(codes).map((c) => [`Key${c}`, c]);
	}
	/**
	* 矢印クラスタ。**最下段 1 行に収める**（↑↓ は半分の高さ）。ノート PC でよくある形。
	*
	* ↑ を 1 段上に置くと、その段にすでにあるキー（JIS の L 字 Enter・オーソリニアの Enter）と
	* 場所を取り合って盤面が崩れる。矢印のために他の行を作り替えるより、こちらを潰すほうが安い。
	*/
	function arrows(x, y) {
		return [
			{
				code: "ArrowLeft",
				x: x - 1,
				y,
				w: 1,
				h: 1,
				label: "←"
			},
			{
				code: "ArrowUp",
				x,
				y,
				w: 1,
				h: .5,
				label: "↑"
			},
			{
				code: "ArrowDown",
				x,
				y: y + .5,
				w: 1,
				h: .5,
				label: "↓"
			},
			{
				code: "ArrowRight",
				x: x + 1,
				y,
				w: 1,
				h: 1,
				label: "→"
			}
		];
	}
	/** Esc（数字段の上に半分の高さで置く。ノート PC の形） */
	const ESC_KEY = {
		code: "Escape",
		x: 0,
		y: .5,
		w: 1,
		h: .5,
		label: "Esc"
	};
	const US_KEYS = [
		ESC_KEY,
		...row(1, 0, [
			["Backquote", "`"],
			["Digit1", "1"],
			["Digit2", "2"],
			["Digit3", "3"],
			["Digit4", "4"],
			["Digit5", "5"],
			["Digit6", "6"],
			["Digit7", "7"],
			["Digit8", "8"],
			["Digit9", "9"],
			["Digit0", "0"],
			["Minus", "-"],
			["Equal", "="],
			[
				"Backspace",
				"⌫",
				2
			]
		]),
		...row(2, 0, [
			[
				"Tab",
				"Tab",
				1.5
			],
			...letters("QWERTYUIOP"),
			["BracketLeft", "["],
			["BracketRight", "]"],
			[
				"Backslash",
				"\\",
				1.5
			]
		]),
		...row(3, 0, [
			[
				"CapsLock",
				"Caps",
				1.75
			],
			...letters("ASDFGHJKL"),
			["Semicolon", ";"],
			["Quote", "'"],
			[
				"Enter",
				"Enter",
				2.25
			]
		]),
		...row(4, 0, [
			[
				"ShiftLeft",
				"Shift",
				2.25
			],
			...letters("ZXCVBNM"),
			["Comma", ","],
			["Period", "."],
			["Slash", "/"],
			[
				"ShiftRight",
				"Shift",
				2.75
			]
		]),
		...row(5, 0, [
			[
				"ControlLeft",
				"Ctrl",
				1.25
			],
			[
				"MetaLeft",
				"Win",
				1.25
			],
			[
				"AltLeft",
				"Alt",
				1.25
			],
			[
				"Space",
				"",
				5.75
			],
			[
				"AltRight",
				"Alt",
				1.25
			],
			[
				"ControlRight",
				"Ctrl",
				1.25
			]
		]),
		...arrows(13, 5)
	];
	const JIS_KEYS = [
		ESC_KEY,
		...row(1, 0, [
			["Backquote", "半/全"],
			["Digit1", "1"],
			["Digit2", "2"],
			["Digit3", "3"],
			["Digit4", "4"],
			["Digit5", "5"],
			["Digit6", "6"],
			["Digit7", "7"],
			["Digit8", "8"],
			["Digit9", "9"],
			["Digit0", "0"],
			["Minus", "-"],
			["Equal", "^"],
			["IntlYen", "¥"],
			["Backspace", "⌫"]
		]),
		...row(2, 0, [
			[
				"Tab",
				"Tab",
				1.5
			],
			...letters("QWERTYUIOP"),
			["BracketLeft", "@"],
			["BracketRight", "["]
		]),
		...row(3, 0, [
			[
				"CapsLock",
				"Caps",
				1.75
			],
			...letters("ASDFGHJKL"),
			["Semicolon", ";"],
			["Quote", ":"],
			["Backslash", "]"]
		]),
		...row(4, 0, [
			[
				"ShiftLeft",
				"Shift",
				2.25
			],
			...letters("ZXCVBNM"),
			["Comma", ","],
			["Period", "."],
			["Slash", "/"],
			["IntlRo", "\\"],
			[
				"ShiftRight",
				"Shift",
				1.75
			]
		]),
		...row(5, 0, [
			["ControlLeft", "Ctrl"],
			["MetaLeft", "Win"],
			["AltLeft", "Alt"],
			["NonConvert", "無変換"],
			[
				"Space",
				"",
				5
			],
			["Convert", "変換"],
			["KanaMode", "かな"],
			["AltRight", "Alt"]
		]),
		{
			code: "Enter",
			x: 13.75,
			y: 2,
			w: 1.25,
			h: 2,
			label: "Enter"
		},
		...arrows(13, 5)
	];
	const ORTHO_KEYS = [
		...row(0, 0, [
			["Tab", "Tab"],
			...letters("QWERTYUIOP"),
			["Backspace", "⌫"]
		]),
		...row(1, 0, [
			["Escape", "Esc"],
			...letters("ASDFGHJKL"),
			["Semicolon", ";"],
			["Quote", "'"]
		]),
		...row(2, 0, [
			["ShiftLeft", "Shift"],
			...letters("ZXCVBNM"),
			["Comma", ","],
			["Period", "."],
			["Slash", "/"],
			["Enter", "Enter"]
		]),
		...row(3, 0, [
			["ControlLeft", "Ctrl"],
			["AltLeft", "Alt"],
			["MetaLeft", "Win"],
			["NonConvert", "無変換"],
			[
				"Space",
				"",
				4
			],
			["Convert", "変換"]
		]),
		...arrows(10, 3)
	];
	/** ホームポジション（指の待機位置）。プロファイル共通の code で指定する */
	const HOME_CODES = /* @__PURE__ */ new Set([
		"KeyA",
		"KeyS",
		"KeyD",
		"KeyF",
		"KeyJ",
		"KeyK",
		"KeyL",
		"Semicolon"
	]);
	/** 親指で打つキー */
	const THUMB_CODES = /* @__PURE__ */ new Set([
		"Space",
		"NonConvert",
		"Convert",
		"KanaMode",
		"AltLeft",
		"AltRight",
		"MetaLeft",
		"MetaRight"
	]);
	function finish(id, name, keys) {
		const marked = keys.map((k) => ({
			...k,
			...HOME_CODES.has(k.code) ? { home: true } : {},
			...THUMB_CODES.has(k.code) ? { thumb: true } : {}
		}));
		return {
			id,
			name,
			width: Math.max(...marked.map((k) => k.x + k.w)),
			height: Math.max(...marked.map((k) => k.y + k.h)),
			keys: marked
		};
	}
	const KEYBOARD_PROFILES = [
		finish("jis", "ロウスタッガード（JIS）", JIS_KEYS),
		finish("us", "ロウスタッガード（US）", US_KEYS),
		finish("ortho", "オーソリニア（格子）", ORTHO_KEYS)
	];
	function findProfile(id) {
		return KEYBOARD_PROFILES.find((p) => p.id === id);
	}
	//#endregion
	//#region src/replay/keyboard/hands.ts
	/** 左手・右手の指を **外側から内側** の順に並べる（この順で手のひらの多角形を描く） */
	const LEFT_HAND = [
		"leftPinky",
		"leftRing",
		"leftMiddle",
		"leftIndex",
		"leftThumb"
	];
	const RIGHT_HAND = [
		"rightThumb",
		"rightIndex",
		"rightMiddle",
		"rightRing",
		"rightPinky"
	];
	const LEFT = LEFT_HAND;
	const RIGHT = RIGHT_HAND;
	const ALL_FINGERS = [...LEFT, ...RIGHT];
	/** KeyboardEvent.code → 担当する指（QWERTY 標準運指）。表に無いキーは動かさない */
	const FINGER_OF = {
		Backquote: "leftPinky",
		Escape: "leftPinky",
		Tab: "leftPinky",
		CapsLock: "leftPinky",
		ShiftLeft: "leftPinky",
		ControlLeft: "leftPinky",
		Digit1: "leftPinky",
		KeyQ: "leftPinky",
		KeyA: "leftPinky",
		KeyZ: "leftPinky",
		Digit2: "leftRing",
		KeyW: "leftRing",
		KeyS: "leftRing",
		KeyX: "leftRing",
		Digit3: "leftMiddle",
		KeyE: "leftMiddle",
		KeyD: "leftMiddle",
		KeyC: "leftMiddle",
		Digit4: "leftIndex",
		KeyR: "leftIndex",
		KeyF: "leftIndex",
		KeyV: "leftIndex",
		Digit5: "leftIndex",
		KeyT: "leftIndex",
		KeyG: "leftIndex",
		KeyB: "leftIndex",
		Digit6: "rightIndex",
		KeyY: "rightIndex",
		KeyH: "rightIndex",
		KeyN: "rightIndex",
		Digit7: "rightIndex",
		KeyU: "rightIndex",
		KeyJ: "rightIndex",
		KeyM: "rightIndex",
		Digit8: "rightMiddle",
		KeyI: "rightMiddle",
		KeyK: "rightMiddle",
		Comma: "rightMiddle",
		Digit9: "rightRing",
		KeyO: "rightRing",
		KeyL: "rightRing",
		Period: "rightRing",
		Digit0: "rightPinky",
		KeyP: "rightPinky",
		Semicolon: "rightPinky",
		Slash: "rightPinky",
		Minus: "rightPinky",
		Equal: "rightPinky",
		IntlYen: "rightPinky",
		Backspace: "rightPinky",
		BracketLeft: "rightPinky",
		BracketRight: "rightPinky",
		Backslash: "rightPinky",
		Quote: "rightPinky",
		Enter: "rightPinky",
		IntlRo: "rightPinky",
		ShiftRight: "rightPinky",
		ControlRight: "rightPinky",
		Delete: "rightPinky",
		ArrowLeft: "rightPinky",
		ArrowDown: "rightPinky",
		ArrowUp: "rightPinky",
		ArrowRight: "rightPinky",
		Space: "leftThumb",
		NonConvert: "leftThumb",
		AltLeft: "leftThumb",
		MetaLeft: "leftThumb",
		Convert: "rightThumb",
		KanaMode: "rightThumb",
		AltRight: "rightThumb",
		MetaRight: "rightThumb"
	};
	function fingerFor(code) {
		return FINGER_OF[code];
	}
	/** 待機位置に使うホームキー（プロファイルに無ければ後述のフォールバック） */
	const HOME_KEY = {
		leftPinky: "KeyA",
		leftRing: "KeyS",
		leftMiddle: "KeyD",
		leftIndex: "KeyF",
		leftThumb: "Space",
		rightThumb: "Space",
		rightIndex: "KeyJ",
		rightMiddle: "KeyK",
		rightRing: "KeyL",
		rightPinky: "Semicolon"
	};
	/** 指ごとの待機位置（u 単位）。親指は Space の左右 1/3 に振り分ける */
	function restPositions(profile) {
		const byCode = /* @__PURE__ */ new Map();
		for (const k of profile.keys) if (!byCode.has(k.code)) byCode.set(k.code, k);
		const center = (k) => ({
			x: k.x + k.w / 2,
			y: k.y + k.h / 2
		});
		const out = /* @__PURE__ */ new Map();
		for (const f of ALL_FINGERS) {
			const k = byCode.get(HOME_KEY[f]);
			if (!k) continue;
			if (f === "leftThumb" || f === "rightThumb") {
				const side = f === "leftThumb" ? .33 : .67;
				out.set(f, {
					x: k.x + k.w * side,
					y: k.y + k.h / 2
				});
			} else out.set(f, center(k));
		}
		if (out.size === 0) {
			const mid = {
				x: profile.width / 2,
				y: profile.height - 1
			};
			for (const f of ALL_FINGERS) out.set(f, mid);
		}
		return out;
	}
	/** 押下中のキーから、各指の目標位置を決める（押されていない指はホーム） */
	function targetPositions(profile, pressed, rest) {
		const out = new Map(rest);
		for (const k of profile.keys) {
			if (!pressed.has(k.code)) continue;
			const f = fingerFor(k.code);
			if (!f) continue;
			out.set(f, {
				x: k.x + k.w / 2,
				y: k.y + k.h / 2
			});
		}
		return out;
	}
	/** 4 本指の付け根 = 最下段より 1u 下 */
	const KNUCKLE_DROP = 1;
	/** 親指の付け根 = さらに 1u 下（母指球のぶん手前に来る） */
	const THUMB_KNUCKLE_DROP = 2;
	/** 手首 = 最下段より 3.5u 下 */
	const WRIST_DROP = 3.5;
	/** 手首の内側の端は、親指の付け根より 1u 外（手首は母指球より小指側にある） */
	const WRIST_INNER_OFFSET = 1;
	/**
	* 指の付け根の位置。**ホームキーの真下**に置く（横には寄せない）。
	* 手のひらの幅は 4 本指の間隔とほぼ同じなので、扇形に狭めると逆に手に見えなくなる。
	*/
	function palmAnchors(profile, rest) {
		const out = /* @__PURE__ */ new Map();
		const knuckleY = profile.height + KNUCKLE_DROP;
		const thumbY = profile.height + THUMB_KNUCKLE_DROP;
		for (const f of ALL_FINGERS) {
			const home = rest.get(f);
			if (!home) continue;
			out.set(f, {
				x: home.x,
				y: f.endsWith("Thumb") ? thumbY : knuckleY
			});
		}
		return out;
	}
	/**
	* 手首の横線（手のひらの下辺）。内側の端は親指の付け根より 1u 外、外側の端は小指の位置。
	* 返すのは [内側, 外側] の 2 点。
	*/
	function wristLine(profile, palms, isLeft) {
		const side = isLeft ? LEFT : RIGHT;
		const thumb = palms.get(side.find((f) => f.endsWith("Thumb")));
		const pinky = palms.get(isLeft ? "leftPinky" : "rightPinky");
		if (!thumb || !pinky) return null;
		const y = profile.height + WRIST_DROP;
		return [{
			x: thumb.x + (isLeft ? -1 : WRIST_INNER_OFFSET),
			y
		}, {
			x: pinky.x,
			y
		}];
	}
	/** 指の幅（付け根 / 指先）。親指だけ太い */
	function fingerWidth(f) {
		if (f.endsWith("Thumb")) return {
			base: .72,
			tip: .54
		};
		if (f.endsWith("Pinky")) return {
			base: .46,
			tip: .34
		};
		return {
			base: .55,
			tip: .42
		};
	}
	/**
	* 手のひらの輪郭点（閉じた多角形。呼び出し側が曲線で結ぶ）。
	* 小指の外縁 → 付け根の並び → 母指球 → 手首 の順に回る。
	*/
	function palmOutline(profile, palms, isLeft) {
		const side = isLeft ? LEFT : RIGHT;
		const four = side.filter((f) => !f.endsWith("Thumb"));
		const thumb = palms.get(side.find((f) => f.endsWith("Thumb")));
		const pts = four.map((f) => palms.get(f)).filter((p) => !!p);
		if (pts.length < 4 || !thumb) return [];
		const sign = isLeft ? -1 : 1;
		const pinky = isLeft ? pts[0] : pts[3];
		const index = isLeft ? pts[3] : pts[0];
		const wrist = wristLine(profile, palms, isLeft);
		if (!wrist) return [];
		const [wIn, wOut] = wrist;
		const halfPinky = fingerWidth(isLeft ? "leftPinky" : "rightPinky").base / 2;
		const halfIndex = fingerWidth(isLeft ? "leftIndex" : "rightIndex").base / 2;
		const knuckles = pts.map((p, i) => ({
			x: p.x,
			y: p.y - (i === 0 || i === 3 ? .1 : .2)
		}));
		const ordered = isLeft ? knuckles : [...knuckles].reverse();
		return [
			{
				x: pinky.x + sign * halfPinky,
				y: pinky.y + .15
			},
			...ordered.map((p) => ({
				x: p.x,
				y: p.y
			})),
			{
				x: index.x - sign * halfIndex,
				y: index.y + .3
			},
			{
				x: thumb.x + -sign * .55,
				y: thumb.y - .5
			},
			{
				x: thumb.x + -sign * .35,
				y: thumb.y + .55
			},
			wIn,
			wOut
		];
	}
	//#endregion
	//#region src/replay/keyboard/visualizer.ts
	const NS = "http://www.w3.org/2000/svg";
	/** 1u のピクセル数（viewBox 内の座標。実寸は CSS 側で決まる） */
	const U = 64;
	const GAP = 3;
	const STYLE = `
.rk-kbd { width: 100%; height: auto; display: block; color: inherit; }
.rk-key rect { fill: var(--rk-key-bg, transparent); stroke: currentColor; stroke-opacity: .35; stroke-width: 1.5; }
.rk-key .rk-cap { fill: currentColor; fill-opacity: .55; font-size: 15px; }
.rk-key .rk-sub { fill: currentColor; fill-opacity: .8; font-size: 22px; }
.rk-key .rk-sub-sm { fill: currentColor; fill-opacity: .8; font-size: 14px; }
.rk-key.rk-on rect { fill: var(--rk-key-on, currentColor); fill-opacity: .85; stroke-opacity: .9; }
.rk-key.rk-on .rk-cap, .rk-key.rk-on .rk-sub, .rk-key.rk-on .rk-sub-sm {
  fill: var(--rk-key-on-fg, #fff); fill-opacity: 1;
}
.rk-home { stroke: currentColor; stroke-opacity: .5; stroke-width: 2; }
/* 手のひらと指は 1 枚のパス。重なった部分だけ濃くならないよう、塗りは 1 回だけ乗せる。
   ★輪郭線は引かない —— サブパスごとに線が出るので、指と手のひらの継ぎ目が全部見えて
   「重なった図形の集まり」になってしまう（外側だけに線を引くにはパスのブーリアン演算が要る）*/
.rk-hand { fill: currentColor; fill-opacity: .22; stroke: none; }
.rk-hands.rk-off { display: none; }
`;
	function mountKeyboard(container, opts) {
		const svg = document.createElementNS(NS, "svg");
		svg.setAttribute("class", "rk-kbd");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", "キーボード");
		const style = document.createElementNS(NS, "style");
		style.textContent = STYLE;
		svg.append(style);
		const layer = document.createElementNS(NS, "g");
		svg.append(layer);
		const handLayer = document.createElementNS(NS, "g");
		handLayer.setAttribute("class", "rk-hands");
		svg.append(handLayer);
		container.append(svg);
		let profile = opts.profile;
		let labels = opts.labels ?? null;
		let handsOn = opts.hands ?? false;
		/** code → キーの <g>。同じ code が複数あるとき（Shift 等）は全部保持する */
		let nodes = /* @__PURE__ */ new Map();
		let lastPressed = /* @__PURE__ */ new Set();
		let rest = /* @__PURE__ */ new Map();
		let palms = /* @__PURE__ */ new Map();
		let restLen = /* @__PURE__ */ new Map();
		let current = /* @__PURE__ */ new Map();
		let target = /* @__PURE__ */ new Map();
		let palmEls = [];
		let raf = null;
		function text(x, y, cls, content, anchor = "middle") {
			const t = document.createElementNS(NS, "text");
			t.setAttribute("x", String(x));
			t.setAttribute("y", String(y));
			t.setAttribute("class", cls);
			t.setAttribute("text-anchor", anchor);
			t.setAttribute("dominant-baseline", "middle");
			t.textContent = content;
			return t;
		}
		function draw() {
			layer.textContent = "";
			nodes = /* @__PURE__ */ new Map();
			const top = Math.min(...profile.keys.map((k) => k.y));
			const bottom = profile.height + (handsOn ? 4 : 0);
			svg.setAttribute("viewBox", `0 ${top * U} ${profile.width * U} ${(bottom - top) * U}`);
			for (const k of profile.keys) {
				const g = document.createElementNS(NS, "g");
				g.setAttribute("class", "rk-key");
				const rect = document.createElementNS(NS, "rect");
				rect.setAttribute("x", String(k.x * U + GAP));
				rect.setAttribute("y", String(k.y * U + GAP));
				rect.setAttribute("width", String(k.w * U - GAP * 2));
				rect.setAttribute("height", String(k.h * U - GAP * 2));
				rect.setAttribute("rx", "6");
				g.append(rect);
				const cx = (k.x + k.w / 2) * U;
				const cy = (k.y + k.h / 2) * U;
				const sub = labels?.get(k.code);
				if (sub) {
					g.append(text(cx, cy + 6, sub.length >= 3 ? "rk-sub-sm" : "rk-sub", sub));
					if (k.label) g.append(text(k.x * U + 9, k.y * U + 15, "rk-cap", k.label, "start"));
				} else if (k.label) g.append(text(cx, cy, k.label.length >= 2 ? "rk-cap" : "rk-sub", k.label));
				if (k.home && (k.code === "KeyF" || k.code === "KeyJ")) {
					const bar = document.createElementNS(NS, "line");
					bar.setAttribute("class", "rk-home");
					bar.setAttribute("x1", String(cx - 10));
					bar.setAttribute("x2", String(cx + 10));
					bar.setAttribute("y1", String(k.y * U + k.h * U - 14));
					bar.setAttribute("y2", String(k.y * U + k.h * U - 14));
					g.append(bar);
				}
				layer.append(g);
				const list = nodes.get(k.code);
				if (list) list.push(g);
				else nodes.set(k.code, [g]);
			}
			applyPressed(lastPressed);
			buildHands();
		}
		function applyPressed(pressed) {
			for (const [code, list] of nodes) {
				const on = pressed.has(code);
				for (const g of list) g.classList.toggle("rk-on", on);
			}
		}
		/**
		* サブパスの巻き方向を揃える。
		*
		* ★ `fill-rule: nonzero` は**逆巻きのサブパスを打ち消す**。手のひらと指を 1 本のパスに
		* まとめたとき、左右で点列の回り方が逆になっていたため、片方の手だけ重なりが抜けて
		* XOR のように見えていた。符号付き面積で判定して正の向きへ揃える。
		*/
		function ensureWinding(pts) {
			let a = 0;
			for (let i = 0; i < pts.length; i++) {
				const p = pts[i];
				const q = pts[(i + 1) % pts.length];
				a += p.x * q.y - q.x * p.y;
			}
			return a < 0 ? [...pts].reverse() : pts;
		}
		/** 点列を Catmull-Rom で滑らかに閉じる（手の輪郭はここで曲線になる） */
		function smoothClosed(input) {
			const pts = ensureWinding(input);
			const n = pts.length;
			if (n < 3) return "";
			const px = (v) => (v * U).toFixed(1);
			let d = `M ${px(pts[0].x)} ${px(pts[0].y)}`;
			for (let i = 0; i < n; i++) {
				const p0 = pts[(i - 1 + n) % n];
				const p1 = pts[i];
				const p2 = pts[(i + 1) % n];
				const p3 = pts[(i + 2) % n];
				const c1x = p1.x + (p2.x - p0.x) / 6;
				const c1y = p1.y + (p2.y - p0.y) / 6;
				const c2x = p2.x - (p3.x - p1.x) / 6;
				const c2y = p2.y - (p3.y - p1.y) / 6;
				d += ` C ${px(c1x)} ${px(c1y)} ${px(c2x)} ${px(c2y)} ${px(p2.x)} ${px(p2.y)}`;
			}
			return `${d} Z`;
		}
		/**
		* 指 1 本の輪郭。**付け根から先へ細くなる帯**（中間で少し曲げる）。
		* 俯瞰の手は指がほぼ直線なので、関節を解くより太さの変化のほうが効く。
		*/
		function fingerOutline(base, tip, f, rest) {
			const w = fingerWidth(f);
			const dx = tip.x - base.x;
			const dy = tip.y - base.y;
			const d = Math.hypot(dx, dy) || .001;
			const nx = -dy / d;
			const ny = dx / d;
			const bend = Math.max(0, rest - d) * .25;
			const mid = {
				x: base.x + dx / 2 + nx * bend,
				y: base.y + dy / 2 + ny * bend
			};
			const mw = (w.base + w.tip) / 2;
			const off = (p, half) => ({
				x: p.x + nx * half,
				y: p.y + ny * half
			});
			return smoothClosed([
				off(base, w.base / 2),
				off(mid, mw / 2),
				off(tip, w.tip / 2),
				off(tip, -w.tip / 2),
				off(mid, -mw / 2),
				off(base, -w.base / 2)
			]);
		}
		/**
		* 手 1 つを **1 本のパス**にまとめる（手のひら + 指 5 本のサブパス）。
		* 別々の要素にすると重なった部分だけ濃くなって、指と手のひらの継ぎ目が見えてしまう。
		*/
		function handPath(side, isLeft) {
			const parts = [smoothClosed(palmOutline(profile, palms, isLeft))];
			for (const f of side) {
				const c = current.get(f);
				const p = palms.get(f);
				if (!c || !p) continue;
				parts.push(fingerOutline(p, c, f, restLen.get(f) ?? 2));
			}
			return parts.filter(Boolean).join(" ");
		}
		function buildHands() {
			handLayer.textContent = "";
			palmEls = [];
			rest = restPositions(profile);
			palms = palmAnchors(profile, rest);
			restLen = /* @__PURE__ */ new Map();
			current = /* @__PURE__ */ new Map();
			target = /* @__PURE__ */ new Map();
			for (const f of ALL_FINGERS) {
				const r = rest.get(f);
				const p = palms.get(f);
				if (!r || !p) continue;
				restLen.set(f, Math.hypot(r.x - p.x, r.y - p.y));
				current.set(f, { ...r });
				target.set(f, { ...r });
			}
			for (let i = 0; i < 2; i++) {
				const path = document.createElementNS(NS, "path");
				path.setAttribute("class", "rk-hand");
				handLayer.append(path);
				palmEls.push(path);
			}
			handLayer.classList.toggle("rk-off", !handsOn);
			renderHands();
		}
		function renderHands() {
			if (palmEls.length === 2) {
				palmEls[0].setAttribute("d", handPath(LEFT_HAND, true));
				palmEls[1].setAttribute("d", handPath(RIGHT_HAND, false));
			}
		}
		function animate() {
			let moving = false;
			for (const f of ALL_FINGERS) {
				const c = current.get(f);
				const t = target.get(f);
				const r = rest.get(f);
				if (!c || !t) continue;
				const dx = t.x - c.x;
				const dy = t.y - c.y;
				if (Math.abs(dx) > .002 || Math.abs(dy) > .002) {
					const k = !!r && (Math.abs(t.x - r.x) > 1e-6 || Math.abs(t.y - r.y) > 1e-6) ? .5 : .18;
					c.x += dx * k;
					c.y += dy * k;
					moving = true;
				} else {
					c.x = t.x;
					c.y = t.y;
				}
			}
			renderHands();
			raf = moving && typeof requestAnimationFrame === "function" ? requestAnimationFrame(animate) : null;
		}
		function startAnimation() {
			if (!handsOn || raf !== null || typeof requestAnimationFrame !== "function") {
				renderHands();
				return;
			}
			raf = requestAnimationFrame(animate);
		}
		draw();
		return {
			element: svg,
			update(pressed) {
				lastPressed = pressed;
				applyPressed(pressed);
				target = targetPositions(profile, pressed, rest);
				startAnimation();
			},
			setProfile(p) {
				profile = p;
				draw();
			},
			setLabels(m) {
				labels = m;
				draw();
			},
			setHands(on) {
				handsOn = on;
				draw();
				startAnimation();
			},
			destroy() {
				if (raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
				raf = null;
				svg.remove();
			}
		};
	}
	//#endregion
	exports.ALL_FINGERS = ALL_FINGERS;
	exports.HLOG_FORMAT = HLOG_FORMAT;
	exports.KEYBOARD_PROFILES = KEYBOARD_PROFILES;
	exports.LEFT_HAND = LEFT_HAND;
	exports.RIGHT_HAND = RIGHT_HAND;
	exports.applyEvent = applyEvent;
	exports.assertHlog = assertHlog;
	exports.cloneState = cloneState;
	exports.cpLength = cpLength;
	exports.cpSlice = cpSlice;
	exports.createPlayer = createPlayer;
	exports.createRecorder = createRecorder;
	exports.createState = createState;
	exports.diffText = diffText;
	exports.findProfile = findProfile;
	exports.fingerFor = fingerFor;
	exports.hashDoc = hashDoc;
	exports.isDocEvent = isDocEvent;
	exports.isImeEvent = isImeEvent;
	exports.isInputEvent = isInputEvent;
	exports.mountKeyboard = mountKeyboard;
	exports.replayAll = replayAll;
	exports.verifyLog = verifyLog;
	exports.version = REPLAY_ENGINE_VERSION;
	exports.visibleCandidates = visibleCandidates;
});
