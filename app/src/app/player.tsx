import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { Body, Cover, EmptyState, ProgressBar, Title, formatTime } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';

const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [null, 15, 30, 45, 60];

export default function PlayerScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const p = usePlayer();
  const { prefs } = usePrefs();
  const [barWidth, setBarWidth] = useState(1);
  const [sleepChoice, setSleepChoice] = useState<number | null>(null);

  if (!p.book)
    return <EmptyState title="Nothing playing" body="Pick a book from Discover or Library." />;
  const chapter = p.book.chapters[p.chapterIndex];
  const hasPrev = p.chapterIndex > 0;
  const hasNext = p.chapterIndex < p.book.chapters.length - 1;

  const onSeek = (e: GestureResponderEvent) => {
    if (p.duration) p.seekTo((e.nativeEvent.locationX / barWidth) * p.duration);
  };

  const nextRate = RATES[(RATES.indexOf(p.rate) + 1) % RATES.length] ?? 1;
  const cycleSleep = () => {
    // Off → 15 → 30 → 45 → 60 → off
    const idx = p.sleepAt ? SLEEP_OPTIONS.indexOf(sleepChoice) : 0;
    const next = SLEEP_OPTIONS[(idx + 1) % SLEEP_OPTIONS.length];
    setSleepChoice(next);
    p.setSleepTimer(next);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Cover uri={p.book.cover} size={260} />
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Title style={{ fontSize: 22, textAlign: 'center' }}>{p.book.title}</Title>
        {p.book.author ? <Body muted>{p.book.author}</Body> : null}
        <Body style={{ color: Colors.accent, textAlign: 'center' }}>
          {chapter?.title} ({p.chapterIndex + 1}/{p.book.chapters.length})
        </Body>
      </View>

      <View style={{ alignSelf: 'stretch', gap: Spacing.one }}>
        <Pressable
          onPress={onSeek}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width || 1)}
          style={{ paddingVertical: Spacing.two }}>
          <ProgressBar value={p.duration ? p.position / p.duration : 0} />
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{formatTime(p.position)}</Text>
          <Text style={styles.time}>-{formatTime(p.duration - p.position)}</Text>
        </View>
      </View>

      {p.error ? <Body style={{ color: Colors.danger }}>{p.error}</Body> : null}

      <View style={styles.controls}>
        <IconButton
          name="play-skip-back"
          disabled={!hasPrev}
          onPress={() => p.playChapter(p.chapterIndex - 1)}
        />
        <IconButton
          name="play-back"
          label={String(prefs.skipBack)}
          onPress={() => p.seekBy(-prefs.skipBack)}
        />
        <Pressable
          style={styles.playButton}
          onPress={p.toggle}
          accessibilityLabel={p.playing ? 'Pause' : 'Play'}>
          {p.loading ? (
            <ActivityIndicator color={Colors.accentText} />
          ) : (
            <Ionicons name={p.playing ? 'pause' : 'play'} size={36} color={Colors.accentText} />
          )}
        </Pressable>
        <IconButton
          name="play-forward"
          label={String(prefs.skipForward)}
          onPress={() => p.seekBy(prefs.skipForward)}
        />
        <IconButton
          name="play-skip-forward"
          disabled={!hasNext}
          onPress={() => p.playChapter(p.chapterIndex + 1)}
        />
      </View>

      <View style={styles.pills}>
        <Pressable style={styles.pill} onPress={() => p.setRate(nextRate)}>
          <Text style={styles.pillText}>{p.rate}×</Text>
        </Pressable>
        <Pressable style={styles.pill} onPress={cycleSleep}>
          <Ionicons name="moon" size={14} color={p.sleepAt ? Colors.accent : Colors.text} />
          <Text style={styles.pillText}>
            {p.sleepAt && sleepChoice ? `${sleepChoice} min` : 'Sleep'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function IconButton({
  name,
  label,
  onPress,
  disabled,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  label?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{ alignItems: 'center', opacity: disabled ? 0.3 : 1 }}>
      <Ionicons name={name} size={28} color={Colors.text} />
      {label ? <Text style={styles.iconLabel}>{label}</Text> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four, alignItems: 'center' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  playButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLabel: { color: Colors.textSecondary, fontSize: 10 },
  pills: { flexDirection: 'row', gap: Spacing.two },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  pillText: { color: Colors.text, fontWeight: '700' },
}));
