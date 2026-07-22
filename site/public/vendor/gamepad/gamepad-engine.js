(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.GamepadEngine = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/engine/gamepad-kana-table.ts
	/** 10行 x 5段のかなテーブル [row][vowel] */
	const KANA_TABLE = [
		[
			"あ",
			"い",
			"う",
			"え",
			"お"
		],
		[
			"か",
			"き",
			"く",
			"け",
			"こ"
		],
		[
			"さ",
			"し",
			"す",
			"せ",
			"そ"
		],
		[
			"た",
			"ち",
			"つ",
			"て",
			"と"
		],
		[
			"な",
			"に",
			"ぬ",
			"ね",
			"の"
		],
		[
			"は",
			"ひ",
			"ふ",
			"へ",
			"ほ"
		],
		[
			"ま",
			"み",
			"む",
			"め",
			"も"
		],
		[
			"や",
			"「",
			"ゆ",
			"」",
			"よ"
		],
		[
			"ら",
			"り",
			"る",
			"れ",
			"ろ"
		],
		[
			"わ",
			"ゐ",
			"？",
			"ゑ",
			"を"
		]
	];
	/** LT後置シフトマップ: 子音かな→拗音, 母音→小書き */
	const YOUON_POSTSHIFT_MAP = /* @__PURE__ */ new Map([
		["あ", "ぁ"],
		["い", "ぃ"],
		["う", "ぅ"],
		["え", "ぇ"],
		["お", "ぉ"],
		["や", "ゃ"],
		["ゆ", "ゅ"],
		["よ", "ょ"],
		["わ", "ゎ"],
		["か", "きゃ"],
		["く", "きゅ"],
		["こ", "きょ"],
		["さ", "しゃ"],
		["す", "しゅ"],
		["そ", "しょ"],
		["た", "ちゃ"],
		["つ", "ちゅ"],
		["と", "ちょ"],
		["な", "にゃ"],
		["ぬ", "にゅ"],
		["の", "にょ"],
		["は", "ひゃ"],
		["ふ", "ひゅ"],
		["ほ", "ひょ"],
		["ま", "みゃ"],
		["む", "みゅ"],
		["も", "みょ"],
		["ら", "りゃ"],
		["る", "りゅ"],
		["ろ", "りょ"],
		["が", "ぎゃ"],
		["ぐ", "ぎゅ"],
		["ご", "ぎょ"],
		["ざ", "じゃ"],
		["ず", "じゅ"],
		["ぞ", "じょ"],
		["だ", "ぢゃ"],
		["づ", "ぢゅ"],
		["ど", "ぢょ"],
		["ば", "びゃ"],
		["ぶ", "びゅ"],
		["ぼ", "びょ"],
		["ぱ", "ぴゃ"],
		["ぷ", "ぴゅ"],
		["ぽ", "ぴょ"]
	]);
	/** 濁点変換マップ */
	const DAKUTEN_MAP = /* @__PURE__ */ new Map([
		["か", "が"],
		["き", "ぎ"],
		["く", "ぐ"],
		["け", "げ"],
		["こ", "ご"],
		["さ", "ざ"],
		["し", "じ"],
		["す", "ず"],
		["せ", "ぜ"],
		["そ", "ぞ"],
		["た", "だ"],
		["ち", "ぢ"],
		["つ", "づ"],
		["て", "で"],
		["と", "ど"],
		["は", "ば"],
		["ひ", "び"],
		["ふ", "ぶ"],
		["へ", "べ"],
		["ほ", "ぼ"],
		["う", "ゔ"]
	]);
	/** 半濁点変換マップ */
	const HANDAKUTEN_MAP = /* @__PURE__ */ new Map([
		["は", "ぱ"],
		["ひ", "ぴ"],
		["ふ", "ぷ"],
		["へ", "ぺ"],
		["ほ", "ぽ"]
	]);
	/** 濁点逆引き（濁音→清音） */
	const DAKUTEN_REVERSE = new Map([...DAKUTEN_MAP.entries()].map(([k, v]) => [v, k]));
	/** 半濁点逆引き（半濁音→清音） */
	const HANDAKUTEN_REVERSE = new Map([...HANDAKUTEN_MAP.entries()].map(([k, v]) => [v, k]));
	/** ボタン押下状態から子音行インデックスを解決（フリック配列準拠） */
	function resolveConsonantRow(buttons) {
		const lb = isPressed(buttons, 4);
		const dUp = isPressed(buttons, 12);
		const dRight = isPressed(buttons, 15);
		const dDown = isPressed(buttons, 13);
		const dLeft = isPressed(buttons, 14);
		if (lb && dLeft) return 6;
		if (lb && dUp) return 7;
		if (lb && dRight) return 8;
		if (lb && dDown) return 9;
		if (lb) return 5;
		if (dLeft) return 1;
		if (dUp) return 2;
		if (dRight) return 3;
		if (dDown) return 4;
		return 0;
	}
	/** ボタン押下状態から母音インデックスを解決 (null = 母音未選択) */
	function resolveVowelIndex(buttons) {
		const rb = isPressed(buttons, 5);
		const x = isPressed(buttons, 2);
		const y = isPressed(buttons, 3);
		const b = isPressed(buttons, 1);
		const a = isPressed(buttons, 0);
		if (rb) return 0;
		if (x) return 1;
		if (y) return 2;
		if (b) return 3;
		if (a) return 4;
		return null;
	}
	/** 母音ボタン（RB + フェイスボタン4つ）のいずれかが押されているか */
	function isVowelButtonPressed(buttons) {
		return isPressed(buttons, 5) || isPressed(buttons, 3) || isPressed(buttons, 1) || isPressed(buttons, 0) || isPressed(buttons, 2);
	}
	/** ボタン押下判定（アナログトリガー対応、閾値 0.5） */
	function isPressed(buttons, index) {
		const btn = buttons[index];
		if (!btn) return false;
		return btn.pressed || btn.value > .5;
	}
	/** 行名（ガイド表示用） */
	const ROW_NAMES = [
		"あ行",
		"か行",
		"さ行",
		"た行",
		"な行",
		"は行",
		"ま行",
		"や行",
		"ら行",
		"わ行"
	];
	/** D-pad ラベル（レイヤー別、行名表記） */
	const DPAD_LABELS = {
		base: {
			center: "あ行",
			left: "か行",
			up: "さ行",
			right: "た行",
			down: "な行"
		},
		lb: {
			center: "は行",
			left: "ま行",
			up: "や行",
			right: "ら行",
			down: "わ行"
		}
	};
	//#endregion
	//#region src/gamepad/machine.ts
	/** eager output を巻き戻せる同時打鍵の窓（ms） */
	const CHORD_WINDOW_MS = 300;
	/** 初期状態を生成する。 */
	function createMachineState() {
		return {
			prevVowelPressed: false,
			prevRow: 0,
			prevVowelIndex: null,
			prevConsonantCount: 0,
			prevLT: false,
			prevRT: false,
			eagerChar: null,
			eagerCharLen: 0,
			eagerTime: 0,
			rtUsed: false,
			rtDuringLT: false
		};
	}
	/** フレーム末尾の prev 更新（試打サイトのフックと同じ順序）。 */
	function syncPrev(f, s) {
		s.prevConsonantCount = f.consonantCount;
		s.prevVowelPressed = f.vowelNow;
		s.prevRow = f.row;
		s.prevVowelIndex = f.vowel;
		s.prevLT = f.ltNow;
		s.prevRT = f.rtNow;
	}
	/** 日本語: かな入力（eager output + rollback）。 */
	function stepJapanese(f, s) {
		const actions = [];
		const v = f.vowel ?? 0;
		if (f.vowelNow) {
			const char = KANA_TABLE[f.row]?.[v] ?? null;
			if (char) {
				const charLen = 1;
				const rowChanged = f.row !== s.prevRow;
				const vowelChanged = f.vowel !== s.prevVowelIndex;
				if (!s.prevVowelPressed) {
					actions.push({
						type: "kana",
						char
					});
					s.eagerChar = char;
					s.eagerCharLen = charLen;
					s.eagerTime = f.now;
				} else if (rowChanged || vowelChanged) {
					if (!(rowChanged && f.consonantCount < s.prevConsonantCount)) {
						if (s.eagerChar && f.now - s.eagerTime < 300) actions.push({
							type: "kana",
							char,
							replace: s.eagerCharLen
						});
						else actions.push({
							type: "kana",
							char
						});
						s.eagerChar = char;
						s.eagerCharLen = charLen;
						s.eagerTime = f.now;
					}
				}
			}
		}
		if (s.prevVowelPressed && !f.vowelNow) s.eagerChar = null;
		if (f.ltNow && !s.prevLT) s.rtDuringLT = false;
		if (f.ltNow && f.rtNow) {
			s.rtDuringLT = true;
			s.rtUsed = true;
		}
		if (!f.ltNow && s.prevLT) {
			if (s.rtDuringLT) actions.push({
				type: "kana",
				char: "っ"
			});
			else actions.push({ type: "youon" });
			s.rtDuringLT = false;
		}
		if (f.rtNow && !s.prevRT) s.rtUsed = false;
		if (!f.rtNow && s.prevRT) {
			if (!s.rtUsed && !f.ltNow && !s.prevLT) actions.push({
				type: "kana",
				char: "ん"
			});
			s.rtUsed = false;
		}
		return actions;
	}
	//#endregion
	//#region src/gamepad/ops.ts
	/** キー名から feed 用の KeyTap を作る（Space だけ key と code が異なる）。 */
	function keyTap(name, mods) {
		const base = name === "Space" ? {
			key: " ",
			code: "Space"
		} : {
			key: name,
			code: name
		};
		if (mods?.shift) base.shiftKey = true;
		if (mods?.ctrl) base.ctrlKey = true;
		return base;
	}
	function key(name) {
		return {
			type: "key",
			tap: keyTap(name)
		};
	}
	/**
	* 合成末尾に拗音後置シフトを適用した置換 op を返す。
	* 対象（YOUON_POSTSHIFT_MAP にある字）→ 末尾 1 字を拗音/小書きに差し替え。
	* 対象外 → 「っ」を追加。空 → null（無反応）。試打サイト InputEngine.applyYouon と同一。
	*/
	function resolveYouonOp(tail) {
		const chars = [...tail];
		if (chars.length === 0) return null;
		const last = chars[chars.length - 1];
		const replaced = YOUON_POSTSHIFT_MAP.get(last);
		if (replaced) return {
			type: "kana",
			text: replaced,
			replace: 1
		};
		return {
			type: "kana",
			text: "っ",
			replace: 0
		};
	}
	/**
	* 合成末尾の濁点/半濁点/清音をトグルした置換 op を返す。
	* か→が→か、は→ば→ぱ→は。空・非対象 → null。試打サイト InputEngine.applyToggleDakuten と同一。
	*/
	function resolveDakutenOp(tail) {
		const chars = [...tail];
		if (chars.length === 0) return null;
		const last = chars[chars.length - 1];
		const seionFromHandakuten = HANDAKUTEN_REVERSE.get(last);
		if (seionFromHandakuten) return {
			type: "kana",
			text: seionFromHandakuten,
			replace: 1
		};
		const seionFromDakuten = DAKUTEN_REVERSE.get(last);
		if (seionFromDakuten) return {
			type: "kana",
			text: HANDAKUTEN_MAP.get(seionFromDakuten) ?? seionFromDakuten,
			replace: 1
		};
		const dakuten = DAKUTEN_MAP.get(last);
		if (dakuten) return {
			type: "kana",
			text: dakuten,
			replace: 1
		};
		return null;
	}
	/** 抽象アクション 1 個を GamepadOp 列へ写像する（無反応は空配列）。 */
	function translateAction(action, host) {
		switch (action.type) {
			case "kana": return [{
				type: "kana",
				text: action.char,
				replace: action.replace ?? 0
			}];
			case "youon": {
				const op = resolveYouonOp(host.getComposingTail());
				return op ? [op] : [];
			}
			case "toggleDakuten": {
				const op = resolveDakutenOp(host.getComposingTail());
				return op ? [op] : [];
			}
			case "space": return [{
				type: "kana",
				text: " ",
				replace: 0
			}];
			case "deleteBack": return [key("Backspace")];
			case "cancel": return [key("Escape")];
			case "confirmOrNewline": return [key("Enter")];
			case "navKey": return [{
				type: "key",
				tap: keyTap(action.key, { shift: action.shift })
			}];
			case "undoCommit": return [{
				type: "key",
				tap: keyTap("Backspace", { ctrl: true })
			}];
		}
	}
	//#endregion
	//#region src/gamepad/engine.ts
	function createResolver(host) {
		let state = createMachineState();
		return {
			stepFrame(f) {
				const ops = stepJapanese(f, state).flatMap((a) => translateAction(a, host));
				syncPrev(f, state);
				return ops;
			},
			action(a) {
				return translateAction(a, host);
			},
			syncPrev(f) {
				syncPrev(f, state);
			},
			consumeRt() {
				state.rtUsed = true;
			},
			reset() {
				state = createMachineState();
			}
		};
	}
	/** 句読点ダブルタップ窓（右スティック下: 1回=、 2回=。 3回=空白+確定）。 */
	const PUNCTUATION_DOUBLE_TAP_MS = 400;
	/** 左スティック軸インデックス（W3C Standard Gamepad）。右スティックは gamepad-kana-table 側。 */
	const AXIS_LSTICK_X = 0;
	const AXIS_LSTICK_Y = 1;
	/**
	* Gamepad API の polling を開始する。ブラウザ環境専用（window / navigator / rAF を使う）。
	*/
	function start(opts) {
		let enabled = opts.enabled ?? true;
		let stopped = false;
		let rafId = 0;
		let connected = false;
		let gamepadName = null;
		const resolver = createResolver({ getComposingTail: opts.getComposingTail });
		let prevLS = false;
		let prevRS = false;
		let prevStart = false;
		let prevRStickRight = false;
		let prevRStickUp = false;
		let prevRStickLeft = false;
		let prevRStickDown = false;
		let prevLStickRight = false;
		let prevLStickUp = false;
		let prevLStickLeft = false;
		let prevLStickDown = false;
		let lastPunctTime = 0;
		let punctTapCount = 0;
		let punctTimerId = null;
		const emit = (a) => {
			for (const op of resolver.action(a)) opts.onOp(op);
		};
		const clearPunctTimer = () => {
			if (punctTimerId !== null) {
				clearTimeout(punctTimerId);
				punctTimerId = null;
			}
		};
		const onConnect = (e) => {
			connected = true;
			gamepadName = e.gamepad.id;
		};
		const onDisconnect = () => {
			connected = false;
			gamepadName = null;
		};
		window.addEventListener("gamepadconnected", onConnect);
		window.addEventListener("gamepaddisconnected", onDisconnect);
		const initialPads = navigator.getGamepads?.();
		if (initialPads) {
			for (const p of initialPads) if (p) {
				connected = true;
				gamepadName = p.id;
				break;
			}
		}
		const poll = () => {
			if (stopped) return;
			rafId = requestAnimationFrame(poll);
			const pads = navigator.getGamepads?.();
			const gp = pads ? pads[0] : null;
			if (!gp) {
				opts.onState?.({
					connected: false,
					gamepadName: null,
					activeRow: 0,
					activeLayer: "base",
					previewChar: null,
					pressed: /* @__PURE__ */ new Set(),
					axes: [
						0,
						0,
						0,
						0
					]
				});
				return;
			}
			connected = true;
			if (!gamepadName) gamepadName = gp.id;
			const buttons = gp.buttons;
			const axes = gp.axes;
			const now = performance.now();
			const vowelNow = isVowelButtonPressed(buttons);
			const ltNow = isPressed(buttons, 6);
			const rtNow = isPressed(buttons, 7);
			const lsNow = isPressed(buttons, 10);
			const rsNow = isPressed(buttons, 11);
			const lbNow = isPressed(buttons, 4);
			const startNow = isPressed(buttons, 9);
			const row = resolveConsonantRow(buttons);
			const vowel = resolveVowelIndex(buttons);
			const v = vowel ?? 0;
			const previewChar = vowelNow ? KANA_TABLE[row]?.[v] ?? null : null;
			const pressed = /* @__PURE__ */ new Set();
			for (let i = 0; i < buttons.length; i++) if (isPressed(buttons, i)) pressed.add(i);
			opts.onState?.({
				connected: true,
				gamepadName,
				activeRow: row,
				activeLayer: lbNow ? "lb" : "base",
				previewChar,
				pressed,
				axes: [...axes]
			});
			const frame = {
				now,
				row,
				vowel,
				vowelNow,
				ltNow,
				rtNow,
				consonantCount: [
					14,
					12,
					15,
					13,
					4
				].filter((b) => isPressed(buttons, b)).length
			};
			if (!enabled) {
				resolver.syncPrev(frame);
				prevLS = lsNow;
				prevRS = rsNow;
				prevStart = startNow;
				prevRStickRight = false;
				prevRStickUp = false;
				prevRStickLeft = false;
				prevRStickDown = false;
				prevLStickRight = false;
				prevLStickUp = false;
				prevLStickLeft = false;
				prevLStickDown = false;
				return;
			}
			for (const op of resolver.stepFrame(frame)) opts.onOp(op);
			const rsX = axes[2] ?? 0;
			const rsY = axes[3] ?? 0;
			const absX = Math.abs(rsX);
			const absY = Math.abs(rsY);
			const dominant = Math.max(absX, absY) > .5 ? absX > absY ? "x" : "y" : null;
			const rStickRight = dominant === "x" && rsX > 0;
			const rStickLeft = dominant === "x" && rsX < 0;
			const rStickUp = dominant === "y" && rsY < 0;
			const rStickDown = dominant === "y" && rsY > 0;
			if (rStickRight && !prevRStickRight) emit({
				type: "kana",
				char: "ー"
			});
			if (rStickUp && !prevRStickUp) emit({ type: "toggleDakuten" });
			if (rStickLeft && !prevRStickLeft) emit({ type: "deleteBack" });
			if (rStickDown && !prevRStickDown) {
				const withinWindow = now - lastPunctTime < PUNCTUATION_DOUBLE_TAP_MS;
				clearPunctTimer();
				punctTapCount = withinWindow ? punctTapCount + 1 : 1;
				const tapCount = punctTapCount;
				if (tapCount === 1) emit({
					type: "kana",
					char: "、"
				});
				else if (tapCount === 2) emit({
					type: "kana",
					char: "。",
					replace: 1
				});
				else {
					emit({
						type: "kana",
						char: "　",
						replace: 1
					});
					emit({ type: "confirmOrNewline" });
					punctTapCount = 0;
					lastPunctTime = 0;
				}
				if (tapCount < 3) {
					lastPunctTime = now;
					punctTimerId = setTimeout(() => {
						punctTimerId = null;
						punctTapCount = 0;
						if (!stopped && enabled) emit({ type: "confirmOrNewline" });
					}, PUNCTUATION_DOUBLE_TAP_MS);
				}
			}
			prevRStickRight = rStickRight;
			prevRStickUp = rStickUp;
			prevRStickLeft = rStickLeft;
			prevRStickDown = rStickDown;
			const lsX = axes[AXIS_LSTICK_X] ?? 0;
			const lsY = axes[AXIS_LSTICK_Y] ?? 0;
			const lAbsX = Math.abs(lsX);
			const lAbsY = Math.abs(lsY);
			const lDominant = Math.max(lAbsX, lAbsY) > .5 ? lAbsX > lAbsY ? "x" : "y" : null;
			const lStickRight = lDominant === "x" && lsX > 0;
			const lStickLeft = lDominant === "x" && lsX < 0;
			const lStickUp = lDominant === "y" && lsY < 0;
			const lStickDown = lDominant === "y" && lsY > 0;
			if (lStickDown && !prevLStickDown) emit({
				type: "navKey",
				key: "Space"
			});
			if (lStickUp && !prevLStickUp) emit({
				type: "navKey",
				key: "ArrowUp"
			});
			if (lStickLeft && !prevLStickLeft) if (rtNow) {
				emit({
					type: "navKey",
					key: "ArrowLeft",
					shift: true
				});
				resolver.consumeRt();
			} else emit({
				type: "navKey",
				key: "ArrowLeft"
			});
			if (lStickRight && !prevLStickRight) if (rtNow) {
				emit({
					type: "navKey",
					key: "ArrowRight",
					shift: true
				});
				resolver.consumeRt();
			} else emit({
				type: "navKey",
				key: "ArrowRight"
			});
			prevLStickRight = lStickRight;
			prevLStickUp = lStickUp;
			prevLStickLeft = lStickLeft;
			prevLStickDown = lStickDown;
			if (prevLS && !lsNow) emit({ type: "confirmOrNewline" });
			if (prevRS && !rsNow) emit({ type: "cancel" });
			if (prevStart && !startNow) emit({ type: "undoCommit" });
			prevLS = lsNow;
			prevRS = rsNow;
			prevStart = startNow;
		};
		rafId = requestAnimationFrame(poll);
		return {
			setEnabled(on) {
				enabled = on;
			},
			stop() {
				stopped = true;
				cancelAnimationFrame(rafId);
				clearPunctTimer();
				window.removeEventListener("gamepadconnected", onConnect);
				window.removeEventListener("gamepaddisconnected", onDisconnect);
			},
			get connected() {
				return connected;
			}
		};
	}
	//#endregion
	//#region src/gamepad/visualizer.ts
	const STYLE_ID = "gamepad-engine-style";
	const CSS = `
.ge-root{--ge-accent:#007aff;--ge-panel-bg:#f5f5f7;--ge-key-bg:#fff;--ge-key-fg:#1d1d1f;
  --ge-muted:#86868b;--ge-dim:#c7c7cc;--ge-badge-bg:rgba(0,122,255,.15);--ge-badge-fg:#007aff;
  font-family:inherit;color:var(--ge-key-fg);}
.ge-badge-row{display:flex;justify-content:center;margin-bottom:12px;}
.ge-badge{border-radius:999px;padding:2px 12px;font-size:10px;font-weight:600;
  background:var(--ge-badge-bg);color:var(--ge-badge-fg);}
.ge-figure{position:relative;margin:0 auto;display:flex;max-width:640px;align-items:center;
  justify-content:space-between;gap:16px;border-radius:16px;background:var(--ge-panel-bg);padding:24px;}
.ge-col{display:flex;flex-direction:column;align-items:center;gap:12px;}
.ge-shoulders{display:flex;gap:8px;}
.ge-shoulder{display:flex;min-width:48px;height:40px;flex-direction:column;align-items:center;
  justify-content:center;border-radius:8px;padding:0 8px;background:var(--ge-key-bg);
  box-shadow:0 1px 2px rgba(0,0,0,.06);}
.ge-shoulder .ge-c{font-size:14px;font-weight:700;line-height:1.1;}
.ge-shoulder .ge-n{font-size:9px;line-height:1.1;color:var(--ge-muted);}
.ge-grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;}
.ge-dpad{width:44px;height:44px;display:flex;align-items:center;justify-content:center;
  border-radius:8px;font-size:12px;font-weight:700;background:rgba(255,255,255,.7);
  color:var(--ge-muted);box-shadow:0 1px 2px rgba(0,0,0,.05);}
.ge-dpad.ge-center{background:#e8e8ed;color:var(--ge-dim);}
.ge-face{width:40px;height:40px;display:flex;align-items:center;justify-content:center;
  border-radius:999px;font-size:14px;font-weight:700;background:var(--ge-key-bg);
  color:var(--ge-key-fg);box-shadow:0 1px 2px rgba(0,0,0,.06);}
.ge-face.ge-center,.ge-stick.ge-center{background:transparent;box-shadow:none;font-size:10px;color:var(--ge-dim);}
.ge-stick{width:40px;height:40px;display:flex;align-items:center;justify-content:center;
  border-radius:999px;font-size:12px;font-weight:700;color:var(--ge-muted);}
.ge-preview{display:flex;width:64px;flex-shrink:0;flex-direction:column;align-items:center;gap:4px;}
.ge-preview .ge-row{font-size:10px;color:var(--ge-muted);}
.ge-preview .ge-char{font-size:44px;font-weight:800;color:var(--ge-dim);line-height:1;}
.ge-preview .ge-char.ge-on{color:var(--ge-accent);}
.ge-lb-badge{margin-top:4px;border-radius:999px;background:#ff9500;padding:1px 10px;
  font-size:10px;font-weight:600;color:#fff;visibility:hidden;}
.ge-lb-badge.ge-on{visibility:visible;}
.ge-empty{width:44px;height:44px;}
.ge-is-pressed{background:var(--ge-accent)!important;color:#fff!important;}
.ge-stick.ge-is-pressed{color:#fff!important;}
.ge-name{margin-top:8px;text-align:center;font-size:10px;color:var(--ge-dim);}
.ge-guide{margin-top:12px;display:flex;flex-wrap:wrap;justify-content:center;gap:2px 16px;
  font-size:10px;color:var(--ge-muted);}
`;
	function ensureStyle() {
		if (typeof document === "undefined") return;
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = CSS;
		document.head.appendChild(style);
	}
	function el(tag, className, text) {
		const e = document.createElement(tag);
		if (className) e.className = className;
		if (text != null) e.textContent = text;
		return e;
	}
	/** ゲームパッドビジュアライザを container 内に生成する（日本語モード）。 */
	function mount(container) {
		ensureStyle();
		container.innerHTML = "";
		const root = el("div", "ge-root");
		const badgeRow = el("div", "ge-badge-row");
		badgeRow.appendChild(el("span", "ge-badge", "日本語"));
		root.appendChild(badgeRow);
		const figure = el("div", "ge-figure");
		const pressedEls = [];
		const track = (index, node) => {
			pressedEls.push({
				index,
				node
			});
			return node;
		};
		const left = el("div", "ge-col");
		const leftShoulders = el("div", "ge-shoulders");
		const ltBtn = track(6, buildShoulder("拗音", "LT"));
		const lbBtn = track(4, buildShoulder("は〜", "LB"));
		leftShoulders.append(ltBtn, lbBtn);
		const lbLabel = lbBtn.querySelector(".ge-c");
		const dpad = el("div", "ge-grid");
		const dUp = track(12, el("div", "ge-dpad", ""));
		const dLeft = track(14, el("div", "ge-dpad", ""));
		const dCenter = el("div", "ge-dpad ge-center", "");
		const dRight = track(15, el("div", "ge-dpad", ""));
		const dDown = track(13, el("div", "ge-dpad", ""));
		dpad.append(el("div", "ge-empty"), dUp, el("div", "ge-empty"), dLeft, dCenter, dRight, el("div", "ge-empty"), dDown, el("div", "ge-empty"));
		left.append(leftShoulders, dpad);
		const center = el("div", "ge-preview");
		const rowNameEl = el("span", "ge-row", "あ行");
		const previewEl = el("span", "ge-char", "　");
		const lbBadge = el("span", "ge-lb-badge", "LB");
		center.append(rowNameEl, previewEl, lbBadge);
		const right = el("div", "ge-col");
		const rightShoulders = el("div", "ge-shoulders");
		const rbBtn = track(5, buildShoulder("あ", "RB"));
		const rtBtn = track(7, buildShoulder("ん", "RT"));
		rightShoulders.append(rbBtn, rtBtn);
		const rbLabel = rbBtn.querySelector(".ge-c");
		const face = el("div", "ge-grid");
		const fUp = track(3, el("div", "ge-face", "う"));
		const fLeft = track(2, el("div", "ge-face", "い"));
		const fRight = track(1, el("div", "ge-face", "え"));
		const fDown = track(0, el("div", "ge-face", "お"));
		face.append(el("div", "ge-empty"), fUp, el("div", "ge-empty"), fLeft, el("div", "ge-face ge-center", "母音"), fRight, el("div", "ge-empty"), fDown, el("div", "ge-empty"));
		right.append(rightShoulders, face);
		const stickCol = el("div", "ge-col");
		const stick = el("div", "ge-grid");
		const sUp = el("div", "ge-stick", "゛゜");
		const sLeft = el("div", "ge-stick", "BS");
		const sCenter = track(11, el("div", "ge-stick", "取消"));
		const sRight = el("div", "ge-stick", "ー");
		const sDown = el("div", "ge-stick", "、。");
		stick.append(el("div", "ge-empty"), sUp, el("div", "ge-empty"), sLeft, sCenter, sRight, el("div", "ge-empty"), sDown, el("div", "ge-empty"));
		stickCol.append(stick);
		figure.append(left, center, right, stickCol);
		root.appendChild(figure);
		const nameEl = el("p", "ge-name", "");
		root.appendChild(nameEl);
		const guide = el("div", "ge-guide");
		for (const g of [
			"LT 拗音/っ",
			"LT+RT っ",
			"RT ん",
			"R🕹↓ 、→。→空白",
			"L🕹↓ 変換/次候補",
			"L🕹↑ 前候補",
			"L🕹←→ 文節移動",
			"RT+L🕹←→ 伸縮",
			"Start 戻す"
		]) guide.appendChild(el("span", void 0, g));
		root.appendChild(guide);
		container.appendChild(root);
		const setPressed = (node, on) => {
			node.classList.toggle("ge-is-pressed", on);
		};
		return {
			update(state) {
				for (const { index, node } of pressedEls) setPressed(node, state.pressed.has(index));
				const rawRow = KANA_TABLE[state.activeRow] ?? KANA_TABLE[0];
				rbLabel.textContent = rawRow[0];
				fLeft.textContent = rawRow[1];
				fUp.textContent = rawRow[2];
				fRight.textContent = rawRow[3];
				fDown.textContent = rawRow[4];
				const dpadLabels = DPAD_LABELS[state.activeLayer];
				dUp.textContent = dpadLabels.up;
				dLeft.textContent = dpadLabels.left;
				dCenter.textContent = dpadLabels.center;
				dRight.textContent = dpadLabels.right;
				dDown.textContent = dpadLabels.down;
				lbLabel.textContent = state.activeLayer === "lb" ? "●" : "は〜";
				rowNameEl.textContent = ROW_NAMES[state.activeRow] ?? "";
				previewEl.textContent = state.previewChar ?? "　";
				previewEl.classList.toggle("ge-on", state.previewChar != null);
				lbBadge.classList.toggle("ge-on", state.activeLayer === "lb");
				if (state.gamepadName) nameEl.textContent = state.gamepadName.length > 50 ? state.gamepadName.slice(0, 50) + "…" : state.gamepadName;
				else nameEl.textContent = "";
				const rsX = state.axes[2] ?? 0;
				const rsY = state.axes[3] ?? 0;
				const absX = Math.abs(rsX);
				const absY = Math.abs(rsY);
				const dominant = Math.max(absX, absY) > .5 ? absX > absY ? "x" : "y" : null;
				sRight.classList.toggle("ge-is-pressed", dominant === "x" && rsX > 0);
				sLeft.classList.toggle("ge-is-pressed", dominant === "x" && rsX < 0);
				sUp.classList.toggle("ge-is-pressed", dominant === "y" && rsY < 0);
				sDown.classList.toggle("ge-is-pressed", dominant === "y" && rsY > 0);
			},
			destroy() {
				root.remove();
			}
		};
	}
	function buildShoulder(char, name) {
		const wrap = el("div", "ge-shoulder");
		wrap.append(el("span", "ge-c", char), el("span", "ge-n", name));
		return wrap;
	}
	//#endregion
	//#region src/gamepad/version.ts
	const GAMEPAD_ENGINE_VERSION = "1.2.0";
	//#endregion
	exports.CHORD_WINDOW_MS = CHORD_WINDOW_MS;
	exports.createMachineState = createMachineState;
	exports.createResolver = createResolver;
	exports.mount = mount;
	exports.resolveDakutenOp = resolveDakutenOp;
	exports.resolveYouonOp = resolveYouonOp;
	exports.start = start;
	exports.stepJapanese = stepJapanese;
	exports.translateAction = translateAction;
	exports.version = GAMEPAD_ENGINE_VERSION;
});
