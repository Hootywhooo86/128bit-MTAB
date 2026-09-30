import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover, ProgressBar } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { usePlayer } from '@/lib/player';

/** Sits above the tab bar whenever something is loaded in the player. */
export function MiniPlayer() {
  const { book, chapterIndex, playing, loading, position, duration, toggle } = usePlayer();
  if (!book) return null;
  const chapter = book.chapters[chapterIndex];

  return (
    <Pressable style={styles.wrap} onPress={() => router.push('/player')}>
      <View style={styles.row}>
        <Cover uri={book.cover} size={42} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.title}>
            {book.title}
          </Text>
          <Text numberOfLines={1} style={styles.sub}>
            {chapter?.title}
          </Text>
        </View>
        <Pressable hitSlop={12} onPress={toggle} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          {loading ? (
            <ActivityIndicator color={Colors.accent} />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={28} color={Colors.text} />
          )}
        </Pressable>
      </View>
      <ProgressBar value={duration ? position / duration : 0} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surfaceRaised,
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three },
  title: { color: Colors.text, fontWeight: '700', fontSize: 14 },
  sub: { color: Colors.textSecondary, fontSize: 12 },
});
