import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AudiobookSearch } from '@/components/audiobook-search';
import { BookRow } from '@/components/book-row';
import { HeaderButtons } from '@/components/header-buttons';
import { WantedList } from '@/components/wanted-list';
import { Button, Cover, EmptyState, formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  bookDownloads,
  cancelBookDownload,
  deleteDownload,
  downloadBook,
  getDownloadedBooks,
  isBookDownloaded,
  offlineSupported,
  onBookDownloads,
  type BookDownload,
} from '@/lib/downloads';
import { usePlayer } from '@/lib/player';
import {
  getFavorites,
  getLibrary,
  getProgressMany,
  removeFromLibrary,
  toggleFavorite,
  type Progress,
} from '@/lib/storage';
import type { PlayableBook } from '@/lib/types';
import { getWanted, markStarted, runAutoDownloads, stillWanted, torboxState, type TorboxState, type WantedBook } from '@/lib/wanted';
import { Pressable } from '@/components/focusable';

type Tab = 'library' | 'downloads' | 'wanted';
type Filter = 'all' | 'favorites' | 'progress' | 'finished';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'progress', label: 'In progress' },
  { id: 'finished', label: 'Finished' },
];

const plural = (n: number) => `${n} book${n === 1 ? '' : 's'}`;

/** "123 MB of 565 MB · 4.2 MB/s" for a download row (or "Paused" when it isn't running). */
function downloadInfo(d?: BookDownload) {
  if (!d) return { fraction: 0, text: 'Paused · tap to carry on · hold to cancel' };
  const size = d.total ? `${formatBytes(d.bytes)} of ${formatBytes(d.total)}` : formatBytes(d.bytes);
  const parts = [size, d.speed ? `${formatBytes(d.speed)}/s` : ''];
  if (d.chapters > 1) parts.push(`chapter ${Math.min(d.chapter + 1, d.chapters)} of ${d.chapters}`);
  return { fraction: d.fraction, text: parts.filter(Boolean).join(' · ') };
}

