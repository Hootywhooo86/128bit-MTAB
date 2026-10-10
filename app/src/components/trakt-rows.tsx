import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { useTraktConnected } from '@/components/trakt-actions';
import { Body, Heading } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePrefs } from '@/lib/prefs';
import { TRAKT_ROWS, getAnimeRow, getLists, getTraktRow, poster, searchTrakt, type TraktItem } from '@/lib/trakt-library';
import type { MetaPreview } from '@/lib/types';

import { PosterTile } from './video-browse';
import { Pressable } from '@/components/focusable';

/** Trakt rows for the Shows / Movies / Anime tabs, as picked in Settings → Tracking. */
export function TraktRows({ type }: { type: 'movie' | 'series' | 'anime' }) {
  const connected = useTraktConnected();
  const { prefs } = usePrefs();
  const [listNames, setListNames] = useState<Record<string, string>>({});
  const lists = prefs.traktRows.some((r) => r.includes('list:'));
  useEffect(() => {
    if (!connected || !lists) return;
    getLists().then((l) => setListNames(Object.fromEntries(l.map((x) => [`list:${x.id}`, x.name]))), () => {});
  }, [connected, lists]);
  if (!connected) return null;
  const kind = type === 'movie' ? 'movie' : 'show';
  if (type === 'anime') {
    // "anime:watchlist" / "anime:list:123": the anime in your watchlist and lists.
    return (
      <>
        {prefs.traktRows
          .filter((r) => r.startsWith('anime:'))
          .map((r) => {
            const row = r.slice(6);
            const name = row === 'watchlist' ? 'Your watchlist' : listNames[row];
            return name ? <Row key={r} title={`${name} · Trakt`} load={() => getAnimeRow(row)} type={type} /> : null;
          })}
      </>
    );
  }
  return (
    <>
      {prefs.traktRows.filter((r) => !r.startsWith('anime:')).map((id) => {
        const def = TRAKT_ROWS.find((r) => r.id === id);
        if (def && !(type === 'movie' ? def.movies : def.shows)) return null;
        const name = def?.name ?? listNames[id];
        if (!name) return null;
        return <Row key={id} title={`${name} · Trakt`} load={() => getTraktRow(id, kind)} type={type} />;
      })}
    </>
  );
}

/** Search results from Trakt itself, as one more row under the addon searches. */
export function TraktSearchRow({ type, query }: { type: 'movie' | 'series'; query: string }) {
  const connected = useTraktConnected();
  if (!connected) return null;
  return (
    <Row
      key={query}
      title={`“${query}” · Trakt`}
      load={() => searchTrakt(type === 'movie' ? 'movie' : 'show', query)}
      type={type}
      always
    />
  );
}

function Row({
  title,
  load,
  type,
  always,
}: {
  title: string;
  load: () => Promise<TraktItem[]>;
  type: string;
  /** Keep the row (saying "No matches") instead of hiding it when empty. */
  always?: boolean;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [items, setItems] = useState<TraktItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    load().then((i) => !cancelled && setItems(i.filter((x) => x.imdb)), () => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
    // Loads once per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!items?.length && !always) return null;
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.head}>
        <Heading style={{ flex: 1 }}>{title}</Heading>
        <Pressable onPress={() => router.push('/trakt')} hitSlop={8}>
          <Text style={{ color: Colors.accent, fontWeight: '700' }}>Trakt library</Text>
        </Pressable>
      </View>
      {items && !items.length ? <Body muted style={{ paddingHorizontal: Spacing.three }}>No matches.</Body> : null}
      <FlatList
        horizontal
        // Rows of posters: only keep the visible ones (and a little either side) mounted.
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        data={(items ?? []).slice(0, 30)}
        keyExtractor={(i) => `${i.imdb}:${i.subtitle ?? ''}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
        renderItem={({ item }) => {
          const meta: MetaPreview = {
            id: item.imdb!,
            type: type === 'anime' ? (item.kind === 'movie' ? 'movie' : 'series') : type,
            name: item.kind === 'episode' && item.subtitle ? `${item.title} · ${item.subtitle.split(' · ')[0]}` : item.title,
            poster: poster(item.imdb),
            releaseInfo: item.year ? String(item.year) : undefined,
          };
          return <PosterTile meta={meta} />;
        }}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
}));
