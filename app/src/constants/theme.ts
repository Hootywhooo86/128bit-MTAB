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
      styles = StyleSheet.create(factory(colors));
      cache.set(key, styles);
    }
    return styles;
  };
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
