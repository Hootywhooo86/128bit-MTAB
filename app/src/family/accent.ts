/**
 * 128bit family — accent colour rules.
 *
 * Every 128bit app lets the user pick an accent, free, permanently. It colours
 * buttons, highlights, active tabs, progress fills and links — never data.
 * Lifted from 128bitfit's lib/accent.ts, which was the first app to get this
 * right. Pure functions only, so any app (or a test runner) can import it.
 */

export type AccentChoice = { name: string; hex: string };

/**
 * The family presets. No crimson: red is reserved for over-target and heavy
 * load, so a progress bar drawn in it would read as "over" when it meant
 * "yours". The accent must not impersonate a data colour.
 */
export const ACCENTS: AccentChoice[] = [
  { name: 'DEFAULT', hex: '#ffffff' },
  { name: 'AMBER', hex: '#ffcc3d' },
  { name: 'TEAL', hex: '#4be0c8' },
  { name: 'VIOLET', hex: '#a78bfa' },
  { name: 'AZURE', hex: '#5aa9ff' },
  { name: 'LIME', hex: '#a3e635' },
  { name: 'CORAL', hex: '#ff8552' },
  { name: 'ROSE', hex: '#ff8fc7' },
  { name: 'MINT', hex: '#6ee7a8' },
  { name: 'GOLD', hex: '#e0b84a' },
  { name: 'ICE', hex: '#9fd8ff' },
];

export const DEFAULT_ACCENT = ACCENTS[0].hex;

/** One of the eleven presets. */
export function isPreset(hex: string | null | undefined): boolean {
  return !!hex && ACCENTS.some((a) => a.hex === hex.toLowerCase());
}

/**
 * "#7af0c3", "7AF0C3", "#7fc" → "#7af0c3". Anything else → null. Typed by
 * hand, so forgiving about the # and the case, strict about the digits.
 */
export function parseHex(input: string | null | undefined): string | null {
  const t = (input ?? '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`;
  return null;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Hue 0–360, saturation and value 0–1. */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast against the app's black background (tokens.ts neutrals.bg). */
export function contrastOnBlack(hex: string): number {
  return (luminance(hex) + 0.05) / 0.05;
}

export const RED_REFUSED = "Red is kept for training load and over-target, so it can't be the accent.";
export const TOO_DARK = 'Too dark to read on the black background.';

/**
 * Why a colour can't be the accent, in one sentence — or null when it can.
 *
 * Red is out for the reason CRIMSON was dropped: the heat scale and
 * over-target are red, and an accent that matched them would make "yours"
 * read as "over". The band is narrow enough that CORAL (hue ~18°) and ROSE
 * (~330°) stay in, and washed-out pinks (low saturation) are fine.
 */
export function accentProblem(hex: string): string | null {
  const { h, s } = hexToHsv(hex);
  if ((h >= 345 || h <= 15) && s >= 0.35) return RED_REFUSED;
  if (contrastOnBlack(hex) < 3) return TOO_DARK;
  return null;
}

/** A preset, or a custom colour that passes accentProblem. */
export function isAccent(hex: string | null | undefined): hex is string {
  if (isPreset(hex)) return true;
  const parsed = parseHex(hex);
  return parsed != null && parsed === hex?.toLowerCase() && accentProblem(parsed) == null;
}

/** The preset's name, or CUSTOM for a colour picked by its code. */
export function accentName(hex: string): string {
  return ACCENTS.find((a) => a.hex === hex.toLowerCase())?.name ?? 'CUSTOM';
}

/** Black or white text on this colour — the prototype's onAccent(). */
export function onAccentFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#000000' : '#ffffff';
}

