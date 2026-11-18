/**
 * Now playing's looks (Settings → Playback → Player look, or the Look button on the player):
 * Arcade (the pixel frame), Big cover, Handheld (a retro console), and the Cassette deck in
 * five skins. The cover art goes on the cassette label; when the chapter changes the tape
 * (or the big cover) pops out, flips over and drops back in.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/focusable';
import { motionOff, useBounce } from '@/components/fx';
import { Cover } from '@/components/ui';
import { Pixel, PixelFont, PixelFontBold, Spacing, useColors } from '@/constants/theme';
import { useCover } from '@/lib/covers';
import type { PlayableBook } from '@/lib/types';

export type CassetteSkin = 'classic' | 'cover' | 'clear' | 'neon' | 'sport';
export type PlayerLook = 'arcade' | 'cover' | 'handheld' | `cassette-${CassetteSkin}`;

export const LOOKS: { id: PlayerLook; name: string; about: string }[] = [
  { id: 'arcade', name: 'Arcade', about: 'The pixel cabinet frame with the equalizer' },
  { id: 'cover', name: 'Big cover', about: 'Your cover, big; it flips over between chapters' },
  { id: 'handheld', name: 'Handheld', about: 'A retro console: D-pad to skip, A to play, B for sleep' },
  { id: 'cassette-classic', name: 'Cassette · Classic', about: 'Cream label with your cover' },
  { id: 'cassette-cover', name: 'Cassette · Cover art', about: 'The whole tape wrapped in your cover' },
  { id: 'cassette-clear', name: 'Cassette · Clear', about: 'See-through shell, the tape spools inside' },
  { id: 'cassette-neon', name: 'Cassette · Neon', about: 'Synthwave purple and cyan' },
  { id: 'cassette-sport', name: 'Cassette · Sport', about: 'Yellow sports-walkman tape' },
];

/** What every look needs from the player. */
export type LookProps = {
  book: PlayableBook;
  chapterTitle: string;
  chapterNo: number;
  chapterCount: number;
  /** Changes whenever the chapter does (in-file chapters too): drives the flip. */
  flipKey: string;
  playing: boolean;
  loading: boolean;
  /** 0..1 through the chapter, and its times. */
  fraction: number;
  posText: string;
  leftText: string;
  skipBack: number;
  skipForward: number;
  hasNext: boolean;
  onToggle: () => void;
  onBack: () => void;
  onForward: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSleep: () => void;
  sleepLabel: string;
  onRate: () => void;
  rateLabel: string;
  onBookmark: () => void;
};

// --- Shared motion --------------------------------------------------------------------------------

const useValue = (start: number) => useState(() => new Animated.Value(start))[0];

/** Pop out, flip over, drop back in: each time `key` changes (not when the screen opens). */
function useChapterFlip(key: string) {
  const t = useValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (motionOff()) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start();
  }, [key, t]);
  return {
    transform: [
      { perspective: 900 },
      { translateY: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, -36, -36, 0] }) },
      { scale: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [1, 1.06, 1.06, 1] }) },
      // Edge-on at the half-way point, so the other side "turns" into view.
      { rotateY: t.interpolate({ inputRange: [0, 0.2, 0.5, 0.5001, 0.8, 1], outputRange: ['0deg', '0deg', '90deg', '-90deg', '0deg', '0deg'] }) },
    ],
  };
}

/** A tape reel that turns while playing. */
function Reel({ playing, size, hub, rim, spokes }: { playing: boolean; size: number; hub: string; rim: string; spokes: string }) {
  const t = useValue(0);
  useEffect(() => {
    if (!playing || motionOff()) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [playing, t]);
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hub,
        borderWidth: size * 0.1,
        borderColor: rim,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate }],
      }}>
      {/* Six teeth around the spindle: you can see them turn. */}
      {[0, 60, 120].map((deg) => (
        <View key={deg} style={{ position: 'absolute', width: size * 0.62, height: size * 0.1, backgroundColor: spokes, transform: [{ rotate: `${deg}deg` }] }} />
      ))}
      <View style={{ width: size * 0.26, height: size * 0.26, backgroundColor: rim }} />
    </Animated.View>
  );
}

