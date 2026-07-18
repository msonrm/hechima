(function() {
	//#region src/hechima/version.ts
	const HECHIMA_VERSION = "0.11.1";
	//#endregion
	//#region src/hechima/worker-main.ts
	let M = null;
	let initStarted = false;
	const LEARN_FILES = ["segment.db", "boundary.db"];
	const PERSIST_FILES = [...LEARN_FILES, "user_dictionary.db"];
	let learningEnabled = true;
	let learnScope = "default";
	let opfsDir = null;
	let saveTimer = null;
	async function openOpfs() {
		opfsDir = null;
		try {
			const nav = globalThis.navigator;
			if (!nav?.storage?.getDirectory) return;
			opfsDir = await (await (await (await nav.storage.getDirectory()).getDirectoryHandle("hechima", { create: true })).getDirectoryHandle("user", { create: true })).getDirectoryHandle(learnScope, { create: true });
		} catch {
			opfsDir = null;
		}
	}
	async function restoreLearning() {
		if (!opfsDir || !M) return;
		for (const name of PERSIST_FILES) try {
			const fh = await opfsDir.getFileHandle(name);
			const buf = new Uint8Array(await (await fh.getFile()).arrayBuffer());
			if (buf.length) M.FS.writeFile(`/tmp/${name}`, buf);
		} catch {}
	}
	async function saveLearning() {
		if (!opfsDir || !M || typeof M._hechima_sync !== "function") return;
		try {
			M.ccall("hechima_sync", "number", [], []);
		} catch {
			return;
		}
		for (const name of PERSIST_FILES) {
			let data;
			try {
				data = M.FS.readFile(`/tmp/${name}`);
			} catch {
				continue;
			}
			try {
				const access = await (await opfsDir.getFileHandle(name, { create: true })).createSyncAccessHandle();
				access.truncate(0);
				access.write(data, { at: 0 });
				access.flush();
				access.close();
			} catch {}
		}
	}
	function scheduleSave() {
		if (!opfsDir) return;
		if (saveTimer !== null) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveLearning();
		}, 3e3);
	}
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
		if (learningEnabled) {
			await openOpfs();
			await restoreLearning();
		}
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
	/** 再変換（表記 → 逆変換でよみ → 通常変換）。結果は convert と同形（keys がよみ） */
	function handleReconvert(id, surface, maxCands) {
		if (!M || typeof M._hechima_reconvert !== "function") {
			self.postMessage({
				type: "result",
				id,
				segments: null,
				error: "hechima_reconvert 未搭載（hechima-wasm v0.6.0+ が必要）"
			});
			return;
		}
		try {
			const segments = parseSegments(M.ccall("hechima_reconvert", "string", ["string", "number"], [surface, maxCands | 0]));
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
	* 確定内容の学習。値はエンジン中立（表示値）で受け、wasm が変換を再現して
	* 値一致で確定 → FinishConversion（all-or-nothing = 誤学習防止）。
	* 成功したら debounce して OPFS へ書き戻す。
	*/
	function handleLearn(id, kana, sizes, values) {
		if (!M || !learningEnabled || typeof M._hechima_learn !== "function" || !kana || !Array.isArray(values) || !values.length) {
			self.postMessage({
				type: "learned",
				id,
				ok: false
			});
			return;
		}
		try {
			const sizesCsv = Array.isArray(sizes) ? sizes.join(",") : "";
			const ok = M.ccall("hechima_learn", "number", [
				"string",
				"string",
				"string"
			], [
				kana,
				sizesCsv,
				values.join("	")
			]) === 0;
			if (ok) scheduleSave();
			self.postMessage({
				type: "learned",
				id,
				ok
			});
		} catch {
			self.postMessage({
				type: "learned",
				id,
				ok: false
			});
		}
	}
	function parseDictEntries(json) {
		try {
			const p = JSON.parse(String(json));
			if (p && Array.isArray(p.entries)) return p.entries;
		} catch {}
		return null;
	}
	function currentDictEntries() {
		if (!M || typeof M._hechima_dict_list !== "function") return null;
		try {
			return parseDictEntries(M.ccall("hechima_dict_list", "string", [], []));
		} catch {
			return null;
		}
	}
	function handleDictList(id) {
		const entries = currentDictEntries();
		self.postMessage({
			type: "dict",
			id,
			entries,
			...entries === null ? { error: "ユーザー辞書は利用できません（hechima-wasm v0.7.0+ が必要）" } : {}
		});
	}
	function handleDictAdd(id, reading, word, pos) {
		if (!M || typeof M._hechima_dict_add !== "function" || !reading || !word) {
			self.postMessage({
				type: "dict",
				id,
				entries: null,
				error: "登録できません"
			});
			return;
		}
		try {
			const r = M.ccall("hechima_dict_add", "number", [
				"string",
				"string",
				"number"
			], [
				reading,
				word,
				pos | 0
			]);
			if (r !== 0) {
				self.postMessage({
					type: "dict",
					id,
					entries: null,
					error: `登録に失敗 (r=${r})`
				});
				return;
			}
			scheduleSave();
			self.postMessage({
				type: "dict",
				id,
				entries: currentDictEntries()
			});
		} catch (e) {
			self.postMessage({
				type: "dict",
				id,
				entries: null,
				error: String(e?.message ?? e)
			});
		}
	}
	function handleDictRemove(id, index) {
		if (!M || typeof M._hechima_dict_remove !== "function") {
			self.postMessage({
				type: "dict",
				id,
				entries: null,
				error: "削除できません"
			});
			return;
		}
		try {
			const r = M.ccall("hechima_dict_remove", "number", ["number"], [index | 0]);
			if (r !== 0) {
				self.postMessage({
					type: "dict",
					id,
					entries: null,
					error: `削除に失敗 (r=${r})`
				});
				return;
			}
			scheduleSave();
			self.postMessage({
				type: "dict",
				id,
				entries: currentDictEntries()
			});
		} catch (e) {
			self.postMessage({
				type: "dict",
				id,
				entries: null,
				error: String(e?.message ?? e)
			});
		}
	}
	/** 直近の learn を取り消す（確定アンドゥの学習巻き戻し）。成功したら保存も更新する */
	function handleRevert(id) {
		if (!M || !learningEnabled || typeof M._hechima_revert !== "function") {
			self.postMessage({
				type: "learned",
				id,
				ok: false
			});
			return;
		}
		try {
			const ok = M.ccall("hechima_revert", "number", [], []) === 0;
			if (ok) scheduleSave();
			self.postMessage({
				type: "learned",
				id,
				ok
			});
		} catch {
			self.postMessage({
				type: "learned",
				id,
				ok: false
			});
		}
	}
	/** OPFS の学習保存分を削除する（メモリ内の学習はページ再ロードまで残る） */
	async function handleClearLearning(id) {
		let ok = true;
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (opfsDir) for (const name of LEARN_FILES) try {
			await opfsDir.removeEntry(name);
		} catch {}
		else ok = false;
		self.postMessage({
			type: "learned",
			id,
			ok
		});
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
			learningEnabled = m.learning !== false;
			learnScope = m.scope || "default";
			init(m.wasmJs ?? "./hechima-wasm.js", m.dataUrl ?? "./mozc.data").then(() => {
				self.postMessage({
					type: "ready",
					protocol: 0,
					version: HECHIMA_VERSION,
					features: {
						resize: !!(M && (typeof M._hechima_convert2 === "function" || typeof M._hechima_resize === "function")),
						learn: !!(M && learningEnabled && typeof M._hechima_learn === "function"),
						persist: opfsDir !== null,
						dict: !!(M && typeof M._hechima_dict_add === "function")
					}
				});
			}, (e) => {
				self.postMessage({
					type: "error",
					message: String(e?.message ?? e)
				});
			});
		} else if (m.type === "convert") handleConvert(m.id, m.kana, m.maxCands ?? 9);
		else if (m.type === "resize") handleResize(m.id, m.segIdx, m.offset, m.maxCands ?? 9);
		else if (m.type === "reconvert") handleReconvert(m.id, m.surface, m.maxCands ?? 9);
		else if (m.type === "learn") handleLearn(m.id, m.kana, m.sizes, m.values);
		else if (m.type === "revert") handleRevert(m.id);
		else if (m.type === "clearLearning") handleClearLearning(m.id);
		else if (m.type === "dictList") handleDictList(m.id);
		else if (m.type === "dictAdd") handleDictAdd(m.id, m.reading, m.word, m.pos ?? 1);
		else if (m.type === "dictRemove") handleDictRemove(m.id, m.index);
	};
	//#endregion
})();
