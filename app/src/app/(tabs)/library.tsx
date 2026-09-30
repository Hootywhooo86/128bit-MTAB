import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, Cover, Heading, ProgressBar, formatBytes } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { getDownloadedBooks } from '@/lib/downloads';
import { usePlayer } from '@/lib/player';
import { getRecent, getTorboxKey } from '@/lib/storage';
import { listAudioItems, type TorboxItem } from '@/lib/torbox';
import type { PlayableBook } from '@/lib/types';

export default function LibraryScreen() {
  const { playBook } = usePlayer();
  const [recent, setRecent] = useState<PlayableBook[]>([]);
  const [downloaded, setDownloaded] = useState<PlayableBook[]>([]);
  const [cloud, setCloud] = useState<TorboxItem[] | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRecent(await getRecent());
    setDownloaded(await getDownloadedBooks());
    if (!(await getTorboxKey())) {
      setCloud(null);
      setCloudError('Connect TorBox in Settings to see your cloud audiobooks.');
      return;
    }
    try {
      setCloud(await listAudioItems());
      setCloudError(null);
    } catch (e) {
      setCloudError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <Heading>Continue listening</Heading>
      {recent.length === 0 ? <Body muted>Books you play show up here.</Body> : null}
      {recent.map((book) => (
        <BookRow key={book.key} book={book} onPress={() => playBook(book).then(() => router.push('/player'))} />
      ))}

      <Heading style={styles.section}>On this phone</Heading>
      {downloaded.length === 0 ? <Body muted>Download a book to listen offline.</Body> : null}
      {downloaded.map((book) => (
        <BookRow key={book.key} book={book} onPress={() => playBook(book).then(() => router.push('/player'))} />
      ))}

      <Heading style={styles.section}>TorBox cloud</Heading>
      {cloudError ? <Body muted>{cloudError}</Body> : null}
      {cloud && cloud.length === 0 ? <Body muted>No audiobooks in your TorBox yet.</Body> : null}
      {cloud?.map((item) => (
        <Pressable
          key={`${item.kind}:${item.id}`}
          style={styles.row}
          onPress={() =>
            router.push({ pathname: '/cloud/[kind]/[id]', params: { kind: item.kind, id: String(item.id) } })
          }>
          <Cover size={52} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={2} style={styles.title}>
              {item.name}
            </Text>
            {item.download_finished ? (
              <Text style={styles.sub}>{formatBytes(item.size)}</Text>
            ) : (
              <>
                <Text style={styles.sub}>
                  {item.download_state ?? 'downloading'} · {Math.round(item.progress * 100)}%
                </Text>
                <ProgressBar value={item.progress} />
              </>
            )}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function BookRow({ book, onPress }: { book: PlayableBook; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Cover uri={book.cover} size={52} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={styles.title}>
          {book.title}
        </Text>
        <Text style={styles.sub}>
          {[book.author, `${book.chapters.length} chapters`].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.three, gap: Spacing.three },
  section: { marginTop: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  sub: { color: Colors.textSecondary, fontSize: 12 },
});
