/* 配列ビジュアライザの刻印 — 「いま押されている状態で、このキーを押すと何が出るか」。
 *
 * 自由配置ではキーの真上に物理キーが乗っていて刻印が見えないので、画面の空いた場所に
 * 小さな配列図（カード）を出す。カードの刻印は押下の状態に応じて替わる:
 *
 *   - **同時打鍵系**（薙刀式・NICOLA・親指ぴゅん）: 押しているキーの組み合わせに、そのキーを
 *     足したときの出力。親指を押していればシフト面、F を押していれば F+J = が …
 *     配列エンジンが展開した `chordData`（キー名 → ビット・ビットの和 → 出力）をそのまま引く
 *   - **かなの逐次系**（月配列・ひたき・いすか）: 待っている打鍵（月配列の `d` …）に
 *     続けたときの出力。待っている打鍵は送り手で追う（受け手の状態は往復を待つと遅れるので）。
 *     ★これは**近似**: 配列エンジンの解決を簡単になぞるだけなので、珍しい並びでは受け手と
 *     ずれることがある（表示だけの話で、送る打鍵は変わらない）
 *   - **ローマ字系**（`inputBase: "romaji"` = ローマ字・AZIK）: かなは出さず、英字のまま。
 *     綴りは打つ人が知っているので、かなを並べても読む手間が増えるだけ（msonrm さん）。
 *     配列が自分で刻印を宣言しているキー（AZIK の q = ん・句読点）だけはそれを出す
 *   - Shift を押していれば、Shift 面の文字
 *
 * 刻印が無い（その組み合わせでは何も出ない）キーは、空で返す。
 */
import { tapFor } from "./keys";

/** 配列エンジンの展開結果のうち、ここで読むところ（keymap-engine の ExpandedKeymap） */
interface ChordData {
  hidToChordKey: Map<number, string>;
  keyBits: Map<string, number>;
  lookupTable: Map<number, string>;
  specialActions: Map<number, { type: string; text?: string }>;
}
export interface ExpandedKeymapLike {
  definition?: { inputBase?: string };
  chordData?: ChordData | null;
  inputMappings?: Record<string, string>;
  prefixSet?: Iterable<string>;
  pendingLabels?: Record<string, string>;
  characterMap?: Record<string, string>;
}

/** 1 キーの刻印 */
export interface LayerCap {
  text: string;
  /** 素の状態（何も押していない）と違う刻印か（シフトした） */
  shifted: boolean;
}

export interface Labeler {
  /** 何も押していないときの刻印（自由配置の大きなキーにも使う） */
  idle(code: string): string;
  /** いまの状態での刻印。`codes` = 刻印を求めるキー、`pressed` = 押しているキー */
  caps(codes: readonly string[], pressed: ReadonlySet<string>): Map<string, LayerCap>;
  /** キーを押した（逐次系の待っている打鍵を進める） */
  down(code: string, pressed: ReadonlySet<string>): void;
  /** いまの状態の短い説明（カードの隅に出す。待っている打鍵・押している親指…） */
  status(pressed: ReadonlySet<string>): string;
  reset(): void;
}

/** 機能（specialActions）の刻印 */
function actionCap(a: { type: string; text?: string }): string {
  switch (a.type) {
    case "moveLeft": return "←";
    case "moveRight": return "→";
    case "deleteBack": return "⌫";
    case "confirm": return "確定";
    case "convert": return "変換";
    case "insertAndConfirm": return a.text ?? "•";
    case "editSegmentLeft": return "⇤";
    case "editSegmentRight": return "⇥";
    case "switchToEnglish": return "英";
    case "switchToJapanese": return "かな";
    default: return "•";
  }
}

const SHIFTS = new Set(["ShiftLeft", "ShiftRight"]);

/**
 * @param km      配列エンジンが展開した配列（`KeymapEngine.decodeKeymap` の結果）
 * @param profile 物理配置（jis / us / ortho。キーが出す文字の表がこれで決まる）
 * @param capLabels 配列の刻印（`keyCapLabels`）。こちらが最優先
 * @param physical  物理の刻印（配列が何も言わないキー）
 * @param toHid     KeyboardEvent.code → HID（`KeymapEngine.browserCodeToHID`）
 */
export function makeLabeler(
  km: ExpandedKeymapLike,
  profile: string,
  capLabels: ReadonlyMap<string, string>,
  physical: (code: string) => string,
  toHid: (code: string) => number | undefined,
): Labeler {
  const chord = km.chordData;
  if (chord) return chordLabeler(chord, (code) => capLabels.get(code) ?? physical(code), toHid);
  return sequentialLabeler(km, profile, capLabels, physical, km.definition?.inputBase !== "romaji");
}

