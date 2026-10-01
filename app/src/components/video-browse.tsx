import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
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
  removeWatchProgress,
  type WatchProgress,
} from '@/lib/video';

import { TraktRows } from './trakt-rows';

type Props = { type: 'movie' | 'series' | 'anime'; noun: string };

/** Home screen for Shows and Movies: search, continue watching, then every addon catalog as a row. */
export function VideoBrowse({ type, noun }: Props) {
  const styles = useStyles();
  const { addons, loaded } = useAddons();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const rows = addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter(
        (c) => catalogTab(addon, c) === type && (submitted ? supportsSearch(c) : isBrowsable(c)),
      )
      .map((catalog) => ({ addon, catalog })),
  );

  if (loaded && !addons.some((a) => a.manifest.catalogs.some((c) => catalogTab(a, c) === type))) {
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
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Input
          placeholder={`Search ${noun}`}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => setSubmitted(query.trim())}
          clearButtonMode="while-editing"
        />
      </View>

      {!submitted ? <ContinueWatchingRow type={type} /> : null}
      {!submitted && type !== 'anime' ? <TraktRows type={type} /> : null}

      {submitted && rows.length === 0 ? (
        <EmptyState title="Nothing to search" body={`None of your addons can search ${noun}.`} />
      ) : null}
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
            onPress={() =>
              item.link &&
              router.push({
                pathname: '/title',
                params: { type: item.link.type, id: item.link.id },
              })
            }>
            <View style={styles.landscape}>
              {item.poster ? (
                <Image
                  source={{ uri: item.poster }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
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

  if (metas && metas.length === 0 && search) return null;

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
      ) : !metas ? (
        <ActivityIndicator
          color={Colors.accent}
          style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }}
        />
      ) : (
        <FlatList
          horizontal
          data={metas}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: Spacing.three,
            gap: Spacing.three,
          }}
          renderItem={({ item }) => <PosterTile meta={item} addonId={addon.manifest.id} />}
        />
      )}
    </View>
  );
}

export function PosterTile({ meta, addonId }: { meta: MetaPreview; addonId?: string }) {
  const styles = useStyles();
  return (
    <Pressable
      style={{ width: 112, gap: 4 }}
      onPress={() =>
        router.push({
          pathname: '/title',
          params: { type: meta.type, id: meta.id, addon: addonId ?? '' },
        })
      }>
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
  screen: { flex: 1, backgroundColor: Colors.background },
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
