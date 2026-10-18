import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Text, View } from 'react-native';

import { PhoneButton, TorboxButton, useBookDownload } from '@/components/torbox-button';
import { Body, Button, Cover, EmptyState, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  addWanted,
  findMatches,
  getWanted,
  markSent,
  markStarted,
  playable,
  removeWanted,
  stillWanted,
  syncWantedWithTracker,
  torboxState,
  updateWanted,
  type Match,
  type TorboxState,
  type WantedBook,
} from '@/lib/wanted';
import { Pressable } from '@/components/focusable';
import { usePlayer } from '@/lib/player';

function confirmRemove(title: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`Remove ${title} from Wanted?`)) onYes();
    return;
  }
  Alert.alert('Remove from Wanted', title, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onYes },
  ]);
}

/** The Wanted tab: books you want, each checked against AudiobookBay and your sources. */
export function WantedList({ onCount }: { onCount?: (n: number) => void }) {
  const Colors = useColors();
  const styles = useStyles();
  const [list, setList] = useState<WantedBook[] | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [round, setRound] = useState(0);

  // Everything you haven't started (sent to TorBox and ready included); started or on the
  // phone: that's in the Library.
  const load = useCallback(async () => {
    await markStarted().catch(() => {});
    const l = (await getWanted()).filter(stillWanted);
    setList(l);
    onCount?.(l.length);
  }, [onCount]);

  // Your Tracker Audiobooks list is Wanted: bring both in step each time you look.
  useFocusEffect(
    useCallback(() => {
      load();
      syncWantedWithTracker().then(load, () => {});
    }, [load]),
  );

  async function add() {
    if (!title.trim()) return;
    await addWanted({ title: title.trim(), author: author.trim() || undefined });
    setTitle('');
    setAuthor('');
    load();
  }

  return (
    <FlatList
      data={list ?? []}
      keyExtractor={(w) => w.id}
      contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two, flexGrow: 1 }}
      ListHeaderComponent={
        <View style={styles.card}>
          <Body muted style={{ fontSize: 13 }}>
            Books you want (your 128bit Tracker Audiobooks list). 128bit looks for each on
            AudiobookBay and your download sources; tap TorBox on a match to get it, and it moves to
            your Library.
          </Body>
          <Input placeholder="Title" value={title} onChangeText={setTitle} />
          <Input
            placeholder="Author (optional)"
            value={author}
            onChangeText={setAuthor}
            onSubmitEditing={add}
          />
          <Button label="Add to Wanted" onPress={add} disabled={!title.trim()} />
          <View style={styles.actions}>
            {list?.length ? (
              <Pressable onPress={() => setRound(round + 1)} hitSlop={8} style={styles.link}>
                <Ionicons name="refresh" size={16} color={Colors.accent} />
                <Text style={styles.linkText}>Check again</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      }
      ListEmptyComponent={
        list ? (
          <EmptyState
            title="Nothing wanted yet"
            body="Add a book above, or open a book in Find audiobooks and tap Add to Wanted."
          />
        ) : null
      }
      renderItem={({ item }) => (
        <WantedRow
          key={`${item.id}:${round}`}
          book={item}
          fresh={round > 0}
          onChanged={load}
        />
      )}
    />
  );
}

