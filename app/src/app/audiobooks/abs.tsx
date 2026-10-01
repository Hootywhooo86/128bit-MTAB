import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { Button, Cover, EmptyState, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  absConnected,
  absItems,
  absLibraries,
  absSearch,
  type AbsItem,
  type AbsLibrary,
} from '@/lib/audiobookshelf';

/** Browse and search your Audiobookshelf libraries. */
export default function AbsBrowseScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [libraries, setLibraries] = useState<AbsLibrary[]>([]);
  const [library, setLibrary] = useState<string | null>(null);
  const [results, setResults] = useState<{ key: string; items: AbsItem[] } | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const yes = await absConnected();
        setConnected(yes);
        if (!yes) return;
        try {
          const libs = await absLibraries();
          setLibraries(libs);
          setLibrary((current) => current ?? libs[0]?.id ?? null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, []),
  );

  // Results are tagged with what they're for, so switching library/search shows a spinner.
  const want = `${library}|${submitted}`;
  useEffect(() => {
    if (!library) return;
    let cancelled = false;
    (submitted ? absSearch(library, submitted) : absItems(library))
      .then((list) => !cancelled && setResults({ key: want, items: list }))
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setResults({ key: want, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [library, submitted, want]);
  const items = results?.key === want ? results.items : null;

  if (connected === false) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="Connect Audiobookshelf"
          body="Sign in to your Audiobookshelf server to browse and play your own audiobooks.">
          <Button label="Open Integrations" onPress={() => router.push('/settings/integrations')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ padding: Spacing.three, gap: Spacing.two }}>
        <Input
          placeholder="Search your library"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => {
            setError(null);
            setSubmitted(query.trim());
          }}
          clearButtonMode="while-editing"
        />
        {libraries.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: Spacing.two }}>
            {libraries.map((l) => (
              <Pressable
                key={l.id}
                onPress={() => setLibrary(l.id)}
                style={[styles.chip, l.id === library && styles.chipActive]}>
                <Text style={[styles.chipText, l.id === library && { color: Colors.accentText }]}>
                  {l.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
      </View>
      {!items ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.four }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={3}
          columnWrapperStyle={{ gap: Spacing.three }}
          contentContainerStyle={{
            paddingHorizontal: Spacing.three,
            gap: Spacing.three,
            paddingBottom: Spacing.five,
          }}
          ListEmptyComponent={<EmptyState title="No audiobooks found" />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.tile}
              onPress={() =>
                router.push({ pathname: '/audiobooks/abs-item', params: { id: item.id } })
              }>
              <Cover uri={item.cover} size={104} title={item.title} author={item.author} />
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              {item.author ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {item.author}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipActive: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  tile: { width: 104, gap: 4 },
  title: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  sub: { color: Colors.textSecondary, fontSize: 12 },
}));
