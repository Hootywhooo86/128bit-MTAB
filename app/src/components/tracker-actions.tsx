import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  addToTrackerList,
  createTrackerList,
  findInTracker,
  getAllTrackerLists,
  rateInTracker,
  setTrackerWatchlist,
  trackerSignedIn,
  type TrackerItem,
  type TrackerKind,
  type TrackerList,
  type TrackerRef,
} from '@/lib/tracker';
import { isAnime } from '@/lib/video';
import { Pressable } from '@/components/focusable';

type IconName = ComponentProps<typeof Ionicons>['name'];

const STATUS: Record<string, string> = { planned: 'In your Tracker', active: 'In progress', done: 'Finished', on_hold: 'On hold', dropped: 'Dropped' };

/** Prefixes addons put on title ids (AIOMetadata, Kitsu, MAL…) → Tracker's id keys. */
const ID_KEYS: Record<string, string> = {
  kitsu: 'kitsu', tmdb: 'tmdb', tvdb: 'tvdb', mal: 'mal', myanimelist: 'mal', anilist: 'anilist', al: 'anilist',
  anidb: 'anidb', trakt: 'trakt', tvmaze: 'tvmaze', simkl: 'simkl',
};

/**
 * A Play title id → the ids Tracker matches on: "tt123" → {imdb}, "kitsu:1" → {kitsu: 1},
 * "tmdb:2" (or "tmdb:tv:2") → {tmdb: 2}, "mal:3" → {mal: 3}, "anilist:4" → {anilist: 4}…
 * Numbers stay numbers (Tracker compares them exactly). Anything else: {} (Tracker then
 * goes by title + year).
 */
export function idsFor(id?: string | null): Record<string, string | number> {
  if (!id) return {};
  const imdb = id.match(/^(?:imdb[:_])?(tt\d+)(?::|$)/i);
  if (imdb) return { imdb: imdb[1].toLowerCase() };
  const m = id.match(/^([a-z]+)[:_](?:(?:tv|movie|series|show|anime)[:_])?(\d+)(?::|$)/i);
  const key = m && ID_KEYS[m[1].toLowerCase()];
  return key ? { [key]: Number(m[2]) } : {};
}

/**
 * A show you opened from the Anime tab (or with an anime id: Kitsu, MAL, AniList…) goes
 * to Tracker as an anime, even when its page came from a general addon (Cinemeta etc.).
 */
export async function withAnimeType(item: TrackerRef): Promise<TrackerRef> {
  if (item.type !== 'show') return item;
  const playIds = Object.entries(item.ids ?? {}).map(([k, v]) => (k === 'imdb' ? String(v) : `${k}:${v}`));
  const anime = await Promise.all(playIds.map((id) => isAnime({ type: 'series', id }).catch(() => false)));
  return anime.some(Boolean) ? { ...item, type: 'anime' } : item;
}

/**
 * Add to 128bit Tracker, for anything in Play: movies, shows, anime, books,
 * comics. Add (or take off), put it on your lists, rate it. Saved to the
 * signed-in account's own Tracker.
 */
