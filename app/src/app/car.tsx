import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { type ComponentProps } from 'react';
import { ActivityIndicator, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/components/focusable';
import { EmptyState, formatTime } from '@/components/ui';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';

/**
 * Car mode: the audiobook player as a few giant tiles you can hit without looking.
 * The screen stays on while it's open. Works upright or sideways in a mount.
 */
export default function CarMode() {
  useKeepAwake();
  const Colors = useColors();
  const styles = useStyles();
  const p = usePlayer();
  const { prefs } = usePrefs();
  const { width, height } = useWindowDimensions();
  const wide = width > height;

  if (!p.book) return <EmptyState title="Nothing playing" body="Pick a book from Audiobooks." />;
  const chapter = p.mark?.title ?? p.book.chapters[p.chapterIndex]?.title;
  const left = Math.max(0, (p.mark ? (p.book.chapters[p.chapterIndex]?.marks?.[p.mark.index + 1]?.start ?? p.duration) : p.duration) - p.position);

  const play = (
    <Tile style={[styles.play, wide ? { flex: 2 } : { flex: 3 }]} onPress={p.toggle} label={p.playing ? 'Pause' : 'Play'}>
      {p.loading ? (
        <ActivityIndicator size="large" color={Colors.accentText} />
      ) : (
        <Ionicons name={p.playing ? 'pause' : 'play'} size={wide ? 120 : 140} color={Colors.accentText} />
      )}
    </Tile>
  );
  const back = <Tile icon="play-back" caption={`${prefs.skipBack}s`} label={`Back ${prefs.skipBack} seconds`} onPress={() => p.seekBy(-prefs.skipBack)} />;
  const fwd = <Tile icon="play-forward" caption={`${prefs.skipForward}s`} label={`Forward ${prefs.skipForward} seconds`} onPress={() => p.seekBy(prefs.skipForward)} />;
  const prev = <Tile icon="play-skip-back" caption="Chapter" label="Previous chapter" onPress={p.previous} />;
  const next = <Tile icon="play-skip-forward" caption="Chapter" label="Next chapter" onPress={p.next} disabled={!p.hasNext} />;

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {p.book.title}
          </Text>
          <Text style={styles.chapter} numberOfLines={1}>
            {chapter} · {formatTime(left)} left
          </Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={16} accessibilityLabel="Leave car mode" style={styles.close}>
          <Ionicons name="close" size={36} color={Colors.text} />
        </Pressable>
      </View>
      {wide ? (
        <View style={styles.row}>
          <View style={styles.col}>
            {back}
            {prev}
          </View>
          {play}
          <View style={styles.col}>
            {fwd}
            {next}
          </View>
        </View>
      ) : (
        <View style={[styles.col, { flex: 1 }]}>
          <View style={[styles.row, { flex: 1 }]}>
            {back}
            {fwd}
          </View>
          {play}
          <View style={[styles.row, { flex: 1 }]}>
            {prev}
            {next}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function Tile({
  icon,
  caption,
  label,
  onPress,
  disabled,
  style,
  children,
}: {
  icon?: ComponentProps<typeof Ionicons>['name'];
  caption?: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: object;
  children?: React.ReactNode;
}) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={({ pressed }: { pressed: boolean }) => [styles.tile, style, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}>
      {children ?? (
        <>
          {icon ? <Ionicons name={icon} size={64} color={Colors.text} /> : null}
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background, padding: Spacing.three, gap: Spacing.three },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { color: Colors.text, fontFamily: PixelFont, fontSize: 16, lineHeight: 24 },
  chapter: { color: Colors.textSecondary, fontSize: 18, marginTop: 4 },
  close: { padding: Spacing.two },
  row: { flex: 1, flexDirection: 'row', gap: Spacing.three },
  col: { flex: 1, gap: Spacing.three },
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: Spacing.one,
  },
  play: { backgroundColor: Colors.accent, borderColor: Colors.text, borderWidth: 4 },
  caption: { color: Colors.textSecondary, fontFamily: PixelFont, fontSize: 12 },
}));
