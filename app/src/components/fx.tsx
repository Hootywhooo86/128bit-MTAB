/**
 * The app's 8-bit motion: boot splash, pixel spinner, press squash, fade-ins, tab wiggle,
 * starfield, streak flame, the "BOOK COMPLETE!" level-up and the CRT switch-off for the
 * sleep timer. All built on React Native's Animated (native driver), and all calm down to
 * a still frame when the phone's "Remove animations" / reduce-motion setting is on.
 */
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PixelFont, useColors } from '@/constants/theme';
import { onFx, type Fx } from '@/lib/fx-events';

// --- Reduce motion ------------------------------------------------------------------------

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reduceMotion = v;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
  reduceMotion = v;
});
export const motionOff = () => reduceMotion;

const useValue = (start: number) => useState(() => new Animated.Value(start))[0];

// --- Press squash ------------------------------------------------------------------------------

/** Scale for something you press: shrinks a little while held, springs back on release. */
export function usePressScale(to = 0.94) {
  const scale = useValue(1);
  const go = (v: number) =>
    motionOff()
      ? undefined
      : Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 8 : 0 }).start();
  return { scale, onPressIn: () => go(to), onPressOut: () => go(1) };
}

/** A quick squash-and-stretch (play/pause): call `bounce()` on press. */
export function useBounce() {
  const scale = useValue(1);
  const bounce = () => {
    if (motionOff()) return;
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.82, duration: 70, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 14 }),
    ]).start();
  };
  return { scale, bounce };
}

// --- Fade-in ------------------------------------------------------------------------------------

/** Children fade and rise in when they first appear. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const t = useValue(motionOff() ? 1 : 0);
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [t, delay]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: t, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** Grows in from smaller (the Now playing cover). */
export function ZoomIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useValue(motionOff() ? 1 : 0);
  useEffect(() => {
    Animated.spring(t, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 7 }).start();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  return <Animated.View style={[style, { opacity: t, transform: [{ scale }] }]}>{children}</Animated.View>;
}

// --- Pixel spinner ------------------------------------------------------------------------------

/** Loading: three blocks hopping in turn, 8-bit style. */
export function PixelSpinner({ size = 8, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const Colors = useColors();
  const t = useValue(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 3, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View style={[{ flexDirection: 'row', gap: size / 2, height: size * 3, alignItems: 'flex-end' }, style]} accessibilityLabel="Loading">
      {[0, 1, 2].map((i) => {
        // Each block hops during its third of the loop.
        const translateY = t.interpolate({
          inputRange: [i, i + 0.5, i + 1],
          outputRange: [0, -size * 1.5, 0],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            style={{ width: size, height: size, backgroundColor: Colors.accent, transform: [{ translateY: motionOff() ? 0 : translateY }] }}
          />
        );
      })}
    </View>
  );
}

// --- Tab icon wiggle ----------------------------------------------------------------------------

/** A tab icon that does a little 8-bit wiggle each time its tab is picked. */
export function Wiggle({ focused, children }: { focused: boolean; children: ReactNode }) {
  const t = useValue(0);
  useEffect(() => {
    if (!focused || motionOff()) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: true }).start();
  }, [focused, t]);
  // Stepped, not smooth: it snaps between angles like a sprite.
  const rotate = t.interpolate({
    inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1],
    outputRange: ['0deg', '-14deg', '12deg', '-8deg', '4deg', '0deg'],
  });
  const translateY = t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, -4, 0] });
  return <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>{children}</Animated.View>;
}

// --- Starfield ------------------------------------------------------------------------------------

const STARS = 22;

/** Slowly drifting, twinkling pixel stars (behind Now playing); faster and brighter while playing. */
export function Starfield({ playing }: { playing: boolean }) {
  const Colors = useColors();
  const { width, height } = useWindowDimensions();
  const t = useValue(0);
  const stars = useMemo(
    () =>
      Array.from({ length: STARS }, (_, i) => ({
        x: (i * 97) % 100,
        y: (i * 61) % 100,
        size: i % 5 === 0 ? 4 : 2,
        phase: (i % 7) / 7,
        accent: i % 4 === 0,
      })),
    [],
  );
  useEffect(() => {
    if (motionOff()) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: playing ? 14000 : 30000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, playing]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {stars.map((s, i) => {
        const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.12] });
        // Half the stars brighten while the other half dim.
        const opacity = t.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: s.phase < 0.5 ? [0.3, 0.9, 0.3] : [0.9, 0.3, 0.9],
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: (s.x / 100) * width,
              top: (s.y / 100) * height * 0.9,
              width: s.size,
              height: s.size,
              backgroundColor: s.accent ? Colors.accent : '#ffffff',
              opacity: motionOff() ? 0.4 : playing ? opacity : 0.25,
              transform: [{ translateY: motionOff() ? 0 : translateY }],
            }}
          />
        );
      })}
    </View>
  );
}

// --- Streak flame ---------------------------------------------------------------------------------

