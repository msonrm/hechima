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
	const REPLAY_ENGINE_VERSION = "0.3.0";
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
		/** 現在位置から「次の keydown の直前」まで前進する */
		function advanceOverOneKey() {
			if (index >= events.length) return;
			do {
				applyOne(events[index], true);
				time = events[index].t;
				index++;
			} while (index < events.length && events[index].k !== "down");
		}
		function tick(deltaMs) {
			if (deltaMs <= 0) return;
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
	exports.HLOG_FORMAT = HLOG_FORMAT;
	exports.applyEvent = applyEvent;
	exports.assertHlog = assertHlog;
	exports.cloneState = cloneState;
	exports.cpLength = cpLength;
	exports.cpSlice = cpSlice;
	exports.createPlayer = createPlayer;
	exports.createRecorder = createRecorder;
	exports.createState = createState;
	exports.diffText = diffText;
	exports.hashDoc = hashDoc;
	exports.isDocEvent = isDocEvent;
	exports.isImeEvent = isImeEvent;
	exports.isInputEvent = isInputEvent;
	exports.replayAll = replayAll;
	exports.verifyLog = verifyLog;
	exports.version = REPLAY_ENGINE_VERSION;
	exports.visibleCandidates = visibleCandidates;
});
