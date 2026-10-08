/* 配列図キーボードの「押したキー → KeyTap」。
 *
 * 配列図は「理想的な物理キーボード」として振る舞うので、本物のキーボードが出すのと同じ
 * KeyboardEvent の key / code を作って送る。受け手の配列エンジンは code で引くが、
 * 逐次系（ローマ字・AZIK）は key（その配置で出る文字）を読むので、**物理配列ごとに文字が違う**
 * （JIS の Shift+2 は `"`、US は `@`）。
 *
 * 格子（オーソリニア）は記号の刻印が US なので US の表で引き、配列の layout は "jis" として扱う
 * （親指に 無変換 / 変換 を置いた、QMK 等で組む定番の形。NICOLA・薙刀式の親指がそこに乗る）。
 */

type Pair = [plain: string, shifted: string];

const LETTERS: Record<string, Pair> = Object.fromEntries(
  Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map((c) => [`Key${c}`, [c.toLowerCase(), c]]),
);

const US: Record<string, Pair> = {
  ...LETTERS,
  Backquote: ["`", "~"],
  Digit1: ["1", "!"], Digit2: ["2", "@"], Digit3: ["3", "#"], Digit4: ["4", "$"], Digit5: ["5", "%"],
  Digit6: ["6", "^"], Digit7: ["7", "&"], Digit8: ["8", "*"], Digit9: ["9", "("], Digit0: ["0", ")"],
  Minus: ["-", "_"], Equal: ["=", "+"],
  BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"],
  Semicolon: [";", ":"], Quote: ["'", "\""],
  Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"],
};

const JIS: Record<string, Pair> = {
  ...LETTERS,
  Digit1: ["1", "!"], Digit2: ["2", "\""], Digit3: ["3", "#"], Digit4: ["4", "$"], Digit5: ["5", "%"],
  Digit6: ["6", "&"], Digit7: ["7", "'"], Digit8: ["8", "("], Digit9: ["9", ")"], Digit0: ["0", "0"],
  Minus: ["-", "="], Equal: ["^", "~"], IntlYen: ["¥", "|"],
  BracketLeft: ["@", "`"], BracketRight: ["[", "{"], Backslash: ["]", "}"],
  Semicolon: [";", "+"], Quote: [":", "*"],
  Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], IntlRo: ["\\", "_"],
};

/** 文字を出さないキーの key（KeyboardEvent.key の値） */
const NAMED: Record<string, string> = {
  Space: " ",
  Enter: "Enter", Backspace: "Backspace", Tab: "Tab", Escape: "Escape", CapsLock: "CapsLock",
  ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
  ShiftLeft: "Shift", ShiftRight: "Shift",
  ControlLeft: "Control", ControlRight: "Control",
  AltLeft: "Alt", AltRight: "Alt", MetaLeft: "Meta", MetaRight: "Meta",
  Convert: "Convert", NonConvert: "NonConvert", KanaMode: "KanaMode",
};

/** 修飾キーの押下状態 */
export interface Mods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** 修飾キーなら、どれか */
export function modOf(code: string): keyof Mods | null {
  if (code === "ShiftLeft" || code === "ShiftRight") return "shift";
  if (code === "ControlLeft" || code === "ControlRight") return "ctrl";
  if (code === "AltLeft" || code === "AltRight") return "alt";
  return null;
}

/** 配列 JSON の layout（"jis" / "us"）。格子は親指に 無変換 / 変換 があるので jis */
export function keymapLayoutFor(profileId: string): "jis" | "us" {
  return profileId === "us" ? "us" : "jis";
}

/** 押したキー（code）から、本物のキーボードが出すのと同じ KeyTap を作る */
export function tapFor(code: string, profileId: string, mods: Mods): Hechima.KeyTap {
  const table = profileId === "jis" ? JIS : US;
  const pair = table[code];
  let key: string;
  if (pair) key = mods.shift ? pair[1] : pair[0];
  else if (code === "Backquote" && profileId === "jis") key = "Zenkaku";
  else key = NAMED[code] ?? "Unidentified";
  const tap: Hechima.KeyTap = { key, code };
  if (mods.shift) tap.shiftKey = true;
  if (mods.ctrl) tap.ctrlKey = true;
  if (mods.alt) tap.altKey = true;
  return tap;
}
