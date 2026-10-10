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
import type { CatalogDef, InstalledAddon, MetaPreview } from '@/lib/types';
import { usePrefs } from '@/lib/prefs';
import { getPlayback, isConnected, traktConfigured } from '@/lib/trakt';
import { getPlaybackRows, removePlayback } from '@/lib/trakt-library';
import {
  getHiddenContinue,
  getWatchProgress,
  markAnime,
  removeWatchProgress,
  resumeSavedStream,
  streamsRoute,
  type WatchProgress,
} from '@/lib/video';

import { TraktRows, TraktSearchRow } from './trakt-rows';
import { Pressable } from '@/components/focusable';

type Props = { type: 'movie' | 'series' | 'anime'; noun: string };

/** Home screen for Shows and Movies: search, continue watching, then every addon catalog as a row. */
export function VideoBrowse({ type, noun }: Props) {
  const Colors = useColors();
  const styles = useStyles();
  const { addons, loaded } = useAddons();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  // Searching Shows also searches the anime catalogs (anime are shows too).
  const inTab = (tab: string) =>
    tab === type || tab === 'all' || (!!submitted && type === 'series' && tab === 'anime');
  const rows = addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter((c) => inTab(catalogTab(addon, c)) && (submitted ? supportsSearch(c) : isBrowsable(c)))
      .map((catalog) => ({ addon, catalog })),
  );
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
      {!submitted && type !== 'anime' ? <TraktRows type={type} /> : null}

      {submitted && rows.length === 0 ? (
        <EmptyState title="Nothing to search" body={`None of your addons can search ${noun}.`} />
      ) : null}
      {submitted && type !== 'anime' ? <TraktSearchRow type={type} query={submitted} /> : null}
      {rows.map(({ addon, catalog }) => (
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
        if (!cancelled)
          setContinuing(merged.filter((p) => (!type || p.link?.type === type) && !hidden.has(p.key)));
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
