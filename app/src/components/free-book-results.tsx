import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Pressable } from '@/components/focusable';
import { Body, Cover, Heading } from '@/components/ui';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';
import { freeBook, searchFreeBooks, type FreeBook } from '@/lib/archive-books';
import { downloadBook, offlineSupported } from '@/lib/downloads';
import { usePlayer } from '@/lib/player';

/**
 * "Free audiobooks": LibriVox and the Internet Archive for `query`. Each plays straight away
 * (no TorBox) or downloads to the phone. Shown only when something matches.
 */
export function FreeBookResults({ query, author }: { query: string; author?: string }) {
  const Colors = useColors();
  const styles = useStyles();
  const { playBook } = usePlayer();
  const [books, setBooks] = useState<FreeBook[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    searchFreeBooks(query, author)
      // With the author, nothing found? Try the title alone.
      .then((found) => (found.length || !author ? found : searchFreeBooks(query)))
      .then((found) => !cancelled && setBooks(found))
      .catch(() => !cancelled && setBooks([]));
    return () => {
      cancelled = true;
    };
  }, [query, author]);

  if (!books?.length) return null;

  const note = (id: string, text: string) => setStatus((s) => ({ ...s, [id]: text }));

  async function play(b: FreeBook) {
    setBusy(b.id);
    try {
      await playBook(await freeBook(b));
      router.push('/player');
    } catch (e) {
      note(b.id, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(b: FreeBook) {
    setBusy(b.id);
    try {
      await downloadBook(await freeBook(b), (done, total) => note(b.id, `Downloading ${done}/${total}…`));
      note(b.id, 'On your phone ✓');
    } catch (e) {
      note(b.id, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: Spacing.two, paddingHorizontal: Spacing.three }}>
      <Heading>Free audiobooks</Heading>
      <Body muted style={{ fontSize: 13 }}>
        LibriVox and the Internet Archive: free and legal, plays right away.
      </Body>
      {books.map((b) => (
        <View key={b.id} style={styles.row}>
          <Cover uri={b.cover} size={56} title={b.title} author={b.author} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title} numberOfLines={2}>
              {b.title}
            </Text>
            {b.author ? <Text style={styles.meta}>{b.author}</Text> : null}
            <Text style={styles.meta}>
              <Text style={styles.free}>FREE</Text> · {b.from}
              {b.downloads ? ` · ${b.downloads.toLocaleString()} listens` : ''}
            </Text>
            {status[b.id] ? <Text style={[styles.meta, { color: Colors.accent }]}>{status[b.id]}</Text> : null}
          </View>
          {busy === b.id ? (
            <ActivityIndicator color={Colors.accent} />
          ) : (
            <View style={{ gap: Spacing.one }}>
              <Pressable style={styles.play} onPress={() => play(b)} accessibilityLabel={`Play ${b.title}`}>
                <Text style={[styles.btnText, { color: Colors.accentText }]}>▶ Play</Text>
              </Pressable>
              {offlineSupported ? (
                <Pressable style={styles.save} onPress={() => save(b)} accessibilityLabel={`Download ${b.title}`}>
                  <Text style={styles.btnText}>Download</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  free: { color: Colors.success, fontFamily: PixelFont, fontSize: 12 },
  play: { backgroundColor: Colors.accent, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center' },
  save: { backgroundColor: Colors.surfaceRaised, borderWidth: 2, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center' },
  btnText: { color: Colors.text, fontFamily: PixelFont, fontSize: 14 },
}));
