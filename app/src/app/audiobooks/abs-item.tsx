import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { formatBookLength } from '@/components/book-row';
import { PlayableActions } from '@/components/playable-actions';
import { Body, Cover, EmptyState, Title } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { absBook } from '@/lib/audiobookshelf';
import type { PlayableBook } from '@/lib/types';

/** One Audiobookshelf audiobook: details, play, download and chapters. */
export default function AbsItemScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<PlayableBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    absBook(id)
      .then(setBook)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <EmptyState title="Couldn’t open this book" body={error} />;
  if (!book) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: book.title }} />
      <View style={styles.header}>
        <Cover uri={book.cover} size={140} />
        <View style={{ flex: 1, gap: 4 }}>
          <Title style={{ fontSize: 22 }}>{book.title}</Title>
          {book.author ? <Body muted>{book.author}</Body> : null}
          {book.narrator ? <Body muted>Read by {book.narrator}</Body> : null}
          {book.duration ? <Body muted>{formatBookLength(book.duration)}</Body> : null}
        </View>
      </View>
      <PlayableActions book={book} />
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  header: { flexDirection: 'row', gap: Spacing.three },
}));
