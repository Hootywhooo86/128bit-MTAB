import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useColors } from '@/constants/theme';
import { onAudioLevels } from '@/lib/player';

/** Blend two #rrggbb colours (t = 0 → a, 1 → b). */
function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const B = 6; // one "pixel" block
const BARS = 16;

/**
 * The audiobook Now Playing frame: a chunky 8-bit arcade-cabinet border in shades of the
 * accent colour — stepped corners, bevelled edges, rivets, a hard drop shadow, two
 * blinking sparkles and an equalizer of blocks that moves with the book's sound (or just
 * bounces where the sound can't be read).
 */
export function PixelFrame({ children, playing }: { children: ReactNode; playing: boolean }) {
  const Colors = useColors();
  const light = mix(Colors.accent, '#ffffff', 0.45);
  const dark = mix(Colors.accent, '#000000', 0.55);
  const bg = Colors.background;

  // One looping driver for the whole frame keeps the animation cheap.
  const [beat] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!playing) {
      beat.stopAnimation();
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(beat, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [playing, beat]);

  // The real sound: each bar follows one frequency band. Plain state at the ~12/s the
  // player sends: cheap enough that taps (like the back button) never wait behind it.
  const [levels, setLevels] = useState<number[] | null>(null);
  useEffect(() => {
    if (!playing) return;
    const off = onAudioLevels((l) => l.length >= BARS && setLevels(l.slice(0, BARS)));
    return () => {
      off();
      setLevels(null);
    };
  }, [playing]);

  // Each bar gets its own bouncy pattern from the shared beat.
  const fake = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => {
        const steps = [0, 0.25, 0.5, 0.75, 1];
        const out = steps.map((_, k) => 0.25 + 0.75 * Math.abs(Math.sin((i * 1.7 + k * 2.3) % Math.PI)));
        return beat.interpolate({ inputRange: steps, outputRange: out });
      }),
    [beat],
  );
  const blink = beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.2, 1] });

  const corner = (pos: object) => (
    <>
      {/* Cut the outer corner out in two steps (stair look). */}
      <View style={[{ position: 'absolute', width: B * 2, height: B, backgroundColor: bg }, pos]} />
      <View style={[{ position: 'absolute', width: B, height: B * 2, backgroundColor: bg }, pos]} />
    </>
  );
  const rivet = (pos: object) => (
    <View style={[{ position: 'absolute', width: B, height: B, backgroundColor: light }, pos]} />
  );
  const sparkle = (pos: object) => (
    <Animated.View style={[{ position: 'absolute', width: B * 3, height: B * 3, opacity: playing ? blink : 0.8 }, pos]}>
      <View style={{ position: 'absolute', left: B, top: 0, width: B, height: B * 3, backgroundColor: light }} />
      <View style={{ position: 'absolute', left: 0, top: B, width: B * 3, height: B, backgroundColor: light }} />
    </Animated.View>
  );

  return (
    <View style={{ alignSelf: 'stretch', paddingRight: B, paddingBottom: B }}>
      {/* Hard drop shadow, one block down-right. */}
      <View style={{ position: 'absolute', left: B * 2, top: B * 2, right: 0, bottom: 0, backgroundColor: dark }} />
      <View style={{ backgroundColor: Colors.accent, padding: B }}>
        {/* Bevel: light top/left, dark bottom/right. */}
        <View style={{ position: 'absolute', left: B, right: B, top: B, height: B / 2, backgroundColor: light }} />
        <View style={{ position: 'absolute', left: B, top: B, bottom: B, width: B / 2, backgroundColor: light }} />
        <View style={{ position: 'absolute', left: B, right: B, bottom: B, height: B / 2, backgroundColor: dark }} />
        <View style={{ position: 'absolute', right: B, top: B, bottom: B, width: B / 2, backgroundColor: dark }} />
        <View
          style={{
            backgroundColor: bg,
            margin: B / 2,
            paddingTop: B * 4,
            paddingHorizontal: B * 3,
            paddingBottom: B * 2,
            alignItems: 'center',
            gap: B * 2,
          }}>
          {children}
          {/* Equalizer of blocks along the bottom. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: B * 4, gap: B / 2, alignSelf: 'stretch' }}>
            {levels
              ? levels.map((l, i) => (
                  <View
                    key={i}
                    style={{ flex: 1, height: B * 4 * (0.15 + 0.85 * l), backgroundColor: i % 2 ? Colors.accent : light }}
                  />
                ))
              : fake.map((h, i) => (
                  <Animated.View
                    key={i}
                    style={{
                      flex: 1,
                      height: B * 4,
                      backgroundColor: i % 2 ? Colors.accent : light,
                      transform: [{ translateY: B * 2 }, { scaleY: playing ? h : 0.25 }, { translateY: -B * 2 }],
                    }}
                  />
                ))}
          </View>
        </View>
        {rivet({ left: B * 2, top: B * 2 })}
        {rivet({ right: B * 2, top: B * 2 })}
        {rivet({ left: B * 2, bottom: B * 2 })}
        {rivet({ right: B * 2, bottom: B * 2 })}
      </View>
      {corner({ left: 0, top: 0 })}
      {corner({ right: B, top: 0, alignItems: 'flex-end' })}
      <View style={{ position: 'absolute', right: B, top: 0, width: B * 2, height: B, backgroundColor: bg }} />
      <View style={{ position: 'absolute', right: B, top: 0, width: B, height: B * 2, backgroundColor: bg }} />
      {corner({ left: 0, bottom: B })}
      <View style={{ position: 'absolute', right: B, bottom: B, width: B * 2, height: B, backgroundColor: bg }} />
      <View style={{ position: 'absolute', right: B, bottom: B, width: B, height: B * 2, backgroundColor: bg }} />
      {sparkle({ left: B * 4, top: B * 4 })}
      {sparkle({ right: B * 5, top: B * 6 })}
    </View>
  );
}
