import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Pressable } from '@/components/focusable';
import { Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { Body } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePrefs } from '@/lib/prefs';
import { getAllTrackerLists, invalidateTracker, listPlaces, trackerSignedIn, type TrackerList } from '@/lib/tracker';

const TABS = [
  { id: 'movie', label: 'Movies' },
  { id: 'series', label: 'Shows' },
  { id: 'anime', label: 'Anime' },
] as const;

/** Settings → Tracking → Where your lists go: each 128bit Tracker list on the tabs you pick. */
export default function TrackerListsSettings() {
  const styles = useStyles();
  const Colors = useColors();
  const { prefs, setPref } = usePrefs();
  const [lists, setLists] = useState<TrackerList[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!(await trackerSignedIn())) {
        setError('Sign in to your 128bit account (Settings → Account) to see your Tracker lists.');
        return;
      }
      invalidateTracker();
      setLists(await getAllTrackerLists());
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const places = prefs.trackerListPlaces ?? {};
  function toggle(list: TrackerList, tab: string) {
    const now = listPlaces(list, places);
    const next = now.includes(tab) ? now.filter((t) => t !== tab) : [...now, tab];
    setPref('trackerListPlaces', { ...places, [list.id]: next });
  }
  function reset(list: TrackerList) {
    const { [list.id]: _, ...rest } = places;
    setPref('trackerListPlaces', rest);
  }

  return (
    <SettingsPage title="Where your lists go">
      <Body muted>
        Pick the tabs each list shows on. A list on no tab stays in Tracker only. Saved to your 128bit account, so it
        follows you to every device.
      </Body>
      <SectionTitle>Automatic rows</SectionTitle>
      <Group>
        <ToggleRow
          title="Up next"
          subtitle="The next episode of shows you're watching (Shows and Anime)"
          value={prefs.trackerUpNext}
          onChange={(v) => setPref('trackerUpNext', v)}
        />
        <ToggleRow
          title="Watchlist"
          subtitle="Everything planned in Tracker that isn't on one of your lists"
          value={prefs.trackerWatchlist}
          onChange={(v) => setPref('trackerWatchlist', v)}
        />
      </Group>
      <SectionTitle>Your Tracker lists</SectionTitle>
      {error ? <Body muted>{error}</Body> : null}
      {!lists && !error ? <ActivityIndicator color={Colors.accent} /> : null}
      {lists && !lists.length ? <Body muted>No lists yet. Make one in Tracker (Library → + New list) or from any title here.</Body> : null}
      {lists?.length ? (
        <Group>
          {lists.map((list) => {
            const on = listPlaces(list, places);
            return (
              <View key={list.id} style={styles.row}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {list.name}
                  </Text>
                  <Text style={styles.count}>{list.item_count}</Text>
                </View>
                <View style={styles.chips}>
                  {TABS.map((t) => {
                    const sel = on.includes(t.id);
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => toggle(list, t.id)}
                        style={[styles.chip, sel && { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: sel }}>
                        <Text style={[styles.chipText, sel && { color: Colors.background }]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                  {places[list.id] ? (
                    <Pressable onPress={() => reset(list)} hitSlop={8} style={{ justifyContent: 'center' }}>
                      <Text style={styles.reset}>Reset</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Group>
      ) : null}
    </SettingsPage>
  );
}

const useStyles = makeStyles((Colors) => ({
  row: { padding: Spacing.three, gap: Spacing.two, borderBottomWidth: 1, borderColor: Colors.border },
  name: { color: Colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  count: { color: Colors.textSecondary, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  reset: { color: Colors.accent, fontWeight: '700', fontSize: 13 },
}));
