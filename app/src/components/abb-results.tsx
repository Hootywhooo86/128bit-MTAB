import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Text, View } from 'react-native';

import { ReleaseButtons } from '@/components/torbox-button';
import { Body, Cover, Heading } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { retryAbbNow, searchAbbSmart, type AbbResult, type AbbSearch } from '@/lib/abb';
import { resolveTorrent } from '@/lib/feeds';
import type { WantedInput } from '@/lib/wanted';
import { Pressable } from '@/components/focusable';

/** AudiobookBay search results for `query`, best matches first, with Load more. */
export function AbbResults({
  query,
  book,
  onSent,
}: {
  query: string;
  /** The book these are for (its Download button saves it to the phone under that name). */
  book?: WantedInput;
  onSent?: (torboxId: number, name: string) => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [results, setResults] = useState<AbbResult[]>([]);
  const [search, setSearch] = useState<AbbSearch | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Several simpler questions to AudiobookBay, merged and ranked (see searchAbbSmart).
    // Results appear as each answer comes in; the spinner stays until the last one.
    searchAbbSmart(query, (partial) => {
      if (cancelled) return;
      setSearch(partial);
      setResults(partial.results);
    })
      .then((s) => {
        if (cancelled) return;
        setSearch(s);
        setResults(s.results);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [query, attempt]);

  function retry() {
    retryAbbNow();
    setError(null);
    setBusy(true);
    setAttempt((n) => n + 1);
  }

  async function loadMore() {
    if (!search) return;
    setBusy(true);
    try {
      const next = await search.loadMore();
      setSearch(next);
      setResults(next.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const more = !!search?.more;

  return (
    <View style={{ gap: Spacing.two, paddingHorizontal: Spacing.three }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <Heading style={{ flex: 1 }}>AudiobookBay</Heading>
        {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Body style={{ flex: 1, color: Colors.danger, fontSize: 12 }}>{error}</Body>
          {busy ? null : (
            <Pressable style={styles.more} onPress={retry}>
              <Text style={styles.moreText}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      {!busy && !error && results.length === 0 ? <Body muted>No results.</Body> : null}
      {results.map((r, i) => (
        <FadeIn key={r.link} delay={Math.min(i, 6) * 60} style={styles.row}>
          <Cover uri={r.cover} size={64} title={r.title} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title} numberOfLines={3}>
              {r.title}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {[r.format, r.bitrate, r.sizeText, r.posted, r.language].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <ReleaseButtons
            name={r.title}
            getMagnet={async () => (await resolveTorrent(r)).magnet}
            book={book}
            onSent={onSent}
          />
        </FadeIn>
      ))}
      {more && results.length > 0 && !busy ? (
        <Pressable style={styles.more} onPress={loadMore}>
          <Text style={styles.moreText}>Load more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Each book fades and slides in as it arrives (only on first appearance, not on re-rank). */
function FadeIn({ delay, style, children }: { delay: number; style: object; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    Animated.timing(v, { toValue: 1, duration: 250, delay, useNativeDriver: true }).start();
  }, [v, delay]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>{children}</Animated.View>;
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
