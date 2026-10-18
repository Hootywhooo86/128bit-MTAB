import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Body, Button, EmptyState, Heading, Input, ProgressBar } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchMetas, isBrowsable, supportsSearch, catalogTab } from '@/lib/addons';
import { useAddons } from '@/lib/hooks';
import { searchAnilist } from '@/lib/anilist';
import { searchKitsu } from '@/lib/kitsu';
import type { CatalogDef, InstalledAddon, MetaPreview } from '@/lib/types';
import { usePrefs } from '@/lib/prefs';
import { getPlayback, isConnected, traktConfigured } from '@/lib/trakt';
import { getPlaybackRows, linkedAnimeImdb, removePlayback } from '@/lib/trakt-library';
import {
  getHiddenContinue,
  getWatchProgress,
  markAnime,
  removeWatchProgress,
  resumeSavedStream,
  streamsRoute,
  type WatchProgress,
  isAnime,
} from '@/lib/video';

import { TraktRows, TraktSearchRow } from './trakt-rows';
import { TrackerRows } from './tracker-rows';
import { Pressable } from '@/components/focusable';

type Props = { type: 'movie' | 'series' | 'anime'; noun: string };

/** Home screen for Shows and Movies: search, continue watching, then every addon catalog as a row. */
export function VideoBrowse({ type, noun }: Props) {
  const Colors = useColors();
  const styles = useStyles();
  const { addons, loaded } = useAddons();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  // Searching Shows also searches the anime catalogs (anime are shows too), and searching
  // Anime searches the show catalogs (Cinemeta, AIOMetadata… often know an anime Kitsu doesn't).
  const inTab = (tab: string) =>
    tab === type ||
    tab === 'all' ||
    (!!submitted && ((type === 'series' && tab === 'anime') || (type === 'anime' && tab === 'series')));
  const rows = addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter((c) => inTab(catalogTab(addon, c)) && (submitted ? supportsSearch(c) : isBrowsable(c)))
      .map((catalog) => ({ addon, catalog })),
  );
  // Anime search: every search above plus Kitsu's and AniList's own, as one row (AnimeSearchRow).
  // Shows search: the Kitsu addon's results and Kitsu's own search, as one row.
  const animeSearch = !!submitted && type === 'anime';
  const kitsuSearch = !!submitted && type === 'series';
  const isKitsuRow = (r: { addon: InstalledAddon; catalog: CatalogDef }) =>
    kitsuSearch && /kitsu/i.test(`${r.addon.manifest.id} ${r.addon.manifest.name}`) && catalogTab(r.addon, r.catalog) === 'anime';
  const clear = () => {
    setQuery('');
    setSubmitted('');
  };
  // Android back while showing results: back to the rows, not out of the tab.
  useEffect(() => {
    if (!submitted) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true;
    });
    return () => sub.remove();
  }, [submitted]);

  if (loaded && !addons.some((a) => a.manifest.catalogs.some((c) => [type, 'all'].includes(catalogTab(a, c))))) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title={`No ${noun} yet`}
          body={
            type === 'anime'
              ? 'Install an anime addon (Kitsu is suggested in Addons), plus one that provides streams.'
              : `Install an addon with ${noun} catalogs (Cinemeta is a good start), plus one that provides streams.`
          }>
          <Button label="Manage addons" onPress={() => router.push('/addons')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingVertical: Spacing.three,
        gap: Spacing.four,
      }}>
      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder={`Search ${noun}`}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => setSubmitted(query.trim())}
          />
        </View>
        {query || submitted ? (
          <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={28} color={Colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {!submitted ? <ContinueWatchingRow type={type} /> : null}
      {!submitted ? <TrackerRows type={type} /> : null}
      {!submitted ? <TraktRows type={type} /> : null}

      {submitted && rows.length === 0 && !kitsuSearch && !animeSearch ? (
        <EmptyState title="Nothing to search" body={`None of your addons can search ${noun}.`} />
      ) : null}
      {submitted && type !== 'anime' ? <TraktSearchRow type={type} query={submitted} /> : null}
      {kitsuSearch ? (
        <KitsuSearchRow key={`kitsu/${submitted}`} query={submitted} addons={addons} rows={rows.filter(isKitsuRow)} />
      ) : null}
      {animeSearch ? <AnimeSearchRow key={`anime/${submitted}`} query={submitted} addons={addons} rows={rows} /> : null}
      {(animeSearch ? [] : rows.filter((r) => !isKitsuRow(r))).map(({ addon, catalog }) => (
        <CatalogRow
          key={`${addon.manifest.id}/${catalog.id}/${submitted}`}
          addon={addon}
          catalog={catalog}
          search={submitted || undefined}
        />
      ))}
    </ScrollView>
  );
}

/** Movies and episodes you started (plus Trakt's, when connected). All types when `type` is omitted. */
export function ContinueWatchingRow({ type }: { type?: string }) {
  const { prefs } = usePrefs();
  const styles = useStyles();
  const [continuing, setContinuing] = useState<WatchProgress[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const Colors = useColors();

  /** One tap: the same stream again from where you stopped; else the stream picker / title. */
  async function open(item: WatchProgress) {
    if (starting) return;
    if (item.stream) {
      setStarting(item.key);
      const ok = await resumeSavedStream(item).catch(() => false);
      setStarting(null);
      if (ok) router.push('/watch');
      else router.push(streamsRoute(item));
      return;
    }
    if (item.link) router.push({ pathname: '/title', params: { type: item.link.type, id: item.link.id } });
  }

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const local = await getWatchProgress();
        let merged = local;
        if (prefs.traktContinueWatching && (await traktConfigured()) && (await isConnected())) {
          // Local entries win (they have exact positions); Trakt fills in the rest.
          const remote = await getPlayback().catch(() => []);
          merged = [...local, ...remote.filter((r) => !local.some((l) => l.key === r.key))].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        }
        const hidden = await getHiddenContinue();
        // Anime tab: the anime you're in the middle of (Kitsu/MAL ids, or opened from Anime).
        // Trakt's paused items have IMDb ids: anime you've linked (opened from Anime) count too.
        const linked = type === 'anime' ? await linkedAnimeImdb() : new Set<string>();
        const anime =
          type === 'anime'
            ? await Promise.all(merged.map(async (p) => (await isAnime(p.link)) || linked.has(p.link?.id ?? '')))
            : [];
        const fits = (p: WatchProgress, i: number) => !type || (type === 'anime' ? anime[i] : p.link?.type === type);
        if (!cancelled) setContinuing(merged.filter((p, i) => fits(p, i) && !hidden.has(p.key)));
      })();
      return () => {
        cancelled = true;
      };
    }, [type, prefs.traktContinueWatching]),
  );

  /** Hold an item: remove it here and from Trakt's paused list. */
  function remove(item: WatchProgress) {
    const go = async () => {
      setContinuing((c) => c.filter((p) => p.key !== item.key));
      await removeWatchProgress(item.key);
      if ((await traktConfigured()) && (await isConnected())) {
        const rows = await getPlaybackRows().catch(() => []);
        const match = rows.find(
          (r) =>
            (r.item.kind === 'movie' ? r.item.imdb : `${r.item.imdb}:${r.item.season}:${r.item.episode}`) ===
            item.key,
        );
        if (match) removePlayback(match.id).catch(() => {});
      }
    };
    const label = item.subtitle ? `${item.title} · ${item.subtitle}` : item.title;
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${label} from Continue watching?`)) go();
      return;
    }
    Alert.alert('Remove from Continue watching', label, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go },
    ]);
  }

  if (!continuing.length) return null;
  return (
    <View style={{ gap: Spacing.two }}>
      <Heading style={{ paddingHorizontal: Spacing.three }}>Continue watching</Heading>
      <Text style={[styles.tileSub, { paddingHorizontal: Spacing.three, marginTop: -4 }]}>
        Hold one to remove it
      </Text>
      <FlatList
        horizontal
        // Rows of posters: only keep the visible ones (and a little either side) mounted.
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        data={continuing}
        keyExtractor={(p) => p.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: Spacing.three,
          gap: Spacing.three,
        }}
        renderItem={({ item }) => (
          <Pressable
            style={{ width: 200, gap: 6 }}
            onLongPress={() => remove(item)}
            onPress={() => open(item)}>
            <View style={styles.landscape}>
              {item.poster ? (
                <Image
                  source={{ uri: item.poster }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              ) : null}
              {starting === item.key ? (
                <View style={[StyleSheet.absoluteFill, styles.starting]}>
                  <ActivityIndicator color={Colors.accent} />
                </View>
              ) : null}
            </View>
            <ProgressBar value={item.duration ? item.position / item.duration : 0} />
            <Text numberOfLines={1} style={styles.tileTitle}>
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text numberOfLines={1} style={styles.tileSub}>
                {item.subtitle}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

export function CatalogRow({
  addon,
  catalog,
  search,
}: {
  addon: InstalledAddon;
  catalog: CatalogDef;
  search?: string;
}) {
  const Colors = useColors();
  const [metas, setMetas] = useState<MetaPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetas(addon, catalog, { search })
      .then((m) => !cancelled && setMetas(m))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [addon, catalog, search]);


  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Heading>{search ? `“${search}” · ${catalog.name}` : catalog.name}</Heading>
        <Body muted style={{ fontSize: 12 }}>
          {addon.manifest.name}
        </Body>
      </View>
      {error ? (
        <Body style={{ paddingHorizontal: Spacing.three, color: Colors.danger }}>{error}</Body>
      ) : metas && !metas.length ? (
        <Body muted style={{ paddingHorizontal: Spacing.three }}>
          No matches.
        </Body>
      ) : !metas ? (
        <ActivityIndicator
          color={Colors.accent}
          style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }}
        />
      ) : (
        <FlatList
          horizontal
          // Rows of posters: only keep the visible ones (and a little either side) mounted.
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          data={metas}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: Spacing.three,
            gap: Spacing.three,
          }}
          renderItem={({ item }) => (
            <PosterTile
              meta={item}
              addonId={addon.manifest.id}
              anime={catalogTab(addon, catalog) === 'anime'}
            />
          )}
        />
      )}
    </View>
  );
}

/**
 * "“query” · Kitsu": what the Kitsu addon's search finds, then everything else Kitsu
 * itself finds (the addon alone often returns only a few), one tile per `kitsu:<id>`.
 */
function KitsuSearchRow({
  query,
  addons,
  rows,
}: {
  query: string;
  addons: InstalledAddon[];
  rows: { addon: InstalledAddon; catalog: CatalogDef }[];
}) {
  const Colors = useColors();
  const [metas, setMetas] = useState<MetaPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addonId = rows[0]?.addon.manifest.id;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      Promise.all(rows.map((r) => fetchMetas(r.addon, r.catalog, { search: query }).catch(() => [] as MetaPreview[]))),
      searchKitsu(query, addons).catch((e) => {
        if (!rows.length) throw e;
        return [] as MetaPreview[];
      }),
    ])
      .then(([fromAddons, direct]) => {
        const seen = new Set<string>();
        const out: MetaPreview[] = [];
        for (const m of [...fromAddons.flat(), ...direct]) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          out.push(m);
        }
        if (!cancelled) setMetas(out);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
    // rows is rebuilt every render; the query (and the addons) are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, addons]);

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Heading>{`“${query}” · Kitsu`}</Heading>
        <Body muted style={{ fontSize: 12 }}>
          Anime
        </Body>
      </View>
      {error ? (
        <Body style={{ paddingHorizontal: Spacing.three, color: Colors.danger }}>{error}</Body>
      ) : metas && !metas.length ? (
        <Body muted style={{ paddingHorizontal: Spacing.three }}>
          No matches.
        </Body>
      ) : !metas ? (
        <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }} />
      ) : (
        <FlatList
          horizontal
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          data={metas}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
          renderItem={({ item }) => <PosterTile meta={item} addonId={addonId} anime />}
        />
      )}
    </View>
  );
}

const ANIME_ID = /^(kitsu|mal|anilist|anidb)[:_]/i;
const yearOf = (m: MetaPreview) => String(m.releaseInfo ?? '').slice(0, 4);
const nameKey = (m: MetaPreview) => `${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${yearOf(m)}`;

type SearchPart = { metas: MetaPreview[]; anime: boolean; addonId?: string };
type SearchHit = { meta: MetaPreview; addonId?: string; anime: boolean };

/**
 * Results from several searches as one list: the same title once (same id, IMDb id, or
 * name + year; the first source's version wins), anime-looking ones first (from an anime
 * catalog, Kitsu / AniList / MAL ids, or an "Anime" genre).
 */
function mergeSearch(parts: SearchPart[]): SearchHit[] {
  const out: SearchHit[] = [];
  const at = new Map<string, number>();
  for (const part of parts) {
    for (const meta of part.metas) {
      if (!meta?.id || !meta.name) continue;
      const keys = [meta.id, meta.imdb_id, nameKey(meta)].filter((k): k is string => !!k);
      const anime = part.anime || ANIME_ID.test(meta.id) || !!meta.genres?.some((g) => /anime/i.test(g));
      const same = keys.map((k) => at.get(k)).find((n) => n !== undefined);
      if (same !== undefined) {
        out[same].anime ||= anime;
        keys.forEach((k) => at.set(k, same));
        continue;
      }
      keys.forEach((k) => at.set(k, out.length));
      out.push({ meta, addonId: part.addonId, anime });
    }
  }
  return [...out.filter((h) => h.anime), ...out.filter((h) => !h.anime)];
}

/**
 * The Anime tab's search: every addon search for shows and anime (the same ones the Shows
 * tab asks), plus Kitsu's own search and AniList's, as one row. Fills in as each answers.
 */
function AnimeSearchRow({
  query,
  addons,
  rows,
}: {
  query: string;
  addons: InstalledAddon[];
  rows: { addon: InstalledAddon; catalog: CatalogDef }[];
}) {
  const Colors = useColors();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  // Keyed by the query, so a new search starts fresh.
  const [pending, setPending] = useState(rows.length + 2);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isKitsu = (a: InstalledAddon) => /kitsu/i.test(`${a.manifest.id} ${a.manifest.name}`);
    // Order decides which copy of a title is kept: Kitsu first (its streams know anime
    // episode numbering), then anime catalogs and AniList, then everything else.
    const sources = [
      ...rows.map(({ addon, catalog }) => ({
        rank: isKitsu(addon) ? 0 : catalogTab(addon, catalog) === 'anime' ? 1 : 3,
        anime: catalogTab(addon, catalog) === 'anime',
        addonId: addon.manifest.id,
        load: () => fetchMetas(addon, catalog, { search: query }),
      })),
      { rank: 0, anime: true, addonId: rows.find((r) => isKitsu(r.addon))?.addon.manifest.id, load: () => searchKitsu(query, addons) },
      { rank: 2, anime: true, addonId: undefined, load: () => searchAnilist(query, addons) },
    ]
      .map((src, i) => ({ ...src, i }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    const got: (SearchPart | undefined)[] = sources.map(() => undefined);
    let left = sources.length;
    let firstError: string | null = null;
    sources.forEach((src, n) => {
      src
        .load()
        .then((metas) => {
          got[n] = { metas, anime: src.anime, addonId: src.addonId };
        })
        .catch((e) => {
          firstError ??= String(e?.message ?? e);
        })
        .finally(() => {
          left -= 1;
          if (cancelled) return;
          const merged = mergeSearch(got.filter((p): p is SearchPart => !!p));
          setPending(left);
          if (merged.length || !left) setHits(merged);
          if (!left && !merged.length && firstError && !got.some(Boolean)) setError(firstError);
        });
    });
    return () => {
      cancelled = true;
    };
    // rows is rebuilt every render; the query (and the addons) are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, addons]);

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Heading>{`“${query}” · Anime`}</Heading>
        <Body muted style={{ fontSize: 12 }}>
          {pending ? 'Searching your addons, Kitsu and AniList…' : 'Your addons, Kitsu and AniList'}
        </Body>
      </View>
      {error ? (
        <Body style={{ paddingHorizontal: Spacing.three, color: Colors.danger }}>{error}</Body>
      ) : hits && !hits.length ? (
        <Body muted style={{ paddingHorizontal: Spacing.three }}>
          No matches.
        </Body>
      ) : !hits ? (
        <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }} />
      ) : (
        <FlatList
          horizontal
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          data={hits}
          keyExtractor={(h) => h.meta.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
          renderItem={({ item }) => <PosterTile meta={item.meta} addonId={item.addonId} anime />}
        />
      )}
    </View>
  );
}

export function PosterTile({
  meta,
  addonId,
  anime,
}: {
  meta: MetaPreview;
  addonId?: string;
  /** From an anime catalog: plays English audio + subtitles first. */
  anime?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      style={{ width: 112, gap: 4 }}
      onPress={() => {
        if (anime) markAnime(meta.id).catch(() => {});
        router.push({
          pathname: '/title',
          params: { type: meta.type, id: meta.id, addon: addonId ?? '' },
        });
      }}>
      <View style={styles.poster}>
        {meta.poster ? (
          <Image
            source={{ uri: meta.poster }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <Text style={styles.posterFallback} numberOfLines={3}>
            {meta.name}
          </Text>
        )}
      </View>
      <Text numberOfLines={1} style={styles.tileTitle}>
        {meta.name}
      </Text>
      {meta.releaseInfo ? <Text style={styles.tileSub}>{meta.releaseInfo}</Text> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  starting: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  screen: { flex: 1, backgroundColor: Colors.background },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  poster: {
    width: 112,
    height: 168,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterFallback: {
    color: Colors.textSecondary,
    textAlign: 'center',
    padding: Spacing.two,
    fontSize: 12,
  },
  landscape: {
    width: 200,
    height: 112,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
  },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
}));
