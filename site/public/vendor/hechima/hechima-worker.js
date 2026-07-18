(function() {
	//#region src/hechima/version.ts
	const HECHIMA_VERSION = "0.7.0";
	//#endregion
	//#region src/hechima/worker-main.ts
	let M = null;
	let initStarted = false;
	let lastYomi = null;
	let lastKeys = null;
	function rememberSegments(segments) {
		if (segments && segments.length) {
			lastKeys = segments.map((s) => s.key);
			lastYomi = lastKeys.join("");
		}
	}
	/** 辞書を fetch（進捗を電文で流す）。SPA フォールバックの HTML 混入も検出する */
	async function fetchDictionary(dataUrl) {
		const res = await fetch(new URL(dataUrl, self.location.href).href);
		if (!res.ok) throw new Error(`辞書の取得に失敗 (HTTP ${res.status}: ${dataUrl})`);
		const total = Number(res.headers.get("content-length")) || 0;
		let buf;
		if (res.body && res.body.getReader) {
			const reader = res.body.getReader();
			const parts = [];
			let n = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				parts.push(value);
				n += value.length;
				self.postMessage({
					type: "progress",
					loaded: n,
					total
				});
			}
			buf = new Uint8Array(n);
			let o = 0;
			for (const p of parts) {
				buf.set(p, o);
				o += p.length;
			}
		} else buf = new Uint8Array(await res.arrayBuffer());
		if (!buf.length || buf[0] === 60) throw new Error("mozc.data が不正（未配備で HTML が返った可能性）");
		return buf;
	}
	/**
	* ホストのタイムゾーンを cctz の固定オフセットゾーン名（Fixed/UTC±hh:mm:ss）で返す。
	* wasm には zoneinfo が無く TZ 未設定だと absl/cctz が UTC に落ち、「いま」「きょう」の
	* 日時候補が 9 時間ずれる（JST）。この特殊名は zoneinfo 不在でも cctz が合成する。
	* DST は起動時オフセット固定（日本は DST なし。セッション跨ぎの切替だけ追従しない — 許容）。
	*/
	function fixedOffsetTzName() {
		const offMin = -(/* @__PURE__ */ new Date()).getTimezoneOffset();
		const sign = offMin >= 0 ? "+" : "-";
		const abs = Math.abs(offMin);
		return `Fixed/UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}:00`;
	}
	async function init(wasmJs, dataUrl) {
		importScripts(wasmJs);
		const factory = self.HechimaModule;
		if (typeof factory !== "function") throw new Error(`HechimaModule が見つからない（${wasmJs} は hechima-wasm.js か？）`);
		const buf = await fetchDictionary(dataUrl);
		const wasmJsAbs = new URL(wasmJs, self.location.href).href;
		const tzName = fixedOffsetTzName();
		const cfg = {
			mainScriptUrlOrBlob: wasmJsAbs,
			locateFile: (p) => new URL(p, wasmJsAbs).href
		};
		cfg.preRun = [() => {
			cfg.ENV.TZ = tzName;
		}];
		M = await factory(cfg);
		M.FS.writeFile("/mozc.data", buf);
		const r = M.ccall("hechima_init", "number", ["string"], ["/mozc.data"]);
		if (r !== 0) throw new Error(`hechima_init failed (r=${r})`);
	}
	/** convert / resize 共通の戻りパース: "" やパース失敗・空 segments は null */
	function parseSegments(json) {
		try {
			const parsed = JSON.parse(String(json));
			if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) return parsed.segments;
		} catch {}
		return null;
	}
	function handleConvert(id, kana, maxCands) {
		if (!M) {
			self.postMessage({
				type: "result",
				id,
				segments: null,
				error: "未初期化（init が先）"
			});
			return;
		}
		try {
			const segments = parseSegments(M.ccall("hechima_convert", "string", ["string", "number"], [kana, maxCands | 0]));
			rememberSegments(segments);
			self.postMessage({
				type: "result",
				id,
				segments
			});
		} catch (e) {
			self.postMessage({
				type: "result",
				id,
				segments: null,
				error: String(e?.message ?? e)
			});
		}
	}
	/**
	* 文節伸縮。hechima-wasm v0.3.0+ では hechima_convert2（ステートレス）を使い、
	* 「segIdx 文節を offset だけ伸縮」を「先頭からの文節よみ文字数の制約列」に翻訳して再変換する
	* （制約は伸縮した文節まで。以降は Mozc の自由分節 = 実 IME と同じ挙動）。
	* 旧 wasm（v0.2.0）では従来の hechima_resize（wasm 内 static 状態）にフォールバックする。
	*/
	function handleResize(id, segIdx, offset, maxCands) {
		if (!M) {
			self.postMessage({
				type: "result",
				id,
				segments: null,
				error: "未初期化（init が先）"
			});
			return;
		}
		try {
			if (typeof M._hechima_convert2 === "function" && lastYomi && lastKeys) {
				if (segIdx < 0 || segIdx >= lastKeys.length) {
					self.postMessage({
						type: "result",
						id,
						segments: null,
						error: "segIdx 範囲外"
					});
					return;
				}
				const lens = lastKeys.map((k) => Array.from(k).length);
				const target = lens[segIdx] + offset;
				if (target < 1 || target > 255) {
					self.postMessage({
						type: "result",
						id,
						segments: null
					});
					return;
				}
				const sizes = [...lens.slice(0, segIdx), target];
				const segments = parseSegments(M.ccall("hechima_convert2", "string", [
					"string",
					"string",
					"number"
				], [
					lastYomi,
					sizes.join(","),
					maxCands | 0
				]));
				rememberSegments(segments);
				self.postMessage({
					type: "result",
					id,
					segments
				});
				return;
			}
			if (typeof M._hechima_resize !== "function") {
				self.postMessage({
					type: "result",
					id,
					segments: null,
					error: "hechima_resize 未搭載（hechima-wasm v0.2.0+ が必要）"
				});
				return;
			}
			const segments = parseSegments(M.ccall("hechima_resize", "string", [
				"number",
				"number",
				"number"
			], [
				segIdx | 0,
				offset | 0,
				maxCands | 0
			]));
			rememberSegments(segments);
			self.postMessage({
				type: "result",
				id,
				segments
			});
		} catch (e) {
			self.postMessage({
				type: "result",
				id,
				segments: null,
				error: String(e?.message ?? e)
			});
		}
	}
	self.onmessage = (ev) => {
		const m = ev.data;
		if (!m || typeof m !== "object") return;
		if (m.type === "init") {
			if (initStarted) {
				self.postMessage({
					type: "error",
					message: "init は 1 worker につき 1 回"
				});
				return;
			}
			initStarted = true;
			init(m.wasmJs ?? "./hechima-wasm.js", m.dataUrl ?? "./mozc.data").then(() => {
				self.postMessage({
					type: "ready",
					protocol: 0,
					version: HECHIMA_VERSION,
					features: { resize: !!(M && (typeof M._hechima_convert2 === "function" || typeof M._hechima_resize === "function")) }
				});
			}, (e) => {
				self.postMessage({
					type: "error",
					message: String(e?.message ?? e)
				});
			});
		} else if (m.type === "convert") handleConvert(m.id, m.kana, m.maxCands ?? 9);
		else if (m.type === "resize") handleResize(m.id, m.segIdx, m.offset, m.maxCands ?? 9);
	};
	//#endregion
})();
