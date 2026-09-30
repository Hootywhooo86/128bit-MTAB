import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Heading, formatBytes } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { deleteDownload, downloadBook, isBookDownloaded, offlineSupported } from '@/lib/downloads';
import { usePlayer } from '@/lib/player';
import type { PlayableBook } from '@/lib/types';

/** Play / download buttons and the chapter list for a book that is ready. */
export function PlayableActions({ book }: { book: PlayableBook }) {
  const { playBook, book: current, chapterIndex } = usePlayer();
  const [downloaded, setDownloaded] = useState(() => offlineSupported && isBookDownloaded(book));
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function play(chapter?: number) {
    await playBook(book, chapter);
    router.push('/player');
  }

  async function download() {
    setError(null);
    try {
      await downloadBook(book, (done, total) => setProgress(`Downloading ${done}/${total}…`));
      setDownloaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    await deleteDownload(book.key);
    setDownloaded(false);
  }

  const isCurrent = current?.key === book.key;

  return (
    <View style={{ gap: Spacing.three }}>
      <Button label={isCurrent ? 'Resume' : 'Play'} onPress={() => play()} />
      {offlineSupported ? (
        downloaded ? (
          <Button label="Remove from phone" variant="danger" onPress={remove} />
        ) : (
          <Button
            label={progress ?? 'Download to phone'}
            variant="secondary"
            onPress={download}
            disabled={!!progress}
          />
        )
      ) : null}
      {error ? <Body style={{ color: Colors.danger }}>{error}</Body> : null}

      <Heading>{book.chapters.length} chapters</Heading>
      {book.chapters.map((c, i) => (
        <Pressable key={c.id} style={styles.chapter} onPress={() => play(i)}>
          <Text style={[styles.num, isCurrent && i === chapterIndex && { color: Colors.accent }]}>{i + 1}</Text>
          <Text
            numberOfLines={2}
            style={[styles.chapterTitle, isCurrent && i === chapterIndex && { color: Colors.accent }]}>
            {c.title}
          </Text>
          {c.size ? <Text style={styles.size}>{formatBytes(c.size)}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  num: { color: Colors.textSecondary, width: 28, fontVariant: ['tabular-nums'] },
  chapterTitle: { color: Colors.text, flex: 1 },
  size: { color: Colors.textSecondary, fontSize: 12 },
});
