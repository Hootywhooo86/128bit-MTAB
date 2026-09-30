import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Card, Heading, ProgressBar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { fetchStreams, type AddonStreams } from '@/lib/addons';
import { getAddons, getTorboxKey } from '@/lib/storage';
import { checkCached } from '@/lib/torbox';
import type { Stream } from '@/lib/types';
import { checkTorboxStream, resolveStream, setNowWatching, type StreamResult } from '@/lib/video';

type Props = {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  poster?: string;
  /** The title page to come back to from Continue watching. */
  link: { type: string; id: string };
};

const POLL_MS = 5000;

/** Every stream your addons offer for one movie or episode. Tap one to play. */
export function StreamList({ type, id, title, subtitle, poster, link }: Props) {
  const [groups, setGroups] = useState<AddonStreams[] | null>(null);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ stream: Stream; result: Extract<StreamResult, { status: 'downloading' }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchStreams(await getAddons(), type, id);
      if (cancelled) return;
      setGroups(result);
      const hashes = result.flatMap((g) => g.streams.map((s) => s.infoHash).filter(Boolean)) as string[];
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

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function play(uri: string, headers?: Record<string, string>) {
    setNowWatching({ key: id, title, subtitle, poster, uri, headers, link, live: type === 'tv' });
    router.push('/watch');
  }

  async function handle(result: StreamResult, stream: Stream) {
    if (result.status === 'ready') {
      setWaiting(null);
      play(result.uri, result.headers);
    } else if (result.status === 'external') {
      Linking.openURL(result.url);
    } else {
      setWaiting({ stream, result });
      timer.current = setTimeout(async () => {
        try {
          await handle(await checkTorboxStream(result.itemId, stream), stream);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, POLL_MS);
    }
  }

  async function pick(stream: Stream, key: string) {
    if (timer.current) clearTimeout(timer.current);
    setBusy(key);
    setError(null);
    setWaiting(null);
    try {
      await handle(await resolveStream(stream, subtitle ? `${title} ${subtitle}` : title), stream);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!groups) return <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.four }} />;

  const total = groups.reduce((n, g) => n + g.streams.length, 0);

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
      {groups.length === 0 ? (
        <Body muted>None of your addons provide streams for this. Install a stream addon in Settings → Addons.</Body>
      ) : total === 0 ? (
        <Body muted>No streams found.</Body>
      ) : null}

      {groups.map(({ addon, streams, error: groupError }) =>
        streams.length || groupError ? (
          <View key={addon.manifest.id} style={{ gap: Spacing.two }}>
            <Heading style={{ fontSize: 15 }}>{addon.manifest.name}</Heading>
            {groupError ? <Body muted style={{ fontSize: 12 }}>{groupError}</Body> : null}
            {streams.map((s, i) => {
              const key = `${addon.manifest.id}:${i}`;
              const isCached = !!s.infoHash && cached.has(s.infoHash.toLowerCase());
              return (
                <Pressable key={key} onPress={() => pick(s, key)} disabled={busy !== null} style={styles.stream}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name}>{(s.name ?? addon.manifest.name).replace(/\n/g, ' ')}</Text>
                    {s.title || s.description ? (
                      <Text style={styles.detail} numberOfLines={4}>
                        {s.title ?? s.description}
                      </Text>
                    ) : null}
                    <View style={styles.badges}>
                      {s.url ? <Badge label="Direct" /> : null}
                      {s.infoHash ? <Badge label={isCached ? '⚡ Cached on TorBox' : 'Torrent → TorBox'} strong={isCached} /> : null}
                      {s.externalUrl ? <Badge label="Opens outside" /> : null}
                    </View>
                  </View>
                  {busy === key ? <ActivityIndicator color={Colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null,
      )}
    </View>
  );
}

function Badge({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <View style={[styles.badge, strong && { backgroundColor: Colors.accent }]}>
      <Text style={[styles.badgeText, strong && { color: Colors.accentText }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: Colors.surfaceRaised },
  badgeText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
});
