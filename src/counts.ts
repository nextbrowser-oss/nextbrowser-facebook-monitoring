// Reading a count the way Facebook draws it.
//
// Below a thousand Facebook prints the exact number ("23 comments"); above it
// a rounded figure with a unit ("1.2K comments", "1,2 тыс."), in the viewer's
// locale. The reaction count under a post is drawn on its own ("1.2K"), or as
// "You and 12 others" / "Mila Novak and 4 others" when people the account
// knows reacted. Every count here is what the page drew, so a rounded figure
// is still worth recording, but a change inside its rounding is invisible.
// (The figure reading is the X monitor's src/counts.ts.)

export interface ParsedCount {
  value: number;
  /** True when Facebook rounded the figure and printed a unit. */
  approximate: boolean;
}

/** Units used across locales, by what they multiply. Lowercased, without the
 *  trailing dot some locales abbreviate with. */
const UNITS: Record<string, number> = {
  // thousand
  k: 1e3, "тыс": 1e3, "тис": 1e3, mil: 1e3, "千": 1e3, "천": 1e3, rb: 1e3, tys: 1e3,
  // ten thousand (CJK)
  "万": 1e4, "萬": 1e4, "만": 1e4,
  // million
  m: 1e6, mln: 1e6, "млн": 1e6, mio: 1e6, mi: 1e6, mn: 1e6, jt: 1e6,
  // billion
  b: 1e9, bn: 1e9, mrd: 1e9, "млрд": 1e9,
};

const NUMBER_PATTERN = /^([+-]?\d[\d\s.,'  ]*)(\S*)/u;
const GROUP_SEPARATORS = /[\s'  ]/gu;

/** parseCount reads the leading figure of a label such as "23 comments" or
 *  "1.2K". Anything that does not start with a figure is not a count and
 *  returns undefined. */
export function parseCount(label: string | null | undefined): ParsedCount | undefined {
  const firstLine = String(label ?? "").trim().split(/\n/u)[0]?.trim() ?? "";
  const match = NUMBER_PATTERN.exec(firstLine);
  if (!match) return undefined;
  const digits = (match[1] ?? "").replace(GROUP_SEPARATORS, "");
  const unit = (match[2] ?? "").toLowerCase().replace(/\.+$/u, "");
  const multiplier = UNITS[unit];
  if (multiplier === undefined) {
    // No unit: the figure is an exact integer and every separator in it
    // groups thousands, whatever the locale uses for them.
    const whole = digits.replace(/[.,]/gu, "");
    if (!/^[+-]?\d+$/u.test(whole)) return undefined;
    return { value: Number(whole), approximate: false };
  }
  const value = Number(decimal(digits));
  if (!Number.isFinite(value)) return undefined;
  return { value: Math.round(value * multiplier), approximate: true };
}

/** decimal turns "92,3" or "1.2" or "1,234.5" into a JavaScript decimal: with
 *  both separators present the last one is the decimal point; with one kind, a
 *  figure that carries a unit uses it as the decimal point. */
function decimal(digits: string): string {
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  if (lastDot < 0 && lastComma < 0) return digits;
  const point = Math.max(lastDot, lastComma);
  const whole = digits.slice(0, point).replace(/[.,]/gu, "");
  return `${whole}.${digits.slice(point + 1)}`;
}

/** "You and 12 others", "Mila Novak and 4 others": the named person plus the
 *  figure. */
const AND_OTHERS = /\band\s+(\d[\d\s.,'  ]*\S*)\s+others?\s*$/iu;

/** reactionCount reads a post's reaction label, in either of the forms
 *  Facebook draws it. A label that names people and no figure ("Mila Novak")
 *  is one reaction. */
export function reactionCount(label: string | null | undefined): number | undefined {
  const text = String(label ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  const others = AND_OTHERS.exec(text);
  if (others) {
    const figure = parseCount(others[1]);
    return figure ? figure.value + 1 : undefined;
  }
  const figure = parseCount(text);
  if (figure) return figure.value;
  return /^[\p{L}][\p{L}\s.'-]{1,80}$/u.test(text) ? 1 : undefined;
}

/** commentCount reads "23 comments", "1 comment" or "1.2K comments". */
export function commentCount(label: string | null | undefined): number | undefined {
  return parseCount(label)?.value;
}
