import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { Body, Heading } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePrefs } from '@/lib/prefs';
import {
  asRowItems,
  getAllTrackerLists,
  getTrackerListItems,
  listPlaces,
  getTrackerInProgress,
  getTrackerUpNext,
  getTrackerWatchlist,
  kindFor,
  trackerSignedIn,
  type TrackerItem,
} from '@/lib/tracker';
import { poster, type TraktItem } from '@/lib/trakt-library';
import type { MetaPreview } from '@/lib/types';

import { PosterTile } from './video-browse';
import { Pressable } from '@/components/focusable';

type Row = { key: string; title: string; items: TraktItem[] };

/**
 * Your 128bit Tracker on the Shows / Movies / Anime tabs: Up next, Watchlist,
 * then every list you marked "Show in 128bitPlay", for whoever is signed in.
 */
export function TrackerRows({ type }: { type: 'movie' | 'series' | 'anime' }) {
  const { prefs } = usePrefs();
  const styles = useStyles();
  const Colors = useColors();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const kind = kindFor(type);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!prefs.trackerRows || !(await trackerSignedIn())) {
          if (!cancelled) { setSignedIn(false); setRows([]); }
          return;
        }
        if (!cancelled) setSignedIn(true);
        try {
          const ofKind = (items: TrackerItem[]) => items.filter((i) => i.type === kind);
          // One show is one card: its seasons share an IMDb id (or a title without "Season 2").
          const showKey = (i: TrackerItem) => String(i.ids?.imdb ?? i.ids?.kitsu ?? i.title.toLowerCase().replace(/[:\s-]*(season|s)\s*\d+$/i, '').trim());
          const onePerShow = (items: TrackerItem[], skip = new Set<string>()) => {
            const seen = new Set(skip);
            return items.filter((i) => !seen.has(showKey(i)) && !!seen.add(showKey(i)));
          };
          const out: Row[] = [];
          // Continue: partway through, on this device or any other (newest first, so the latest season wins).
          const cont = onePerShow(ofKind(await getTrackerInProgress().catch(() => [])));
          if (cont.length) {
            const items = cont.map((i) => ({
              ...i,
              title: `${i.title} · ${Math.round(i.now?.pct ?? i.pct ?? 0)}%`,
              next: i.now?.episode ? { season: i.season ?? 1, number: i.now.episode } : undefined,
            }));
            out.push({ key: 'continue', title: 'Continue', items: await asRowItems(items) });
          }
          if (kind !== 'movie') {
            // Shows already in Continue don't show again here.
            const up = onePerShow(ofKind(await getTrackerUpNext()), new Set(cont.map(showKey)));
            if (up.length) out.push({ key: 'upnext', title: 'Up next', items: await asRowItems(up) });
          }
          // Your lists, on whichever tabs you put them (Settings → Tracking → Where your lists go).
          const places = prefs.trackerListPlaces ?? {};
          const listRows: Row[] = [];
          const inLists = new Set<string>();
          for (const list of (await getAllTrackerLists()).filter((l) => listPlaces(l, places).includes(type))) {
            const placed = !!places[list.id];
            const items = (await getTrackerListItems(list.id)).filter((i) => placed || list.kind !== 'mixed' || i.type === kind);
            items.forEach((i) => inLists.add(i.id));
            if (items.length) listRows.push({ key: `list:${list.id}`, title: list.name, items: await asRowItems(items) });
          }
          // Watchlist: what you plan to watch that isn't already on one of those lists.
          const wl = (await getTrackerWatchlist(kind)).filter((i) => !inLists.has(i.id));
          if (wl.length) out.push({ key: 'watchlist', title: 'Watchlist', items: await asRowItems(wl) });
          out.push(...listRows);
          if (!cancelled) setRows(out.filter((r) => r.items.length));
        } catch {
          if (!cancelled) setRows([]); // Tracker not set up on this account server yet
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [kind, type, prefs.trackerRows, prefs.trackerListPlaces]),
  );

  if (!prefs.trackerRows || !signedIn || rows === null) return null;
  if (!rows.length) {
    return (
      <View style={styles.hint}>
        <Body muted>Build your lists in 128bit Tracker (Library → + New list) and choose where they go in Settings → Tracking → Where your lists go.</Body>
      </View>
    );
  }
  return (
    <>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: Spacing.two }}>
          <View style={styles.head}>
            <Heading style={{ flex: 1 }}>{r.title} · Tracker</Heading>
            {r.key === 'upnext' ? (
              <Pressable onPress={() => router.push('/tracker')} hitSlop={8}>
                <Text style={{ color: Colors.accent, fontWeight: '700' }}>Calendar</Text>
              </Pressable>
            ) : null}
          </View>
          <FlatList
            horizontal
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            data={r.items.slice(0, 40)}
            keyExtractor={(i) => `${i.imdb}:${i.subtitle ?? ''}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
            renderItem={({ item }) => {
              const meta: MetaPreview = {
                id: item.imdb!,
                type: type === 'anime' ? (item.kind === 'movie' ? 'movie' : 'series') : type,
                name: item.kind === 'episode' && item.subtitle ? `${item.title} · ${item.subtitle}` : item.title,
                poster: poster(item.imdb),
                releaseInfo: item.year ? String(item.year) : undefined,
              };
              return <PosterTile meta={meta} />;
            }}
          />
        </View>
      ))}
    </>
  );
}

const useStyles = makeStyles(() => ({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
  hint: { paddingHorizontal: Spacing.three },
}));
