import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Body, EmptyState, Heading } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { Pressable } from '@/components/focusable';
import { airDay, asRowItems, getTrackerCalendar, getTrackerUpNext, trackerSignedIn, type CalendarEntry, type TrackerItem } from '@/lib/tracker';

/** Your 128bit Tracker: Up next and everything coming up (new episodes, releases). */
export default function TrackerScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<{ signedIn: boolean; upnext: TrackerItem[]; calendar: CalendarEntry[]; error?: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!(await trackerSignedIn())) return !cancelled && setState({ signedIn: false, upnext: [], calendar: [] });
        try {
          const [upnext, calendar] = await Promise.all([getTrackerUpNext(), getTrackerCalendar(30)]);
          if (!cancelled) setState({ signedIn: true, upnext, calendar });
        } catch (err) {
          if (!cancelled) setState({ signedIn: true, upnext: [], calendar: [], error: (err as Error).message });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const open = async (item: TrackerItem) => {
    const [row] = await asRowItems([item]);
    if (row?.imdb) router.push({ pathname: '/title', params: { type: item.type === 'movie' ? 'movie' : 'series', id: row.imdb } });
  };

  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} color={Colors.accent} />;
  if (!state.signedIn) {
    return (
      <EmptyState
        title="Sign in to see your Tracker"
        body="128bit Tracker uses the same 128bit account as this app (Settings → Account). Every account has its own lists."
      />
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {state.error ? <Body muted>{state.error}</Body> : null}
      <Heading>Up next</Heading>
      {state.upnext.length ? (
        state.upnext.map((i) => (
          <Pressable key={i.id} onPress={() => open(i)} style={styles.row}>
            <Text style={styles.title} numberOfLines={1}>{i.title}</Text>
            <Text style={styles.sub}>
              S{i.next?.season} E{i.next?.number}
              {i.progress_total ? ` of ${i.progress_total}` : ''}
              {i.next?.air_date && i.next.air_date > new Date().toISOString().slice(0, 10) ? ` · airs ${airDay(i.next.air_date)}` : ''}
            </Text>
          </Pressable>
        ))
      ) : (
        <Body muted>Nothing in progress. Start a show and it shows up here.</Body>
      )}
      <Heading style={{ marginTop: Spacing.four }}>Coming up</Heading>
      {state.calendar.length ? (
        state.calendar.map((c, n) => (
          <Pressable key={`${c.date}:${n}`} onPress={() => c.item && open(c.item)} style={styles.row}>
            <Text style={styles.date}>{new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{c.title}</Text>
              {c.detail ? <Text style={styles.sub} numberOfLines={1}>{c.detail}</Text> : null}
            </View>
          </Pressable>
        ))
      ) : (
        <Body muted>Nothing in the next 30 days. Tracker fills this in from the shows, anime and games you track.</Body>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((C) => ({
  screen: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { color: C.text, fontWeight: '700', flexShrink: 1 },
  sub: { color: C.textSecondary },
  date: { color: C.accent, fontWeight: '700', width: 96 },
}));
