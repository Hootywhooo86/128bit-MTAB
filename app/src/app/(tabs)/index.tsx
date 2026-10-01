import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, ScrollView, View } from 'react-native';

import { ComicTile } from '@/components/comic-tile';
import { Body, Heading, Input } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  getAllComicProgress,
  getComicLibrary,
  listComics,
  searchComics,
  type Comic,
  type ComicList,
  type ReadProgress,
} from '@/lib/comics';

/** Comics tab: your comics, what you're reading, and MangaDex to browse and search. */
export default function ComicsScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [results, setResults] = useState<Comic[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Comic[]>([]);
  const [progress, setProgress] = useState<Record<string, ReadProgress>>({});

  useFocusEffect(
    useCallback(() => {
      getComicLibrary().then(setLibrary);
      getAllComicProgress().then(setProgress);
    }, []),
  );

  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    searchComics(submitted).then(
      (r) => !cancelled && setResults(r),
      (e) => !cancelled && setSearchError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [submitted]);

  const reading = library
    .filter((c) => progress[c.id])
    .sort((a, b) => progress[b.id].updatedAt - progress[a.id].updatedAt);

  function search() {
    const q = query.trim();
    setResults(null);
    setSearchError(null);
    setSubmitted(q);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingVertical: Spacing.three, gap: Spacing.four }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Input
          placeholder="Search comics and manga"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (!t) setSubmitted('');
          }}
          returnKeyType="search"
          onSubmitEditing={search}
          clearButtonMode="while-editing"
        />
      </View>

      {submitted ? (
        <View style={{ gap: Spacing.two }}>
          <Heading style={{ paddingHorizontal: Spacing.three }}>“{submitted}”</Heading>
          {searchError ? (
            <Body style={{ color: Colors.danger, paddingHorizontal: Spacing.three }}>{searchError}</Body>
          ) : !results ? (
            <ActivityIndicator color={Colors.accent} />
          ) : results.length === 0 ? (
            <Body muted style={{ paddingHorizontal: Spacing.three }}>No results.</Body>
          ) : (
            <View style={styles.grid}>
              {results.map((c) => (
                <ComicTile key={c.id} comic={c} width={108} />
              ))}
            </View>
          )}
        </View>
      ) : (
        <>
          {reading.length ? (
            <Row title="Continue reading">
              {reading.map((c) => (
                <ComicTile key={c.id} comic={c} note={progress[c.id].chapterLabel} />
              ))}
            </Row>
          ) : null}
          {library.length ? (
            <Row title={`Your library (${library.length})`}>
              {library.map((c) => (
                <ComicTile key={c.id} comic={c} note={progress[c.id] ? undefined : 'New'} />
              ))}
            </Row>
          ) : null}
          <ListRow title="Popular" kind="popular" />
          <ListRow title="Latest updates" kind="latest" />
          <ListRow title="Top rated" kind="top" />
          <Body muted style={{ fontSize: 12, paddingHorizontal: Spacing.three }}>
            Comics and manga from MangaDex. Officially licensed series are often taken down there,
            so some have few or no chapters.
          </Body>
        </>
      )}
    </ScrollView>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.two }}>
      <Heading style={{ paddingHorizontal: Spacing.three }}>{title}</Heading>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}>
        {children}
      </ScrollView>
    </View>
  );
}

function ListRow({ title, kind }: { title: string; kind: ComicList }) {
  const Colors = useColors();
  const [items, setItems] = useState<Comic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listComics(kind).then(
      (r) => !cancelled && setItems(r),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function more() {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await listComics(kind, items.length);
      setItems((cur) => [...(cur ?? []), ...next.filter((n) => !cur?.some((c) => c.id === n.id))]);
    } catch {
      // Keep what we have.
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Heading style={{ paddingHorizontal: Spacing.three }}>{title}</Heading>
      {error ? (
        <Body style={{ color: Colors.danger, paddingHorizontal: Spacing.three }}>{error}</Body>
      ) : !items ? (
        <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }} />
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(c) => c.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => <ComicTile comic={item} />}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.accent} /> : null}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
}));
