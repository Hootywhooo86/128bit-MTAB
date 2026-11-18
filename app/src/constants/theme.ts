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
export function buildPalette(accent: AccentId, amoled: boolean, custom?: string): Palette {
  const a =
    accent === 'custom' && custom && /^#[0-9a-f]{6}$/i.test(custom)
      ? { color: custom, onAccent: textOn(custom) }
      : (ACCENTS[accent as keyof typeof ACCENTS] ?? ACCENTS.amber);
  const base = amoled
    ? {
        background: '#000000',
        surface: '#121212',
        surfaceRaised: '#1C1C1C',
        border: '#262626',
      }
    : {
        // Night-sky pixel palette: deep blue-black, cool greys.
        background: '#0C0C14',
        surface: '#161622',
        surfaceRaised: '#20202F',
        border: '#30304A',
      };
  return {
    ...base,
    text: '#F4F4FA',
    textSecondary: '#9C9CB4',
    accent: a.color,
    accentText: a.onAccent,
    danger: '#FF5C5C',
    success: '#5CD68A',
  };
}

/** Black or white, whichever reads better on `hex`. */
export function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? '#000000' : '#FFFFFF';
}

/** The current palette. Re-renders when the user changes theme. */
export function useColors(): Palette {
  const { prefs } = usePrefs();
  return useMemo(
    () => buildPalette(prefs.accent, prefs.amoled, prefs.customAccent),
    [prefs.accent, prefs.amoled, prefs.customAccent],
  );
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
      styles = StyleSheet.create(factory(colors));
      cache.set(key, styles);
    }
    return styles;
  };
}

/**
 * The 128bit pixel fonts (Pixelify Sans): crisp pixel letters that still read at normal
 * sizes. PixelFont for labels and titles, PixelFontBold for big headings.
 */
export const PixelFont = 'PixelifySans_600SemiBold';
export const PixelFontBold = 'PixelifySans_700Bold';
export const PixelFontRegular = 'PixelifySans_400Regular';

export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
} as const;

/** Pixel art has square corners: everything is squared off (Notches cuts the corner pixel). */
export const Radius = { sm: 0, md: 0, lg: 0 } as const;

/** Pixel-art borders and hard (unblurred) drop shadows. */
export const Pixel = { border: 2, shadow: 3, notch: 3 } as const;

export const MaxContentWidth = 800;
