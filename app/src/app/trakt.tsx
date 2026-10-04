import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTraktConnected } from '@/components/trakt-actions';
import { Button, EmptyState, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { formatDuration } from '@/lib/stats';
import {
  createList,
  deleteList,
  getCalendar,
  getCollection,
  getFavorites,
  getHistory,
  getListItems,
  getLists,
  getPlaybackRows,
  getRatings,
  getRecommendations,
  getTraktStats,
  getUpNext,
  getWatchlist,
  hideRecommendation,
  linkFor,
  poster,
  rate,
  removeHistoryRow,
  removePlayback,
  setCollected,
  setEpisodeWatched,
  setFavorite,
  setInList,
  setWatchlist,
  type Kind,
  type TraktItem,
  type TraktList,
  type TraktStats,
} from '@/lib/trakt-library';
import { Pressable } from '@/components/focusable';

type Section =
  | 'upnext'
  | 'watchlist'
  | 'history'
  | 'collection'
  | 'ratings'
  | 'favorites'
  | 'lists'
  | 'calendar'
  | 'recommended'
  | 'playback'
  | 'stats';

const SECTIONS: { id: Section; label: string; byKind?: boolean }[] = [
  { id: 'upnext', label: 'Up next' },
  { id: 'watchlist', label: 'Watchlist', byKind: true },
  { id: 'history', label: 'History' },
  { id: 'collection', label: 'Collection', byKind: true },
  { id: 'ratings', label: 'Ratings', byKind: true },
  { id: 'favorites', label: 'Favorites', byKind: true },
  { id: 'lists', label: 'Lists' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'recommended', label: 'For you', byKind: true },
  { id: 'playback', label: 'Paused' },
  { id: 'stats', label: 'Stats' },
];

type IconName = ComponentProps<typeof Ionicons>['name'];
type Row = { item: TraktItem; action?: { icon: IconName; label: string; run: () => Promise<unknown> }; note?: string };

function confirm(message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onYes();
    return;
  }
  Alert.alert('Trakt', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'OK', style: 'destructive', onPress: onYes },
  ]);
}

