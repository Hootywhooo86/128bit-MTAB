import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { isConnected, traktConfigured } from '@/lib/trakt';
import {
  checkIn,
  createList,
  getListItems,
  getLists,
  rate,
  searchTrakt,
  setTraktLink,
  setCollected,
  setFavorite,
  setInList,
  setWatched,
  setWatchlist,
  titleState,
  type Kind,
  type TraktList,
} from '@/lib/trakt-library';
import { Pressable } from '@/components/focusable';

type State = Awaited<ReturnType<typeof titleState>>;
type IconName = ComponentProps<typeof Ionicons>['name'];

/** True when Trakt is set up and signed in. */
export function useTraktConnected() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    (async () => setOn((await traktConfigured()) && (await isConnected())))();
  }, []);
  return on;
}

/** No Trakt match for this anime (or other non-IMDb title) yet: search and pick it once. */
export function LinkToTrakt({
  id,
  name,
  kind,
  onLinked,
}: {
  id: string;
  name: string;
  kind: Kind;
  onLinked: (imdb: string) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(name);
  const [hits, setHits] = useState<Awaited<ReturnType<typeof searchTrakt>> | null>(null);
  const search = (q: string) => searchTrakt(kind, q).then((h) => setHits(h.filter((x) => x.imdb)), () => setHits([]));
  return (
    <View style={styles.wrap}>
      <Button
        label="Link to Trakt"
        variant="secondary"
        onPress={() => {
          setOpen(true);
          search(query);
        }}
      />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.heading}>Which one is it on Trakt?</Text>
            <Input value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => search(query)} />
            {!hits ? <ActivityIndicator /> : null}
            <ScrollView style={{ maxHeight: 360 }}>
              {hits?.map((h) => (
                <Pressable
                  key={h.imdb}
                  style={styles.listRow}
                  onPress={async () => {
                    await setTraktLink(id, h.imdb!);
                    setOpen(false);
                    onLinked(h.imdb!);
                  }}>
                  <Text style={styles.listName}>
                    {h.title}
                    {h.year ? ` (${h.year})` : ''}
                  </Text>
                </Pressable>
              ))}
              {hits && !hits.length ? <Text style={styles.listName}>Nothing found. Try other words.</Text> : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Trakt buttons for a movie or show: watchlist, watched, collection, favorite, rating, lists, check-in. */
export function TraktActions({ type, imdb }: { type: string; imdb: string }) {
  const Colors = useColors();
  const styles = useStyles();
  const connected = useTraktConnected();
  const kind: Kind = type === 'movie' ? 'movie' : 'show';
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rating, setRating] = useState(false);
  const [lists, setLists] = useState(false);

  const load = useCallback(() => {
    titleState(kind, imdb).then(setState, (e) => setError(e.message));
  }, [kind, imdb]);

  useEffect(() => {
    if (connected && /^tt\d+$/.test(imdb)) load();
  }, [connected, imdb, load]);

  if (!connected || !/^tt\d+$/.test(imdb)) return null;

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const buttons: { id: string; icon: IconName; on: boolean; label: string; press: () => void }[] = state
    ? [
        {
          id: 'watchlist',
          icon: state.watchlist ? 'bookmark' : 'bookmark-outline',
          on: state.watchlist,
          label: 'Watchlist',
          press: () => run('watchlist', () => setWatchlist(kind, imdb, !state.watchlist)),
        },
        {
          id: 'watched',
          icon: state.watched ? 'checkmark-circle' : 'checkmark-circle-outline',
          on: state.watched,
          label: kind === 'movie' ? 'Watched' : 'Mark all',
          press: () =>
            run(
              'watched',
              () => setWatched(kind, imdb, kind === 'show' ? true : !state.watched),
              kind === 'show' ? 'Every aired episode marked watched on Trakt' : undefined,
            ),
        },
        {
          id: 'collected',
          icon: state.collected ? 'albums' : 'albums-outline',
          on: state.collected,
          label: 'Collection',
          press: () => run('collected', () => setCollected(kind, imdb, !state.collected)),
        },
        {
          id: 'favorite',
          icon: state.favorite ? 'heart' : 'heart-outline',
          on: state.favorite,
          label: 'Favorite',
          press: () => run('favorite', () => setFavorite(kind, imdb, !state.favorite)),
        },
        {
          id: 'rating',
          icon: state.rating ? 'star' : 'star-outline',
          on: !!state.rating,
          label: state.rating ? `${state.rating}/10` : 'Rate',
          press: () => setRating(true),
        },
        {
          id: 'lists',
          icon: 'list',
          on: false,
          label: 'Lists',
          press: () => setLists(true),
        },
        ...(kind === 'movie'
          ? [
              {
                id: 'checkin',
                icon: 'radio-button-on' as IconName,
                on: false,
                label: 'Check in',
                press: () => run('checkin', () => checkIn('movie', imdb), 'Checked in on Trakt'),
              },
            ]
          : []),
      ]
    : [];

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Trakt</Text>
      {!state ? (
        <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start' }} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
          {buttons.map((b) => (
            <Pressable key={b.id} onPress={b.press} style={[styles.button, b.on && styles.buttonOn]} disabled={!!busy}>
              {busy === b.id ? (
                <ActivityIndicator size="small" color={b.on ? Colors.accentText : Colors.accent} />
              ) : (
                <Ionicons name={b.icon} size={20} color={b.on ? Colors.accentText : Colors.text} />
              )}
              <Text style={[styles.buttonText, b.on && { color: Colors.accentText }]}>{b.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {note ? <Text style={{ color: Colors.success, fontSize: 13 }}>{note}</Text> : null}
      {error ? <Text style={{ color: Colors.danger, fontSize: 13 }}>{error}</Text> : null}

      <RatingModal
        visible={rating}
        current={state?.rating ?? 0}
        onClose={() => setRating(false)}
        onPick={(n) => {
          setRating(false);
          run('rating', () => rate(kind, imdb, n));
        }}
      />
      <ListsModal visible={lists} kind={kind} imdb={imdb} onClose={() => setLists(false)} />
    </View>
  );
}

function RatingModal({
  visible,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: number;
  onClose: () => void;
  onPick: (n: number) => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.modal}>
          <Text style={styles.heading}>Your rating</Text>
          <View style={styles.grid}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <Pressable key={n} onPress={() => onPick(n)} style={[styles.num, n === current && styles.buttonOn]}>
                <Text style={[styles.numText, n === current && { color: Colors.accentText }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          {current ? <Button label="Remove rating" variant="secondary" onPress={() => onPick(0)} /> : null}
        </View>
      </Pressable>
    </Modal>
  );
}

function ListsModal({
  visible,
  kind,
  imdb,
  onClose,
}: {
  visible: boolean;
  kind: Kind;
  imdb: string;
  onClose: () => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [lists, setLists] = useState<(TraktList & { has: boolean })[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<number | 'new' | null>(null);

  const fetchLists = useCallback(async () => {
    const all = await getLists();
    return Promise.all(
      all.map(async (l) => ({ ...l, has: (await getListItems(l.id).catch(() => [])).some((i) => i.imdb === imdb) })),
    );
  }, [imdb]);
  const load = async () => setLists(await fetchLists());

  useEffect(() => {
    if (visible) fetchLists().then(setLists, () => setLists([]));
  }, [visible, fetchLists]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.heading}>Your Trakt lists</Text>
          {!lists ? <ActivityIndicator color={Colors.accent} /> : null}
          {lists?.length === 0 ? <Text style={styles.muted}>No lists yet. Make one below.</Text> : null}
          <ScrollView style={{ maxHeight: 320 }}>
            {lists?.map((l) => (
              <Pressable
                key={l.id}
                style={styles.listRow}
                onPress={async () => {
                  setBusy(l.id);
                  await setInList(l.id, kind, imdb, !l.has).catch(() => {});
                  await load();
                  setBusy(null);
                }}>
                {busy === l.id ? (
                  <ActivityIndicator size="small" color={Colors.accent} />
                ) : (
                  <Ionicons name={l.has ? 'checkbox' : 'square-outline'} size={22} color={l.has ? Colors.accent : Colors.text} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.listName}>{l.name}</Text>
                  <Text style={styles.muted}>
                    {l.itemCount} items · {l.privacy}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <Input placeholder="New list name" value={name} onChangeText={setName} />
          <Button
            label="Create list"
            variant="secondary"
            disabled={!name.trim()}
            loading={busy === 'new'}
            onPress={async () => {
              setBusy('new');
              await createList(name.trim()).catch(() => {});
              setName('');
              await load();
              setBusy(null);
            }}
          />
          <Button label="Done" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((Colors) => ({
  wrap: { gap: Spacing.two },
  heading: { color: Colors.text, fontSize: 17, fontWeight: '800' },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  button: {
    alignItems: 'center',
    gap: 4,
    minWidth: 72,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  buttonOn: { backgroundColor: Colors.accent },
  buttonText: { color: Colors.text, fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.four },
  modal: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.four, gap: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  num: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
  },
  numText: { color: Colors.text, fontSize: 17, fontWeight: '800' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  listName: { color: Colors.text, fontWeight: '600', fontSize: 15 },
}));