/** Chunky deck / console button that presses into its shadow. */
function Key({
  onPress,
  children,
  style,
  label,
  disabled,
}: {
  onPress: () => void;
  children: ReactNode;
  style?: object;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={({ pressed }: { pressed: boolean }) => [
        { alignItems: 'center', justifyContent: 'center', boxShadow: '3px 3px 0px #000000', opacity: disabled ? 0.35 : 1 },
        style,
        pressed && { transform: [{ translateX: 3 }, { translateY: 3 }], boxShadow: 'none' },
      ]}>
      {children}
    </Pressable>
  );
}

function PlayIcon({ props, color, size }: { props: LookProps; color: string; size: number }) {
  return props.loading ? (
    <ActivityIndicator color={color} />
  ) : (
    <Ionicons name={props.playing ? 'pause' : 'play'} size={size} color={color} />
  );
}

// --- Big cover --------------------------------------------------------------------------------------

/** The cover, as big as the screen allows; it flips over when the chapter changes. */
export function BigCoverLook(props: LookProps) {
  const Colors = useColors();
  const flip = useChapterFlip(props.flipKey);
  return (
    <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: Spacing.three }}>
      <Animated.View style={[{ borderWidth: 3, borderColor: Colors.accent, boxShadow: `8px 8px 0px ${Colors.border}` }, flip]}>
        <Cover uri={props.book.cover} size={300} title={props.book.title} author={props.book.author} />
      </Animated.View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={[s.bigTitle, { color: Colors.text }]} numberOfLines={2}>
          {props.book.title}
        </Text>
        {props.book.author ? <Text style={{ color: Colors.textSecondary, fontSize: 15 }}>{props.book.author}</Text> : null}
      </View>
    </View>
  );
}

// --- Handheld ---------------------------------------------------------------------------------------

const LCD = { bg: '#9BBC0F', mid: '#8BAC0F', dark: '#306230', ink: '#0F380F' };

/** A retro handheld: the book on a green screen, D-pad to skip, A to play, B for sleep. */
export function HandheldLook(props: LookProps) {
  const Colors = useColors();
  const a = useBounce();
  // The screen blinks off and on as a new chapter loads.
  const blink = useValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (motionOff()) return;
    Animated.sequence([
      Animated.timing(blink, { toValue: 0.15, duration: 90, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 0.15, duration: 90, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  }, [props.flipKey, blink]);
  const blocks = 12;
  const filled = Math.round(props.fraction * blocks);
  const pad = (dir: 'up' | 'down' | 'left' | 'right', onPress: () => void, label: string, text: string, disabled?: boolean) => (
    <Key
      onPress={onPress}
      label={label}
      disabled={disabled}
      style={[s.padArm, dir === 'up' && { top: 0, left: 40 }, dir === 'down' && { bottom: 0, left: 40 }, dir === 'left' && { left: 0, top: 40 }, dir === 'right' && { right: 0, top: 40 }]}>
      <Text style={s.padText}>{text}</Text>
    </Key>
  );
  return (
    <View style={[s.device, { borderColor: '#4A4A6E' }]}>
      <View style={s.bezel}>
        <Animated.View style={[s.lcd, { opacity: blink }]}>
          <View style={s.lcdCover}>
            <Cover uri={props.book.cover} size={104} title={props.book.title} author={props.book.author} />
            {/* Green-screen tint over the cover. */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: LCD.bg, opacity: 0.45 }]} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: LCD.ink, opacity: 0.15 }]} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.lcdTitle]} numberOfLines={2}>
              {props.book.title.toUpperCase()}
            </Text>
            {props.book.author ? (
              <Text style={s.lcdText} numberOfLines={1}>
                {props.book.author.toUpperCase()}
              </Text>
            ) : null}
            <Text style={[s.lcdText, { marginTop: 6 }]} numberOfLines={1}>
              CH {props.chapterNo}/{props.chapterCount} {props.chapterTitle.toUpperCase()}
            </Text>
            <Text style={s.lcdText}>
              {props.posText} / -{props.leftText} {props.playing ? '▶' : '❚❚'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
              {Array.from({ length: blocks }, (_, i) => (
                <View key={i} style={{ width: 8, height: 8, backgroundColor: i < filled ? LCD.ink : LCD.mid }} />
              ))}
            </View>
          </View>
        </Animated.View>
      </View>
      <Text style={s.brand}>128BIT · BOOK BOY</Text>
      <View style={s.controlsRow}>
        <View style={s.pad}>
          <View style={s.padCenter} />
          {pad('up', props.onPrevious, 'Previous chapter', 'CH▲')}
          {pad('down', props.onNext, 'Next chapter', 'CH▼', !props.hasNext)}
          {pad('left', props.onBack, `Back ${props.skipBack} seconds`, `-${props.skipBack}`)}
          {pad('right', props.onForward, `Forward ${props.skipForward} seconds`, `+${props.skipForward}`)}
        </View>
        <View style={s.abRow}>
          <View style={{ alignItems: 'center', gap: 4, marginTop: 34 }}>
            <Key onPress={props.onSleep} label="Sleep timer" style={[s.round, { backgroundColor: '#7A2148', width: 56, height: 56 }]}>
              <Ionicons name="moon" size={20} color="#F4F4FA" />
            </Key>
            <Text style={s.keyLabel}>{props.sleepLabel}</Text>
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Animated.View style={{ transform: [{ scale: a.scale }] }}>
              <Key
                onPress={() => {
                  a.bounce();
                  props.onToggle();
                }}
                label={props.playing ? 'Pause' : 'Play'}
                style={[s.round, { backgroundColor: Colors.accent, width: 68, height: 68 }]}>
                <PlayIcon props={props} color={Colors.accentText} size={30} />
              </Key>
            </Animated.View>
            <Text style={s.keyLabel}>{props.playing ? 'PAUSE' : 'PLAY'}</Text>
          </View>
        </View>
      </View>
      <View style={s.selectRow}>
        <Key onPress={props.onRate} label="Speed" style={s.pill}>
          <Text style={s.pillText}>SPEED {props.rateLabel}</Text>
        </Key>
        <Key onPress={props.onBookmark} label="Add bookmark" style={s.pill}>
          <Text style={s.pillText}>MARK</Text>
        </Key>
      </View>
    </View>
  );
}

