import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { PlayableActions } from '@/components/playable-actions';
import {
  Body,
  Card,
  Cover,
  EmptyState,
  Heading,
  ProgressBar,
  Title,
  formatBytes,
} from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchBook } from '@/lib/addons';
import { checkTorbox, resolveSource, type ResolveResult } from '@/lib/resolve';
import { getAddons } from '@/lib/storage';
import type { BookDetail, Source } from '@/lib/types';
import { Pressable } from '@/components/focusable';

const POLL_MS = 5000;

function describeSource(s: Source) {
  if (s.chapters?.length) return `Direct stream · ${s.chapters.length} files`;
  if (s.infoHash || s.magnet) return 'Torrent via TorBox';
  if (s.webUrl) return 'Web link via TorBox';
  return 'Unknown';
}

export default function BookScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { addon: addonId, id } = useLocalSearchParams<{
    addon: string;
    id: string;
  }>();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const addon = (await getAddons()).find((a) => a.manifest.id === addonId);
        if (!addon) throw new Error('That addon is no longer installed');
        setBook(await fetchBook(addon, id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [addonId, id]);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  // While TorBox is still downloading, check back every few seconds.
  useEffect(() => {
    if (result?.status !== 'downloading' || !book) return;
    pollTimer.current = setTimeout(async () => {
      try {
        setResult(await checkTorbox(result.kind, result.itemId, book));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, POLL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [result, book]);

  async function pick(source: Source, index: number) {
    if (!book) return;
    setResolving(index);
    setError(null);
    try {
      setResult(await resolveSource(addonId, book, source));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(null);
    }
  }

  if (!book) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        {error ? (
          <EmptyState title="Couldn't load this book" body={error} />
        ) : (
          <ActivityIndicator color={Colors.accent} />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: book.title }} />
      <View style={styles.header}>
        <Cover uri={book.cover} size={140} title={book.title} author={book.author} />
        <View style={{ flex: 1, gap: 4 }}>
          <Title style={{ fontSize: 22 }}>{book.title}</Title>
          {book.author ? <Body muted>{book.author}</Body> : null}
          {book.narrator ? <Body muted>Read by {book.narrator}</Body> : null}
          {book.duration ? <Body muted>{book.duration}</Body> : null}
        </View>
      </View>
      {book.description ? (
        <Body muted numberOfLines={8}>
          {book.description}
        </Body>
      ) : null}
      {error ? <Body style={{ color: Colors.danger }}>{error}</Body> : null}

      {result?.status === 'ready' ? (
        <PlayableActions book={result.book} />
      ) : result?.status === 'downloading' ? (
        <Card>
          <Heading>TorBox is fetching this book</Heading>
          <Body muted>
            You can leave this screen. It will also show up in Library → TorBox cloud.
          </Body>
          <ProgressBar value={result.progress} />
          <Body muted>{Math.round(result.progress * 100)}%</Body>
        </Card>
      ) : (
        <>
          <Heading>Sources</Heading>
          {book.sources.length === 0 ? <Body muted>This addon returned no sources.</Body> : null}
          {book.sources.map((s, i) => (
            <Pressable key={i} onPress={() => pick(s, i)} disabled={resolving !== null}>
              <Card>
                <View style={styles.sourceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sourceName}>{s.name ?? `Source ${i + 1}`}</Text>
                    {s.title ? <Body muted>{s.title}</Body> : null}
                    <Body muted style={{ fontSize: 12 }}>
                      {[describeSource(s), formatBytes(s.size)].filter(Boolean).join(' · ')}
                    </Body>
                  </View>
                  {resolving === i ? <ActivityIndicator color={Colors.accent} /> : null}
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  header: { flexDirection: 'row', gap: Spacing.three },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  sourceName: { color: Colors.text, fontWeight: '700', fontSize: 15 },
}));
