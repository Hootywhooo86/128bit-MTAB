import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { TorboxButton } from '@/components/torbox-button';
import { Body, Cover, Heading } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { searchAbb, type AbbResult } from '@/lib/abb';
import { resolveTorrent } from '@/lib/feeds';
import { Pressable } from '@/components/focusable';

/** AudiobookBay search results for `query`, best matches first, with Load more. */
export function AbbResults({
  query,
  onSent,
}: {
  query: string;
  onSent?: (torboxId: number, name: string) => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [results, setResults] = useState<AbbResult[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // First two pages together: the site lists newest first, not best match.
    Promise.all([searchAbb(query, 1), searchAbb(query, 2)])
      .then(([a, b]) => {
        if (cancelled) return;
        setResults([...a.results, ...b.results]);
        setPage(2);
        setMore(a.more && b.more);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function loadMore() {
    setBusy(true);
    try {
      const next = await searchAbb(query, page + 1);
      setResults((r) => [...r, ...next.results]);
      setPage(page + 1);
      setMore(next.more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...results].sort((a, b) => b.score - a.score);

  return (
    <View style={{ gap: Spacing.two, paddingHorizontal: Spacing.three }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <Heading style={{ flex: 1 }}>AudiobookBay</Heading>
        {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      </View>
      {error ? <Body style={{ color: Colors.danger, fontSize: 12 }}>{error}</Body> : null}
      {!busy && !error && results.length === 0 ? <Body muted>No results.</Body> : null}
      {sorted.map((r) => (
        <View key={r.link} style={styles.row}>
          <Cover uri={r.cover} size={64} title={r.title} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title} numberOfLines={3}>
              {r.title}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {[r.format, r.bitrate, r.sizeText, r.posted, r.language].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <TorboxButton
            name={r.title}
            getMagnet={async () => (await resolveTorrent(r)).magnet}
            onSent={onSent}
          />
        </View>
      ))}
      {more && results.length > 0 && !busy ? (
        <Pressable style={styles.more} onPress={loadMore}>
          <Text style={styles.moreText}>Load more</Text>
        </Pressable>
      ) : null}
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
  more: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  moreText: { color: Colors.text, fontWeight: '700' },
}));
