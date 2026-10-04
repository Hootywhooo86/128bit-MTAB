import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Button, Cover, ProgressBar } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { formatMinutes } from '@/lib/audible';
import { offlineSupported } from '@/lib/downloads';
import { usePlayer } from '@/lib/player';
import {
  downloadWanted,
  getWantedById,
  grabBook,
  playable,
  removeWanted,
  addWanted,
  torboxState,
  updateWanted,
  wantedId,
  type TorboxState,
  type WantedBook,
  type WantedInput,
} from '@/lib/wanted';
import { Pressable } from '@/components/focusable';

type Params = {
  title: string;
  author?: string;
  narrator?: string;
  cover?: string;
  rating?: string;
  minutes?: string;
  series?: string;
  description?: string;
};

/** A book you might want: get it into TorBox, then play it or save it to the phone. */
export default function BookDetailsScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { playBook } = usePlayer();
  const p = useLocalSearchParams<Params>();
  const id = wantedId(p.title ?? '', p.author || undefined);

  const [entry, setEntry] = useState<WantedBook | null | undefined>(undefined);
  const [tb, setTb] = useState<TorboxState>({ state: 'none' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dl, setDl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // What we know about the book: the saved Wanted entry, else what the search passed in.
  const info: WantedInput = {
    title: entry?.title ?? p.title ?? '',
    author: entry?.author ?? (p.author || undefined),
    narrator: entry?.narrator ?? (p.narrator || undefined),
    cover: entry?.cover ?? (p.cover || undefined),
    rating: entry?.rating ?? (Number(p.rating) || undefined),
    minutes: entry?.minutes ?? (Number(p.minutes) || undefined),
    series: entry?.series ?? (p.series || undefined),
    description: entry?.description ?? (p.description || undefined),
  };

  const load = useCallback(async () => {
    setEntry((await getWantedById(id)) ?? null);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Follow TorBox while the screen is open.
  const torboxId = entry?.torbox?.id;
  useEffect(() => {
    if (!entry || !torboxId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const s = await torboxState(entry);
      if (cancelled) return;
      setTb(s);
      if (s.state === 'downloading') timer = setTimeout(poll, 5000);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entry, torboxId]);

  // "Download when ready": start as soon as TorBox finishes.
  useEffect(() => {
    if (tb.state !== 'ready' || !entry?.autoDownload || entry.downloaded || dl) return;
    saveToPhone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tb.state, entry?.autoDownload, entry?.downloaded]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setBusy(null);
    }
  }

  const get = () => run('get', () => grabBook(info));

  async function saveToPhone() {
    if (!entry || tb.state !== 'ready') return;
    setError(null);
    setDl('Starting…');
    try {
      await downloadWanted(entry, tb.item, (done, total) => setDl(`Downloading ${done}/${total}…`));
      setDl(null);
      load();
    } catch (e) {
      setDl(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function play() {
    if (!entry || tb.state !== 'ready') return;
    await playBook(playable(entry, tb.item));
    router.push('/player');
  }

  const facts = [
    info.rating ? `★ ${info.rating.toFixed(1)}` : null,
    formatMinutes(info.minutes),
  ].filter(Boolean);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: 'Book Details',
          headerRight: () => (
            <Pressable
              hitSlop={10}
              accessibilityLabel={entry ? 'Remove from Wanted' : 'Add to Wanted'}
              onPress={() =>
                entry
                  ? run('heart', () => removeWanted(entry.id))
                  : run('heart', () => addWanted(info))
              }>
              <Ionicons
                name={entry ? 'heart' : 'heart-outline'}
                size={26}
                color={entry ? Colors.accent : Colors.text}
              />
            </Pressable>
          ),
        }}
      />
      <Cover uri={info.cover} size={220} title={info.title} author={info.author} />
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={styles.title}>{info.title}</Text>
        {info.author ? <Text style={styles.author}>by {info.author}</Text> : null}
        {info.narrator ? <Text style={styles.meta}>Narrated by {info.narrator}</Text> : null}
        {facts.length ? <Text style={styles.meta}>{facts.join('  ·  ')}</Text> : null}
        {info.series ? <Text style={styles.meta}>{info.series}</Text> : null}
      </View>

      <View style={styles.actions}>
        {entry === undefined ? (
          <ActivityIndicator color={Colors.accent} />
        ) : !entry?.torbox ? (
          <>
            <Button
              label={busy === 'get' ? 'Finding the best release…' : 'Download'}
              loading={busy === 'get'}
              onPress={get}
            />
            <Text style={styles.hint}>
              Adds it to Wanted{entry ? '' : ' (and Hardcover Want to Read)'}, finds the best release
              and sends it to TorBox.
            </Text>
            <Button
              label="Choose a release myself"
              variant="secondary"
              onPress={async () => {
                await addWanted(info);
                router.push({
                  pathname: '/audiobooks/find',
                  params: { title: info.title, author: info.author ?? '', cover: info.cover ?? '' },
                });
              }}
            />
          </>
        ) : tb.state === 'downloading' ? (
          <>
            <View style={styles.status}>
              <Text style={styles.statusTitle}>
                TorBox is getting it · {Math.round(tb.progress * 100)}%
              </Text>
              <ProgressBar value={tb.progress} />
              <Text style={styles.hint} numberOfLines={2}>
                {entry.torbox.name}
              </Text>
            </View>
            {offlineSupported ? (
              <Button
                label={entry.autoDownload ? '✓ Downloads to your phone when ready' : 'Download when ready'}
                variant={entry.autoDownload ? 'secondary' : 'primary'}
                onPress={() =>
                  run('auto', () => updateWanted(entry.id, { autoDownload: !entry.autoDownload }))
                }
              />
            ) : null}
          </>
        ) : tb.state === 'ready' ? (
          <>
            <View style={styles.status}>
              <Text style={[styles.statusTitle, { color: Colors.success }]}>Ready in TorBox</Text>
              <Text style={styles.hint} numberOfLines={2}>
                {entry.torbox.name}
              </Text>
            </View>
            <Button label="Play" onPress={play} />
            {offlineSupported ? (
              entry.downloaded ? (
                <Button label="✓ On your phone" variant="secondary" disabled onPress={() => {}} />
              ) : (
                <Button
                  label={dl ?? 'Download to phone'}
                  variant="secondary"
                  loading={!!dl}
                  onPress={saveToPhone}
                />
              )
            ) : null}
          </>
        ) : tb.state === 'gone' ? (
          <>
            <Text style={styles.hint}>
              The TorBox item for this book is gone (deleted or expired).
            </Text>
            <Button label="Send it again" loading={busy === 'get'} onPress={get} />
          </>
        ) : (
          <ActivityIndicator color={Colors.accent} />
        )}
        {error ? <Text style={{ color: Colors.danger, textAlign: 'center' }}>{error}</Text> : null}
      </View>

      {info.description ? (
        <Text
          style={styles.description}
          numberOfLines={expanded ? undefined : 6}
          onPress={() => setExpanded(!expanded)}>
          {info.description}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four, alignItems: 'center' },
  title: { color: Colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  author: { color: Colors.textSecondary, fontSize: 17 },
  meta: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.three },
  hint: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  status: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  statusTitle: { color: Colors.text, fontWeight: '700', fontSize: 15, textAlign: 'center' },
  description: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, alignSelf: 'stretch' },
}));