// --- Cassette deck ----------------------------------------------------------------------------------

type Skin = {
  shell: string;
  edge: string;
  label: string;
  labelText: string;
  stripe: string;
  window: string;
  hub: string;
  rim: string;
  spokes: string;
  lcd: string;
  lcdText: string;
  key: string;
  keyEdge: string;
  keyText: string;
};

const SKINS: Record<CassetteSkin, Skin> = {
  classic: { shell: '#2A2A33', edge: '#45455A', label: '#E9D8B4', labelText: '#222222', stripe: '#C0392B', window: '#1E1E1E', hub: '#E0E0E0', rim: '#5A5A5A', spokes: '#9A9A9A', lcd: '#0A1A0A', lcdText: '#5CF27A', key: '#20202F', keyEdge: '#45456A', keyText: '#F4F4FA' },
  cover: { shell: '#141420', edge: '#30304A', label: '#000000', labelText: '#FFFFFF', stripe: '#FFFFFF', window: '#000000CC', hub: '#F4F4FA', rim: '#30304A', spokes: '#9C9CB4', lcd: '#0A0A14', lcdText: '#F4F4FA', key: '#20202F', keyEdge: '#45456A', keyText: '#F4F4FA' },
  clear: { shell: '#9FD7FF33', edge: '#9FD7FF', label: '#F4F8FF', labelText: '#1A2A40', stripe: '#3A8DDE', window: '#00000033', hub: '#F4F8FF', rim: '#3A8DDE', spokes: '#9FD7FF', lcd: '#06121F', lcdText: '#7FD4FF', key: '#13263A', keyEdge: '#3A8DDE', keyText: '#DFF2FF' },
  neon: { shell: '#1A0B2E', edge: '#FF3FD5', label: '#2B0F4A', labelText: '#3FF6FF', stripe: '#FF3FD5', window: '#0B0418', hub: '#3FF6FF', rim: '#FF3FD5', spokes: '#7A2BB0', lcd: '#0B0418', lcdText: '#FF3FD5', key: '#1A0B2E', keyEdge: '#FF3FD5', keyText: '#3FF6FF' },
  sport: { shell: '#F2C200', edge: '#8A6D00', label: '#111111', labelText: '#F2C200', stripe: '#F2C200', window: '#2A2A2A', hub: '#DDDDDD', rim: '#111111', spokes: '#777777', lcd: '#111111', lcdText: '#F2C200', key: '#111111', keyEdge: '#F2C200', keyText: '#F2C200' },
};

