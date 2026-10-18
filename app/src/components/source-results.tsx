import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { ReleaseButtons } from '@/components/torbox-button';
import { Body, Heading, formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  getSources,
  isCatalog,
  resultHash,
  searchSourceSmart,
  type InstalledSource,
  type SourceResult,
} from '@/lib/sources';
import { getTorboxKey } from '@/lib/storage';
import { checkCached, magnetFromHash } from '@/lib/torbox';
import type { WantedInput } from '@/lib/wanted';

/**
 * Torrent results for `query` from every enabled download source, each with TorBox and
 * Download (TorBox, then the phone) buttons. Each source is asked simpler forms of the
 * query until one finds something (see searchSourceSmart).
 */
export function SourceResults({
  query,
  author,
  title = 'Download sources',
  book,
  onSent,
}: {
  query: string;
  author?: string;
  title?: string;
  /** The book these are for (its Download button saves it to the phone under that name). */
  book?: WantedInput;
  onSent?: (torboxId: number, name: string) => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [sources, setSources] = useState<InstalledSource[] | null>(null);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [cached, setCached] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getSources().then((all) => {
      const active = all.filter((s) => s.enabled !== false && !isCatalog(s.config));
      if (cancelled) return;
      setSources(active);
      setResults([]);
      setErrors([]);
      setPending(active.length);
      active.forEach((s) => {
        searchSourceSmart(s.config, { title: query, author })
          .then((found) => {
            if (cancelled) return;
            setResults((prev) => [...prev, ...found]);
            // ⚡ = TorBox already has it, so it's ready right away.
            getTorboxKey().then((key) => {
              if (!key) return;
              const hashes = found.map(resultHash).filter(Boolean) as string[];
              checkCached(hashes)
                .then((c) => !cancelled && setCached((prev) => new Set([...prev, ...c])))
                .catch(() => {});
            });
          })
          .catch((e) => !cancelled && setErrors((prev) => [...prev, `${s.config.name}: ${e.message}`]))
          .finally(() => !cancelled && setPending((n) => n - 1));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [query, author]);

  if (!sources?.length) return null;

  // Best matches first, then the healthiest torrents; one row per torrent.
  const seen = new Set<string>();
  const sorted = [...results]
    .sort((a, b) => b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0))
    .filter((r) => {
      const h = resultHash(r) ?? r.title;
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    });

  return (
    <View style={{ gap: Spacing.two, paddingHorizontal: Spacing.three }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <Heading style={{ flex: 1 }}>{title}</Heading>
        {pending > 0 ? <ActivityIndicator color={Colors.accent} /> : null}
      </View>
      {errors.map((e) => (
        <Body key={e} muted style={{ fontSize: 12, color: Colors.danger }}>
          {e}
        </Body>
      ))}
      {pending === 0 && sorted.length === 0 ? <Body muted>No torrents found.</Body> : null}
      {sorted.slice(0, 40).map((r) => {
        const hash = resultHash(r);
        const key = hash ?? r.title;
        const meta = [
          r.size ? formatBytes(r.size) : null,
          r.seeders != null ? `${r.seeders} seeders` : null,
          r.format,
          r.sourceName,
        ].filter(Boolean);
        return (
          <View key={`${r.sourceId}:${key}`} style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title} numberOfLines={3}>
                {hash && cached.has(hash) ? '⚡ ' : ''}
                {r.title}
              </Text>
              <Text style={styles.meta}>{meta.join(' · ')}</Text>
            </View>
            <ReleaseButtons
              name={r.title}
              getMagnet={async () => r.magnet ?? magnetFromHash(r.infoHash!, r.title)}
              book={book}
              cached={!!hash && cached.has(hash)}
              onSent={onSent}
            />
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  title: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
}));
