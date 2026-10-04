import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  getHardcoverToken,
  getMatch,
  searchHardcover,
  setMatch,
  type HardcoverBook,
} from '@/lib/hardcover';
import type { PlayableBook } from '@/lib/types';
import { Pressable } from '@/components/focusable';

/** Player pill: shows which Hardcover book this is tracked as, and lets you change it. */
export function HardcoverPill({ book }: { book: PlayableBook }) {
  const Colors = useColors();
  const styles = useStyles();
  const [enabled, setEnabled] = useState(false);
  const [match, setMatchState] = useState<HardcoverBook | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HardcoverBook[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHardcoverToken().then((t) => setEnabled(!!t));
    getMatch(book.key).then(setMatchState);
  }, [book.key]);

  if (!enabled) return null;

  async function search(q: string) {
    setBusy(true);
    setError(null);
    try {
      setResults(await searchHardcover(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function show() {
    const q = [book.title, book.author].filter(Boolean).join(' ');
    setQuery(q);
    setOpen(true);
    getMatch(book.key).then(setMatchState);
    search(q);
  }

  async function choose(m: HardcoverBook | null) {
    await setMatch(book.key, m);
    setMatchState(m);
    setOpen(false);
  }

  return (
    <>
      <Pressable style={styles.pill} onPress={show} accessibilityLabel="Hardcover">
        <Ionicons name="library" size={14} color={match ? Colors.accent : Colors.text} />
        <Text style={styles.pillText}>Hardcover</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.title}>Track on Hardcover as…</Text>
            <Text style={styles.sub}>
              {match
                ? `Now: ${match.title}${match.author ? ` · ${match.author}` : ''}`
                : match === null
                  ? 'Not tracked'
                  : 'Picked automatically when you listen'}
            </Text>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Title and author"
              onSubmitEditing={() => search(query)}
              returnKeyType="search"
            />
            {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
            <ScrollView style={{ maxHeight: 340 }}>
              {busy ? <ActivityIndicator color={Colors.accent} style={{ margin: 16 }} /> : null}
              {!busy && results?.length === 0 ? <Text style={styles.sub}>No matches.</Text> : null}
              {!busy &&
                results?.map((r) => (
                  <Pressable key={r.id} style={styles.row} onPress={() => choose(r)}>
                    <View style={styles.cover}>
                      {r.cover ? (
                        <Image source={{ uri: r.cover }} style={{ flex: 1 }} contentFit="cover" />
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {r.title}
                      </Text>
                      <Text style={styles.sub} numberOfLines={1}>
                        {[r.author, r.year].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {match?.id === r.id ? (
                      <Ionicons name="checkmark" size={20} color={Colors.accent} />
                    ) : null}
                  </Pressable>
                ))}
            </ScrollView>
            <Button label="Don't track this book" variant="secondary" onPress={() => choose(null)} />
            <Button label="Close" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((Colors) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  pillText: { color: Colors.text, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modal: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  sub: { color: Colors.textSecondary, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  cover: {
    width: 40,
    height: 60,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
  },
  rowTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
}));
