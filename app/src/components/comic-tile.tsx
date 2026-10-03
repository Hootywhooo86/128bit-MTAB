import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, makeStyles } from '@/constants/theme';
import { comicImage, type Comic, type ReadProgress } from '@/lib/comics';

/**
 * Portrait cover with title. With `resume`, a tap goes straight back into the reader where
 * you stopped (or the next chapter if that one's done); long-press opens the comic's page.
 */
export function ComicTile({
  comic,
  width = 120,
  note,
  resume,
}: {
  comic: Comic;
  width?: number;
  note?: string;
  resume?: ReadProgress;
}) {
  const styles = useStyles();
  const details = () => router.push({ pathname: '/comics/[id]', params: { id: comic.id } });
  return (
    <Pressable
      style={{ width, gap: 4 }}
      onLongPress={resume ? details : undefined}
      onPress={() =>
        resume
          ? router.push({
              pathname: '/comics/read',
              params: { id: comic.id, chapter: resume.chapterId, resume: '1' },
            })
          : details()
      }>
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
