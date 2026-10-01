import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, makeStyles } from '@/constants/theme';
import { comicImage, type Comic } from '@/lib/comics';

/** Portrait cover with title; opens the comic. */
export function ComicTile({
  comic,
  width = 120,
  note,
}: {
  comic: Comic;
  width?: number;
  note?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      style={{ width, gap: 4 }}
      onPress={() => router.push({ pathname: '/comics/[id]', params: { id: comic.id } })}>
      <View style={[styles.cover, { width, height: width * 1.45 }]}>
        {comic.cover ? (
          <Image
            source={comicImage(comic.cover)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            recyclingKey={comic.id}
          />
        ) : (
          <Text style={styles.fallback}>{comic.title.slice(0, 2).toUpperCase()}</Text>
        )}
      </View>
      <Text numberOfLines={2} style={styles.title}>
        {comic.title}
      </Text>
      {note ? (
        <Text numberOfLines={1} style={styles.note}>
          {note}
        </Text>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  cover: {
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: { color: Colors.textSecondary, fontWeight: '800', fontSize: 22 },
  title: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  note: { color: Colors.accent, fontSize: 12, fontWeight: '600' },
}));