export function TrackerActions({ item: given }: { item: TrackerRef }) {
  const Colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'unavailable'>('loading');
  const [found, setFound] = useState<TrackerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'lists' | 'rate' | null>(null);
  const [lists, setLists] = useState<TrackerList[] | null>(null);
  const [newName, setNewName] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // What Tracker is sent: the title as given, as an anime when it is one.
  const [item, setItem] = useState<TrackerRef>(given);
  const key = `${given.type}|${given.title}|${given.year ?? ''}|${JSON.stringify(given.ids ?? {})}`;

  const load = useCallback(async () => {
    const signedIn = await trackerSignedIn();
    if (!signedIn) return setState('signed-out');
    try {
      const ref = await withAnimeType(given);
      setItem(ref);
      setFound(await findInTracker(ref));
      setState('ready');
    } catch {
      setState('unavailable'); // Tracker not set up on this account server yet
    }
    // given is described by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    (async () => load())();
  }, [load]);

  if (state === 'loading' || state === 'unavailable' || !item.title) return null;
  if (state === 'signed-out') {
    return (
      <Pressable onPress={() => router.push('/settings/account')} style={styles.hint}>
        <Ionicons name="add-circle-outline" size={18} color={Colors.textSecondary} />
        <Text style={styles.muted}>Sign in (Settings → Account) to add this to 128bit Tracker</Text>
      </Pressable>
    );
  }

  const inTracker = !!found;
  const kind: TrackerKind = item.type;
  const run = async (fn: () => Promise<unknown>, note?: string) => {
    setBusy(true);
    setFailed(null);
    try {
      await fn();
      await load();
      if (note) setAdded(note);
    } catch (e) {
      setAdded(null);
      setFailed(`Couldn’t save to Tracker: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const button = (icon: IconName, label: string, onPress: () => void, active = false) => (
    <Pressable key={label} onPress={onPress} style={[styles.button, active && styles.buttonOn]} disabled={busy}>
      <Ionicons name={icon} size={20} color={active ? Colors.accentText : Colors.text} />
      <Text style={[styles.buttonText, active && { color: Colors.accentText }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>128bit Tracker</Text>
      {found ? (
        <Text style={styles.muted}>
          {STATUS[found.status] ?? found.status}
          {found.progress_total ? ` · ${found.progress}/${found.progress_total}` : ''}
        </Text>
      ) : null}
      {added ? <Text style={[styles.muted, { color: Colors.accent }]}>{added}</Text> : null}
      {failed ? <Text style={[styles.muted, { color: Colors.danger }]}>{failed}</Text> : null}
      <View style={{ flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' }}>
        {inTracker && found?.status !== 'planned'
          ? button('checkmark-circle', 'In Tracker', () => {}, true)
          : button(inTracker ? 'checkmark-circle' : 'add-circle-outline', inTracker ? 'In Tracker' : 'Add to Tracker',
              () => run(() => setTrackerWatchlist(item, !inTracker), inTracker ? 'Taken off your Tracker' : 'Added to your Tracker'), inTracker)}
        {button('list', 'Lists', async () => {
          setModal('lists');
          setLists(null);
          // Every list you've made, whatever its kind or tab: this title's kind first.
          const all = await getAllTrackerLists().catch(() => [] as TrackerList[]);
          const rank = (l: TrackerList) => (l.kind === kind ? 0 : l.kind === 'mixed' ? 1 : 2);
          setLists([...all].sort((a, b) => rank(a) - rank(b)));
        })}
        {found ? button(found.rating ? 'star' : 'star-outline', found.rating ? `${found.rating}/10` : 'Rate', () => setModal('rate'), !!found.rating) : null}
        {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      </View>

      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            {modal === 'rate' && found ? (
              <>
                <Text style={styles.heading}>Rate {item.title}</Text>
                <View style={styles.grid}>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                    <Pressable key={n} style={[styles.num, found.rating === n && styles.buttonOn]} onPress={() => { setModal(null); run(() => rateInTracker(found.id, n)); }}>
                      <Text style={[styles.numText, found.rating === n && { color: Colors.accentText }]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            {modal === 'lists' ? (
              <>
                <Text style={styles.heading}>Add to a Tracker list</Text>
                {lists === null ? <ActivityIndicator color={Colors.accent} /> : null}
                <ScrollView style={{ maxHeight: 320 }}>
                  {(lists ?? []).map((l) => (
                    <Pressable key={l.id} style={styles.listRow} onPress={() => { setModal(null); run(() => addToTrackerList(l.id, item), `Added to ${l.name}`); }}>
                      <Ionicons name="add-circle-outline" size={22} color={Colors.accent} />
                      <Text style={styles.listName}>{l.name}</Text>
                      <Text style={styles.muted}>{l.item_count}</Text>
                    </Pressable>
                  ))}
                  {lists && !lists.length ? <Text style={styles.muted}>No lists yet. Make one:</Text> : null}
                </ScrollView>
                <Input placeholder="New list name" value={newName} onChangeText={setNewName} />
                <Button
                  label="Create and add"
                  onPress={() => {
                    const name = newName.trim();
                    if (!name) return;
                    setModal(null);
                    setNewName('');
                    run(async () => addToTrackerList((await createTrackerList(name, kind)).id, item), `Added to ${name}`);
                  }}
                />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  wrap: { gap: Spacing.two },
  heading: { color: Colors.text, fontSize: 17, fontWeight: '800' },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
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
  num: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceRaised },
  numText: { color: Colors.text, fontSize: 17, fontWeight: '800' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  listName: { color: Colors.text, fontWeight: '600', fontSize: 15, flex: 1 },
}));
