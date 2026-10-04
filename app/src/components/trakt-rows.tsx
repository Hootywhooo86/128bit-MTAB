import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { useTraktConnected } from '@/components/trakt-actions';
import { Heading } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { getUpNext, getWatchlist, poster, type TraktItem } from '@/lib/trakt-library';
import type { MetaPreview } from '@/lib/types';

import { PosterTile } from './video-browse';
import { Pressable } from '@/components/focusable';

/** Trakt rows for the Shows / Movies tabs: Up next (shows) and your watchlist. */
export function TraktRows({ type }: { type: 'movie' | 'series' }) {
  const connected = useTraktConnected();
  if (!connected) return null;
  return (
    <>
      {type === 'series' ? <Row title="Up next on Trakt" load={getUpNext} type={type} /> : null}
      <Row title="Your Trakt watchlist" load={() => getWatchlist(type === 'movie' ? 'movie' : 'show')} type={type} />
    </>
  );
}

function Row({ title, load, type }: { title: string; load: () => Promise<TraktItem[]>; type: string }) {
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
  if (!items?.length) return null;
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.head}>
        <Heading style={{ flex: 1 }}>{title}</Heading>
        <Pressable onPress={() => router.push('/trakt')} hitSlop={8}>
          <Text style={{ color: Colors.accent, fontWeight: '700' }}>Trakt library</Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={items.slice(0, 30)}
        keyExtractor={(i) => `${i.imdb}:${i.subtitle ?? ''}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
        renderItem={({ item }) => {
          const meta: MetaPreview = {
            id: item.imdb!,
            type,
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
