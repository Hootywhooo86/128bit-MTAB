/**
 * 128bit family — shared look.
 *
 * Monochrome on true black. Colour only ever means data; the one exception is
 * the accent the user picks (accent.ts). The values are 128bitfit's, which
 * came from its prototype spec.
 */

/** Bump when anything in this folder changes, in every repo at once. */
export const FAMILY_VERSION = '0.1.0';

/**
 * The family pixel face, for headers, section labels and tab labels. Never
 * body text. Load it with @expo-google-fonts/press-start-2p.
 *
 * Its capitals are a full em tall, so it reads big for its point size: 7–12
 * covers labels and headers. Below 6 the glyphs blur on a phone screen.
 */
export const PIXEL_FONT = 'PressStart2P_400Regular';

export const neutrals = {
  bg: '#000000',
  surface: '#0d0d0d',
  surfaceAlt: '#171717',
  /** The track behind a bar. */
  track: '#212121',
  border: '#242424',
  /** The border of something focused or pressed. */
  borderBright: '#3a3a3a',
  text: '#ffffff',
  textMuted: '#8c8c8c',
  /** Labels, captions, anything secondary to muted. */
  textDim: '#575757',
} as const;

/**
 * Colours that carry meaning. Fixed in every app, never user-changeable, and
 * never offered as an accent.
 */
export const dataColors = {
  /** Over target, over budget, heavy load. */
  danger: '#ff4d6d',
  /** Middle of a load scale. */
  warm: '#ff9a3d',
  /** Light end of a load scale. */
  light: '#ffd95e',
  /** Nothing logged. Grey is absence, not a low amount. */
  none: '#2a2a2a',
} as const;
