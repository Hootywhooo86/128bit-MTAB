import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';

import { PixelBlock, PixelPlus } from '@/components/pixel-art';
import { PixelCheck } from '@/components/pixel-check';
import { Button, Input } from '@/components/ui';
import { PixelFont, Spacing, Radius, makeStyles, useColors } from '@/constants/theme';
import {
  addToTrackerList,
  createTrackerList,
  findInTracker,
  getAllTrackerLists,
  getTrackerItemLists,
  getTrackerListItems,
  rateInTracker,
  removeFromTrackerList,
  trackerSignedIn,
  type TrackerItem,
  type TrackerKind,
  type TrackerList,
  type TrackerRef,
} from '@/lib/tracker';
import { Pressable } from '@/components/focusable';
import { withAnimeType } from '@/components/tracker-actions';

const STATUS: Record<string, string> = { planned: 'In your Tracker', active: 'In progress', done: 'Finished', on_hold: 'On hold', dropped: 'Dropped' };

/**
 * The title page's pixel "+" button: opens a sheet to put this title on (or take it off)
 * any of your 128bit Tracker lists, and rate it 1–10. Being on a list is what puts it in
 * your Tracker. Filled with the accent colour once it's in your Tracker.
 */
export function TrackerPlus({ item: given, size }: { item: TrackerRef; size: number }) {
  const Colors = useColors();
  const styles = useStyles();
  // A show from the Anime tab (or with an anime id) goes to Tracker as an anime.
  const [item, setItem] = useState(given);
  const givenKey = JSON.stringify(given);
  useEffect(() => {
    let cancelled = false;
    setItem(given);
    withAnimeType(given).then((i) => !cancelled && setItem(i), () => {});
    return () => {
      cancelled = true;
    };
    // given is described by givenKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [givenKey]);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'unavailable'>('loading');
  const [found, setFound] = useState<TrackerItem | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lists, setLists] = useState<TrackerList[] | null>(null);
  // Ids of the lists this title is on (null while looking).
  const [onLists, setOnLists] = useState<Set<string> | null>(null);
  const [newName, setNewName] = useState('');
  const key = `${item.type}|${item.title}|${JSON.stringify(item.ids ?? {})}`;
  const kind: TrackerKind = item.type;

  const load = useCallback(async () => {
    const signedIn = await trackerSignedIn();
    if (!signedIn) {
      setState('signed-out');
      return null;
    }
    try {
      const f = await findInTracker(item);
      setFound(f);
      setState('ready');
      return f;
    } catch {
      setState('unavailable'); // Tracker not set up on this account server yet
      return null;
    }
    // item is described by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    (async () => load())();
  }, [load]);

  function openSheet() {
    setOpen(true);
    setError(null);
    setLists(null);
    setOnLists(null);
  }
  // The lists, once the sheet is open and Tracker answered.
  useEffect(() => {
    if (!open || state !== 'ready') return;
    let cancelled = false;
    (async () => {
      // Every list you've made, whatever its kind or tab: this title's kind first.
      const all = await getAllTrackerLists().catch(() => [] as TrackerList[]);
      const rank = (l: TrackerList) => (l.kind === kind ? 0 : l.kind === 'mixed' ? 1 : 2);
      if (cancelled) return;
      setLists([...all].sort((a, b) => rank(a) - rank(b)));
      // Which of them it's on: only worth asking once it's in your Tracker at all.
      if (!found) return setOnLists(new Set());
      const direct = await getTrackerItemLists(found.id);
      if (direct) {
        if (!cancelled) setOnLists(new Set(direct));
        return;
      }
      // Older account server: look through each list.
      const hits = await Promise.all(
        all.map((l) =>
          getTrackerListItems(l.id).then(
            (items) => (items.some((x) => x.id === found.id) ? l.id : null),
            () => null,
          ),
        ),
      );
      if (!cancelled) setOnLists(new Set(hits.filter((x): x is string => !!x)));
    })();
    return () => {
      cancelled = true;
    };
    // Once per opening: adding from the sheet updates these itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Tap a list: on it → take it off; not on it → add it (which adds it to your Tracker).
  const toggleList = (l: TrackerList) =>
    run(async () => {
      const on = onLists?.has(l.id);
      if (on && found) await removeFromTrackerList(l.id, found.id);
      else await addToTrackerList(l.id, item);
      setOnLists((cur) => {
        const next = new Set(cur);
        if (on) next.delete(l.id);
        else next.add(l.id);
        return next;
      });
      setLists((cur) => cur?.map((x) => (x.id === l.id ? { ...x, item_count: x.item_count + (on ? -1 : 1) } : x)) ?? null);
      if (!on && !found) await load();
    });

  const inTracker = state === 'ready' && !!found;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add to a Tracker list or rate"
        onPress={openSheet}
        style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <PixelBlock color={inTracker ? Colors.accent : Colors.surfaceRaised} style={{ width: size, height: size }}>
          <PixelPlus size={Math.round(size * 0.38)} color={inTracker ? Colors.accentText : Colors.text} />
        </PixelBlock>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.heading} numberOfLines={2}>
              {item.title}
            </Text>
            {state === 'loading' ? <ActivityIndicator color={Colors.accent} /> : null}
            {state === 'unavailable' ? <Text style={styles.muted}>128bit Tracker isn’t available on this account yet.</Text> : null}
            {state === 'signed-out' ? (
              <>
                <Text style={styles.muted}>Sign in to put this on your 128bit Tracker lists and rate it.</Text>
                <Button
                  label="Sign in (Settings → Account)"
                  onPress={() => {
                    setOpen(false);
                    router.push('/settings/account');
                  }}
                />
              </>
            ) : null}
            {state === 'ready' ? (
              <>
                {found ? (
                  <Text style={styles.muted}>
                    {STATUS[found.status] ?? found.status}
                    {found.progress_total ? ` · ${found.progress}/${found.progress_total}` : ''}
                  </Text>
                ) : null}
                {error ? <Text style={[styles.muted, { color: Colors.danger }]}>{error}</Text> : null}

                <Text style={styles.label}>LISTS</Text>
                {lists === null || (found && onLists === null) ? <ActivityIndicator color={Colors.accent} /> : null}
                <ScrollView style={{ maxHeight: 260 }}>
                  {(lists ?? []).map((l) => {
                    const on = !!onLists?.has(l.id);
                    return (
                      <Pressable key={l.id} style={styles.listRow} disabled={busy || onLists === null} onPress={() => toggleList(l)}>
                        {on ? <PixelCheck /> : <View style={styles.box} />}
                        <Text style={styles.listName}>{l.name}</Text>
                        <Text style={styles.muted}>{l.item_count}</Text>
                      </Pressable>
                    );
                  })}
                  {lists && !lists.length ? <Text style={styles.muted}>No lists yet. Make one:</Text> : null}
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Input placeholder="New list name" value={newName} onChangeText={setNewName} />
                  </View>
                  <Button
                    label="Create"
                    disabled={busy}
                    onPress={() => {
                      const name = newName.trim();
                      if (!name) return;
                      setNewName('');
                      run(async () => {
                        const { id } = await createTrackerList(name, kind);
                        await addToTrackerList(id, item);
                        setLists((cur) => [{ id, name, kind, item_count: 1, show_in_play: true }, ...(cur ?? [])]);
                        setOnLists((cur) => new Set(cur).add(id));
                        if (!found) await load();
                      });
                    }}
                  />
                </View>

                <Text style={styles.label}>RATE</Text>
                {found ? (
                  <View style={styles.grid}>
                    {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => {
                      const on = found.rating === n;
                      return (
                        <Pressable
                          key={n}
                          disabled={busy}
                          style={[styles.num, on && { backgroundColor: Colors.accent }]}
                          // Tap your rating again to clear it.
                          onPress={() => run(async () => { await rateInTracker(found.id, on ? null : n); await load(); })}>
                          <Text style={[styles.numText, on && { color: Colors.accentText }]}>{n}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.muted}>Put it on a list first, then rate it.</Text>
                )}
                {busy ? <ActivityIndicator color={Colors.accent} /> : null}
              </>
            ) : null}
            <Button label="Done" variant="secondary" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((Colors) => ({
  heading: { color: Colors.text, fontSize: 17, fontWeight: '800' },
  label: { color: Colors.accent, fontFamily: PixelFont, fontSize: 10 },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.four },
  modal: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.four, gap: Spacing.three, maxWidth: 520, width: '100%', alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  // Square "pixel" number keys.
  num: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceRaised },
  numText: { color: Colors.text, fontFamily: PixelFont, fontSize: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  box: { width: 22, height: 22, borderWidth: 2, borderColor: Colors.textSecondary },
  listName: { color: Colors.text, fontWeight: '600', fontSize: 15, flex: 1 },
}));
