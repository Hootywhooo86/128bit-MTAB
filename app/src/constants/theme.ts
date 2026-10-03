import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { ACCENTS, usePrefs, type AccentId } from '@/lib/prefs';

export type Palette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
};

/** Builds the colour palette from the chosen accent and whether AMOLED black is on. */
export function buildPalette(accent: AccentId, amoled: boolean): Palette {
  const a = ACCENTS[accent] ?? ACCENTS.amber;
  const base = amoled
    ? {
        background: '#000000',
        surface: '#121212',
        surfaceRaised: '#1C1C1C',
        border: '#262626',
      }
    : {
        background: '#121214',
        surface: '#1C1C1F',
        surfaceRaised: '#26262A',
        border: '#323236',
      };
  return {
    ...base,
    text: '#FFFFFF',
    textSecondary: '#9E9E9E',
    accent: a.color,
    accentText: a.onAccent,
    danger: '#FF5C5C',
    success: '#5CD68A',
  };
}

/** The current palette. Re-renders when the user changes theme. */
export function useColors(): Palette {
  const { prefs } = usePrefs();
  return useMemo(() => buildPalette(prefs.accent, prefs.amoled), [prefs.accent, prefs.amoled]);
}

/**
 * Like StyleSheet.create, but the styles can use the current palette:
 *   const useStyles = makeStyles((Colors) => ({ box: { backgroundColor: Colors.surface } }));
 *   const styles = useStyles();
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T & StyleSheet.NamedStyles<T>,
) {
  const cache = new Map<string, T>();
  return function useStyles(): T {
    const colors = useColors();
    const key = `${colors.accent}|${colors.background}`;
    let styles = cache.get(key);
    if (!styles) {
      styles = StyleSheet.create(pixelizeAll(factory(colors)) as T);
      cache.set(key, styles);
    }
    return styles;
  };
}

/** The 128bit pixel font. Use small sizes (8–16): it's big for its point size. */
export const PixelFont = 'PressStart2P_400Regular';

/**
 * Press Start 2P everywhere: turns a text style into the pixel font at a size that fits
 * (it's much wider than a normal font and has no bold or italic). Styles that already
 * name a font are left alone; name a style `plain…` to keep the normal font.
 */
export function pixelText<S extends Record<string, unknown>>(style: S): S {
  if (!style || typeof style !== 'object' || 'fontFamily' in style) return style;
  if (!('fontSize' in style) && !('fontWeight' in style)) return style;
  const out: Record<string, unknown> = { ...style, fontFamily: PixelFont };
  const size = typeof style.fontSize === 'number' ? style.fontSize : 15;
  const px = Math.max(7, Math.min(18, Math.round(size * 0.66)));
  out.fontSize = px;
  out.lineHeight =
    typeof style.lineHeight === 'number' ? Math.max(Math.round(px * 1.5), Math.round(style.lineHeight * 0.8)) : Math.round(px * 1.6);
  delete out.fontWeight;
  delete out.fontStyle;
  delete out.letterSpacing;
  return out as S;
}

function pixelizeAll<T extends Record<string, unknown>>(styles: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(styles)) {
    out[name] = name.startsWith('plain') ? style : pixelText(style as Record<string, unknown>);
  }
  return out as T;
}

export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
} as const;

export const Radius = { sm: 8, md: 12, lg: 20 } as const;

export const MaxContentWidth = 800;
