import { useEffect, useState } from 'react';

import { Group, SectionTitle, ToggleRow } from '@/components/settings-ui';
import { useTraktConnected } from '@/components/trakt-actions';
import { usePrefs } from '@/lib/prefs';
import { TRAKT_ROWS, getLists, type TraktList } from '@/lib/trakt-library';

/** Settings → Tracking: which Trakt rows show on the Shows and Movies tabs (in the order picked). */
export function TraktRowPicker() {
  const connected = useTraktConnected();
  const { prefs, setPref } = usePrefs();
  const [lists, setLists] = useState<TraktList[]>([]);
  useEffect(() => {
    if (connected) getLists().then(setLists, () => {});
  }, [connected]);
  if (!connected) return null;

  const toggle = (id: string, on: boolean) =>
    setPref('traktRows', on ? [...prefs.traktRows.filter((r) => r !== id), id] : prefs.traktRows.filter((r) => r !== id));
  const where = (shows: boolean, movies: boolean) => (shows && movies ? 'Shows & Movies' : shows ? 'Shows' : 'Movies');

  return (
    <>
      <SectionTitle>Trakt rows on Shows & Movies</SectionTitle>
      <Group>
        {TRAKT_ROWS.map((r) => (
          <ToggleRow
            key={r.id}
            title={r.name}
            subtitle={where(r.shows, r.movies)}
            value={prefs.traktRows.includes(r.id)}
            onChange={(v) => toggle(r.id, v)}
          />
        ))}
        {lists.map((l) => (
          <ToggleRow
            key={l.id}
            title={l.name}
            subtitle={`Your list · ${l.itemCount} items`}
            value={prefs.traktRows.includes(`list:${l.id}`)}
            onChange={(v) => toggle(`list:${l.id}`, v)}
          />
        ))}
      </Group>
    </>
  );
}