/** Your whole Trakt account: browse and change it. */
export default function TraktScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const connected = useTraktConnected();
  const [section, setSection] = useState<Section>('upnext');
  const [kind, setKind] = useState<Kind>('show');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lists, setLists] = useState<TraktList[] | null>(null);
  const [openList, setOpenList] = useState<TraktList | null>(null);
  const [stats, setStats] = useState<TraktStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [newList, setNewList] = useState('');

  const loadRows = useCallback(async (): Promise<Row[]> => {
    const wrap = (items: TraktItem[], action?: (i: TraktItem) => Row['action']) =>
      items.map((item) => ({ item, action: action?.(item) }));
    switch (section) {
      case 'upnext':
        return wrap(await getUpNext(), (i) => ({
          icon: 'checkmark-circle-outline',
          label: 'Mark watched',
          run: () => setEpisodeWatched(i.imdb!, i.season!, i.episode!, true),
        }));
      case 'watchlist':
        return wrap(await getWatchlist(kind), (i) => ({
          icon: 'bookmark',
          label: 'Remove from watchlist',
          run: () => setWatchlist(kind, i.imdb!, false),
        }));
      case 'history':
        return wrap(await getHistory(), (i) => ({
          icon: 'trash-outline',
          label: 'Remove this play',
          run: () => removeHistoryRow(i.rowId!),
        }));
      case 'collection':
        return wrap(await getCollection(kind), (i) => ({
          icon: 'albums',
          label: 'Remove from collection',
          run: () => setCollected(kind, i.imdb!, false),
        }));
      case 'ratings':
        return wrap(await getRatings(kind), (i) => ({
          icon: 'star',
          label: 'Remove rating',
          run: () => rate(kind, i.imdb!, 0),
        }));
      case 'favorites':
        return wrap(await getFavorites(kind), (i) => ({
          icon: 'heart',
          label: 'Remove favorite',
          run: () => setFavorite(kind, i.imdb!, false),
        }));
      case 'calendar':
        return wrap(await getCalendar(30));
      case 'recommended':
        return wrap(await getRecommendations(kind), (i) => ({
          icon: 'eye-off-outline',
          label: 'Not interested',
          run: () => hideRecommendation(kind, i.traktId!),
        }));
      case 'playback':
        return (await getPlaybackRows()).map((p) => ({
          item: p.item,
          note: `${Math.round(p.progress)}% watched`,
          action: { icon: 'trash-outline', label: 'Remove', run: () => removePlayback(p.id) },
        }));
      default:
        return [];
    }
  }, [section, kind]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const fail = (e: Error) => !cancelled && setError(e.message);
    if (section === 'stats') getTraktStats().then((s) => !cancelled && setStats(s), fail);
    else if (section === 'lists') {
      if (openList)
        getListItems(openList.id).then(
          (items) =>
            !cancelled &&
            setRows(
              items.map((item) => ({
                item,
                action: {
                  icon: 'remove-circle-outline',
                  label: 'Remove from list',
                  run: () => setInList(openList.id, item.kind === 'movie' ? 'movie' : 'show', item.imdb!, false),
                },
              })),
            ),
          fail,
        );
      else getLists().then((l) => !cancelled && setLists(l), fail);
    } else loadRows().then((r) => !cancelled && setRows(r), fail);
    return () => {
      cancelled = true;
    };
  }, [connected, section, kind, openList, round, loadRows]);

  function pick(s: Section) {
    setSection(s);
    setRows(null);
    setError(null);
    setOpenList(null);
  }

  if (!connected) {
    return (
      <EmptyState title="Connect Trakt" body="Sign in to Trakt in Settings → Tracking to see your library here.">
        <Button label="Open Tracking" onPress={() => router.push('/settings/tracking')} />
      </EmptyState>
    );
  }

  const meta = SECTIONS.find((s) => s.id === section)!;

  return (
    <View style={styles.screen}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
        {SECTIONS.map((s) => (
          <Pressable key={s.id} onPress={() => pick(s.id)} style={[styles.chip, section === s.id && styles.chipOn]}>
            <Text style={[styles.chipText, section === s.id && { color: Colors.accentText }]}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {meta.byKind ? (
        <View style={styles.segment}>
          {(['show', 'movie'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                setKind(k);
                setRows(null);
              }}
              style={[styles.segmentItem, kind === k && styles.chipOn]}>
              <Text style={[styles.chipText, kind === k && { color: Colors.accentText }]}>{k === 'show' ? 'Shows' : 'Movies'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text style={[styles.muted, { color: Colors.danger, padding: Spacing.three }]}>{error}</Text> : null}

      {section === 'stats' ? (
        stats ? <StatsView stats={stats} /> : <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.five }} />
      ) : section === 'lists' && !openList ? (
        <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}>
          {!lists ? <ActivityIndicator color={Colors.accent} /> : null}
          {lists?.map((l) => (
            <Pressable key={l.id} style={styles.row} onPress={() => setOpenList(l)} onLongPress={() => confirm(`Delete the list “${l.name}”?`, () => deleteList(l.id).then(() => setRound(round + 1)))}>
              <Ionicons name="list" size={24} color={Colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{l.name}</Text>
                <Text style={styles.muted}>
                  {l.itemCount} items · {l.privacy}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </Pressable>
          ))}
          <Input placeholder="New list name" value={newList} onChangeText={setNewList} />
          <Button
            label="Create list"
            variant="secondary"
            disabled={!newList.trim()}
            onPress={async () => {
              await createList(newList.trim()).catch((e) => setError(e.message));
              setNewList('');
              setRound(round + 1);
            }}
          />
          <Text style={styles.muted}>Hold a list to delete it. Add titles to lists from their page (Trakt → Lists).</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={(r, i) => `${r.item.kind}:${r.item.imdb ?? r.item.title}:${r.item.subtitle ?? ''}:${r.item.rowId ?? i}`}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
          ListHeaderComponent={
            openList ? (
              <Pressable onPress={() => setOpenList(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.two }}>
                <Ionicons name="chevron-back" size={18} color={Colors.accent} />
                <Text style={{ color: Colors.accent, fontWeight: '700' }}>Lists · {openList.name}</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            rows ? <Text style={styles.muted}>Nothing here.</Text> : <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.four }} />
          }
          renderItem={({ item: r }) => <ItemRow row={r} onDone={() => setRound(round + 1)} />}
        />
      )}
    </View>
  );
}

function ItemRow({ row, onDone }: { row: Row; onDone: () => void }) {
  const Colors = useColors();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const { item } = row;
  const link = linkFor(item);
  const when = item.at ? new Date(item.at).toLocaleDateString() : undefined;
  const sub = [
    item.subtitle,
    item.kind !== 'episode' && item.year ? String(item.year) : null,
    item.rating ? `★ ${item.rating}/10` : null,
    row.note,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable style={styles.row} onPress={() => link && router.push({ pathname: '/title', params: link })}>
      <View style={styles.poster}>
        {poster(item.imdb) ? <Image source={{ uri: poster(item.imdb) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {sub ? (
          <Text style={styles.muted} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {row.action ? (
        <Pressable
          hitSlop={10}
          accessibilityLabel={row.action.label}
          onPress={async () => {
            setBusy(true);
            await row.action!.run().catch(() => {});
            setBusy(false);
            onDone();
          }}>
          {busy ? <ActivityIndicator size="small" color={Colors.accent} /> : <Ionicons name={row.action.icon} size={22} color={Colors.accent} />}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function StatsView({ stats }: { stats: TraktStats }) {
  const styles = useStyles();
  const tiles = [
    ['Movies watched', String(stats.movies.watched)],
    ['Movie time', formatDuration(stats.movies.minutes * 60)],
    ['Episodes watched', String(stats.episodes.watched)],
    ['Episode time', formatDuration(stats.episodes.minutes * 60)],
    ['Shows', String(stats.shows.watched)],
    ['Collected', String(stats.movies.collected + stats.shows.collected)],
    ['Ratings', String(stats.ratings.total)],
    ['Plays', String(stats.movies.plays + stats.episodes.plays)],
  ];
  return (
    <ScrollView contentContainerStyle={styles.tiles}>
      {tiles.map(([label, value]) => (
        <View key={label} style={styles.tile}>
          <Text style={styles.tileValue}>{value}</Text>
          <Text style={styles.muted}>{label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  chips: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999, backgroundColor: Colors.surfaceRaised },
  chipOn: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  segment: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 3,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  poster: { width: 46, height: 68, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.surfaceRaised },
  title: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, padding: Spacing.three },
  tile: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: 4,
  },
  tileValue: { color: Colors.text, fontSize: 22, fontWeight: '800' },
}));
