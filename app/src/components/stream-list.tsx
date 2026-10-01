import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Body, Card, Heading, ProgressBar, formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { LIVE_TYPES, fetchStreams, type AddonStreams } from '@/lib/addons';
import { usePrefs } from '@/lib/prefs';
import { getActiveAddons, getTorboxKey } from '@/lib/storage';
import { parseStream, qualityRank, type Quality } from '@/lib/stream-info';
import { checkCached } from '@/lib/torbox';
import type { Stream } from '@/lib/types';
import { downloadVideo } from '@/lib/video-downloads';
import {
  checkTorboxStream,
  getSeriesContext,
  resolveStream,
  setNowWatching,
  type StreamResult,
} from '@/lib/video';

type Props = {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  poster?: string;
  /** The title page to come back to from Continue watching. */
  link: { type: string; id: string };
};

type Filter = 'all' | 'cached' | Quality;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cached', label: '⚡ Cached' },
  { id: '4K', label: '4K' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: 'SD', label: 'SD' },
];

const POLL_MS = 5000;

/** Every stream your addons offer for one movie or episode. Tap one to play. */
export function StreamList({ type, id, title, subtitle, poster, link }: Props) {
  const { prefs } = usePrefs();
  const Colors = useColors();
  const styles = useStyles();
  const [groups, setGroups] = useState<AddonStreams[] | null>(null);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{
    stream: Stream;
    result: Extract<StreamResult, { status: 'downloading' }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchStreams(await getActiveAddons(), type, id);
      if (cancelled) return;
      setGroups(result);
      const hashes = result.flatMap((g) =>
        g.streams.map((s) => s.infoHash).filter(Boolean),
      ) as string[];
      if (hashes.length && (await getTorboxKey())) {
        checkCached(hashes)
          .then((set) => !cancelled && setCached(set))
          .catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function play(uri: string, stream: Stream, addonId: string, headers?: Record<string, string>) {
    setNowWatching({
      key: id,
      title,
      subtitle,
      poster,
      uri,
      headers,
      link,
      live: LIVE_TYPES.includes(type),
      series: type === 'series' || type === 'anime' ? getSeriesContext(link.id) : undefined,
      source: { addonId, bingeGroup: stream.behaviorHints?.bingeGroup },
    });
    router.push('/watch');
  }

  async function handle(result: StreamResult, stream: Stream, addonId: string) {
    if (result.status === 'ready') {
      setWaiting(null);
      play(result.uri, stream, addonId, result.headers);
    } else if (result.status === 'external') {
      Linking.openURL(result.url);
    } else {
      setWaiting({ stream, result });
      timer.current = setTimeout(async () => {
        try {
          await handle(await checkTorboxStream(result.itemId, stream), stream, addonId);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, POLL_MS);
    }
  }

  /** Hold a stream: save it to the phone (Settings → Downloads shows progress). */
  function save(stream: Stream) {
    const live = LIVE_TYPES.includes(type);
    if (live) {
      setError('Live channels can only be streamed.');
      return;
    }
    const label = subtitle ? `${title} · ${subtitle}` : title;
    const go = async () => {
      setError(null);
      try {
        await downloadVideo({
          key: id,
          kind: type === 'movie' ? 'movie' : 'episode',
          title,
          subtitle,
          poster,
          link,
          stream,
        });
        setSaved(label);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    if (Platform.OS === 'web') {
      go();
      return;
    }
    Alert.alert('Download to phone', `${label}\n${(stream.name ?? '').replace(/\n/g, ' ')}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Download', onPress: go },
    ]);
  }

  async function pick(stream: Stream, addonId: string, key: string) {
    if (timer.current) clearTimeout(timer.current);
    setBusy(key);
    setError(null);
    setWaiting(null);
    try {
      const name = subtitle ? `${title} ${subtitle}` : title;
      await handle(await resolveStream(stream, name), stream, addonId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!groups)
    return <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.four }} />;

  const isCached = (s: Stream) => !!s.infoHash && cached.has(s.infoHash.toLowerCase());
  const matches = (s: Stream) => {
    if (filter === 'all') return true;
    if (filter === 'cached') return isCached(s) || !!s.url;
    return parseStream(s).quality === filter;
  };
  // Keep each stream's original index for its key; optionally float TorBox-cached ones up.
  const ordered = (streams: Stream[]) => {
    const list = streams.map((s, i) => ({ s, i })).filter(({ s }) => matches(s));
    return prefs.cachedFirst
      ? list.sort((a, b) => Number(isCached(b.s)) - Number(isCached(a.s)))
      : list;
  };
  const total = groups.reduce((n, g) => n + g.streams.length, 0);
  const shown = groups.reduce((n, g) => n + ordered(g.streams).length, 0);

  return (
    <View style={{ gap: Spacing.three }}>
      {waiting ? (
        <Card>
          <Heading>TorBox is fetching this</Heading>
          <Body muted>It plays automatically when it’s ready.</Body>
          <ProgressBar value={waiting.result.progress} />
          <Body muted>{Math.round(waiting.result.progress * 100)}%</Body>
        </Card>
      ) : null}
      {error ? <Body style={{ color: Colors.danger }}>{error}</Body> : null}
      {saved ? (
        <Pressable onPress={() => router.push('/settings/downloads')}>
          <Body style={{ color: Colors.success }}>
            Downloading {saved}. Tap to see Downloads.
          </Body>
        </Pressable>
      ) : null}
      {total > 0 && !LIVE_TYPES.includes(type) ? (
        <Body muted style={{ fontSize: 12 }}>
          Tap a stream to play it · hold to download it to your phone
        </Body>
      ) : null}

      {total > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.two }}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.chip, filter === f.id && styles.chipActive]}>
              <Text style={[styles.chipText, filter === f.id && { color: Colors.accentText }]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {groups.length === 0 ? (
        <Body muted>
          None of your addons provide streams for this. Install a stream addon in Settings → Addons.
        </Body>
      ) : total === 0 ? (
        <Body muted>No streams found.</Body>
      ) : shown === 0 ? (
        <Body muted>No streams match this filter.</Body>
      ) : null}

      {groups.map(({ addon, streams, error: groupError }) => {
        const list = ordered(streams);
        if (!list.length && !groupError) return null;
        return (
          <View key={addon.manifest.id} style={{ gap: Spacing.two }}>
            <Heading style={{ fontSize: 15 }}>{addon.manifest.name}</Heading>
            {groupError ? (
              <Body muted style={{ fontSize: 12 }}>
                {groupError}
              </Body>
            ) : null}
            {list.map(({ s, i }) => {
              const key = `${addon.manifest.id}:${i}`;
              const info = parseStream(s);
              const cachedHere = isCached(s);
              return (
                <Pressable
                  key={key}
                  onPress={() => pick(s, addon.manifest.id, key)}
                  onLongPress={() => save(s)}
                  delayLongPress={400}
                  disabled={busy !== null}
                  style={styles.stream}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name}>
                      {(s.name ?? addon.manifest.name).replace(/\n/g, ' ')}
                    </Text>
                    {s.title || s.description ? (
                      <Text style={styles.detail} numberOfLines={4}>
                        {s.title ?? s.description}
                      </Text>
                    ) : null}
                    <View style={styles.badges}>
                      {info.quality ? (
                        <Badge label={info.quality} strong={qualityRank(info.quality) >= 3} />
                      ) : null}
                      {info.hdr.map((h) => (
                        <Badge key={h} label={h} />
                      ))}
                      {info.sizeBytes ? <Badge label={formatBytes(info.sizeBytes)} /> : null}
                      {info.seeders !== null ? <Badge label={`👤 ${info.seeders}`} /> : null}
                      {s.url ? <Badge label="Direct" /> : null}
                      {s.infoHash ? (
                        <Badge
                          label={cachedHere ? '⚡ Cached' : 'Torrent → TorBox'}
                          strong={cachedHere}
                        />
                      ) : null}
                      {s.externalUrl ? <Badge label="Opens outside" /> : null}
                    </View>
                  </View>
                  {busy === key ? <ActivityIndicator color={Colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function Badge({ label, strong }: { label: string; strong?: boolean }) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <View style={[styles.badge, strong && { backgroundColor: Colors.accent }]}>
      <Text style={[styles.badgeText, strong && { color: Colors.accentText }]}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  stream: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  name: { color: Colors.text, fontWeight: '700' },
  detail: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Colors.surfaceRaised,
  },
  badgeText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipActive: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
}));
