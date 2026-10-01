import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePlayer } from '@/lib/player';

/** Sits above the tab bar whenever an audiobook is loaded. */
export function MiniPlayer() {
  const Colors = useColors();
  const styles = useStyles();
  const { book, playing, loading, position, duration, toggle } = usePlayer();
  if (!book) return null;
  const fraction = duration ? Math.min(1, position / duration) : 0;

  return (
    <Pressable style={styles.wrap} onPress={() => router.push('/player')}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={styles.row}>
        <Cover uri={book.cover} size={48} title={book.title} author={book.author} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.title}>
            {book.title}
          </Text>
          {book.author ? (
            <Text numberOfLines={1} style={styles.sub}>
              {book.author}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.play}
          hitSlop={8}
          onPress={toggle}
          accessibilityLabel={playing ? 'Pause' : 'Play'}>
          {loading ? (
            <ActivityIndicator color={Colors.accentText} />
          ) : (
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={24}
              color={Colors.accentText}
              style={playing ? undefined : { marginLeft: 3 }}
            />
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  wrap: {
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  track: { height: 2, backgroundColor: Colors.border },
  fill: { height: 2, backgroundColor: Colors.accent },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  title: { color: Colors.text, fontWeight: '700', fontSize: 16 },
  sub: { color: Colors.textSecondary, fontSize: 13 },
  play: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
