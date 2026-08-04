// hechima ラボサイト — 実験ページ共通モジュール。
//
// 各ページ（/ = ローマ字、/naginata/ = 薙刀式、/flick/ = フリック）は
// initLabPage(config) を呼ぶだけ。エディタ・候補ポップアップ・ユーザー辞書・
// フリックキーボードの UI 骨格はここが #app と body に生成する。
// ページ固有なのは説明文（各 HTML）と config（配列セレクタ・フリック挙動）のみ。
//
// 文書モデル: contenteditable の平文運用。中身は「テキストノード + 未確定 span 1 個」だけ。
//   - 未確定（composition）はカーソル位置にインライン挿入（標準 IME の見た目）
//   - 貼り付けはプレーンテキストに剥がす（憲法「プレーンテキスト往復生存」）
//   - 保存は OPFS（非対応環境は localStorage に degrade）へ自動保存
//   - undo/redo は Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y（スナップショット方式。Ctrl+BS の
//     確定アンドゥ = IME 側の取り消しとは別物）
// 学習・ユーザー辞書（worker 側 OPFS）と文書は同一オリジン共有 = ラボ内全ページで共通。
// hechima 側の変更は不要 — cb 契約（show/hide/commit/hostKey/retract/learn/unlearn）で完結。

declare const KeymapEngine: {
  version: string;
  /** v2: opts.layout で `layouts` の追加バインドを選ぶ（ホストの責務） */
  decodeKeymap(json: unknown, opts?: { layout?: string; roleOverrides?: Map<string, string[]> }): unknown;
  InputEngine: new (keymap: unknown) => Hechima.InputEngineLike;
  keyEventFromBrowser(tap: Hechima.KeyTap): Hechima.KeyEvent | null;
};

type FlickOp =
  | { type: "kana"; text: string; replace: number }
  | { type: "key"; tap: Hechima.KeyTap }
  | { type: "text"; text: string }
  | { type: "layer"; layer: string };

// gamepad-engine の操作（フリックの kana/key 二語彙のサブセット）
type GamepadOp =
  | { type: "kana"; text: string; replace: number }
  | { type: "key"; tap: Hechima.KeyTap };

declare const FlickEngine: {
  version: string;
  decodeFlickmap(json: unknown): unknown;
  mount(
    container: HTMLElement,
    map: unknown,
    opts: { onOp(op: FlickOp): void; getComposingTail?: () => string },
  ): {
    element: HTMLElement;
    layer: string;
    setLayer(name: string): boolean;
    setComposing(on: boolean): void;
    destroy(): void;
  };
};

declare const GamepadEngine: {
  version: string;
  start(opts: {
    onOp(op: GamepadOp): void;
    getComposingTail(): string;
    onState?(state: unknown): void;
    enabled?: boolean;
  }): { setEnabled(on: boolean): void; stop(): void; connected: boolean };
  mount(container: HTMLElement): { update(state: unknown): void; destroy(): void };
};

export interface KeymapChoice {
  /**
   * keymap v2 の**レイアウト**（`layouts` のキー。"jis" / "us"）。
   * v1 までは配列ファイル名だったが、JIS/US が 1 本に統合されたので選ぶ対象が変わった。
   */
  value: string;
  label: string;
}

export interface LabPageConfig {
  /**
   * 使う配列（`/vendor/keymaps/<keymap>.json`）。**省略時は内蔵ローマ字**だが、
   * 内蔵は畳む方針なので新しいページでは必ず指定すること（通常は `"romaji"`）。
   */
  keymap?: string;
  /**
   * レイアウトセレクタを持たないページで使うレイアウト（`"jis"` / `"us"`）。
   * `layouts` を持つ配列（NICOLA 等）を固定で使うときだけ要る。ローマ字は不要。
   */
  keymapLayout?: string;
  /** レイアウトセレクタの選択肢。省略時はセレクタなし */
  keymapChoices?: KeymapChoice[];
  /** セレクタのラベル（既定 "配列:"） */
  keymapLabel?: string;
  /**
   * 配列を**外から差し替える口**を呼び出し側へ渡す（`/keymaps/` 実験ページ用）。
   * エンジンの準備が済んだ時点で 1 度だけ呼ばれる。
   *
   * `/vendor/keymaps/` に置いた配列を選ばせるのではなく、**利用者が持ってきた JSON**
   * をその場で読ませたいページのためにある。`load()` は decode 済みの生 JSON を受け取り、
   * 失敗したら例外を投げる（呼び出し側が利用者へ見せる）。
   */
  onKeymapControl?(control: {
    load(json: unknown, layout?: string, roleOverrides?: Map<string, string[]>): Promise<void>;
  }): void;
  /**
   * フリックキーボード:
   *   "on"  = ページを開いたら即表示（/flick/ 実験ページ）
   *   "off" = なし（既定。物理キーボード / ゲームパッド専用ページ）
   */
  flick?: "on" | "off";
  /**
   * ゲームパッド日本語入力（gamepad-engine 駆動。日本語のみ）:
   *   "on"  = ページを開いたらビジュアライザ + polling を起動（ゲームパッド実験ページ）
   *   "off" = なし（既定）
   * フリックと違い OS キーボードは封じない（gamepad は keyboard イベントを介さない = 物理併用可）。
   */
  gamepad?: "on" | "off";
  /**
   * 書字方向。"vertical" でエディタが縦書き（writing-mode: vertical-rl）になり、
   * 候補ポップアップも縦組で注目文節の左隣に出る（/tategaki/ 検証ページ用）
   */
  writingMode?: "horizontal" | "vertical";
  /**
   * 縦書き時の候補段の並び（検証用の切替。横書きでは無視）:
   *   "rl" = 右から左（縦組の読み順。番号表示なし）— 既定
   *   "lr" = 左から右（番号 1-9 付き = 数字キーの物理的な並びと一致）
   */
  verticalCandOrder?: "rl" | "lr";
  /**
   * wasm グルーコードの差し替え（既定 `/vendor/hechima-wasm/hechima-wasm.js`）。
   * 2026-07-25 以降その既定は**単スレッド版**（-pthread なし = SharedArrayBuffer 不要）。
   * 版を並べて比べたいときだけ指定する
   */
  wasmJs?: string;
  /** 辞書の URL（既定 `/vendor/hechima-wasm/mozc.data`） */
  dataUrl?: string;
  /**
   * 候補の二層化（/candlayer/ 実験ページ）。指定すると:
   *   - 候補窓が一層目だけを見せる（1 ページ pageSize 件・末尾に「+n 件」）
   *   - Tab で二層目のグリッドを開き、Esc で閉じる
   *   - パラメータ調整パネルが出る
   * **costs を返す wasm が要る**ので wasmJs に `/vendor/hechima-wasm-cost/hechima-wasm.js`
   * を指定すること（既定の wasm は costs を返さないので二層化は起きない）。
   * 設計と実測 = labo `docs/hechima-candidate-fold-design.md`
   */
  candidateFold?: CandidateFoldConfig;
  /**
   * 入力の記録先（/replay/ 実験ページ）。**ReplayEngine の Recorder が構造的にそのまま入る**
   * ので、ページ側は `createRecorder()` の戻り値を渡すだけでよい。
   *
   * ここが呼ばれるのは「状態が変わる点」— 文字の増減 / 選択の移動 / 未確定表示と候補の変化。
   * 記録の開始・停止は Recorder 側の責務（`start()` を呼ぶまで全部無視される = オプトイン）。
   */
  recordSink?: RecordSink;
}

/**
 * 記録シンク。ReplayEngine の `Recorder` が構造的に適合する
 * （メソッド名と引数はそちらに合わせてある）。すべて省略可。
 */
export interface RecordSink {
  keyDown?(e: { code: string; key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean }): void;
  keyUp?(e: { code: string }): void;
  paste?(charCount: number): void;
  show?(segments: Hechima.SegmentView[]): void;
  hide?(): void;
  commit?(text: string): void;
  /** 文字増減の合流点（afterEdit）から。差分は記録側が取る */
  doc?(text: string, caret: number, anchor?: number | null): void;
  /** 選択・キャレットの移動（selectionchange）から */
  caret?(caret: number, anchor?: number | null): void;
}

/** 候補二層化の初期パラメータ（実験ページの UI で実行時に変更できる） */
export interface CandidateFoldConfig {
  /** 一層目に入れる「1 位からのコスト差」の上限 */
  costDelta: number;
  /** 一層目の最小件数（コスト差で切りすぎないための下限） */
  minCandidates: number;
  /** 一層目の最大件数（拮抗しているよみで出しすぎないための上限） */
  maxCandidates: number;
  /** 一層目の 1 ページ件数（候補窓に一度に見える数） */
  pageSize: number;
  /** 二層目グリッドの列の高さ（行数）。数字キー選択と揃えるなら 9 */
  gridRows: number;
  /** 二層目グリッドの列数 */
  gridCols: number;
}