function confirm(title: string, message: string, action: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function AudiobooksScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation();
  const { openBook } = usePlayer();
  const [tab, setTab] = useState<Tab>('library');
  const [filter, setFilter] = useState<Filter>('all');
  const [library, setLibrary] = useState<PlayableBook[]>([]);
  const [downloads, setDownloads] = useState<PlayableBook[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [wantedCount, setWantedCount] = useState(0);
  // Sent to TorBox, not ready yet: in the Library already, with how far along they are.
  const [coming, setComing] = useState<WantedBook[]>([]);
  const [searching, setSearching] = useState(false);
  // Books downloading right now (live bytes / speed).
  const [live, setLive] = useState<Map<string, BookDownload>>(() => bookDownloads());

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButtons
          actions={[
            {
              icon: 'compass-outline',
              label: 'Browse sources',
              onPress: () => router.push('/audiobooks/browse'),
            },
          ]}
        />
      ),
    });
  }, [navigation]);

  const load = useCallback(async () => {
    await markStarted().catch(() => {});
    const [lib, dl, favs, wanted] = await Promise.all([
      getLibrary(),
      getDownloadedBooks(),
      getFavorites(),
      getWanted(),
    ]);
    setWantedCount(wanted.filter(stillWanted).length);
    // Sent to TorBox but not started: those wait in Wanted now, not here.
    setComing([]);
    setLibrary(lib);
    setDownloads(dl);
    setFavorites(favs);
    setProgress(await getProgressMany([...new Set([...lib, ...dl].map((b) => b.key))]));
  }, []);

  useEffect(() => {
    let count = bookDownloads().size;
    return onBookDownloads(() => {
      const now = bookDownloads();
      setLive(now);
      // A book that just finished moves over to the Library.
      if (now.size < count) load();
      count = now.size;
    });
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Anything TorBox finished meanwhile goes on the shelf.
      if (Platform.OS !== 'web') runAutoDownloads().then(load, () => {});
    }, [load]),
  );

  // Tapping a book shows it in the player at your spot; it starts when you tap Play.
  const open = async (book: PlayableBook) => {
    await openBook(book);
    router.push('/player');
  };

  const onLongPress = (book: PlayableBook) =>
    tab === 'library'
      ? confirm('Remove from library', `${book.title}\n\nAlso deletes it from this phone.`, 'Remove', async () => {
          await removeFromLibrary(book.key);
          await cancelBookDownload(book.key); // stops a running download too
          load();
        })
      : confirm('Delete download', `Remove ${book.title} from this phone?`, 'Delete', async () => {
          await deleteDownload(book.key);
          load();
        });

  // Downloads = only books still coming down; finished ones are in the Library.
  const downloading = downloads.filter((b) => live.has(b.key) || !isBookDownloaded(b));
  const onPhone = downloads.filter((b) => !downloading.includes(b));
  // The Library is books you have and are into: started, finished, on the phone, or favourites.
  // Not started yet? It waits in Wanted (your Tracker Audiobooks list) until you press play.
  const begun = (b: PlayableBook) => {
    const p = progress[b.key];
    return !!p && (p.finished || p.fraction > 0);
  };
  const shelf = [
    ...library.filter((b) => begun(b) || favorites.includes(b.key) || onPhone.some((d) => d.key === b.key)),
    ...onPhone.filter((b) => !library.some((l) => l.key === b.key)),
  ];
  const source = tab === 'library' ? shelf : downloading;
  const showComing = tab === 'library' && (filter === 'all' || filter === 'progress') && coming.length > 0;
  const books =
    tab === 'downloads'
      ? source
      : source.filter((b) => {
          const p = progress[b.key];
          if (filter === 'favorites') return favorites.includes(b.key);
          if (filter === 'finished') return !!p?.finished;
          if (filter === 'progress') return !!p && !p.finished && p.fraction > 0;
          return true;
        });

  return (
    <View style={styles.screen}>
      <AudiobookSearch onActive={setSearching} />
      {searching ? null : (
        <>
      <View style={styles.segments}>
        {(['library', 'downloads', 'wanted'] as const).map((t) => (
          <Pressable key={t} style={styles.segment} onPress={() => setTab(t)}>
            <Text style={[styles.segmentLabel, tab === t && styles.segmentLabelActive]}>
              {t === 'library' ? 'Library' : t === 'downloads' ? 'Downloads' : 'Wanted'}
            </Text>
            <Text style={styles.segmentCount}>
              {plural(
                t === 'library' ? shelf.length + coming.length : t === 'downloads' ? downloading.length : wantedCount,
              )}
            </Text>
            <View style={[styles.underline, tab === t && { backgroundColor: Colors.accent }]} />
          </Pressable>
        ))}
      </View>

      {tab === 'library' && shelf.length + coming.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.chip, filter === f.id && styles.chipActive]}>
              <Text style={[styles.chipText, filter === f.id && { color: Colors.accentText }]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {tab === 'wanted' ? <WantedList onCount={setWantedCount} /> : null}
      <FlatList
        style={tab === 'wanted' ? { display: 'none' } : undefined}
        data={books}
        keyExtractor={(b) => b.key}
        contentContainerStyle={{
          paddingHorizontal: Spacing.three,
          paddingBottom: Spacing.five,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          showComing ? (
            <View style={{ gap: Spacing.two, paddingBottom: Spacing.two }}>
              {coming.map((w) => (
                <ComingRow key={w.id} book={w} />
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          showComing ? null : tab === 'library' ? (
            shelf.length ? (
              <EmptyState title="Nothing here" body="No books match this filter." />
            ) : (
              <EmptyState
                title="Your library is empty"
                body="Find a book from your addons or your TorBox cloud.">
                <Button label="Find audiobooks" onPress={() => router.push('/audiobooks/browse')} />
              </EmptyState>
            )
          ) : (
            <EmptyState
              title="Nothing downloading"
              body={
                offlineSupported
                  ? 'Books you download show here while they come down, then move to your Library.'
                  : 'Offline downloads work in the iOS and Android app.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <BookRow
            book={item}
            progress={progress[item.key]}
            favorite={favorites.includes(item.key)}
            onPress={() =>
              tab === 'downloads' && !live.has(item.key)
                ? // Stopped part-way (e.g. the app was closed): carry on.
                  downloadBook(item).catch(() => {}).finally(load)
                : open(item)
            }
            onLongPress={() =>
              tab === 'downloads'
                ? confirm('Cancel download', `Stop downloading ${item.title} and delete what came down?`, 'Cancel download', async () => {
                    await cancelBookDownload(item.key);
                    load();
                  })
                : onLongPress(item)
            }
            onToggleFavorite={async () => setFavorites(await toggleFavorite(item.key))}
            download={tab === 'downloads' ? downloadInfo(live.get(item.key)) : undefined}
            // Streaming it? Download it to the phone from here; it shows under Downloads while it comes down.
            onDownload={
              tab === 'library' && offlineSupported && !downloads.some((d) => d.key === item.key)
                ? () => {
                    downloadBook(item).catch((e) => Alert.alert('Download failed', String(e?.message ?? e))).finally(load);
                    setTimeout(load, 500);
                  }
                : undefined
            }
            onPhone={tab === 'library' && onPhone.some((d) => d.key === item.key)}
          />
        )}
      />
        </>
      )}
    </View>
  );
}

/** A book sent to TorBox that isn't ready yet: how far along, and tap for its page. */
function ComingRow({ book }: { book: WantedBook }) {
  const Colors = useColors();
  const styles = useStyles();
  const [tb, setTb] = useState<TorboxState | null>(null);
  useEffect(() => {
    let cancelled = false;
    torboxState(book).then((s) => !cancelled && setTb(s), () => {});
    return () => {
      cancelled = true;
    };
  }, [book]);
  return (
    <Pressable
      style={styles.coming}
      onPress={() =>
        router.push({
          pathname: '/audiobooks/details',
          params: { title: book.title, author: book.author ?? '', cover: book.cover ?? '' },
        })
      }>
      <Cover uri={book.cover} size={56} title={book.title} author={book.author} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.comingTitle} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? <Text style={styles.comingMeta}>{book.author}</Text> : null}
        <Text style={[styles.comingMeta, { color: tb?.state === 'gone' ? Colors.danger : Colors.accent }]}>
          {tb?.state === 'downloading'
            ? `Coming from TorBox · ${Math.round(tb.progress * 100)}%`
            : tb?.state === 'ready'
              ? 'Ready in TorBox · tap to play or download'
              : tb?.state === 'gone'
                ? 'TorBox item gone · tap to send again'
                : 'Sent to TorBox'}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  coming: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  comingTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  comingMeta: { color: Colors.textSecondary, fontSize: 12 },
  screen: { flex: 1, backgroundColor: Colors.background },
  segments: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  segment: { flex: 1, alignItems: 'center', paddingTop: Spacing.two, gap: 2 },
  segmentLabel: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },
  segmentLabelActive: { color: Colors.text },
  segmentCount: { color: Colors.textSecondary, fontSize: 13 },
  underline: {
    height: 3,
    alignSelf: 'stretch',
    marginTop: Spacing.two,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  filters: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipActive: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
}));