function WantedRow({
  book,
  fresh,
  onChanged,
}: {
  book: WantedBook;
  fresh: boolean;
  onChanged: () => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tb, setTb] = useState<TorboxState | null>(null);

  // Sent to TorBox: show how far along it is.
  useEffect(() => {
    if (!book.torbox) return;
    let cancelled = false;
    torboxState(book).then((s) => !cancelled && setTb(s));
    return () => {
      cancelled = true;
    };
  }, [book, fresh]);

  useEffect(() => {
    if (book.sentAt) return;
    let cancelled = false;
    findMatches(book, fresh).then(
      (m) => !cancelled && setMatches(m),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [book, fresh]);

  // Downloading to the phone right now (Download button, or "download when ready").
  const toPhone = useBookDownload(book.libraryKey);
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (toPhone) wasDownloading.current = true;
    else if (wasDownloading.current) {
      // Finished (or stopped): it's in the Library now if it made it.
      wasDownloading.current = false;
      onChanged();
    }
  }, [toPhone, onChanged]);

  const best = matches?.[0];
  const { openBook } = usePlayer();
  // Ready in TorBox: tap plays it (starting it is what moves it to the Library).
  async function playReady() {
    if (tb?.state !== 'ready') return;
    const pb = playable(book, tb.item);
    await updateWanted(book.id, { libraryKey: pb.key });
    await openBook(pb);
    router.push('/player');
  }
  const openSearch = () =>
    router.push({
      pathname: '/audiobooks/details',
      params: { title: book.title, author: book.author ?? '', cover: book.cover ?? '' },
    });

  return (
    <Pressable
      style={styles.row}
      onPress={tb?.state === 'ready' ? playReady : openSearch}
      onLongPress={() =>
        confirmRemove(book.title, async () => {
          await removeWanted(book.id);
          onChanged();
        })
      }>
      <Cover uri={book.cover} size={64} title={book.title} author={book.author} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.title} numberOfLines={2}>
          {book.title}
        </Text>
        {book.author ? <Text style={styles.meta}>{book.author}</Text> : null}
        {book.downloaded ? (
          <Text style={[styles.meta, { color: Colors.success }]}>✓ On your phone · in Library</Text>
        ) : toPhone ? (
          <Text style={[styles.meta, { color: Colors.accent }]}>
            Downloading to phone… {Math.round(toPhone.fraction * 100)}%
          </Text>
        ) : book.torbox && tb?.state === 'downloading' ? (
          <Text style={[styles.meta, { color: Colors.accent }]}>
            TorBox {Math.round(tb.progress * 100)}%
            {book.autoDownload ? ' · downloads to phone when ready' : ''}
          </Text>
        ) : book.torbox && tb?.state === 'ready' ? (
          <Text style={[styles.meta, { color: Colors.success }]}>
            Ready in TorBox · {book.autoDownload ? 'downloading to phone…' : 'tap to play'}
          </Text>
        ) : book.torbox && tb?.state === 'gone' ? (
          <Text style={[styles.meta, { color: Colors.danger }]}>TorBox item gone · tap to send again</Text>
        ) : book.sentAt ? (
          <Text style={[styles.meta, { color: Colors.success }]} numberOfLines={2}>
            {book.autoDownload ? 'Sent · downloads to phone when ready' : '✓ Sent to TorBox'}
            {book.sentName ? `: ${book.sentName}` : ''}
          </Text>
        ) : error ? (
          <Text style={[styles.meta, { color: Colors.danger }]}>{error}</Text>
        ) : !matches ? (
          <Text style={styles.meta}>Looking…</Text>
        ) : best ? (
          <Text style={[styles.meta, { color: Colors.accent }]} numberOfLines={2}>
            Found on {best.where}: {best.name}
            {best.size ? ` · ${best.size}` : ''}
            {matches.length > 1 ? ` (+${matches.length - 1} more)` : ''}
          </Text>
        ) : (
          <Text style={styles.meta}>Not found yet. Tap to search by hand.</Text>
        )}
      </View>
      {best && !book.sentAt ? (
        <View style={{ gap: 6, alignItems: 'flex-end' }}>
          <TorboxButton
            name={best.name}
            getMagnet={best.magnet}
            onSent={async (torboxId) => {
              await markSent(book.id, best.name, torboxId);
              onChanged();
            }}
          />
          {/* Sends it to TorBox and saves it to the phone when ready (it marks the book itself). */}
          <PhoneButton name={best.name} getMagnet={best.magnet} book={book} onSent={onChanged} />
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  linkText: { color: Colors.accent, fontWeight: '700', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
}));