/** A pixel flame that grows with your streak (days in a row). */
export function PixelFlame({ days }: { days: number }) {
  const t = useValue(0);
  useEffect(() => {
    if (!days || motionOff()) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 500, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t, days]);
  if (!days) return null;
  const level = days >= 30 ? 4 : days >= 10 ? 3 : days >= 4 ? 2 : 1;
  const b = 4 + level; // block size
  // Rows of blocks from the tip down: 0 = gap, 1 = yellow, 2 = orange, 3 = red.
  const rows = [
    [0, 0, 1, 0, 0],
    [0, 1, 2, 1, 0],
    [1, 2, 2, 2, 1],
    [2, 2, 1, 2, 3],
    [3, 2, 1, 2, 3],
    [0, 3, 3, 3, 0],
  ].slice(4 - level > 0 ? 4 - level : 0);
  const colors = ['transparent', '#FFE14D', '#FF8C2A', '#E8361E'];
  const scaleY = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.12, 1] });
  return (
    <Animated.View style={{ transform: [{ scaleY }], alignItems: 'center' }} accessibilityLabel={`${days} day streak`}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((c, i) => (
            <View key={i} style={{ width: b, height: b, backgroundColor: colors[c] }} />
          ))}
        </View>
      ))}
    </Animated.View>
  );
}

// --- Pixel burst ----------------------------------------------------------------------------------

/** Blocks flying out from the middle once (finishing something). */
export function PixelBurst({ size = 160 }: { size?: number }) {
  const Colors = useColors();
  const t = useValue(0);
  useEffect(() => {
    if (motionOff()) return;
    Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        const r = size / 2;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: i % 3 ? 6 : 10,
              height: i % 3 ? 6 : 10,
              backgroundColor: i % 2 ? Colors.accent : '#ffffff',
              opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * r] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * r] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

// --- Boot splash ----------------------------------------------------------------------------------

const GRID = 8;

/** Launch: the logo appears block by block, like an old console switching on, then fades away. */
export function BootSplash() {
  const Colors = useColors();
  const [done, setDone] = useState(motionOff);
  const t = useValue(0);
  const fade = useValue(1);
  // Each block covering the logo drops out at its own moment.
  const order = useMemo(() => Array.from({ length: GRID * GRID }, (_, i) => ((i * 37) % (GRID * GRID)) / (GRID * GRID)), []);
  useEffect(() => {
    if (done) return;
    Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }),
      Animated.delay(250),
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setDone(true));
  }, [done, t, fade]);
  if (done) return null;
  const S = 160;
  const cell = S / GRID;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: Colors.background, opacity: fade }]}>
      <View style={{ width: S, height: S }}>
        <Image source={require('../../assets/images/icon.png')} style={{ width: S, height: S }} contentFit="contain" />
        {order.map((at, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: (i % GRID) * cell,
              top: Math.floor(i / GRID) * cell,
              width: cell + 0.5,
              height: cell + 0.5,
              backgroundColor: Colors.background,
              opacity: t.interpolate({ inputRange: [at, at + 0.02], outputRange: [1, 0], extrapolate: 'clamp' }),
            }}
          />
        ))}
      </View>
      <Text style={[styles.boot, { color: Colors.accent }]}>128BIT</Text>
    </Animated.View>
  );
}

// --- Over everything: level-up and CRT off ----------------------------------------------------------

/** Mounted once at the root: "BOOK COMPLETE!" when you finish a book, and the CRT switch-off. */
export function FxOverlay() {
  const [fx, setFx] = useState<(Fx & { id: number }) | null>(null);
  useEffect(() => onFx((f) => setFx({ ...f, id: Date.now() })), []);
  if (!fx) return null;
  const close = () => setFx(null);
  return fx.kind === 'bookComplete' ? <LevelUp key={fx.id} fx={fx} onDone={close} /> : <CrtOff key={fx.id} onDone={close} />;
}

function LevelUp({ fx, onDone }: { fx: Extract<Fx, { kind: 'bookComplete' }>; onDone: () => void }) {
  const Colors = useColors();
  const t = useValue(0);
  useEffect(() => {
    Animated.sequence([
      Animated.spring(t, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 10 }),
      Animated.delay(2600),
      Animated.timing(t, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(onDone);
  }, [t, onDone]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(0,0,0,0.75)', opacity: t }]}>
      <Animated.View style={[styles.center, { transform: [{ scale }], gap: 14 }]}>
        <View style={styles.center}>
          <PixelBurst size={240} />
          {fx.cover ? (
            <Image source={{ uri: fx.cover }} style={{ width: 120, height: 120, borderWidth: 3, borderColor: Colors.accent }} contentFit="cover" />
          ) : null}
        </View>
        <Text style={[styles.levelTitle, { color: Colors.accent }]}>BOOK COMPLETE!</Text>
        <Text style={styles.levelBook} numberOfLines={2}>
          {fx.title}
        </Text>
        <Text style={styles.levelCount}>
          {fx.count} {fx.count === 1 ? 'book' : 'books'} finished
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** Old TV switching off: the picture squeezes to a line, then a dot, then black. */
function CrtOff({ onDone }: { onDone: () => void }) {
  const lineY = useValue(1);
  const lineX = useValue(1);
  const glow = useValue(1);
  useEffect(() => {
    if (motionOff()) {
      onDone();
      return;
    }
    Animated.sequence([
      Animated.timing(lineY, { toValue: 0.006, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(lineX, { toValue: 0.02, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 380, useNativeDriver: true }),
      Animated.delay(250),
    ]).start(onDone);
  }, [lineY, lineX, glow, onDone]);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: '#000' }]}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#e8f4ff',
          opacity: glow,
          transform: [{ scaleY: lineY }, { scaleX: lineX }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  boot: { fontFamily: PixelFont, fontSize: 16, marginTop: 18, letterSpacing: 4 },
  levelTitle: { fontFamily: PixelFont, fontSize: 18, textAlign: 'center' },
  levelBook: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center', maxWidth: 280 },
  levelCount: { color: '#bbb', fontFamily: PixelFont, fontSize: 10 },
});