/** 二層化パラメータの調整パネル（/candlayer/ 専用）。既定値は config から */
function foldPanelHtml(p: CandidateFoldConfig): string {
  const num = (id: string, label: string, value: number, min: number, max: number, step: number, hint: string) =>
    `<label class="fold-item" title="${hint}">
       <span class="fold-label">${label}</span>
       <input type="number" id="fold-${id}" value="${value}" min="${min}" max="${max}" step="${step}" />
     </label>`;
  return `
    <details class="fold-panel" id="fold-panel" open>
      <summary>切り方のパラメータ</summary>
      <div class="fold-grid">
        ${num("delta", "コスト差 Δ", p.costDelta, 0, 30000, 250,
              "1 位からのこの差までを一層目に入れる。0 = 二層化しない")}
        ${num("min", "下限", p.minCandidates, 1, 50, 1,
              "コスト差で切りすぎないための最小件数")}
        ${num("max", "上限", p.maxCandidates, 1, 100, 1,
              "拮抗しているよみで出しすぎないための最大件数")}
        ${num("page", "1 ページ", p.pageSize, 1, 20, 1, "候補窓に一度に見える件数")}
        <div class="fold-break"></div>
        ${num("rows", "グリッド行", p.gridRows, 1, 20, 1, "二層目の列の高さ（数字キーと揃えるなら 9）")}
        ${num("cols", "グリッド列", p.gridCols, 1, 20, 1, "二層目の列数")}
      </div>
      <p class="fold-note" id="fold-note"></p>
    </details>`;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つからない`);
  return el as T;
};

/** buildCandidateColumns の結果（呼び出し側がフッタと配置を組むのに使う） */
export interface CandidateColumns {
  cols: HTMLElement;
  /** 現在ページの先頭（候補一覧の絶対 index） */
  winStart: number;
  /** 現在ページに出ている件数 */
  visibleCount: number;
  pages: number;
  page: number;
  /** 二層目に隠れている件数 */
  hidden: number;
  layer1Length: number;
}

/**
 * 候補窓の中身（`.cand-cols`）を作る。**本番の入力と /replay/ の再生で共有する。**
 *
 * 同じ見た目を 2 か所に書くと必ずズレる —— 実際、再生側で作り直したときに
 * 追加候補（↑ のひらがな/カタカナ）とページングが丸ごと抜けていた。
 * ここは seg と窓サイズだけに依存する純粋な組み立てで、配置・フリック候補バー・
 * 二層目グリッドへの分岐は呼び出し側の責務。
 *
 * null = 候補窓を出さない（候補が 1 件以下で追加候補も無い）。
 */
export function buildCandidateColumns(
  seg: Hechima.SegmentView,
  opts: { windowSize: number; onSelect?(abs: number): void },
): CandidateColumns | null {
  const cands = seg.candidates;
  const idx = seg.candidateIndex;
  const additional = seg.additional ?? [];
  if (!cands || idx === undefined || (cands.length < 2 && additional.length === 0)) return null;

  // 二層化しているときは一層目だけがページングの対象（二層目は Tab で開くまで現れない）
  const layer1 = cands.slice(0, seg.foldCount ?? cands.length);
  const hidden = cands.length - layer1.length;
  const WS = opts.windowSize;

  // ページング: WS 件目からさらに送ると次ページ（ハイライトは先頭行）、
  // 戻ると前ページ（ハイライトは末尾行）。ページは選択位置から決まる純関数
  const winStart = Math.floor(idx / WS) * WS;

  const inAdditional = seg.additionalIndex !== undefined;
  const rows: HTMLElement[] = [];

  // 追加候補（↑ で段階展開。通常候補の上に注釈付きで表示 = KeyLogicKit と同配置）
  additional.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = "cand-row" + (inAdditional && i === seg.additionalIndex ? " selected" : "");
    const ann = document.createElement("span");
    ann.className = "cand-ann";
    ann.textContent = a.annotation;
    const label = document.createElement("span");
    label.textContent = a.text;
    row.append(ann, label);
    rows.push(row);
  });
  if (additional.length > 0) {
    const divider = document.createElement("div");
    divider.className = "cand-divider";
    rows.push(divider);
  }

  const visible = layer1.slice(winStart, winStart + WS);
  visible.forEach((text, i) => {
    const abs = winStart + i;
    const row = document.createElement("div");
    row.className = "cand-row" + (!inAdditional && abs === idx ? " selected" : "");
    const label = document.createElement("span");
    label.textContent = text;
    const num = document.createElement("span");
    num.className = "cand-num";
    // 番号は「位置ハンドル」— 常に画面の左から 1,2,… で物理数字キーの並びと一致させる。
    // ここでは仮に候補順で振り、縦書きの右→左流はアンカー確定後に振り直す
    num.textContent = String(i + 1);
    row.append(num, label);
    if (opts.onSelect) {
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // フォーカス移動を防ぐ
        opts.onSelect?.(abs);
      });
    }
    rows.push(row);
  });

  // 段組コンテナ。縦書きでは writing-mode をここに持たせ、ページ表示フッタ
  // （cand-more）はポップアップ直下で横書きのまま残す
  const cols = document.createElement("div");
  cols.className = "cand-cols";
  cols.append(...rows);

  return {
    cols,
    winStart,
    visibleCount: visible.length,
    pages: Math.max(1, Math.ceil(layer1.length / WS)),
    page: Math.floor(idx / WS),
    hidden,
    layer1Length: layer1.length,
  };
}

/** 二層化していないときのフッタ（従来表示）。1 ページに収まるなら null */
export function buildCandidateFooter(c: CandidateColumns, idx: number): HTMLElement | null {
  if (c.pages <= 1) return null;
  const more = document.createElement("div");
  more.className = "cand-more";
  more.textContent = `${idx + 1} / ${c.layer1Length}（${c.page + 1}/${c.pages} ページ）`;
  return more;
}

/** #app と body に共通 UI 骨格を生成する（id は従来の単一ページ時代と同一） */
function renderScaffold(config: LabPageConfig): void {
  const keymapControl = config.keymapChoices
    ? `<label>${config.keymapLabel ?? "配列:"}
        <select id="keymap">${config.keymapChoices
          .map((c) => `<option value="${c.value}">${c.label}</option>`)
          .join("")}</select>
      </label>`
    : "";
  $<HTMLDivElement>("app").innerHTML = `
    <section class="controls">
      ${keymapControl}
      <button id="clear" type="button">クリア</button>
      <button id="reset-learning" type="button" title="保存された学習データを消去してページを再読み込みします">学習リセット</button>
      <button id="flick-toggle" type="button" hidden title="タッチ用フリックキーボードを表示します">フリック</button>
      <span id="status" class="status">変換エンジンを準備中…</span>
    </section>

    <section class="editor-wrap">
      <div id="editor" class="editor" contenteditable="true" spellcheck="false"
        aria-label="プレーンエディタ" data-placeholder="ここに書く…"></div>
      <div class="statusline"><span id="counts">0 字 ・ 0 行</span></div>
    </section>

    <details class="dict" id="dict-panel">
      <summary>ユーザー辞書</summary>
      <form id="dict-form" autocomplete="off">
        <input id="dict-reading" placeholder="よみ（ひらがな）" required />
        <input id="dict-word" placeholder="単語" required />
        <select id="dict-pos" aria-label="品詞">
          <option value="1">名詞</option>
          <option value="4">固有名詞</option>
          <option value="5">人名</option>
          <option value="9">地名</option>
        </select>
        <button type="submit">登録</button>
        <span id="dict-msg" class="status"></span>
      </form>
      <ul id="dict-list"></ul>
    </details>
    ${config.candidateFold ? foldPanelHtml(config.candidateFold) : ""}`;

  // ポップアップとフリックパネルは body 直下（absolute / fixed 配置のため）
  // ※ 二層化パネル（/candlayer/）は上の app HTML 内に差し込む
  const overlays = document.createElement("div");
  overlays.innerHTML = `
    <div id="candidates" class="candidates" hidden></div>
    <div id="cand-grid" class="cand-grid" hidden></div>
    <div id="flick-panel" class="flick-panel" hidden>
      <div id="flick-cands" class="flick-cands"></div>
      <div id="flick-area" class="flick-area"></div>
    </div>`;
  document.body.append(...Array.from(overlays.children));
}

export function initLabPage(config: LabPageConfig = {}): void {
  const flickMode = config.flick ?? "off";
  const vertical = config.writingMode === "vertical";
  // 縦書き時の候補段の並び。横書きは null = 従来の横組ポップアップ（番号付き縦積み）
  const candOrder = vertical ? (config.verticalCandOrder ?? "rl") : null;
  if (vertical) document.body.classList.add("vertical");
  renderScaffold(config);

  const statusEl = $<HTMLSpanElement>("status");
  const editorEl = $<HTMLDivElement>("editor");
  const countsEl = $<HTMLSpanElement>("counts");
  const keymapSelect = config.keymapChoices ? $<HTMLSelectElement>("keymap") : null;

  let engineStatus = "変換エンジンを準備中…";
  let storageLabel = "";
  let diagLabel = ""; // 実機調査用: リソース読込失敗の常設表示（後続の status 更新で消えないように）
  // COI 診断は 2026-07-25 に廃止（単スレッド wasm 移行で COOP/COEP を撤去したため、
  // crossOriginIsolated が false であることが正常な状態になった）。
  // 環境の確認が必要なときは /coi-test/ の診断パネルを使う
  const refreshStatus = () => {
    statusEl.textContent = [engineStatus, storageLabel, diagLabel].filter(Boolean).join(" ・ ");
  };
  const setStatus = (text: string) => { engineStatus = text; refreshStatus(); };
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

  // 実機リモート調査用: サブリソース（CSS/script 等）の読込失敗を表面化する。
  // resource error はバブルしないため capture で拾う（window 自身のエラーは tagName 無しで除外）。
  // iPad Safari は COI サイトで URL 欄 navigation 後にキャッシュ済み応答（style/worker）の
  // 再利用を誤ブロックする（COI は維持・新規ネットワーク取得は成功する）実機事象があるため、
  // CSS はキャッシュキーをずらして 1 回だけ自動再取得し自己回復する
  const retriedCss = new Set<string>();
  window.addEventListener("error", (e) => {
    const t = e.target as (Element & { src?: string; href?: string; rel?: string }) | null;
    if (!t || !t.tagName) return;
    diagLabel = `⚠ 読込失敗: ${t.tagName.toLowerCase()} ${t.src ?? t.href ?? ""}`;
    refreshStatus();
    if (t.tagName === "LINK" && t.rel === "stylesheet" && t.href && !retriedCss.has(t.href)) {
      retriedCss.add(t.href);
      const fresh = document.createElement("link");
      fresh.rel = "stylesheet";
      fresh.href = `${t.href}${t.href.includes("?") ? "&" : "?"}r=${Date.now()}`;
      document.head.appendChild(fresh);
    }
  }, true);

  if (vertical) {
    // 検証ページ: iPad ではコンソールが見えないので、実行時エラーをステータス欄に表面化する
    window.addEventListener("error", (e) => setStatus(`⚠ JS エラー: ${e.message}`));
    window.addEventListener("unhandledrejection", (e) => setStatus(`⚠ 非同期エラー: ${String(e.reason)}`));
  }

  // ---- 変換エンジン（hechima-worker、へちま蔓 v0） ----

  // worker スクリプトは毎回キャッシュキーをずらして必ずネットワークから取る（14KB）。
  // 上記の Safari キャッシュ再利用ブロックの回避 — 汚染済みエントリに当たらない
  const worker = new Worker(`/vendor/hechima/hechima-worker.js?t=${Date.now()}`);
  // worker スクリプト自体のロード失敗（404 等）は message が一切来ず init が沈黙ハングする
  // （connectWorker は error イベントを見ない）ため、ホスト側でここに表面化する
  worker.addEventListener("error", (e) =>
    setStatus(`エンジン worker の読み込みに失敗: ${e.message || "スクリプトを取得できません"}`));
  const conn = Hechima.connectWorker(worker, {
    // 既定は 9（= ポップアップの 1 ウィンドウ分）だが、それだと 10 件目以降が
    // 存在せずページングが起きない。ウィンドウ複数ページ分を取得する
    maxCands: 50,
    onProgress: (loaded, total) =>
      setStatus(total > 0 ? `辞書を取得中… ${mb(loaded)} / ${mb(total)} MB` : `辞書を取得中… ${mb(loaded)} MB`),
  });
  conn
    .init({
      wasmJs: config.wasmJs ?? "/vendor/hechima-wasm/hechima-wasm.js",
      dataUrl: config.dataUrl ?? "/vendor/hechima-wasm/mozc.data",
    })
    .then((info) => {
      const learn = info.features.learn
        ? info.features.persist ? " / 学習オン" : " / 学習オン（この環境では保存されません）"
        : "";
      setStatus(`準備完了 — Mozc 実変換（hechima v${info.version} / へちま蔓 v${info.protocol}${learn}）`);
    })
    .catch((e: Error) => setStatus(`エンジン初期化失敗: ${e.message} — フォールバック変換（カナ/かな巡回）で動作中`));

  // ---- 文書モデル（contenteditable 平文 + 未確定 span） ----

  let compEl: HTMLSpanElement | null = null;

  const compositionActive = (): boolean => !!(compEl && compEl.isConnected);

  // 末尾センチネル（EOF 相当のパーツ）。contenteditable は末尾に <br> が無いと最終空行の
  // 行ボックスを作れず、末尾境界の選択が「editing host の端」という曖昧な位置になって
  // WebKit の非同期処理（スクロールクランプ後の選択正規化）で末尾へ吸われる。
  // native 編集ならブラウザが自動維持するが、編集を全自前化したのでホストが維持する。
  // テキストノードだけを歩く offset 系（docText/caretOffset/rangeAt）には影響しない
  let eofBr: HTMLBRElement | null = null;

  function ensureEofBr(): void {
    if (!vertical) return;
    if (!eofBr || !eofBr.isConnected) {
      eofBr = document.createElement("br");
      eofBr.className = "eof-br";
    }
    if (editorEl.lastChild !== eofBr) editorEl.appendChild(eofBr);
  }

  /** テキスト末尾（センチネルの直前）に collapse した Range */
  function endOfTextRange(): Range {
    const r = document.createRange();
    if (eofBr && eofBr.isConnected) {
      r.setStartBefore(eofBr);
      r.collapse(true);
    } else {
      r.selectNodeContents(editorEl);
      r.collapse(false);
    }
    return r;
  }

  /** 本文（未確定 span を除いたテキスト） */
  function docText(): string {
    let out = "";
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        compEl && compEl.contains(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.textContent ?? "";
    return out;
  }

  /** editor 内のキャレット（無ければ末尾）。選択があれば focus 側に潰す */
  function caretRange(): Range {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) {
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(false);
      return r;
    }
    return endOfTextRange();
  }

  function selectRange(r: Range): void {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function setCaretAfter(node: Node): void {
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    selectRange(r);
  }

  /** 任意の点（container, offset）を本文オフセットへ。未確定 span は数えない */
  function offsetOfPoint(container: Node, offset: number): number {
    const pre = document.createRange();
    pre.selectNodeContents(editorEl);
    try {
      pre.setEnd(container, offset);
    } catch {
      return 0; // エディタ外の点（選択が外れている等）
    }
    let out = 0;
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        compEl && compEl.contains(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = (n.textContent ?? "").length;
      if (pre.comparePoint(n, 0) > 0) break; // 点より後ろのノード
      const inPre = pre.comparePoint(n, len) <= 0 ? len
        : (n === container ? offset : 0);
      out += inPre;
      if (n === container) break;
    }
    return out;
  }

  /** キャレット位置（本文の UTF-16 オフセット。未確定 span は挿入位置として数えない） */
  function caretOffset(): number {
    const r = caretRange();
    return offsetOfPoint(r.startContainer, r.startOffset);
  }

  /**
   * リプレイ記録用のキャレットと選択アンカー。
   *
   * `caretOffset()` は選択を **end 側へ潰す**ので、そのまま使うと Shift+← のような
   * 左向き選択で caret と anchor が同値になり、**範囲がまるごと消える**。
   * 記録には focus / anchor をそれぞれの実点から取る。
   */
  function recordPoints(): { caret: number; anchor: number | null } {
    const sel = window.getSelection();
    if (
      !sel || sel.rangeCount === 0 || sel.isCollapsed ||
      !sel.focusNode || !sel.anchorNode ||
      !editorEl.contains(sel.focusNode) || !editorEl.contains(sel.anchorNode)
    ) {
      return { caret: caretOffset(), anchor: null };
    }
    return {
      caret: offsetOfPoint(sel.focusNode, sel.focusOffset),
      anchor: offsetOfPoint(sel.anchorNode, sel.anchorOffset),
    };
  }

  /** 本文オフセット [start, end) を指す Range（未確定 span が無い前提で使う） */
  function rangeAt(start: number, end: number): Range | null {
    const r = document.createRange();
    let acc = 0;
    let started = false;
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = (n.textContent ?? "").length;
      if (!started && start <= acc + len) {
        r.setStart(n, start - acc);
        started = true;
      }
      if (started && end <= acc + len) {
        r.setEnd(n, Math.max(0, end - acc));
        return r;
      }
      acc += len;
    }
    if (!started && start === acc) {
      return endOfTextRange(); // 空文書・末尾位置はセンチネルの直前に置く
    }
    if (started) {
      if (eofBr && eofBr.isConnected) r.setEndBefore(eofBr);
      else r.setEnd(editorEl, editorEl.childNodes.length);
      return r;
    }
    return null;
  }

  let lastCaretOffset = 0; // 直近のキャレット位置（Safari が選択を落としたときの復帰用）

  function setCaretByOffset(offset: number): void {
    const r = rangeAt(offset, offset);
    if (r) {
      r.collapse(true);
      selectRange(r);
      lastCaretOffset = offset;
    }
  }

  /**
   * Safari は縦書きの文字削除でペイント無効化（再描画矩形）を漏らし、削除済みの文字が
   * 残像として見え続けることがある（スクロールすると消える）。文字レイアウトを不可視の
   * 量だけ揺らして戻し、テキスト全体の再描画を強制する
   */
  function forceTextRepaint(): void {
    if (!vertical) return;
    editorEl.style.letterSpacing = "0.001px";
    requestAnimationFrame(() => {
      editorEl.style.letterSpacing = "";
    });
  }

  /** Safari がスクロールクランプ等で選択を落としていたら、直近のキャレット位置へ復帰させる */
  function ensureEditorSelection(): void {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) return;
    setCaretByOffset(Math.min(lastCaretOffset, docText().length));
  }

  function insertTextAtCaret(text: string): void {
    const r = caretRange();
    r.deleteContents();
    const tn = document.createTextNode(text);
    r.insertNode(tn);
    setCaretAfter(tn);
    editorEl.normalize();
    // Safari: normalize 後に要素境界アンカーで残るキャレットは縦書きで描画位置がずれる
    // （改行のたびに下方向へ累積ドリフト）ため、テキストノード内オフセットへ再アンカーする
    setCaretByOffset(caretOffset());
  }

  /** キャレット直後の n 文字（コードポイント）を削除（Delete キー用）。成功で true */
  function deleteAfterCaret(nChars: number): boolean {
    const off = caretOffset();
    const after = docText().slice(off);
    if (!after) return false;
    const chars = Array.from(after);
    const take = Math.min(nChars, chars.length);
    const units = chars.slice(0, take).join("").length;
    const r = rangeAt(off, off + units);
    if (!r) return false;
    r.deleteContents();
    editorEl.normalize();
    setCaretByOffset(off);
    return true;
  }

  /** キャレット直前の n 文字（コードポイント）を削除。成功で true */
  function deleteBeforeCaret(nChars: number): boolean {
    const off = caretOffset();
    const before = docText().slice(0, off);
    if (!before) return false;
    const chars = Array.from(before);
    const take = Math.min(nChars, chars.length);
    const units = chars.slice(chars.length - take).join("").length;
    const r = rangeAt(off - units, off);
    if (!r) return false;
    r.deleteContents();
    editorEl.normalize();
    setCaretByOffset(off - units);
    return true;
  }

  // ---- 保存（OPFS → localStorage に degrade）・undo/redo・カウント ----

  const DOC_FILE = "document.txt";
  const DOC_LS_KEY = "hechima-doc";
  const CARET_LS_KEY = "hechima-doc-caret"; // キャレット位置も文書と同じく自動保存（サイト共有）
  let opfsDoc: { getFileHandle(name: string, o?: { create?: boolean }): Promise<FileSystemFileHandle> } | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  async function initStorage(): Promise<string> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("hechima", { create: true });
      const fh = await dir.getFileHandle(DOC_FILE, { create: true });
      const text = await (await fh.getFile()).text();
      // createWritable の存在だけ確認（呼んで close すると既存内容が空になるため呼ばない。
      // Safari 旧版などメソッド自体が無い環境は localStorage へ）
      if (typeof (fh as { createWritable?: unknown }).createWritable !== "function") {
        throw new Error("createWritable なし");
      }
      opfsDoc = dir as never;
      storageLabel = "自動保存: この端末（OPFS）";
      return text;
    } catch {
      opfsDoc = null;
      try {
        const text = localStorage.getItem(DOC_LS_KEY) ?? "";
        storageLabel = "自動保存: この端末（localStorage）";
        return text;
      } catch {
        storageLabel = "自動保存: 不可（この環境では保存されません）";
        return "";
      }
    }
  }

  async function saveDocNow(): Promise<void> {
    const text = docText();
    // キャレット位置の保存。選択がエディタ外（辞書フォーム等）のときは前回値を保持する
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) {
      try { localStorage.setItem(CARET_LS_KEY, String(caretOffset())); } catch { /* 保存不可環境 */ }
    }
    if (opfsDoc) {
      try {
        const fh = await opfsDoc.getFileHandle(DOC_FILE, { create: true });
        const w = await (fh as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable();
        await w.write(text);
        await w.close();
        return;
      } catch {
        // 書けなければ localStorage へ
      }
    }
    try { localStorage.setItem(DOC_LS_KEY, text); } catch { /* 保存不可環境 */ }
  }

  function scheduleSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void saveDocNow(); }, 800);
  }

  function updateCounts(): void {
    const t = docText();
    const chars = Array.from(t.replace(/\n/g, "")).length;
    const lines = t.length ? t.split("\n").length : 0;
    countsEl.textContent = `${chars} 字 ・ ${lines} 行`;
    // センチネル <br> があると :empty が効かないため、プレースホルダはクラスで出す
    editorEl.classList.toggle("is-empty", t.length === 0 && !compositionActive());
  }

  interface DocState { text: string; caret: number }
  const undoStack: DocState[] = [];
  const redoStack: DocState[] = [];

  function currentState(): DocState {
    return { text: docText(), caret: caretOffset() };
  }

  /** 変更の直前に呼ぶ（native 編集は beforeinput から） */
  function snapshot(): void {
    const cur = currentState();
    const top = undoStack[undoStack.length - 1];
    if (top && top.text === cur.text) return; // 同一テキストは積まない
    undoStack.push(cur);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }

  function applyState(s: DocState): void {
    compEl = null;
    editorEl.textContent = s.text;
    ensureEofBr();
    setCaretByOffset(Math.min(s.caret, s.text.length));
    afterEdit();
  }

  function undo(): void {
    if (!undoStack.length || compositionActive()) return;
    redoStack.push(currentState());
    applyState(undoStack.pop()!);
  }

  function redo(): void {
    if (!redoStack.length || compositionActive()) return;
    undoStack.push(currentState());
    applyState(redoStack.pop()!);
  }

  /** 編集後の共通処理（保存 + カウント + 縦書きのキャレット追従） */
  function afterEdit(): void {
    ensureEofBr();
    scheduleSave();
    updateCounts();
    // リプレイ記録: 文字増減の合流点はここ 1 点（自前編集も native 編集も通る）。
    // キャレット移動だけはここを通らないので selectionchange で別に拾う
    if (config.recordSink?.doc) {
      const pt = recordPoints();
      config.recordSink.doc(docText(), pt.caret, pt.anchor);
    }
    scrollCaretIntoView();
    updateVCaret();
    if (vertical) {
      // Safari はコンテンツ縮小時のスクロールクランプを次フレームで非同期に行うため、
      // クランプ後のレイアウトでもう一度追従・描画し直す
      requestAnimationFrame(() => {
        scrollCaretIntoView();
        updateVCaret();
      });
    }
  }

  /**
   * キャレット位置の実測矩形（ZWSP プローブ方式）。Safari は縦書きだと collapsed Range の
   * getBoundingClientRect も誤る（native キャレット誤描画と同根）ため、キャレット関連の
   * 測定はすべてこれを使う。折返し行・空行・空文書も同一経路で正しく出る。
   * 非 collapsed 選択・エディタ外・レイアウト未確定のときは null
   */
  function measureCaretRect(): DOMRect | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed ||
        !editorEl.contains(sel.getRangeAt(0).startContainer)) {
      return null;
    }
    const o = caretOffset();
    const r = rangeAt(o, o);
    if (!r) return null;
    r.collapse(true);
    const probe = document.createTextNode("\u200b");
    r.insertNode(probe);
    const pr = document.createRange();
    pr.selectNode(probe);
    const rect = pr.getBoundingClientRect();
    probe.remove();
    editorEl.normalize();
    setCaretByOffset(o); // プローブ挿入で乱れた選択を戻す
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
      return null; // レイアウト未確定でプローブ矩形が取れない（起動直後など）
    }
    return rect;
  }

  /**
   * 縦書きでキャレット（未確定表示を含む）がエディタの横スクロール範囲に入るよう追従する。
   * programmatic な Range 操作は contenteditable の自動追従が効かないため自前で行う。
   * 相対量で調整するので vertical-rl の scrollLeft 符号方言（0 = 右端、左へ負）に依存しない
   */
  function scrollCaretIntoView(): void {
    if (!vertical) return;
    const target = compositionActive() && compEl
      ? compEl.getBoundingClientRect()
      : measureCaretRect();
    if (!target) return;
    const MARGIN = 24;
    const box = editorEl.getBoundingClientRect();
    if (target.left < box.left) {
      editorEl.scrollLeft -= box.left - target.left + MARGIN;
    } else if (target.right > box.right) {
      editorEl.scrollLeft += target.right - box.right + MARGIN;
    }
  }

  // ---- 自前キャレット（縦書きのみ） ----
  // Safari は縦書き contenteditable の native キャレットを横書きメトリクスで描画する
  // （形状が短い・改行を跨ぐたびに描画位置が下へ累積ドリフト。挿入位置自体は正しい）。
  // DOM 側の是正では直らないため、native は caret-color: transparent で隠し、
  // ゼロ幅スペースのプローブを一瞬挿して実測した位置に自前で描く。
  // 折返し行・空行・空文書も同一経路で正しく出る
  let vcaretEl: HTMLDivElement | null = null;
  let vcaretRetry = 0; // レイアウト未確定でプローブ矩形が取れないときの再測回数

  function updateVCaret(): void {
    if (!vertical) return;
    if (!vcaretEl) {
      vcaretEl = document.createElement("div");
      vcaretEl.className = "vcaret";
      // エディタ枠（.editor-wrap、position: relative）の中に置く。ステータス文言の出現などで
      // 上流のレイアウトが動いても枠ごと一緒に動くので、描画済みキャレットが陳腐化しない
      (editorEl.parentElement ?? document.body).appendChild(vcaretEl);
    }
    if (compositionActive() || document.activeElement !== editorEl) {
      vcaretEl.style.display = "none";
      return;
    }
    const rect = measureCaretRect();
    if (!rect) {
      // 起動直後のレイアウト未確定など → 隠して次フレームで再測（最大 3 回）
      vcaretEl.style.display = "none";
      if (vcaretRetry < 3) {
        vcaretRetry++;
        requestAnimationFrame(() => updateVCaret());
      }
      return;
    }
    vcaretRetry = 0;
    const box = editorEl.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(editorEl).fontSize) || 18;
    const w = Math.min(rect.width || fs, fs);
    // 測定値が枠外に出た場合（起動直後のフォント/レイアウト確定前の保険）は枠内へクランプ
    const left = Math.min(
      Math.max(rect.left + (rect.width > w ? (rect.width - w) / 2 : 0), box.left),
      box.right - w,
    );
    const top = Math.min(Math.max(rect.top, box.top + 2), box.bottom - 4);
    const hostRect = (vcaretEl.parentElement ?? document.body).getBoundingClientRect();
    vcaretEl.style.display = "";
    vcaretEl.style.left = `${left - hostRect.left}px`;
    vcaretEl.style.top = `${top - hostRect.top}px`;
    vcaretEl.style.width = `${w}px`;
    // 点滅は移動のたびに先頭から（実 IME キャレットの作法）
    vcaretEl.style.animation = "none";
    void vcaretEl.offsetWidth;
    vcaretEl.style.animation = "";
  }

  if (vertical) {
    // scroll イベントのディスパッチ中にプローブ（DOM 変異 + 選択の張り直し）を走らせると
    // Safari のスクロールクランプと衝突して選択が落ちることがある → 次フレームに集約
    let scrollRaf = 0;
    editorEl.addEventListener("scroll", () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        updateVCaret();
      });
    });
    window.addEventListener("resize", () => updateVCaret());
    editorEl.addEventListener("focus", () => updateVCaret());
    editorEl.addEventListener("blur", () => updateVCaret());
    // クリック/タップは選択確定後に反映（dblclick の単語選択は非 collapsed → 非表示になる）
    editorEl.addEventListener("mouseup", () => setTimeout(updateVCaret, 0));
    editorEl.addEventListener("touchend", () => setTimeout(updateVCaret, 0));
  }

  // ---- 未確定表示（インライン）と候補ポップアップ ----

  // 直近の show 内容（二層目グリッドのキー処理が注目文節の候補を読むのに使う）
  let lastSegments: Hechima.SegmentView[] = [];

  function renderComposition(segments: Hechima.SegmentView[]): void {
    lastSegments = segments;
    updateFoldNote(); // 二層化パネルの注記（実験ページ以外では何もしない）
    // フリック連携はここで一元更新する。cb.show / cb.hide だけに仕込むと、確定時
    // （セッションは cb.hide を呼ばず、ホストの cb.commit がここを直接呼ぶ契約）に
    // ラベルと postModify 用テキストが取り残される
    flickComposingText = segments.map((s) => s.text).join("");
    flickKbd?.setComposing(segments.length > 0);
    if (segments.length) editorEl.classList.remove("is-empty"); // 合成中はプレースホルダを出さない
    if (!segments.length) {
      if (compositionActive() && compEl) {
        const marker = document.createTextNode("");
        compEl.replaceWith(marker);
        setCaretAfter(marker);
        editorEl.normalize();
      }
      compEl = null;
      scrollCaretIntoView();
      updateVCaret();
      renderCandidatePopup(segments);
      return;
    }
    if (!compositionActive()) {
      // 選択がある状態での入力開始は選択を置き換える（標準エディタの挙動）
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
          editorEl.contains(sel.getRangeAt(0).startContainer)) {
        snapshot();
        sel.getRangeAt(0).deleteContents();
        editorEl.normalize();
      }
      compEl = document.createElement("span");
      compEl.className = "composition";
      const r = caretRange();
      r.insertNode(compEl);
    }
    compEl!.replaceChildren(
      ...segments.map((s) => {
        const span = document.createElement("span");
        span.className = `seg-${s.kind}`;
        span.textContent = s.text;
        return span;
      }),
    );
    setCaretAfter(compEl!);
    scrollCaretIntoView(); // ポップアップのアンカー計算より先にスクロールを確定させる
    updateVCaret(); // composing 中は非表示になる
    renderCandidatePopup(segments);
  }

  // ---- 変換候補ポップアップ（KeyLogicKit CandidatePopup の設計を移植） ----
  // 注目文節の直下にアンカーし、下端はみ出しで上にフリップ・右端で水平クランプ。
  // 9 件ごとのページング + 数字キー 1-9 / クリックで直接選択。

  const popupEl = $<HTMLDivElement>("candidates");
  if (vertical) popupEl.classList.add("cand-v", candOrder === "lr" ? "cand-v-lr" : "cand-v-rl");
  // 縦書き候補段の現在の流れ（左→右か）。既定（近接アンカー）モードではポップアップの
  // 出た側で毎回決まり、矢印キーの視覚写像はこれに追従する
  let candFlowLtr = candOrder === "lr";
  let candWindowCount = 0; // 現在ページの表示候補数（位置ベース番号の振り直しと数字選択に使う）
  // 候補の二層化（/candlayer/）。null = 従来どおり全候補を 1 つの流れで見せる
  let foldParams: CandidateFoldConfig | null = config.candidateFold ? { ...config.candidateFold } : null;
  const WINDOW_SIZE = (): number => foldParams?.pageSize ?? 9;
  let winStart = 0; // 現在ページの先頭（候補一覧の絶対 index。選択位置から導出）
  const gridEl = $<HTMLDivElement>("cand-grid");

  function popupVisible(): boolean {
    return !popupEl.hidden;
  }

  /**
   * ページ位置の点列（一層目の候補窓と二層目のグリッドで共通の語彙）。
   * 全体のページ数と現在地を、数えずに掴めるようにするためのもの。
   * 点が多すぎて数えられない領域（8 ページ超）では素直に数字へ倒す。
   */
  function pageDots(pages: number, page: number): HTMLElement {
    if (pages > 8) {
      const n = document.createElement("span");
      n.textContent = `${page + 1}/${pages}`;
      return n;
    }
    const dots = document.createElement("span");
    dots.className = "cand-dots";
    for (let i = 0; i < pages; i++) {
      const d = document.createElement("span");
      d.className = "cand-dot" + (i === page ? " on" : "");
      dots.appendChild(d);
    }
    return dots;
  }

  function renderCandidatePopup(segments: Hechima.SegmentView[]): void {
    // フリック中はポップアップ（縦長でキーボードと干渉する）の代わりに
    // キーボード上部の候補バーへ出す
    if (flickKbd) {
      popupEl.hidden = true;
      renderFlickCandBar(segments);
      return;
    }
    const focusIdx = segments.findIndex((s) => s.kind === "focus");
    const seg = focusIdx >= 0 ? segments[focusIdx] : undefined;
    const cands = seg?.candidates;
    const idx = seg?.candidateIndex;
    const additional = seg?.additional ?? [];
    if (!seg || !cands || idx === undefined || (cands.length < 2 && additional.length === 0)) {
      popupEl.hidden = true;
      gridEl.hidden = true;
      return;
    }

    // 二層目を展開中はグリッド一覧に切り替える（候補窓は畳む）
    if (seg.expanded) {
      popupEl.hidden = true;
      renderCandGrid(cands, idx);
      return;
    }
    gridEl.hidden = true;

    // 行の組み立ては /replay/ の再生と共有する（二重に書くとズレる）
    const built = buildCandidateColumns(seg, {
      windowSize: WINDOW_SIZE(),
      onSelect: (abs) => {
        fep.selectCandidate(abs);
      },
    });
    if (!built) {
      popupEl.hidden = true;
      return;
    }
    const hidden = built.hidden;
    winStart = built.winStart;
    candWindowCount = built.visibleCount;
    popupEl.replaceChildren(built.cols);
    // フッタは「読まなくても分かる」2 つだけに絞る:
    //   (1) 全体で何ページあって今どこか = 点の列（先が長いか・現在地はどこか）
    //   (2) 二層目があるか = 「… Tab」の有無（件数は出さない — 押す価値の有無だけ要る）
    // 候補の番号や件数は候補窓を見れば分かるので出さない。
    // **1 ページ・二層目なしでも点を 1 個出す**: 情報が消える瞬間を作らず、
    // 点が 1 個だけ = それ自体が「これで全部」の合図になる。
    if (foldParams) {
      const more = document.createElement("div");
      more.className = "cand-more cand-more-nav";
      more.title = `${built.pages} ページ中 ${built.page + 1} ページ目`
        + (hidden > 0 ? `（Tab でさらに ${hidden} 件）` : "（これで全部）");
      more.appendChild(pageDots(built.pages, built.page)); // 左詰め（右端は Tab の合図に空けておく）
      if (hidden > 0) {
        const tab = document.createElement("span");
        tab.className = "cand-tab-hint";
        tab.textContent = "… Tab";
        more.appendChild(tab);
      }
      popupEl.append(more);
    } else {
      // 二層化していないページ（従来どおり）: 表示は変えない
      const more = buildCandidateFooter(built, idx);
      if (more) popupEl.append(more);
    }
    popupEl.hidden = false;

    // 配置: 横書き = 注目文節の直下（下端はみ出しで上にフリップ、右端でクランプ）。
    // 縦書き = 次の行方向 = 注目文節の左隣（左端はみ出しで右にフリップ、下端でクランプ）
    const GAP = 4;
    const anchorSpan = compEl?.children[focusIdx] as HTMLElement | undefined;
    const anchor = (anchorSpan ?? editorEl).getBoundingClientRect();
    const popupW = popupEl.offsetWidth;
    const popupH = popupEl.offsetHeight;
    let x: number;
    let y: number;
    if (vertical) {
      // 側の選択: 左優先（次の行方向）。左に入らないときは「右に入る」か「右の方が広い」
      // 場合のみ右へ。両側とも狭いときは広い方に出し、下の画面内クランプで必ず見せる
      // （本文と重なっても見えないよりマシ）
      const spaceLeft = anchor.left - GAP;
      const spaceRight = window.innerWidth - anchor.right - GAP;
      const flipRight = popupW > spaceLeft && (popupW <= spaceRight || spaceRight > spaceLeft);
      x = flipRight
        ? anchor.right + GAP + window.scrollX
        : anchor.left - GAP - popupW + window.scrollX;
      y = anchor.top + window.scrollY;
      if (anchor.top + popupH > window.innerHeight) {
        y = window.innerHeight - popupH + window.scrollY;
      }
      x = Math.min(x, window.innerWidth - popupW + window.scrollX); // 右端クランプ
      // 既定（近接アンカー）モード: 第一候補が注目文節のすぐ隣に来る向きに段を流す —
      // 左に出るときは右→左、右にフリップしたときは左→右。Space は常に文節から離れる方向、
      // 矢印は candFlowLtr 経由で常に押した向きに動く。?cand=lr（番号付き比較）は左→右固定。
      // 向きの反転で幅は変わらない（同じ段の鏡像）ので、測定済み popupW はそのまま使える
      if (candOrder !== "lr") {
        candFlowLtr = flipRight;
        popupEl.classList.toggle("cand-v-lr", flipRight);
        popupEl.classList.toggle("cand-v-rl", !flipRight);
        // 番号は位置ハンドル = 常に画面の左から 1,2,…。右→左流では DOM 順（優先順）と
        // 逆になるため振り直す（1 桁どうしの差し替えなので測定済みの幅は変わらない）
        if (!flipRight) {
          const nums = popupEl.querySelectorAll<HTMLSpanElement>(".cand-num");
          nums.forEach((n, j) => { n.textContent = String(nums.length - j); });
        }
      }
    } else {
      x = anchor.left + window.scrollX;
      y = anchor.bottom + GAP + window.scrollY;
      if (anchor.bottom + GAP + popupH > window.innerHeight) {
        y = anchor.top - popupH - GAP + window.scrollY;
      }
      if (anchor.left + popupW > window.innerWidth) {
        x = window.innerWidth - popupW + window.scrollX;
      }
    }
    popupEl.style.left = `${Math.max(0, x)}px`;
    popupEl.style.top = `${Math.max(0, y)}px`;
  }

  // ---- 二層目のグリッド（/candlayer/。「探す」ためのモード = 一望させる） ----
  // 列内は縦に流れ（新聞の段組と同じ）、最下段の次は右隣の列頭。
  // Tab = 次の列頭 / Shift+Tab = 前の列頭 / 1-9 = 現在の列の中の行 / ↑↓ = 1 件ずつ。
  // 移動は 1 次元のまま（←→ は文節移動に割り当て済みなので取り上げない）。

  /** UI のパラメータ → セッションの FoldOptions（グリッド寸法はホスト側の関心なので渡さない） */
  const foldOptionsOf = (p: CandidateFoldConfig) => ({
    costDelta: p.costDelta,
    minCandidates: p.minCandidates,
    maxCandidates: p.maxCandidates,
  });

  const gridRows = (): number => Math.max(1, foldParams?.gridRows ?? 9);
  const gridCols = (): number => Math.max(1, foldParams?.gridCols ?? 8);
  const gridPageSize = (): number => gridRows() * gridCols();

  function renderCandGrid(cands: string[], idx: number): void {
    const rows = gridRows();
    const per = gridPageSize();
    const pageStart = Math.floor(idx / per) * per;
    const view = cands.slice(pageStart, pageStart + per);

    const grid = document.createElement("div");
    grid.className = "cand-grid-cells";
    // 列内縦流れ = grid-auto-flow: column + 行数固定
    grid.style.gridTemplateRows = `repeat(${rows}, auto)`;
    view.forEach((text, i) => {
      const abs = pageStart + i;
      const cell = document.createElement("div");
      cell.className = "cand-cell" + (abs === idx ? " selected" : "");
      const num = document.createElement("span");
      num.className = "cand-num";
      num.textContent = String((i % rows) + 1); // 列内の行番号 = 数字キーと一致
      const label = document.createElement("span");
      label.textContent = text;
      cell.append(num, label);
      cell.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        fep.selectCandidate(abs);
      });
      grid.appendChild(cell);
    });

    // フッタは一層目と同じ語彙: 左にページ位置の点列、右に操作説明。
    // 正確な件数はホバーへ（探すモードでも、まず要るのは現在地と残りの量）
    const foot = document.createElement("div");
    foot.className = "cand-grid-foot";
    const pages = Math.max(1, Math.ceil(cands.length / per));
    const page = Math.floor(idx / per);
    foot.title = `全 ${cands.length} 件・${pages} ページ中 ${page + 1} ページ目`;
    const help = document.createElement("span");
    help.textContent = "Tab=次の列 / 1-9=列の中 / Esc=閉じる";
    foot.append(pageDots(pages, page), help);
    gridEl.replaceChildren(grid, foot);
    gridEl.hidden = false;
  }

  /** 二層目グリッドの列移動。dir=+1 で右隣の列頭、-1 で左隣。端は循環 */
  function gridMoveCol(cands: string[], idx: number, dir: 1 | -1): void {
    const rows = gridRows();
    const lastCol = Math.floor((cands.length - 1) / rows);
    let col = Math.floor(idx / rows) + dir;
    if (col > lastCol) col = 0;
    if (col < 0) col = lastCol;
    fep.selectCandidate(Math.min(col * rows, cands.length - 1));
  }

  /** パネル下部の注記: いまの文節が実際に何件 → 何件になったかを出す（数値決めの材料） */
  function updateFoldNote(): void {
    if (!foldParams) return;
    const noteEl = document.getElementById("fold-note");
    if (!noteEl) return;
    const seg = lastSegments.find((s) => s.kind === "focus");
    const total = seg?.candidates?.length;
    const l1 = seg?.foldCount ?? total;
    noteEl.textContent = total === undefined || l1 === undefined
      ? `1 ページ ${foldParams.pageSize} 件 / グリッド ${foldParams.gridRows}×${foldParams.gridCols} = ${gridPageSize()} 件`
      : `いまの文節: 全 ${total} 件 → 一層目 ${l1} 件 / 二層目 ${total - l1} 件`
        + `（1 ページ ${foldParams.pageSize} 件・グリッド ${foldParams.gridRows}×${foldParams.gridCols}）`;
  }

  /** 展開中の注目文節（候補一覧と選択位置）。二層目のキー処理で使う */
  function expandedFocus(): { cands: string[]; idx: number } | null {
    const seg = lastSegments.find((s) => s.kind === "focus");
    if (!seg?.expanded || !seg.candidates || seg.candidateIndex === undefined) return null;
    return { cands: seg.candidates, idx: seg.candidateIndex };
  }

  // ---- セッション（ホスト = このエディタ） ----

  // フリック postModify（゛゜小トグル）の対象特定用: 合成表示テキストを控える
  // （更新は renderComposition の先頭で一元的に行う）
  let flickComposingText = "";

  const fep = Hechima.createFep({
    show: (segments) => {
      config.recordSink?.show?.(segments);
      renderComposition(segments);
    },
    hide: () => {
      config.recordSink?.hide?.();
      renderComposition([]);
    },
    commit: (text) => {
      config.recordSink?.commit?.(text);
      snapshot();
      renderComposition([]); // 未確定 span を畳んでから
      insertTextAtCaret(text);
      afterEdit();
    },
    hostKey: (name) => {
      // 編集キー委譲（薙刀式 T/Y/U の specialAction → 空バッファ時）
      const sel = window.getSelection();
      const canModify = !!sel && typeof sel.modify === "function";
      if (name === "ArrowLeft") { if (canModify) sel.modify("move", "backward", "character"); }
      else if (name === "ArrowRight") { if (canModify) sel.modify("move", "forward", "character"); }
      else if (name === "Backspace") {
        snapshot();
        if (deleteBeforeCaret(1)) afterEdit();
      }
    },
    retract: (text) => {
      // 確定アンドゥ（Ctrl+BS）の文書側協力: キャレット直前が確定テキストと一致するなら取り除く
      const off = caretOffset();
      if (!docText().slice(0, off).endsWith(text)) return false;
      snapshot();
      const r = rangeAt(off - text.length, off);
      if (!r) return false;
      r.deleteContents();
      editorEl.normalize();
      setCaretByOffset(off - text.length);
      afterEdit();
      forceTextRepaint(); // 確定アンドゥも削除 = 残像対策
      return true;
    },
    ...conn.callbacks(),
  }, foldParams ? { fold: foldOptionsOf(foldParams) } : undefined);
  fep.setActive(true);

  // ---- 配列（keymap-format JSON。セレクタはページ config 次第） ----

  async function setKeymap(layout: string): Promise<void> {
    const id = config.keymap;
    if (!id) {
      fep.setEngine(null);
      return;
    }
    // **KeymapEngine はページの HTML が読み込む**（`/vendor/keymap-engine/keymap-engine.js`）。
    // 忘れると以前はここで例外になり、握りつぶされて**内蔵ローマ字のまま黙って動いていた**
    // ——「cya が ちゃ にならない」等の綴りの欠けとしてしか現れず、原因に辿り着きにくい。
    // 気づける形にする（`scripts/check-keymap-script.mjs` がビルド時にも検査する）。
    if (typeof KeymapEngine === "undefined") {
      setStatus(`配列エンジンが読み込まれていません（このページの HTML に keymap-engine.js の script タグが要ります）`);
      return;
    }
    const res = await fetch(`/vendor/keymaps/${id}.json`);
    if (!res.ok) {
      setStatus(`配列の読み込みに失敗: ${id} (HTTP ${res.status})`);
      return;
    }
    // v2: レイアウトは**ホストが決める**。役 → 物理キーの追加バインドがこれで決まる
    const engine = new KeymapEngine.InputEngine(
      KeymapEngine.decodeKeymap(await res.json(), layout ? { layout } : {}),
    );
    engine.onStateChange = () => fep.pumpEngine();
    fep.setEngine(engine, (tap) => KeymapEngine.keyEventFromBrowser(tap));
  }

  // 外から配列を差し込む口（`/keymaps/` 実験ページ）。ここだけは fetch を経由せず、
  // 呼び出し側が持っている JSON をそのまま decode する
  config.onKeymapControl?.({
    async load(
      json: unknown,
      layout?: string,
      roleOverrides?: Map<string, string[]>,
    ): Promise<void> {
      if (typeof KeymapEngine === "undefined") {
        throw new Error("配列エンジンが読み込まれていません（HTML に keymap-engine.js の script タグが要ります）");
      }
      // 役 → 物理キーの上書きはホストの領分（v2 の芯）。読み込み側が選ばせた結果が入る
      const opts: { layout?: string; roleOverrides?: Map<string, string[]> } = {};
      if (layout) opts.layout = layout;
      if (roleOverrides && roleOverrides.size > 0) opts.roleOverrides = roleOverrides;
      const engine = new KeymapEngine.InputEngine(KeymapEngine.decodeKeymap(json, opts));
      engine.onStateChange = () => fep.pumpEngine();
      fep.setEngine(engine, (tap) => KeymapEngine.keyEventFromBrowser(tap));
    },
  });

  if (keymapSelect) {
    keymapSelect.addEventListener("change", () => {
      void setKeymap(keymapSelect.value);
      editorEl.focus(); // そのまま打鍵を続けられるように
    });
    void setKeymap(keymapSelect.value); // ページの既定配列を即ロード
  } else if (config.keymap) {
    // レイアウトセレクタを持たないページ。**ここが無いと config.keymap が黙って無視され**、
    // 内蔵ローマ字のまま動いてしまう（セレクタのあるページだけが engine 経路だった）
    void setKeymap(config.keymapLayout ?? "");
  }

  $<HTMLButtonElement>("clear").addEventListener("click", () => {
    snapshot();
    fep.reset();
    compEl = null;
    editorEl.textContent = "";
    popupEl.hidden = true;
    afterEdit();
    editorEl.focus();
  });

  $<HTMLButtonElement>("reset-learning").addEventListener("click", () => {
    // OPFS の保存分を消してから再読み込み（メモリ内の学習は再ロードで消える）
    void saveDocNow().then(() => conn.clearLearning()).finally(() => location.reload());
  });

  // ---- ユーザー辞書（ページ内直置き UI） ----

  const dictPanel = $<HTMLDetailsElement>("dict-panel");
  const dictListEl = $<HTMLUListElement>("dict-list");
  const dictMsgEl = $<HTMLSpanElement>("dict-msg");
  const POS_NAMES: Record<number, string> = { 1: "名詞", 4: "固有名詞", 5: "人名", 9: "地名" };

  function renderDict(entries: Hechima.DictEntry[] | null): void {
    if (entries === null) {
      dictMsgEl.textContent = "ユーザー辞書は利用できません";
      return;
    }
    dictListEl.replaceChildren(
      ...entries.map((e, i) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `${e.reading} → ${e.word}（${POS_NAMES[e.pos] ?? "その他"}）`;
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "削除";
        del.addEventListener("click", () => {
          void conn.dictRemove(i).then(renderDict);
        });
        li.append(label, del);
        return li;
      }),
    );
    if (!entries.length) {
      const li = document.createElement("li");
      li.textContent = "（登録なし。よみと単語を入れて登録すると、すぐ変換候補に出ます）";
      dictListEl.replaceChildren(li);
    }
  }

  dictPanel.addEventListener("toggle", () => {
    if (dictPanel.open) void conn.dictList().then(renderDict);
  });

  $<HTMLFormElement>("dict-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const readingEl = $<HTMLInputElement>("dict-reading");
    const wordEl = $<HTMLInputElement>("dict-word");
    const reading = readingEl.value.trim();
    const word = wordEl.value.trim();
    const pos = Number($<HTMLSelectElement>("dict-pos").value) || 1;
    if (!reading || !word) return;
    dictMsgEl.textContent = "登録中…";
    void conn.dictAdd(reading, word, pos).then((entries) => {
      if (entries) {
        dictMsgEl.textContent = "";
        readingEl.value = "";
        wordEl.value = "";
        renderDict(entries);
        readingEl.focus();
      } else {
        // wasm 側で Mozc 純正のよみ検証（かな + 英数字は可、漢字等は不可）に弾かれた等
        dictMsgEl.textContent = "登録できませんでした — よみに使えない文字（漢字など）があります";
      }
    });
  });

  // ---- 二層化パラメータのパネル（/candlayer/） ----

  if (foldParams) {
    const ids = ["delta", "min", "max", "page", "rows", "cols"] as const;
    const noteEl = document.getElementById("fold-note");
    const apply = (): void => {
      if (!foldParams) return;
      const get = (id: string, fallback: number): number => {
        const el = document.getElementById(`fold-${id}`) as HTMLInputElement | null;
        const v = el ? Number(el.value) : NaN;
        return Number.isFinite(v) ? v : fallback;
      };
      foldParams = {
        costDelta: get("delta", foldParams.costDelta),
        minCandidates: get("min", foldParams.minCandidates),
        maxCandidates: get("max", foldParams.maxCandidates),
        pageSize: get("page", foldParams.pageSize),
        gridRows: get("rows", foldParams.gridRows),
        gridCols: get("cols", foldParams.gridCols),
      };
      // Δ=0 は「二層化しない」= 従来どおり全候補を 1 つの流れで見せる
      fep.setFold(foldParams.costDelta > 0 ? foldOptionsOf(foldParams) : null);
      void noteEl;
      updateFoldNote();
    };
    for (const id of ids) {
      document.getElementById(`fold-${id}`)?.addEventListener("input", apply);
    }
    apply();
  }

  // ---- 再変換（確定済みテキストを選択して 変換キー / Ctrl+/） ----

  async function doReconvert(): Promise<void> {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editorEl.contains(range.startContainer) || !editorEl.contains(range.endContainer)) return;
    const surface = sel.toString();
    if (!surface || surface.includes("\n") || Array.from(surface).length > 64) return;
    snapshot(); // 逆変換不能時や Ctrl+Z での復元用
    range.deleteContents();
    editorEl.normalize();
    range.collapse(true);
    selectRange(range); // キャレットを取り除いた位置へ（composition がここに開く）
    // ★await の前に確定させる。ここを飛ばすと「文書から消えた」より先に「未確定表示が出た」が
    // 記録され、リプレイに実在しない中間状態（元テキストが残ったまま未確定が出る）が現れる。
    // 最終文書は正しいままなので docHash では捕まらない（labo docs/hechima-replay-design.md §3-1）
    afterEdit();
    const ok = await fep.reconvert(surface);
    if (!ok) insertTextAtCaret(surface); // 逆変換不能 → 元に戻す
    afterEdit();
    forceTextRepaint(); // 再変換も選択削除を伴う = 残像対策
  }

  // ---- キー捕捉 ----

  window.addEventListener("keydown", (e) => {
    if (e.metaKey) return; // OS/ブラウザのショートカットは奪わない
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement ||
        e.target instanceof HTMLInputElement) return; // 辞書フォーム等の入力は素通し
    // リプレイ記録: ここが打鍵の唯一の入口（フォーム類を除いたあと）
    config.recordSink?.keyDown?.(e);
    // 候補の二層化（/candlayer/）のキー。セッションの routing には触れず、
    // 数字キーと同じくホスト側の方針としてここで先取りする
    if (foldParams && !e.ctrlKey && !e.altKey) {
      const ex = expandedFocus();
      if (e.key === "Tab") {
        // 一層目なら二層目を開く。既に開いていれば次（Shift で前）の列頭へ
        if (ex) gridMoveCol(ex.cands, ex.idx, e.shiftKey ? -1 : 1);
        else if (!fep.expandCandidates()) return; // 二層目が無ければブラウザに委ねる
        e.preventDefault();
        return;
      }
      if (ex && e.key === "Escape") {
        fep.collapseCandidates();
        e.preventDefault();
        return;
      }
      if (ex && /^[1-9]$/.test(e.key)) {
        // 列の中の行を選ぶ（列内縦流れなので「現在の列頭 + n-1」）
        const rows = gridRows();
        const target = Math.floor(ex.idx / rows) * rows + (Number(e.key) - 1);
        if (target < ex.cands.length && fep.selectCandidate(target)) {
          e.preventDefault();
          return;
        }
      }
    }
    // 候補ポップアップ表示中の数字 1-9 = ウィンドウ内の直接選択（標準 IME の作法）。
    // セッションのキー routing には触れず、ホスト側の方針としてここで先取りする
    if (popupVisible() && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      // 番号は画面の左からの位置。縦書きの右→左流ではウィンドウ内の優先順と逆転する
      const d = Number(e.key);
      const sel = vertical && !candFlowLtr ? candWindowCount - d : d - 1;
      if (sel >= 0 && fep.selectCandidate(winStart + sel)) {
        e.preventDefault();
        return;
      }
    }
    // 再変換: 確定済みテキストを選択して 変換キー（JIS）/ Ctrl+/（US 向け）
    if (!compositionActive() && (e.code === "Convert" || (e.ctrlKey && !e.altKey && e.key === "/"))) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
          editorEl.contains(sel.getRangeAt(0).startContainer)) {
        e.preventDefault();
        void doReconvert();
        return;
      }
    }
    // 縦書き: 矢印キーを見た目の向きに一致させる（90° 回転して論理キーへ写像）。
    // 論理 ←→（文節移動 / Shift = 伸縮）は行に沿う方向 → 物理 ↑↓、
    // 論理 ↑↓（前候補 / 次候補）は段の進む方向 → 物理 ←→（rl は ← が次候補、lr は →）
    if (vertical && compositionActive() && e.key.startsWith("Arrow")) {
      const map: Record<string, string> = candFlowLtr
        ? { ArrowDown: "ArrowRight", ArrowUp: "ArrowLeft", ArrowRight: "ArrowDown", ArrowLeft: "ArrowUp" }
        : { ArrowDown: "ArrowRight", ArrowUp: "ArrowLeft", ArrowLeft: "ArrowDown", ArrowRight: "ArrowUp" };
      const key = map[e.key];
      if (key && fep.feed({ key, code: key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey })) {
        e.preventDefault();
      }
      return; // 未消費でも素の矢印は二重に流さない（composing 中の native キャレット移動は不可）
    }
    if (fep.feed(e)) {
      e.preventDefault();
      return;
    }
    // ---- セッションが飲まなかったキー = エディタの文書操作 ----
    // 縦書き: 変換中でない矢印も見た目の向きへ写像する。Safari は vertical-rl の
    // contenteditable で矢印を論理方向のまま動かす（Chrome は視覚方向に再写像する）ため、
    // native に任せず自前の sel.modify で全ブラウザ統一する。
    // 視覚 ↓↑ = 字送り（forward/backward character）、視覚 ←→ = 行移動（forward/backward line）
    if (vertical && !e.ctrlKey && !e.altKey && e.key.startsWith("Arrow")) {
      const sel = window.getSelection();
      if (sel && typeof sel.modify === "function" && sel.rangeCount > 0 &&
          editorEl.contains(sel.getRangeAt(0).startContainer)) {
        const alter = e.shiftKey ? "extend" : "move";
        if (e.key === "ArrowDown") sel.modify(alter, "forward", "character");
        else if (e.key === "ArrowUp") sel.modify(alter, "backward", "character");
        else if (e.key === "ArrowLeft") sel.modify(alter, "forward", "line");
        else sel.modify(alter, "backward", "line");
        e.preventDefault();
        scrollCaretIntoView();
        updateVCaret();
        return;
      }
    }
    // 縦書き: BS/Delete と直接文字も native に任せない。Safari は native 編集の後、
    // 壊れた縦書きキャレット矩形（改行数に比例して下へずれる）へ向けて「見せるための」
    // スクロールをページ側にも行うため、文末近くの編集でページが最下部まで飛ぶ
    if (vertical && !e.ctrlKey && !e.altKey &&
        (e.key === "Backspace" || e.key === "Delete") && document.activeElement === editorEl) {
      ensureEditorSelection();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) {
        e.preventDefault();
        snapshot();
        if (!sel.isCollapsed) {
          sel.getRangeAt(0).deleteContents();
          editorEl.normalize();
          setCaretByOffset(caretOffset()); // テキストノード内オフセットへ再アンカー
        } else if (e.key === "Backspace") {
          deleteBeforeCaret(1);
        } else {
          deleteAfterCaret(1);
        }
        afterEdit();
        forceTextRepaint(); // 削除は残像（ペイント無効化漏れ）が出やすい
        return;
      }
    }
    if (vertical && !e.ctrlKey && !e.altKey && e.key.length === 1 &&
        document.activeElement === editorEl) {
      // セッションが飲まなかった 1 文字キー（数字・記号・空白等）の直接挿入も自前で
      ensureEditorSelection();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorEl.contains(sel.getRangeAt(0).startContainer)) {
        e.preventDefault();
        snapshot();
        insertTextAtCaret(e.key);
        afterEdit();
        return;
      }
    }
    if (e.ctrlKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.ctrlKey && !e.altKey && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey) {
      // contenteditable の native Enter は <div>/<br> を作るので平文の \n に統一する
      e.preventDefault();
      snapshot();
      insertTextAtCaret("\n");
      afterEdit();
      return;
    }
    // Backspace / 矢印 / Home / End / Delete などは contenteditable の native に任せる
    // （native 編集のスナップショットは beforeinput で取る）
  });
  window.addEventListener("keyup", (e) => {
    config.recordSink?.keyUp?.(e);
    fep.feedUp(e);
  });

  // リプレイ記録: キャレット・選択の移動は afterEdit を通らない（編集を伴わないので）。
  // 素通しの矢印キーも cb.hostKey の sel.modify もここでしか捕まらない
  document.addEventListener("selectionchange", () => {
    if (!config.recordSink?.caret) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (!editorEl.contains(sel.getRangeAt(0).startContainer)) return; // エディタ外の選択は無視
    const pt = recordPoints();
    config.recordSink.caret(pt.caret, pt.anchor);
  });

  // native 編集（BS・Delete・数字等の透過入力）の undo スナップショットと保存。
  // 縦書きは native 編集経路ゼロ（全編集を自前処理）なので、ここに届く beforeinput は
  // すべて OS 側の割り込み（Android 物理キーボードのオートコレクト = 入力のローマ字を
  // 単語として挿入してくる等）。防げるものは防ぎ、検出したら設定案内を一度だけ出す
  let autocorrectWarned = false;
  editorEl.addEventListener("beforeinput", (e) => {
    if (!vertical) {
      snapshot();
      return;
    }
    if (e.cancelable) e.preventDefault();
    if (!autocorrectWarned) {
      autocorrectWarned = true;
      setStatus("⚠ OS の自動修正（オートコレクト）が編集に割り込んだためブロックしました。物理キーボードの設定で自動修正をオフにすると確実です");
    }
  });
  editorEl.addEventListener("input", () => afterEdit());

  // 貼り付けはプレーンテキストに剥がす
  editorEl.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    // リプレイ記録: 内容は doc 層の ins に出るので、ここでは「貼り付けだった」ことだけ残す
    config.recordSink?.paste?.(Array.from(text).length);
    snapshot();
    insertTextAtCaret(text);
    afterEdit();
  });

  // 未確定のままエディタをクリック → 現在の内容で確定してからカーソル移動（標準 IME の挙動）
  editorEl.addEventListener("mousedown", () => {
    if (compositionActive()) fep.feed({ key: "Enter" });
  });

  // OS 側 IME の検出: このページは自前で変換するため、OS の日本語 IME がオンだと
  // 未確定文字の混入・同時打鍵の判定崩れが起きる。composition イベント / key="Process" で
  // 検出して警告し、直ったら（通常キーが来たら）表示を戻す
  let osImeWarned = false;
  function warnOsIme(): void {
    osImeWarned = true;
    statusEl.textContent =
      "⚠ OS 側の日本語 IME がオンのようです。このページは自前で変換するので、OS の IME はオフ（英数直接入力）にしてください";
  }
  editorEl.addEventListener("compositionstart", warnOsIme);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Process" || e.keyCode === 229) warnOsIme();
    else if (osImeWarned && e.key.length === 1) {
      osImeWarned = false;
      refreshStatus(); // IME オフに直った → 通常表示へ
    }
  }, true);

  // ---- フリック入力（タッチ端末向け。flick-engine + flickmap 駆動） ----
  // エディタは inputmode="none" で OS ソフトウェアキーボードを抑止し、自前フリック UI
  // だけを入力手段にする（hechima は OS IME 非依存なので成立する）。

  const flickToggle = $<HTMLButtonElement>("flick-toggle");
  const flickPanel = $<HTMLDivElement>("flick-panel");
  const flickArea = $<HTMLDivElement>("flick-area");
  let flickKbd: { setComposing(on: boolean): void; destroy(): void } | null = null;

  // fep が飲まなかった機能キー = エディタ操作（物理キーボード keydown の素通し分と同じ扱い）
  function applyFlickHostKey(tap: Hechima.KeyTap): void {
    const sel = window.getSelection();
    const canModify = !!sel && typeof sel.modify === "function";
    // 範囲選択中か（ゲームパッドの RT+LS で作った選択等）
    const selected = !!sel && sel.rangeCount > 0 && !sel.isCollapsed &&
      editorEl.contains(sel.getRangeAt(0).startContainer);
    // 矢印の Shift 併用（RT+LS 由来）は選択拡張 extend、単独は移動 move
    const alter = tap.shiftKey ? "extend" : "move";
    // 戻す（undo アクション = Ctrl+BS）: 確定アンドゥ不成立で透過されたら文書 undo に落とす
    if (tap.ctrlKey && tap.key === "Backspace") { undo(); return; }
    // やり直し（redo アクション = Ctrl+y。ゲームパッドの RT+Start。物理キーボードの Ctrl+Y と同経路）
    if (tap.ctrlKey && (tap.key === "y" || tap.key === "Y")) { redo(); return; }
    if (tap.key === "Enter") { snapshot(); insertTextAtCaret("\n"); afterEdit(); }
    else if (tap.key === " ") { snapshot(); insertTextAtCaret(" "); afterEdit(); }
    else if (tap.key === "Backspace") {
      snapshot();
      if (selected) {
        // 選択があれば範囲ごと削除（縦書きの BS ハンドラと同じ手順）
        sel.getRangeAt(0).deleteContents();
        editorEl.normalize();
        setCaretByOffset(caretOffset());
        afterEdit();
      } else if (deleteBeforeCaret(1)) {
        afterEdit();
      }
    }
    else if (tap.key === "ArrowLeft") { if (canModify) sel.modify(alter, "backward", "character"); }
    else if (tap.key === "ArrowRight") { if (canModify) sel.modify(alter, "forward", "character"); }
    else if (tap.key === "ArrowUp") { if (canModify) sel.modify(alter, "backward", "line"); }
    else if (tap.key === "ArrowDown") { if (canModify) sel.modify(alter, "forward", "line"); }
  }

  async function enableFlick(): Promise<void> {
    if (flickKbd) return;
    const res = await fetch("/vendor/flick/flick_standard.json");
    const map = FlickEngine.decodeFlickmap(await res.json());
    flickKbd = FlickEngine.mount(flickArea, map, {
      getComposingTail: () => flickComposingText,
      onOp(op) {
        if (op.type === "kana") fep.insertKana(op.text, op.replace);
        else if (op.type === "key") { if (!fep.feed(op.tap)) applyFlickHostKey(op.tap); }
        else if (op.type === "text") { snapshot(); insertTextAtCaret(op.text); afterEdit(); }
      },
    });
    flickPanel.hidden = false;
    document.body.classList.add("flick-on");
    editorEl.setAttribute("inputmode", "none");
    flickToggle.textContent = "フリックを隠す";
    editorEl.focus();
  }

  function disableFlick(): void {
    if (!flickKbd) return;
    flickKbd.destroy();
    flickKbd = null;
    flickCandsEl.replaceChildren();
    flickPanel.hidden = true;
    document.body.classList.remove("flick-on");
    editorEl.removeAttribute("inputmode");
    flickToggle.textContent = "フリック";
  }

  flickToggle.addEventListener("click", () => {
    if (flickKbd) disableFlick();
    else void enableFlick();
  });

  // パネルの余白タップがダブルタップズームに化けないように（キーボード root 側のガードと重ねる）。
  // 候補バーだけは除外する（touchend を止めると iOS の慣性スクロールが死ぬ。
  // バー自体は touch-action: pan-x でズームを抑止）
  flickPanel.addEventListener("touchend", (e) => {
    if ((e.target as HTMLElement).closest?.("#flick-cands")) return;
    e.preventDefault();
  }, { passive: false });

  // ---- 候補バー（フリック時のポップアップ代替。キーボード上部の横スクロール帯） ----
  // 高さは常時確保（候補の出入りでキーボードが上下にズレないように）。
  // タップ選択は pointer イベント + 移動量判別（横スクロールと区別）。
  // 追加候補（ひらがな/カタカナ展開）は注釈スタイルで表示のみ — 選択は ↑↓（カーソル
  // キーの上下フリック）で行う（selectCandidate は通常候補のみ対象のため）。

  const flickCandsEl = $<HTMLDivElement>("flick-cands");

  function renderFlickCandBar(segments: Hechima.SegmentView[]): void {
    const focusIdx = segments.findIndex((s) => s.kind === "focus");
    const seg = focusIdx >= 0 ? segments[focusIdx] : undefined;
    const cands = seg?.candidates;
    const idx = seg?.candidateIndex;
    const additional = seg?.additional ?? [];
    if (!seg || !cands || idx === undefined || (cands.length < 2 && additional.length === 0)) {
      flickCandsEl.replaceChildren();
      return;
    }
    const inAdditional = seg.additionalIndex !== undefined;
    const items: HTMLElement[] = [];
    additional.forEach((a, i) => {
      const item = document.createElement("span");
      item.className = "fcand fcand-addl" + (inAdditional && i === seg.additionalIndex ? " selected" : "");
      item.textContent = a.text;
      item.title = a.annotation;
      items.push(item);
    });
    cands.forEach((text, i) => {
      const item = document.createElement("span");
      item.className = "fcand" + (!inAdditional && i === idx ? " selected" : "");
      item.textContent = text;
      item.dataset.idx = String(i);
      items.push(item);
    });
    flickCandsEl.replaceChildren(...items);
    flickCandsEl.querySelector(".selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  let flickCandPress: { x: number; y: number; idx: number } | null = null;
  flickCandsEl.addEventListener("pointerdown", (e) => {
    const t = (e.target as HTMLElement).closest?.(".fcand") as HTMLElement | null;
    flickCandPress = t?.dataset.idx !== undefined
      ? { x: e.clientX, y: e.clientY, idx: Number(t.dataset.idx) }
      : null;
  });
  flickCandsEl.addEventListener("pointerup", (e) => {
    if (!flickCandPress) return;
    const moved = Math.hypot(e.clientX - flickCandPress.x, e.clientY - flickCandPress.y);
    const idx = flickCandPress.idx;
    flickCandPress = null;
    if (moved < 8) fep.selectCandidate(idx);
  });
  // 候補バーをマウスで押してもエディタのフォーカスを奪わない（PC でフリックを試すとき用。
  // タッチは panel の touchend 抑止が担う）
  flickCandsEl.addEventListener("mousedown", (e) => e.preventDefault());

  // フリックの出し方はページ config 次第:
  //   "on"  = 即マウント（/flick/ 実験ページ。PC でもマウスで試せる）
  //   "off" = ボタンを出さない（既定。物理キーボード / ゲームパッド専用ページ）
  if (flickMode === "on") {
    flickToggle.hidden = false;
    void enableFlick();
  }

  // ---- ゲームパッド入力（gamepad-engine 駆動。日本語のみ。物理キーボードと併用可） ----
  // gamepad は keyboard イベントを介さないので物理キーボードと併用できる。一方 iPad では
  // エディタをタップしてフォーカスする必要があり、素の contenteditable だと OS ソフトウェア
  // キーボードが出てしまう。よって有効化時に inputmode="none" を立て、画面キーボードだけ
  // 抑止する（物理キーボード入力は inputmode の影響を受けない）。
  // エディタの下にビジュアライザを出し、onOp を fep へ配線する（配線はフリックと同型 =
  // kana→insertKana / key→feed→未消費は applyFlickHostKey）。候補は通常ポップアップのまま。
  let gamepadCtl: { setEnabled(on: boolean): void; stop(): void } | null = null;
  let gamepadViz: { update(s: unknown): void; destroy(): void } | null = null;

  function enableGamepad(): void {
    if (gamepadCtl) return;
    editorEl.setAttribute("inputmode", "none"); // iPad: タップフォーカス時に OS ソフトキーボードを出さない
    const area = document.createElement("div");
    area.className = "gamepad-area";
    $<HTMLElement>("app").appendChild(area);
    gamepadViz = GamepadEngine.mount(area);
    gamepadCtl = GamepadEngine.start({
      getComposingTail: () => flickComposingText, // 合成表示テキスト（renderComposition が更新）
      onState: (s) => gamepadViz?.update(s),
      enabled: document.activeElement === editorEl,
      onOp(op) {
        if (op.type === "kana") fep.insertKana(op.text, op.replace);
        else if (op.type === "key") {
          // Start（Ctrl+BS）: 非合成で範囲選択があれば「戻す」ではなく再変換に振る
          // （確定直後は選択が無いので確定アンドゥと衝突しない）。
          if (op.tap.ctrlKey && op.tap.key === "Backspace" && !compositionActive()) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
                editorEl.contains(sel.getRangeAt(0).startContainer)) {
              void doReconvert();
              return;
            }
          }
          if (!fep.feed(op.tap)) applyFlickHostKey(op.tap);
        }
      },
    });
    // 入力はエディタにフォーカスがあるときだけ有効（物理キーボードと同じ前提）
    editorEl.addEventListener("focus", () => gamepadCtl?.setEnabled(true));
    editorEl.addEventListener("blur", () => gamepadCtl?.setEnabled(false));
  }

  if ((config.gamepad ?? "off") === "on") enableGamepad();

  // ページを離れるときに保存を確実に
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saveDocNow();
  });

  // ---- 起動: 保存文書の復元 ----

  void initStorage().then((text) => {
    if (text) {
      editorEl.textContent = text;
      ensureEofBr();
      // 保存済みキャレット位置へ復帰（無ければ末尾）。書きかけの場所から再開できる
      let caret = text.length;
      try {
        const saved = Number(localStorage.getItem(CARET_LS_KEY));
        if (Number.isFinite(saved) && saved >= 0) caret = Math.min(saved, text.length);
      } catch { /* 保存不可環境 */ }
      setCaretByOffset(caret);
      scrollCaretIntoView(); // 縦書きはキャレット行が見える位置まで送る
    }
    ensureEofBr(); // 空文書でもセンチネルを立てる
    updateCounts();
    refreshStatus();
    editorEl.focus();
    if (vertical) {
      // 起動直後はフォント/レイアウト確定前でキャレット測定がずれることがある → 確定後に再測
      requestAnimationFrame(() => updateVCaret());
      void document.fonts.ready.then(() => updateVCaret());
    }
  });
}
