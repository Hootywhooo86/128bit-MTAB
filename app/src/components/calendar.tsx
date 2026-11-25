/**
 * The new-episodes calendar, from 128bit Tracker (shows and anime you're watching or have
 * planned): a "Coming up" row on the Shows and Anime tabs, the full Calendar page, and the
 * title page's "Add to calendar" button (it marks the show planned in Tracker).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { Pressable } from '@/components/focusable';
import { withAnimeType } from '@/components/tracker-actions';
import { Body, Heading } from '@/components/ui';
import { Pixel, PixelFont, PosterSize, Spacing, TvRowPad, makeStyles, useColors } from '@/constants/theme';
import {
  asRowItems,
  findInTracker,
  getTrackerCalendar,
  setTrackerWatchlist,
  trackerSignedIn,
  type CalendarEntry,
  type TrackerItem,
  type TrackerRef,
} from '@/lib/tracker';

/** "Today", "Tomorrow", "Fri", or "Mon, Dec 1" further out. */
export function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Opens what a calendar entry is for. */
async function openEntry(item?: TrackerItem | null) {
  if (!item) return;
  const [row] = await asRowItems([item]);
  if (row) router.push({ pathname: '/title', params: { type: row.openType, id: row.id } });
}

/** Calendar entries for one tab's kind ('show' or 'anime'); everything when kind is omitted. */
export function useCalendar(days: number, kind?: 'show' | 'anime') {
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!(await trackerSignedIn())) return !cancelled && setEntries([]);
        const all = await getTrackerCalendar(days).catch(() => [] as CalendarEntry[]);
        if (!cancelled) setEntries(kind ? all.filter((e) => (e.item?.type ?? 'show') === kind) : all);
      })();
      return () => {
        cancelled = true;
      };
    }, [days, kind]),
  );
  return entries;
}

/** "Coming up": the next two weeks of episodes for this tab, as posters with the day on them. */
export function CalendarRow({ type }: { type: 'series' | 'anime' }) {
  const styles = useStyles();
  const entries = useCalendar(14, type === 'anime' ? 'anime' : 'show');
  if (!entries?.length) return null;
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Heading>Coming up</Heading>
          <Body muted style={{ fontSize: 12 }}>
            New episodes in the next two weeks
          </Body>
        </View>
        <Pressable onPress={() => router.push('/calendar')} hitSlop={8} style={styles.allButton}>
          <Ionicons name="calendar-outline" size={16} color="#fff" />
          <Text style={styles.allText}>Calendar</Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={entries}
        keyExtractor={(e, i) => `${e.date}:${e.title}:${i}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[{ paddingHorizontal: Spacing.three, gap: Spacing.three }, TvRowPad]}
        renderItem={({ item: e }) => (
          <Pressable style={{ width: PosterSize.width, gap: 4 }} onPress={() => openEntry(e.item)}>
            <View style={styles.poster}>
              {e.item?.poster ? (
                <Image source={{ uri: e.item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
              ) : null}
              <Text style={styles.day}>{dayLabel(e.date)}</Text>
            </View>
            <Text style={styles.tileTitle} numberOfLines={1}>
              {e.item?.title ?? e.title}
            </Text>
            {e.detail ? (
              <Text style={styles.tileSub} numberOfLines={1}>
                {e.detail}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

/** The whole calendar, day by day (two months ahead). */
export function CalendarList() {
  const Colors = useColors();
  const styles = useStyles();
  const entries = useCalendar(60);
  if (!entries) return <Body muted style={{ padding: Spacing.three }}>Loading…</Body>;
  if (!entries.length) {
    return (
      <Body muted style={{ padding: Spacing.three }}>
        Nothing coming up. Shows you&apos;re watching or have planned in 128bit Tracker show up here; use Add to calendar on
        a show&apos;s page.
      </Body>
    );
  }
  const days = [...new Set(entries.map((e) => e.date))];
  return (
    <View style={{ gap: Spacing.three, padding: Spacing.three }}>
      {days.map((day) => (
        <View key={day} style={{ gap: Spacing.two }}>
          <Text style={[styles.dayHead, { color: dayLabel(day) === 'Today' ? Colors.accent : Colors.text }]}>{dayLabel(day)}</Text>
          {entries
            .filter((e) => e.date === day)
            .map((e, i) => (
              <Pressable key={`${day}:${i}`} style={styles.entry} onPress={() => openEntry(e.item)}>
                <View style={styles.thumb}>
                  {e.item?.poster ? <Image source={{ uri: e.item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.entryTitle} numberOfLines={1}>
                    {e.item?.title ?? e.title}
                  </Text>
                  {e.detail ? (
                    <Text style={styles.entrySub} numberOfLines={2}>
                      {e.detail}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
              </Pressable>
            ))}
        </View>
      ))}
    </View>
  );
}

/** Title page: puts the show on your calendar (planned in Tracker), or says it's on it. */
export function CalendarButton({ item }: { item: TrackerRef }) {
  const Colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<'loading' | 'off' | 'on' | 'hidden'>('loading');
  const key = JSON.stringify(item);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await trackerSignedIn())) return !cancelled && setState('hidden');
      const found = await findInTracker(await withAnimeType(item)).catch(() => null);
      if (!cancelled) setState(found && (found.status === 'planned' || found.status === 'active') ? 'on' : 'off');
    })();
    return () => {
      cancelled = true;
    };
    // item is described by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state === 'hidden' || state === 'loading') return null;
  const on = state === 'on';
  return (
    <Pressable
      style={[styles.calButton, on && { borderColor: Colors.accent }]}
      disabled={on}
      onPress={async () => {
        setState('on');
        await setTrackerWatchlist(await withAnimeType(item), true).catch(() => setState('off'));
      }}>
      <Ionicons name={on ? 'calendar' : 'calendar-outline'} size={18} color={on ? Colors.accent : Colors.text} />
      <Text style={[styles.calText, on && { color: Colors.accent }]}>{on ? 'On your calendar' : 'Add to calendar'}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  rowHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, gap: Spacing.two },
  allButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: Pixel.border, borderColor: Colors.border, backgroundColor: Colors.surfaceRaised },
  allText: { color: Colors.text, fontFamily: PixelFont, fontSize: 14 },
  poster: { width: PosterSize.width, height: PosterSize.height, backgroundColor: Colors.surfaceRaised, overflow: 'hidden', justifyContent: 'flex-end' },
  day: { alignSelf: 'flex-start', margin: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: Colors.accent, color: Colors.accentText, fontFamily: PixelFont, fontSize: 13 },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
  dayHead: { fontFamily: PixelFont, fontSize: 20 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, backgroundColor: Colors.surface, borderWidth: Pixel.border, borderColor: Colors.border },
  thumb: { width: 44, height: 66, backgroundColor: Colors.surfaceRaised, overflow: 'hidden' },
  entryTitle: { color: Colors.text, fontWeight: '700', fontSize: 15 },
  entrySub: { color: Colors.textSecondary, fontSize: 13 },
  calButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderWidth: Pixel.border, borderColor: Colors.border, backgroundColor: Colors.surfaceRaised },
  calText: { color: Colors.text, fontFamily: PixelFont, fontSize: 16 },
}));
