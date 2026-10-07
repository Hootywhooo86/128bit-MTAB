import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { dayKey, formatDuration, getStats, resetStats, streaks, summarize, type Stats } from '@/lib/stats';
import { Pressable } from '@/components/focusable';

// Chart series colours (validated for colour-blind separation and contrast on the dark surfaces).
const LISTEN = '#3987e5';
const WATCH = '#d95926';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function lastDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return { key: dayKey(d), label: DAY_NAMES[d.getDay()] };
  });
}

export default function StatsScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  useFocusEffect(
    useCallback(() => {
      // Copy, so the screen re-renders with fresh numbers each visit.
      getStats().then((s) => setStats(JSON.parse(JSON.stringify(s))));
    }, []),
  );

  if (!stats) return <SettingsPage>{null}</SettingsPage>;

  const all = summarize(stats);
  const listenTotal = all.listen;
  const watchTotal = all.watch;
  const chaptersTotal = all.chapters;
  const yr = summarize(stats, year);
  const years = [...new Set([new Date().getFullYear(), ...Object.keys(stats.days).map((k) => Number(k.slice(0, 4)))])].sort(
    (a, b) => b - a,
  );
  const streak = streaks(stats);

  const books = Object.values(stats.books).sort((a, b) => b.seconds - a.seconds);
  const watched = Object.values(stats.watched);
  const movies = watched.filter((w) => w.kind === 'movie');
  const episodes = watched.filter((w) => w.kind === 'episode');
  const showCounts = new Map<string, number>();
  for (const w of episodes) if (w.finished) showCounts.set(w.title, (showCounts.get(w.title) ?? 0) + 1);
  const topShows = [...showCounts].sort(([, a], [, b]) => b - a).slice(0, 5);
  const shows = new Set(episodes.map((e) => e.title));
  const liveSeconds = watched.filter((w) => w.kind === 'live').reduce((n, w) => n + w.seconds, 0);
  const comics = Object.values(stats.comics).sort((a, b) => b.chapters - a.chapters);
  const recent = [...watched].sort((a, b) => b.at - a.at).slice(0, 5);

  const week = lastDays(7).map((d) => ({ ...d, ...(stats.days[d.key] ?? { listen: 0, watch: 0, chapters: 0 }) }));
  const weekMax = Math.max(60, ...week.map((d) => d.listen + d.watch));
  const pick = week.find((d) => d.key === selected) ?? week[week.length - 1];

  function reset() {
    const go = async () => {
      await resetStats();
      setStats(JSON.parse(JSON.stringify(await getStats())));
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Reset all statistics?')) go();
      return;
    }
    Alert.alert('Reset statistics', 'This clears all listening, watching and reading stats.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: go },
    ]);
  }

  return (
    <SettingsPage>
      <View style={styles.tiles}>
        <Tile value={formatDuration(listenTotal)} label="Listening" />
        <Tile value={formatDuration(watchTotal)} label="Watching" />
        <Tile value={String(chaptersTotal)} label="Chapters read" />
      </View>
      <View style={styles.tiles}>
        <Tile value={String(all.books)} label="Books finished" />
        <Tile value={String(all.movies)} label="Movies" />
        <Tile value={String(all.episodes)} label="Episodes" />
      </View>

      <SectionTitle>Year</SectionTitle>
      {years.length > 1 ? (
        <View style={styles.years}>
          {years.map((y) => (
            <Pressable key={y} onPress={() => setYear(y)} style={[styles.yearChip, y === year && styles.yearChipOn]}>
              <Text style={[styles.yearText, y === year && { color: Colors.accentText }]}>{y}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Group>
        <Row title={`Listening in ${year}`} value={formatDuration(yr.listen)} />
        <Row title={`Watching in ${year}`} value={formatDuration(yr.watch)} />
        <Row title="Books finished" value={String(yr.books)} />
        <Row title="Movies watched" value={String(yr.movies)} />
        <Row title="Episodes watched" value={`${yr.episodes} · ${yr.shows} shows`} />
        <Row title="Comic chapters read" value={String(yr.chapters)} />
      </Group>

      <SectionTitle>Streaks & records</SectionTitle>
      <Group>
        <Row title="Current streak" value={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`} />
        <Row title="Longest streak" value={`${streak.longest} ${streak.longest === 1 ? 'day' : 'days'}`} />
        {streak.best ? (
          <Row
            title="Biggest day"
            subtitle={new Date(`${streak.best.day}T12:00:00`).toLocaleDateString()}
            value={formatDuration(streak.best.seconds)}
          />
        ) : null}
        <Row
          title="Average active day"
          value={formatDuration(streak.activeDays ? (all.listen + all.watch) / streak.activeDays : 0)}
        />
      </Group>

      <SectionTitle>Last 7 days</SectionTitle>
      <View style={styles.card}>
        <View style={styles.legend}>
          <Legend color={LISTEN} label="Listening" />
          <Legend color={WATCH} label="Watching" />
        </View>
        {/* The tapped day (today by default), in words: the chart's readout. */}
        <Text style={styles.readout}>
          {pick.key === dayKey() ? 'Today' : pick.label}: {formatDuration(pick.listen)} listening ·{' '}
          {formatDuration(pick.watch)} watching · {pick.chapters} chapters
        </Text>
        <View style={styles.chart}>
          {week.map((d) => {
            const total = d.listen + d.watch;
            const h = (s: number) => (s / weekMax) * 120;
            const active = d.key === pick.key;
            return (
              <Pressable
                key={d.key}
                style={styles.col}
                onPress={() => setSelected(d.key)}
                accessibilityLabel={`${d.label}: ${formatDuration(d.listen)} listening, ${formatDuration(d.watch)} watching`}>
                <View style={styles.barArea}>
                  {total > 0 ? (
                    <View style={[styles.stack, active && styles.stackActive]}>
                      {d.watch > 0 ? (
                        <View style={[styles.segment, { height: Math.max(3, h(d.watch)), backgroundColor: WATCH }]} />
                      ) : null}
                      {d.listen > 0 ? (
                        <View
                          style={[
                            styles.segment,
                            { height: Math.max(3, h(d.listen)), backgroundColor: LISTEN },
                            d.watch > 0 && styles.gap,
                            d.watch > 0 && { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
                          ]}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.dayLabel, active && { color: Colors.text }]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <SectionTitle>Audiobooks</SectionTitle>
      <Group>
        <Row title="Listening time" value={formatDuration(listenTotal)} />
        <Row title="Books finished" value={String(books.filter((b) => b.finished).length)} />
        <Row title="Books started" value={String(books.length)} />
        {books.slice(0, 5).map((b) => (
          <Row key={b.title} title={b.title} subtitle={b.author} value={formatDuration(b.seconds)} />
        ))}
      </Group>

      <SectionTitle>Movies & TV</SectionTitle>
      <Group>
        <Row title="Watching time" value={formatDuration(watchTotal)} />
        <Row title="Movies watched" value={String(movies.filter((m) => m.finished).length)} />
        <Row title="Episodes watched" value={String(episodes.filter((e) => e.finished).length)} />
        <Row title="Shows" value={String(shows.size)} />
        <Row title="Live TV & sports" value={formatDuration(liveSeconds)} />
        {topShows.map(([title, n]) => (
          <Row key={`top:${title}`} title={title} subtitle="Most-watched show" value={`${n} ep.`} />
        ))}
        {recent.map((w) => (
          <Row
            key={`${w.title}:${w.subtitle ?? ''}:${w.at}`}
            title={w.title}
            subtitle={[w.subtitle, w.finished ? 'Watched' : null].filter(Boolean).join(' · ')}
            value={formatDuration(w.seconds)}
          />
        ))}
      </Group>

      <SectionTitle>Comics</SectionTitle>
      <Group>
        <Row title="Chapters read" value={String(chaptersTotal)} />
        <Row title="Series" value={String(comics.length)} />
        {comics.slice(0, 5).map((c) => (
          <Row key={c.title} title={c.title} value={`${c.chapters} ch.`} />
        ))}
      </Group>

      <Text style={styles.since}>
        Counting since {new Date(stats.since).toLocaleDateString()}. Stats stay on this phone.
      </Text>
      <Group>
        <Row icon="trash" title="Reset statistics" danger onPress={reset} />
      </Group>
    </SettingsPage>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  tiles: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  tile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    gap: 4,
  },
  tileValue: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  tileLabel: { color: Colors.textSecondary, fontSize: 12 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  legend: { flexDirection: 'row', gap: Spacing.four },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { color: Colors.textSecondary, fontSize: 12 },
  readout: { color: Colors.text, fontSize: 13 },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  col: { flex: 1, alignItems: 'center', gap: 6, paddingBottom: 6 },
  barArea: { height: 124, justifyContent: 'flex-end' },
  stack: { width: 18, opacity: 0.85 },
  stackActive: { opacity: 1 },
  // Rounded on the data end only; the base sits square on the axis.
  segment: { width: 18, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  gap: { borderTopWidth: 2, borderTopColor: Colors.surface },
  dayLabel: { color: Colors.textSecondary, fontSize: 11 },
  years: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  yearChip: { paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: Radius.lg, backgroundColor: Colors.surface },
  yearChipOn: { backgroundColor: Colors.accent },
  yearText: { color: Colors.text, fontWeight: '700' },
  since: { color: Colors.textSecondary, fontSize: 12, marginVertical: Spacing.three },
}));
