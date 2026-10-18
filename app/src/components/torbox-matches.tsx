import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Pressable } from '@/components/focusable';
import { Body, Cover, Heading, ProgressBar, formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles } from '@/constants/theme';
import { bookNumber, numberFit, titleScore } from '@/lib/book-match';
import { listAudioItems, type TorboxItem } from '@/lib/torbox';
import { canGetTorrents } from '@/lib/torrent-device';

/** Share of the search's words found in `name`, the right book number first (see book-match). */
function overlap(query: string, name: string) {
  const want = bookNumber(query);
  const fit = numberFit(want, name);
  return titleScore(query, name) + (fit === 'same' ? 0.2 : fit === 'other' ? -0.3 : 0);
}

/**
 * Already in your TorBox (e.g. you added it yourself from somewhere else): tap one to open it
 * and, for a wanted book, link it so it downloads to the phone like anything sent from here.
 */
export function TorboxMatches({ query, onPick }: { query: string; onPick?: (id: number, name: string) => void }) {
  const styles = useStyles();
  const [items, setItems] = useState<TorboxItem[] | null>(null);
  const [off, setOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await canGetTorrents())) return !cancelled && setOff(true);
      const all = await listAudioItems();
      if (!cancelled)
        setItems(
          all
            .map((i) => ({ i, score: overlap(query, i.name) }))
            .filter((x) => x.score >= 0.6)
            .sort((a, b) => b.score - a.score)
            .map((x) => x.i),
        );
    })().catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Always shown (fewer moving parts): checking, nothing, or the matches.
  return (
    <View style={{ gap: Spacing.two, paddingHorizontal: Spacing.three }}>
      <Heading>Already on your TorBox</Heading>
      {off ? <Body muted>Add TorBox in Settings → Integrations to see it here.</Body> : null}
      {!off && !items ? <Body muted>Checking…</Body> : null}
      {items && !items.length ? <Body muted>Nothing matching yet.</Body> : null}
      {items?.map((item) => (
        <Pressable
          key={`${item.kind}:${item.id}`}
          style={styles.row}
          onPress={() => {
            onPick?.(item.id, item.name);
            router.push({ pathname: '/cloud/[kind]/[id]', params: { kind: item.kind, id: String(item.id) } });
          }}>
          <Cover size={52} title={item.name} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title} numberOfLines={3}>
              {item.name}
            </Text>
            {item.download_finished ? (
              <Text style={styles.meta}>Ready · {formatBytes(item.size)}</Text>
            ) : (
              <>
                <Text style={styles.meta}>
                  {item.download_state ?? 'downloading'} · {Math.round(item.progress * 100)}%
                </Text>
                <ProgressBar value={item.progress} />
              </>
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  title: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
}));