/** The cassette deck: your cover on the label, reels spinning while it plays; a new chapter ejects the tape, flips it and slots it back. */
export function CassetteLook({ skin, ...props }: LookProps & { skin: CassetteSkin }) {
  const Colors = useColors();
  const k = SKINS[skin] ?? SKINS.classic;
  const flip = useChapterFlip(props.flipKey);
  const play = useBounce();
  const art = useCover(props.book.cover, props.book.title, props.book.author);
  const side = props.chapterNo % 2 === 1 ? 'A' : 'B';
  const labelText = (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[s.tapeSide, { color: k.labelText }]} numberOfLines={1}>
        SIDE {side} · {props.book.title.toUpperCase()}
      </Text>
      <Text style={[s.tapeSub, { color: k.labelText }]} numberOfLines={1}>
        {props.book.author ?? ''}
      </Text>
      <View style={{ height: 2, backgroundColor: k.stripe, marginTop: 2 }} />
      <Text style={[s.tapeSub, { color: k.labelText }]} numberOfLines={1}>
        CH {props.chapterNo}/{props.chapterCount} · {props.chapterTitle}
      </Text>
    </View>
  );
  return (
    <View style={{ alignSelf: 'stretch', gap: Spacing.three }}>
      {/* The deck. */}
      <View style={[s.deck, { backgroundColor: '#12121C', borderColor: k.edge }]}>
        <Animated.View style={[s.shell, { backgroundColor: k.shell, borderColor: k.edge }, flip]}>
          {skin === 'cover' && art ? (
            <>
              <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#00000066' }]} />
            </>
          ) : null}
          <View style={[s.label, { backgroundColor: skin === 'cover' ? '#000000AA' : k.label }]}>
            {skin === 'cover' ? null : (
              <View style={{ borderWidth: 2, borderColor: k.stripe }}>
                <Cover uri={props.book.cover} size={44} title={props.book.title} author={props.book.author} />
              </View>
            )}
            {labelText}
          </View>
          <View style={[s.window, { backgroundColor: k.window, borderColor: k.edge }]}>
            <Reel playing={props.playing} size={52} hub={k.hub} rim={k.rim} spokes={k.spokes} />
            {/* The tape between the reels: more on the right as the chapter goes on. */}
            <View style={{ flex: 1, height: 18, marginHorizontal: 6, flexDirection: 'row' }}>
              <View style={{ flex: Math.max(0.05, 1 - props.fraction), backgroundColor: '#3B2A1E' }} />
              <View style={{ width: 2 }} />
              <View style={{ flex: Math.max(0.05, props.fraction), backgroundColor: '#3B2A1E' }} />
            </View>
            <Reel playing={props.playing} size={52} hub={k.hub} rim={k.rim} spokes={k.spokes} />
          </View>
          <View style={s.screws}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[s.screw, { backgroundColor: k.edge }]} />
            ))}
          </View>
        </Animated.View>
        {/* Counter. */}
        <View style={[s.counter, { backgroundColor: k.lcd }]}>
          <Text style={[s.counterTime, { color: k.lcdText }]}>{props.posText}</Text>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <View key={i} style={{ width: 7, height: 12, backgroundColor: k.lcdText, opacity: i < Math.round(props.fraction * 10) ? 1 : 0.2 }} />
            ))}
          </View>
          <Text style={[s.counterLeft, { color: k.lcdText }]}>-{props.leftText}</Text>
        </View>
      </View>
      {/* Deck keys. */}
      <View style={s.keys}>
        <Key onPress={props.onPrevious} label="Previous chapter" style={[s.key, { backgroundColor: k.key, borderColor: k.keyEdge }]}>
          <Ionicons name="play-skip-back" size={22} color={k.keyText} />
        </Key>
        <Key onPress={props.onBack} label={`Back ${props.skipBack} seconds`} style={[s.key, { backgroundColor: k.key, borderColor: k.keyEdge }]}>
          <Ionicons name="play-back" size={22} color={k.keyText} />
          <Text style={[s.keyNum, { color: k.keyText }]}>{props.skipBack}</Text>
        </Key>
        <Animated.View style={{ flex: 1.5, transform: [{ scale: play.scale }] }}>
          <Key
            onPress={() => {
              play.bounce();
              props.onToggle();
            }}
            label={props.playing ? 'Pause' : 'Play'}
            style={[s.key, s.playKey, { backgroundColor: Colors.accent, borderColor: Colors.text }]}>
            <PlayIcon props={props} color={Colors.accentText} size={34} />
          </Key>
        </Animated.View>
        <Key onPress={props.onForward} label={`Forward ${props.skipForward} seconds`} style={[s.key, { backgroundColor: k.key, borderColor: k.keyEdge }]}>
          <Ionicons name="play-forward" size={22} color={k.keyText} />
          <Text style={[s.keyNum, { color: k.keyText }]}>{props.skipForward}</Text>
        </Key>
        <Key onPress={props.onNext} label="Next chapter" disabled={!props.hasNext} style={[s.key, { backgroundColor: k.key, borderColor: k.keyEdge }]}>
          <Ionicons name="play-skip-forward" size={22} color={k.keyText} />
        </Key>
      </View>
    </View>
  );
}

