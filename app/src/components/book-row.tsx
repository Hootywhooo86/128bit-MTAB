import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover, ProgressBar } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import type { Progress } from '@/lib/storage';
import type { PlayableBook } from '@/lib/types';

/** "10:17:59" → "10h 17m" */
export function formatBookLength(duration?: string) {
  if (!duration) return undefined;
  const parts = duration.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return duration;
  const [h, m] = parts.length === 3 ? parts : [0, parts[0] ?? 0];
  return h ? `${h}h ${m}m` : `${m}m`;
}

type Props = {
  book: PlayableBook;
  progress?: Progress;
  favorite: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onToggleFavorite: () => void;
  extra?: string;
};

/** One book in the Audiobooks library: cover, title, author · narrator, length and progress. */
export function BookRow({ book, progress, favorite, onPress, onLongPress, onToggleFavorite, extra }: Props) {
  const byline = [book.author, book.narrator].filter(Boolean).join(' • ');
  const length = formatBookLength(book.duration) ?? `${book.chapters.length} chapters`;
  const started = progress && !progress.finished && (progress.fraction > 0 || progress.chapter > 0 || progress.position > 0);

  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={onLongPress}>
      <Cover uri={book.cover} size={84} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {byline ? (
          <Text style={styles.sub} numberOfLines={1}>
            {byline}
          </Text>
        ) : null}
        <Text style={styles.sub}>{[length, extra].filter(Boolean).join(' · ')}</Text>
        {progress?.finished ? (
          <Text style={styles.complete}>Complete</Text>
        ) : started ? (
          <View style={styles.progressRow}>
            <View style={{ flex: 1 }}>
              <ProgressBar value={progress.fraction} />
            </View>
            <Text style={styles.percent}>{Math.max(1, Math.round(progress.fraction * 100))}%</Text>
          </View>
        ) : (
          <Text style={styles.sub}>Not started</Text>
        )}
      </View>
      <Pressable
        hitSlop={12}
        onPress={onToggleFavorite}
        accessibilityLabel={favorite ? 'Remove from favorites' : 'Add to favorites'}>
        <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={24} color={favorite ? Colors.accent : Colors.text} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  info: { flex: 1, gap: 3 },
  title: { color: Colors.text, fontWeight: '700', fontSize: 17 },
  sub: { color: Colors.textSecondary, fontSize: 14 },
  complete: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 4 },
  percent: { color: Colors.textSecondary, fontSize: 13, minWidth: 36, textAlign: 'right' },
});
