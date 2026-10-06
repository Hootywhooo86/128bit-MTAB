import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
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
import { Button, EmptyState } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { deleteDownload, getDownloadedBooks, offlineSupported } from '@/lib/downloads';
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
import { getWanted } from '@/lib/wanted';
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
  const [searching, setSearching] = useState(false);

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
    const [lib, dl, favs, wanted] = await Promise.all([
      getLibrary(),
      getDownloadedBooks(),
      getFavorites(),
      getWanted(),
    ]);
    setWantedCount(wanted.length);
    setLibrary(lib);
    setDownloads(dl);
    setFavorites(favs);
    setProgress(await getProgressMany([...new Set([...lib, ...dl].map((b) => b.key))]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Tapping a book shows it in the player at your spot; it starts when you tap Play.
  const open = async (book: PlayableBook) => {
    await openBook(book);
    router.push('/player');
  };

  const onLongPress = (book: PlayableBook) =>
    tab === 'library'
      ? confirm('Remove from library', book.title, 'Remove', async () => {
          await removeFromLibrary(book.key);
          load();
        })
      : confirm('Delete download', `Remove ${book.title} from this phone?`, 'Delete', async () => {
          await deleteDownload(book.key);
          load();
        });

  const source = tab === 'library' ? library : downloads;
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
                t === 'library' ? library.length : t === 'downloads' ? downloads.length : wantedCount,
              )}
            </Text>
            <View style={[styles.underline, tab === t && { backgroundColor: Colors.accent }]} />
          </Pressable>
        ))}
      </View>

      {tab === 'library' && library.length > 0 ? (
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
        ListEmptyComponent={
          tab === 'library' ? (
            library.length ? (
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
              title="No downloads"
              body={
                offlineSupported
                  ? 'Open a book and tap “Download to phone” to listen offline.'
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
            onPress={() => open(item)}
            onLongPress={() => onLongPress(item)}
            onToggleFavorite={async () => setFavorites(await toggleFavorite(item.key))}
            extra={tab === 'downloads' ? 'On this phone' : undefined}
          />
        )}
      />
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
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
