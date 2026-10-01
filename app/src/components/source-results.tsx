import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Body, Heading, formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  getSources,
  isCatalog,
  resultHash,
  searchSource,
  type InstalledSource,
  type SourceResult,
} from '@/lib/sources';
import { getTorboxKey } from '@/lib/storage';
import { addMagnet, checkCached, magnetFromHash } from '@/lib/torbox';

type Sent = 'sending' | 'sent' | { error: string };

/** Torrent results for `query` from every enabled download source, each with a Send to TorBox button. */
export function SourceResults({
  query,
  author,
  title = 'Download sources',
}: {
  query: string;
  author?: string;
  title?: string;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [sources, setSources] = useState<InstalledSource[] | null>(null);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Record<string, Sent>>({});

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
        searchSource(s.config, { title: query, author })
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

  async function send(r: SourceResult) {
    const key = resultHash(r) ?? r.title;
    if (!(await getTorboxKey())) {
      router.push('/settings/integrations');
      return;
    }
    setSent((s) => ({ ...s, [key]: 'sending' }));
    try {
      await addMagnet(r.magnet ?? magnetFromHash(r.infoHash!, r.title), r.title);
      setSent((s) => ({ ...s, [key]: 'sent' }));
    } catch (e) {
      setSent((s) => ({ ...s, [key]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

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
        const state = sent[key];
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
              {typeof state === 'object' ? (
                <Text style={[styles.meta, { color: Colors.danger }]}>{state.error}</Text>
              ) : null}
            </View>
            {state === 'sent' ? (
              <Pressable style={styles.sent} onPress={() => router.push('/audiobooks/cloud')}>
                <Ionicons name="checkmark" size={16} color={Colors.success} />
                <Text style={[styles.buttonText, { color: Colors.success }]}>In TorBox</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.button}
                disabled={state === 'sending'}
                onPress={() => send(r)}
                accessibilityLabel="Send to TorBox">
                {state === 'sending' ? (
                  <ActivityIndicator size="small" color={Colors.accentText} />
                ) : (
                  <>
                    <Ionicons name="cloud-download" size={16} color={Colors.accentText} />
                    <Text style={styles.buttonText}>TorBox</Text>
                  </>
                )}
              </Pressable>
            )}
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
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 84,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.accent,
  },
  sent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  buttonText: { color: Colors.accentText, fontWeight: '700', fontSize: 13 },
}));
