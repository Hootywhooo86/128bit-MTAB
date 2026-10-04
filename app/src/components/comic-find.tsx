import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Body, Input, formatBytes } from '@/components/ui';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';
import { canOpenRar } from '@/lib/comic-archive';
import {
  followSeries,
  grabComic,
  searchComicReleases,
  type ComicRelease,
} from '@/lib/comic-grab';
import { Pressable } from '@/components/focusable';

/**
 * Find comics on GetComics and The Pirate Bay (Comics). Tap Get: it goes on your
 * Wanted list and comes to the phone (GetComics directly, torrents via TorBox).
 */
export function ComicFind({ onGrabbed }: { onGrabbed: () => void }) {
  const Colors = useColors();
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ComicRelease[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setResults(null);
    setErrors([]);
    const r = await searchComicReleases(q).catch((e) => ({ results: [], errors: [String(e.message ?? e)] }));
    setResults(r.results);
    setErrors(r.errors);
    setBusy(false);
  }

  const say = (id: string, text: string) => setNote((n) => ({ ...n, [id]: text }));

  return (
    <View style={{ gap: Spacing.three, paddingHorizontal: Spacing.three }}>
      <Input
        placeholder="Search GetComics + Pirate Bay (e.g. Absolute Batman)"
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        onSubmitEditing={search}
        clearButtonMode="while-editing"
      />
      <Body muted style={{ fontSize: 12 }}>
        {canOpenRar
          ? 'CBZ and CBR both open. GetComics downloads straight to the phone; torrents go through TorBox first. The archive is deleted once unpacked.'
          : 'CBZ releases come first; CBR (RAR) opens in the Android app only. GetComics downloads straight to the phone; torrents go through TorBox first.'}
      </Body>
      {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      {errors.map((e) => (
        <Body key={e} style={{ color: Colors.danger, fontSize: 12 }}>
          {e}
        </Body>
      ))}
      {results && !results.length && !busy ? <Body muted>No results.</Body> : null}
      {results?.map((r) => {
        // CBR opens in the Android app; elsewhere it's marked and can't be got.
        const cbr = (r.format === 'CBR' && !canOpenRar) || r.format === 'PDF';
        return (
          <View key={r.id} style={[styles.row, cbr && { opacity: 0.45 }]}>
            {r.cover ? (
              <Image source={{ uri: r.cover }} style={styles.cover} contentFit="cover" />
            ) : (
              <View style={[styles.cover, styles.coverBlank]}>
                <Text style={styles.coverText}>{r.source === 'tpb' ? 'TPB' : 'GC'}</Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.title} numberOfLines={3}>
                {r.title}
              </Text>
              <View style={styles.badges}>
                <Text style={[styles.badge, (r.format === 'CBZ' || (r.format === 'CBR' && canOpenRar)) && styles.badgeOn]}>
                  {cbr ? `${r.format} – can’t open` : r.format === 'Direct' ? 'Direct download' : r.format}
                </Text>
                <Text style={styles.badge}>{r.source === 'tpb' ? 'Pirate Bay' : 'GetComics'}</Text>
                {r.size ? <Text style={styles.badge}>{formatBytes(r.size)}</Text> : null}
                {r.seeders !== undefined ? <Text style={styles.badge}>👤 {r.seeders}</Text> : null}
              </View>
              {note[r.id] ? <Text style={styles.note}>{note[r.id]}</Text> : null}
              <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                {!cbr ? (
                  <Pressable
                    style={[styles.btn, styles.btnMain]}
                    onPress={async () => {
                      try {
                        await grabComic(r);
                        say(r.id, 'On your Wanted list ▶ coming to the phone');
                        onGrabbed();
                      } catch (e) {
                        say(r.id, e instanceof Error ? e.message : String(e));
                      }
                    }}>
                    <Text style={[styles.btnText, { color: Colors.accentText }]}>GET</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.btn}
                  onPress={async () => {
                    try {
                      const f = await followSeries(r);
                      say(r.id, `Following ${f.name}${f.lastIssue ? ` after #${f.lastIssue}` : ''}`);
                    } catch (e) {
                      say(r.id, e instanceof Error ? e.message : String(e));
                    }
                  }}>
                  <Text style={styles.btnText}>FOLLOW</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  cover: { width: 64, height: 96, backgroundColor: Colors.surfaceRaised },
  coverBlank: { alignItems: 'center', justifyContent: 'center' },
  coverText: { color: Colors.accent, fontFamily: PixelFont, fontSize: 10 },
  title: { color: Colors.text, fontWeight: '700', fontSize: 14 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: {
    color: Colors.textSecondary,
    fontSize: 11,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeOn: { color: Colors.accent, borderColor: Colors.accent },
  note: { color: Colors.accent, fontSize: 12 },
  btn: {
    borderWidth: 2,
    borderColor: Colors.text,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  btnMain: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  btnText: { color: Colors.text, fontFamily: PixelFont, fontSize: 9 },
}));
