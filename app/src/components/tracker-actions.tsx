import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePrefs } from '@/lib/prefs';
import {
  addToTrackerList,
  createTrackerList,
  getTrackerLists,
  getTrackerProgress,
  kindFor,
  rateInTracker,
  setTrackerWatchlist,
  trackerSignedIn,
  type TrackerItem,
  type TrackerList,
} from '@/lib/tracker';
import { Pressable } from '@/components/focusable';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * 128bit Tracker buttons for a movie or show: Watchlist, Add to list, Rate.
 * Saved to the signed-in account's own Tracker library.
 */
export function TrackerActions({ type, imdb, title, year, poster }: { type: string; imdb: string; title: string; year?: number; poster?: string }) {
  const Colors = useColors();
  const styles = useStyles();
  const { prefs } = usePrefs();
  const [on, setOn] = useState(false);
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'lists' | 'rate' | null>(null);
  const [lists, setLists] = useState<TrackerList[] | null>(null);
  const [newName, setNewName] = useState('');
  const kind = kindFor(type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'series');
  const itemType = kind === 'movie' ? 'movie' : kind;
  const ref = { type: itemType, title, year, poster, imdb };

  const load = useCallback(async () => {
    const signedIn = await trackerSignedIn();
    if (!signedIn || !/^tt\d+$/.test(imdb)) return setOn(false);
    try {
      setItems(await getTrackerProgress(imdb));
      setOn(true);
    } catch {
      setOn(false); // Tracker not set up on this account server
    }
  }, [imdb]);
  useEffect(() => {
    (async () => load())();
  }, [load]);

  if (!on || !prefs.trackerRows) return null;
  const whole = items.find((i) => i.season == null) ?? items[0];
  const planned = !!whole && whole.status === 'planned';
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
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
      {whole && whole.status !== 'planned' ? (
        <Text style={styles.muted}>
          {whole.status === 'done' ? 'Finished' : whole.status === 'active' ? 'In progress' : whole.status}
          {whole.season ? ` · season ${whole.season}` : ''}
          {whole.progress_total ? ` · ${whole.progress}/${whole.progress_total}` : ''}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' }}>
        {button(planned ? 'bookmark' : 'bookmark-outline', 'Watchlist', () => run(() => setTrackerWatchlist(ref, !planned)), planned)}
        {button('list', 'Lists', async () => {
          setModal('lists');
          setLists(null);
          setLists(await getTrackerLists(kind).catch(() => []));
        })}
        {whole ? button(whole.rating ? 'star' : 'star-outline', whole.rating ? `${whole.rating}/10` : 'Rate', () => setModal('rate'), !!whole.rating) : null}
        {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      </View>

      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            {modal === 'rate' && whole ? (
              <>
                <Text style={styles.heading}>Rate {title}</Text>
                <View style={styles.grid}>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                    <Pressable key={n} style={[styles.num, whole.rating === n && styles.buttonOn]} onPress={() => { setModal(null); run(() => rateInTracker(whole.id, n)); }}>
                      <Text style={[styles.numText, whole.rating === n && { color: Colors.accentText }]}>{n}</Text>
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
                    <Pressable key={l.id} style={styles.listRow} onPress={() => { setModal(null); run(() => addToTrackerList(l.id, ref)); }}>
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
                    run(async () => addToTrackerList((await createTrackerList(name, kind)).id, ref));
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
