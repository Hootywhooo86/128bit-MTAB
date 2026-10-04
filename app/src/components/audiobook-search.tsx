import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Cover } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  addRecentSearch,
  clearRecentSearches,
  formatMinutes,
  getRecentSearches,
  removeRecentSearch,
  searchAudible,
  type AudibleBook,
  type SearchMode,
} from '@/lib/audible';
import { getWanted, wantedId } from '@/lib/wanted';
import { Pressable } from '@/components/focusable';

const MODES: { id: SearchMode; label: string; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'title', label: 'Title', icon: 'book-outline' },
  { id: 'author', label: 'Author', icon: 'person-outline' },
  { id: 'narrator', label: 'Narrator', icon: 'mic-outline' },
  { id: 'all', label: 'All', icon: 'search-outline' },
];

/**
 * Search bar for the Audiobooks tab. While it's in use (focused or showing results)
 * it takes over the screen; `onActive` tells the tab to hide its lists.
 */
export function AudiobookSearch({ onActive }: { onActive: (active: boolean) => void }) {
  const Colors = useColors();
  const styles = useStyles();
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<SearchMode>('title');
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [results, setResults] = useState<AudibleBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setWanted] = useState<Set<string>>(new Set());

  const active = focused || !!submitted;
  useEffect(() => onActive(active), [active, onActive]);

  useFocusEffect(
    useCallback(() => {
      getRecentSearches().then(setRecent);
      getWanted().then((w) => setWanted(new Set(w.map((x) => x.id))));
    }, []),
  );

  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    searchAudible(submitted, mode).then(
      (r) => !cancelled && setResults(r),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [submitted, mode]);

  function search(q = query) {
    const text = q.trim();
    if (!text) return;
    setQuery(text);
    setResults(null);
    setError(null);
    setSubmitted(text);
    addRecentSearch(text).then(setRecent);
    Keyboard.dismiss();
  }

  function clear() {
    setQuery('');
    setSubmitted('');
    setResults(null);
    input.current?.blur();
    setFocused(false);
  }

  function pickMode(m: SearchMode) {
    setMode(m);
    if (submitted) setResults(null);
  }

  return (
    <View style={active ? { flex: 1 } : undefined}>
      <View style={styles.bar}>
        <Ionicons name="search" size={20} color={Colors.textSecondary} />
        <TextInput
          ref={input}
          style={styles.input}
          placeholder={`Search by ${mode === 'all' ? 'anything' : mode}…`}
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => search()}
          returnKeyType="search"
          autoCorrect={false}
        />
        {active ? (
          <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Close search">
            <Ionicons name="close-circle" size={20} color={Colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {active ? (
        <>
          <View style={styles.chips}>
            {MODES.map((m) => {
              const on = m.id === mode;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => pickMode(m.id)}
                  style={[styles.chip, on && styles.chipOn]}>
                  <Ionicons name={m.icon} size={15} color={on ? Colors.accentText : Colors.textSecondary} />
                  <Text style={[styles.chipText, on && { color: Colors.accentText }]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {!submitted ? (
            recent.length ? (
              <View style={{ paddingHorizontal: Spacing.three, gap: Spacing.two }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.heading, { flex: 1 }]}>Recent Searches</Text>
                  <Pressable onPress={() => clearRecentSearches().then(setRecent)} hitSlop={8}>
                    <Text style={styles.muted}>Clear All</Text>
                  </Pressable>
                </View>
                <View style={styles.recent}>
                  {recent.map((r) => (
                    <View key={r} style={styles.recentChip}>
                      <Pressable onPress={() => search(r)}>
                        <Text style={styles.recentText}>{r}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => removeRecentSearch(r).then(setRecent)}
                        hitSlop={8}
                        accessibilityLabel={`Remove ${r}`}>
                        <Ionicons name="close" size={16} color={Colors.textSecondary} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          ) : error ? (
            <Text style={[styles.muted, { color: Colors.danger, padding: Spacing.three }]}>{error}</Text>
          ) : !results ? (
            <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.four }} />
          ) : (
            <FlatList
              data={results}
              keyExtractor={(b) => b.asin}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five }}
              ListHeaderComponent={
                <Text style={styles.muted}>
                  {results.length} results for “{submitted}”
                </Text>
              }
              ListEmptyComponent={<Text style={styles.muted}>Nothing found. Try another mode.</Text>}
              renderItem={({ item }) => (
                <ResultCard book={item} wanted={wanted.has(wantedId(item.title, item.author))} />
              )}
            />
          )}
        </>
      ) : null}
    </View>
  );
}

function ResultCard({ book, wanted }: { book: AudibleBook; wanted: boolean }) {
  const Colors = useColors();
  const styles = useStyles();
  const facts = [book.rating ? `★ ${book.rating.toFixed(1)}` : null, formatMinutes(book.minutes)]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <Pressable
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: '/audiobooks/details',
          params: {
            title: book.title,
            author: book.author ?? '',
            narrator: book.narrator ?? '',
            cover: book.cover ?? '',
            rating: book.rating ? String(book.rating) : '',
            minutes: book.minutes ? String(book.minutes) : '',
            series: book.series ?? '',
            description: book.description?.slice(0, 2000) ?? '',
          },
        })
      }>
      <Cover uri={book.cover} size={88} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? <Text style={styles.cardAuthor}>{book.author}</Text> : null}
        {book.narrator ? (
          <Text style={styles.muted} numberOfLines={1}>
            Narrated by {book.narrator}
          </Text>
        ) : null}
        {facts ? <Text style={[styles.muted, { color: Colors.text }]}>{facts}</Text> : null}
        {book.series ? <Text style={styles.muted}>{book.series}</Text> : null}
      </View>
      {wanted ? <Ionicons name="checkmark" size={22} color={Colors.text} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  input: { flex: 1, color: Colors.text, fontSize: 16, paddingVertical: Spacing.three },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: Colors.textSecondary, fontWeight: '700' },
  heading: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  recent: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recentText: { color: Colors.text, fontSize: 15 },
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  cardAuthor: { color: Colors.text, fontSize: 14 },
}));
