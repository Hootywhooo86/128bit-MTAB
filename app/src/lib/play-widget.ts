/**
 * Home screen widgets (modules/play-widget, Android): "Resume audiobook" 1x1 and 2x1.
 * The player tells them what's playing; their buttons come back here as actions.
 */
import { requireOptionalNativeModule } from 'expo';

import { buildPalette } from '@/constants/theme';

import { readPrefs } from './prefs';

export type WidgetAction = 'toggle' | 'back' | 'forward';

type Native = {
  update(key: string, title: string, subtitle: string | null, cover: string | null, playing: boolean, accent: number): void;
  addListener(event: 'widgetAction', fn: (e: { action: WidgetAction }) => void): { remove(): void };
};

const widget = requireOptionalNativeModule<Native>('PlayWidget');

/** "#ff8c2a" → Android's signed ARGB int. */
const argb = (hex: string) => (0xff000000 | parseInt(hex.replace('#', '').slice(0, 6), 16)) | 0;

let last = '';

/** Redraws the widgets (only when something they show changed). */
export async function updateWidget(w: { key: string; title: string; subtitle?: string; cover?: string; playing: boolean }) {
  // The player calls this twice a second: only real changes reach the widget.
  const sig = JSON.stringify(w);
  if (!widget || sig === last) return;
  last = sig;
  const prefs = await readPrefs();
  const accent = argb(buildPalette(prefs.accent, prefs.amoled, prefs.customAccent).accent);
  try {
    widget.update(w.key, w.title, w.subtitle ?? null, w.cover ?? null, w.playing, accent);
  } catch {
    // Widgets are a nice-to-have.
  }
}

export function onWidgetAction(fn: (action: WidgetAction) => void) {
  const sub = widget?.addListener('widgetAction', (e) => fn(e.action));
  return () => sub?.remove();
}