function chordLabeler(
  chord: ChordData,
  base: (code: string) => string,
  toHid: (code: string) => number | undefined,
): Labeler {
  const nameOf = (code: string): string | undefined => {
    const hid = toHid(code);
    return hid === undefined ? undefined : chord.hidToChordKey.get(hid);
  };
  /** 押しているキーのビットの和。★`|` は 32 ビットに丸められる（キーは 34 個まである）ので和で取る */
  const bitsOf = (codes: Iterable<string>): number => {
    const names = new Set<string>();
    for (const c of codes) {
      const n = nameOf(c);
      if (n) names.add(n);
    }
    let sum = 0;
    for (const n of names) sum += chord.keyBits.get(n) ?? 0;
    return sum;
  };
  const outOf = (bits: number): string | null => {
    const kana = chord.lookupTable.get(bits);
    if (kana !== undefined) return kana;
    const act = chord.specialActions.get(bits);
    return act ? actionCap(act) : null;
  };
  return {
    idle: base,
    caps(codes, pressed) {
      const held = bitsOf(pressed);
      const out = new Map<string, LayerCap>();
      for (const code of codes) {
        const name = nameOf(code);
        const bit = name ? chord.keyBits.get(name) : undefined;
        if (held === 0 || bit === undefined || pressed.has(code)) {
          out.set(code, { text: base(code), shifted: false });
          continue;
        }
        // 押しているキーに、もう同じキー名が含まれている（左右の親指が同じ役）なら足さない
        const already = [...pressed].some((p) => nameOf(p) === name);
        const text = already ? null : outOf(held + bit);
        out.set(code, { text: text ?? "", shifted: text !== null });
      }
      return out;
    },
    down() { /* 同時打鍵系は押している間だけの状態なので、追うものは無い */ },
    status(pressed) {
      return [...pressed].filter((c) => nameOf(c)).map(base).join("+");
    },
    reset() {},
  };
}

function sequentialLabeler(
  km: ExpandedKeymapLike,
  profile: string,
  capLabels: ReadonlyMap<string, string>,
  physical: (code: string) => string,
  /** かなを出すか（ローマ字系は false = 英字のまま・待っている打鍵も追わない） */
  kana: boolean,
): Labeler {
  const im = km.inputMappings ?? {};
  const prefixes = new Set(km.prefixSet ?? []);
  const pendingLabels = km.pendingLabels ?? {};
  const charMap = km.characterMap ?? {};
  const has = (s: string) => Object.prototype.hasOwnProperty.call(im, s);
  const charOf = (code: string, shift: boolean): string =>
    tapFor(code, profile, { shift, ctrl: false, alt: false }).key;
  let pending = "";

  /** 待っている打鍵 s のキーに出す刻印（ひたき・いすかは行の代表、それ以外はそのまま） */
  const pendingCap = (s: string) => pendingLabels[s] ?? s;
  /** 素の刻印: 配列の刻印 → 単打で出る文字（ローマ字の a = あ）→ 待つ打鍵（k）→ 物理 */
  const base = (code: string): string => {
    const cap = capLabels.get(code);
    if (cap !== undefined) return cap;
    const ch = charOf(code, false);
    if (kana && Array.from(ch).length === 1) {
      if (has(ch)) return im[ch];
      if (prefixes.has(ch)) return pendingCap(ch);
    }
    return physical(code);
  };

  return {
    idle: base,
    caps(codes, pressed) {
      const shift = [...pressed].some((c) => SHIFTS.has(c));
      const out = new Map<string, LayerCap>();
      for (const code of codes) {
        const ch = charOf(code, shift);
        if (Array.from(ch).length !== 1 || pressed.has(code)) {
          out.set(code, { text: base(code), shifted: false }); // 機能キー・押しているキー
          continue;
        }
        if (shift) {
          const t = charMap[ch] ?? (has(ch) ? im[ch] : ch);
          out.set(code, { text: t, shifted: t !== base(code) });
          continue;
        }
        if (!pending) {
          out.set(code, { text: base(code), shifted: false });
          continue;
        }
        const s = pending + ch;
        const t = has(s) ? im[s] : prefixes.has(s) ? pendingCap(s) : "";
        out.set(code, { text: t, shifted: t !== "" });
      }
      return out;
    },
    down(code, pressed) {
      if (!kana) return;
      if (code === "Backspace") {
        pending = pending.slice(0, -1);
        return;
      }
      if (SHIFTS.has(code)) return;
      const shift = [...pressed].some((c) => SHIFTS.has(c) && c !== code);
      const ch = charOf(code, shift);
      if (Array.from(ch).length !== 1 || shift) {
        pending = ""; // 空白・Enter・矢印・Shift 面の文字は待っている打鍵を流す
        return;
      }
      const s = pending + ch;
      if (prefixes.has(s)) pending = s;
      else if (!has(s) && prefixes.has(ch)) pending = ch; // 流れて、この打鍵から待ち直す（n → k）
      else pending = "";
    },
    status(pressed) {
      if ([...pressed].some((c) => SHIFTS.has(c))) return "Shift";
      return pending ? pendingCap(pending) : "";
    },
    reset() {
      pending = "";
    },
  };
}
