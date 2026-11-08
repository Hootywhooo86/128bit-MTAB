/** One-off screen effects the app shows over everything (components/fx.tsx → FxOverlay). */
export type Fx =
  | { kind: 'bookComplete'; title: string; cover?: string; count: number }
  | { kind: 'sleep' };

const listeners = new Set<(fx: Fx) => void>();

export function emitFx(fx: Fx) {
  listeners.forEach((l) => l(fx));
}

export function onFx(fn: (fx: Fx) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
