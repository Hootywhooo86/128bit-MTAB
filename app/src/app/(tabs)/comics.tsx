import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { ComicFind } from '@/components/comic-find';
import { ComicTile } from '@/components/comic-tile';
import { ComicWanted } from '@/components/comic-wanted';
import { Body, Heading, Input } from '@/components/ui';
import { PixelFont, Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  browseSuwayomi,
  getAllComicProgress,
  getComicLibrary,
  listComics,
  searchComics,
  type Comic,
  type ReadProgress,
} from '@/lib/comics';
import { usePrefs } from '@/lib/prefs';
import {
  comicDownloadsSupported,
  getComicDownloads,
  importCbz,
  onComicDownloads,
  type LocalSeries,
} from '@/lib/comic-downloads';
import { getSuwayomi, listSources, type SuwaSource } from '@/lib/suwayomi';

const MANGADEX = 'mangadex';
const SECTIONS = ['Browse', 'Find', 'Wanted'] as const;
type Section = (typeof SECTIONS)[number];

/** Comics tab: your comics, what you're reading, and MangaDex to browse and search. */
export default function ComicsScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [section, setSection] = useState<Section>('Browse');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [results, setResults] = useState<Comic[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Comic[]>([]);
  const [progress, setProgress] = useState<Record<string, ReadProgress>>({});
  const [sources, setSources] = useState<SuwaSource[]>([]);
  const [onPhone, setOnPhone] = useState<LocalSeries[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    getComicDownloads().then((l) => setOnPhone([...l]));
    return onComicDownloads((l) => setOnPhone([...l]));
  }, []);

  async function importFiles() {
    setImporting(true);
    setImportError(null);
    try {
      const series = await importCbz();
      if (series) router.push({ pathname: '/comics/[id]', params: { id: series.comic.id } });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }
  const [source, setSource] = useState(MANGADEX);

  useFocusEffect(
    useCallback(() => {
      getComicLibrary().then(setLibrary);
      getAllComicProgress().then(setProgress);
      // Sources from your Suwayomi extensions (Keiyoushi etc.), when a server is connected.
      getSuwayomi().then((c) =>
        c ? listSources().then(setSources, () => setSources([])) : setSources([]),
      );
    }, []),
  );

  const { prefs } = usePrefs();
  const shownSources = prefs.comicAllLanguages
    ? sources
    : sources.filter((s) => ['en', 'all', 'multi', 'other'].includes(s.lang));
  const current = shownSources.find((s) => s.id === source);

  useEffect(() => {
    if (!submitted) return;
    let cancelled = false;
    (current
      ? browseSuwayomi(current.id, 'SEARCH', 1, submitted).then((r) => r.comics)
      : searchComics(submitted)
    ).then(
      (r) => !cancelled && setResults(r),
      (e) => !cancelled && setSearchError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [submitted, current]);

  const reading = library
    .filter((c) => progress[c.id])
    .sort((a, b) => progress[b.id].updatedAt - progress[a.id].updatedAt);

  function search() {
    const q = query.trim();
    setResults(null);
    setSearchError(null);
    setSubmitted(q);
  }

  const tabs = (
    <View style={styles.sections}>
      {SECTIONS.map((t) => (
        <Pressable
          key={t}
          onPress={() => setSection(t)}
          style={[styles.section, section === t && styles.sectionOn]}>
          <Text style={[styles.sectionText, section === t && { color: Colors.accentText }]}>
            {t.toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  if (section !== 'Browse') {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingVertical: Spacing.three, gap: Spacing.four }}
        keyboardShouldPersistTaps="handled">
        {tabs}
        {section === 'Find' ? <ComicFind onGrabbed={() => {}} /> : <ComicWanted />}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingVertical: Spacing.three, gap: Spacing.four }}>
      {tabs}
      {shownSources.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.two }}>
          {[{ id: MANGADEX, displayName: 'MangaDex' }, ...shownSources].map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                setSource(s.id);
                setResults(null);
              }}
              style={[styles.chip, source === s.id && { backgroundColor: Colors.accent }]}>
              <Text style={[styles.chipText, source === s.id && { color: Colors.accentText }]}>
                {s.displayName}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Input
          placeholder={`Search ${current ? current.name : 'comics and manga'}`}
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
          {onPhone.length ? (
            <Row title="On this phone">
              {onPhone.map((s) => (
                <ComicTile
                  key={s.comic.id}
                  comic={s.comic}
                  note={`${s.chapters.filter((c) => c.state === 'done').length} ch. saved`}
                />
              ))}
            </Row>
          ) : null}
          {comicDownloadsSupported ? (
            <View style={{ paddingHorizontal: Spacing.three, gap: Spacing.two }}>
              <Pressable style={styles.importButton} onPress={importFiles} disabled={importing}>
                {importing ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <Text style={styles.importText}>＋ Import CBZ files from this phone</Text>
                )}
              </Pressable>
              {importError ? <Body style={{ color: Colors.danger, fontSize: 12 }}>{importError}</Body> : null}
            </View>
          ) : null}
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
          {current ? (
            <>
              <ListRow
                key={`${current.id}:popular`}
                title={`Popular on ${current.name}`}
                load={async (page) => (await browseSuwayomi(current.id, 'POPULAR', page)).comics}
              />
              {current.supportsLatest ? (
                <ListRow
                  key={`${current.id}:latest`}
                  title="Latest updates"
                  load={async (page) => (await browseSuwayomi(current.id, 'LATEST', page)).comics}
                />
              ) : null}
            </>
          ) : (
            <>
              <ListRow key="md:popular" title="Popular" load={(page) => listComics('popular', (page - 1) * 24)} />
              <ListRow key="md:latest" title="Latest updates" load={(page) => listComics('latest', (page - 1) * 24)} />
              <ListRow key="md:top" title="Top rated" load={(page) => listComics('top', (page - 1) * 24)} />
              <Body muted style={{ fontSize: 12, paddingHorizontal: Spacing.three }}>
                Comics and manga from MangaDex. Officially licensed series are often taken down
                there. For Mihon extensions (Keiyoushi), connect Suwayomi in Settings → Comics.
              </Body>
            </>
          )}
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

function ListRow({ title, load }: { title: string; load: (page: number) => Promise<Comic[]> }) {
  const Colors = useColors();
  const [items, setItems] = useState<Comic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    load(1).then(
      (r) => !cancelled && setItems(r),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
    // Each row loads once; its key changes when the source does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function more() {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await load(page + 1);
      setPage(page + 1);
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
  importButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
    padding: Spacing.three,
    alignItems: 'center',
  },
  importText: { color: Colors.accent, fontWeight: '700' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: Colors.surfaceRaised,
  },
  chipText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  sections: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three },
  section: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  sectionOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  sectionText: { color: Colors.text, fontFamily: PixelFont, fontSize: 9 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
}));