// --- Picker -----------------------------------------------------------------------------------------

/** Choose the player's look. */
export function LookPicker({ visible, value, onPick, onClose }: { visible: boolean; value: string; onPick: (id: PlayerLook) => void; onClose: () => void }) {
  const Colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <View style={[s.sheet, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
          <Text style={[s.sheetTitle, { color: Colors.text }]}>Player look</Text>
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: Spacing.two }}>
            {LOOKS.map((l) => {
              const on = l.id === value;
              return (
                <Pressable
                  key={l.id}
                  onPress={() => {
                    onPick(l.id);
                    onClose();
                  }}
                  style={[s.option, { borderColor: on ? Colors.accent : Colors.border, backgroundColor: on ? Colors.surfaceRaised : 'transparent' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.optionName, { color: on ? Colors.accent : Colors.text }]}>{l.name}</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>{l.about}</Text>
                  </View>
                  {on ? <Ionicons name="checkmark" size={22} color={Colors.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  bigTitle: { fontFamily: PixelFontBold, fontSize: 28, textAlign: 'center' },
  // Handheld
  device: { alignSelf: 'stretch', backgroundColor: '#2A2A40', borderWidth: 3, padding: 16, gap: 10, boxShadow: '6px 6px 0px #000000' },
  bezel: { backgroundColor: '#1C1C2C', padding: 8 },
  lcd: { backgroundColor: LCD.bg, padding: 10, flexDirection: 'row', gap: 12, alignItems: 'center' },
  lcdCover: { width: 104, height: 104, overflow: 'hidden' },
  lcdTitle: { color: LCD.ink, fontFamily: PixelFontBold, fontSize: 18 },
  lcdText: { color: LCD.ink, fontFamily: PixelFont, fontSize: 13 },
  brand: { color: '#9C9CB4', fontFamily: PixelFont, fontSize: 12, letterSpacing: 3, textAlign: 'center' },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  pad: { width: 120, height: 120 },
  padCenter: { position: 'absolute', left: 40, top: 40, width: 40, height: 40, backgroundColor: '#111111' },
  padArm: { position: 'absolute', width: 40, height: 40, backgroundColor: '#111111' },
  padText: { color: '#9C9CB4', fontFamily: PixelFont, fontSize: 11 },
  abRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  round: { borderRadius: 999 },
  keyLabel: { color: '#9C9CB4', fontFamily: PixelFont, fontSize: 11 },
  selectRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 4 },
  pill: { backgroundColor: '#111111', paddingHorizontal: 14, paddingVertical: 6 },
  pillText: { color: '#9C9CB4', fontFamily: PixelFont, fontSize: 12 },
  // Cassette
  deck: { borderWidth: 3, padding: 12, gap: 12, boxShadow: '6px 6px 0px #000000' },
  shell: { borderWidth: Pixel.border, padding: 10, gap: 10, overflow: 'hidden' },
  label: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8 },
  tapeSide: { fontFamily: PixelFontBold, fontSize: 15 },
  tapeSub: { fontFamily: PixelFont, fontSize: 12 },
  window: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 2, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 18 },
  screws: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 },
  screw: { width: 6, height: 6 },
  counter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, borderColor: '#000000' },
  counterTime: { fontFamily: PixelFontBold, fontSize: 22, letterSpacing: 1 },
  counterLeft: { fontFamily: PixelFont, fontSize: 14 },
  keys: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  key: { flex: 1, height: 62, borderWidth: 2, borderTopWidth: 4, gap: 2 },
  playKey: { flex: 1, height: 74, borderWidth: 3, borderTopWidth: 5 },
  keyNum: { fontFamily: PixelFont, fontSize: 11 },
  // Picker
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: Spacing.three },
  sheet: { borderWidth: Pixel.border, padding: Spacing.three, gap: Spacing.three },
  sheetTitle: { fontFamily: PixelFontBold, fontSize: 24 },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: Pixel.border, padding: Spacing.three },
  optionName: { fontFamily: PixelFont, fontSize: 17 },
});
