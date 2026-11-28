import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { searchFreeBooks } from '@/lib/archive-books';
import { searchAbb } from '@/lib/abb';
import { getSources, searchCatalog, searchSource } from '@/lib/sources';
import { listTorrents } from '@/lib/torbox';

type Check = { name: string; ok?: boolean; note?: string };

/** A well-known book every source should have. */
const PROBE = 'Harry Potter';

/** Asks every book source (and TorBox) one quick question, from this phone, and shows who answered. */
export function SourceCheck() {
  const Colors = useColors();
  const styles = useStyles();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const sources = (await getSources()).filter((s) => s.enabled !== false);
    const tests: { name: string; test: () => Promise<number> }[] = [
      { name: 'AudiobookBay', test: async () => (await searchAbb(PROBE)).results.length },
      { name: 'LibriVox / Internet Archive', test: async () => (await searchFreeBooks('Pride and Prejudice')).length },
      { name: 'TorBox', test: async () => (await listTorrents()).length + 1 },
      ...sources.map((s) => ({
        name: s.config.name,
        test: async () =>
          s.config.search ? (await searchCatalog(s.config, PROBE)).length : (await searchSource(s.config, { title: PROBE })).length,
      })),
    ];
    setChecks(tests.map((t) => ({ name: t.name })));
    await Promise.all(
      tests.map(async (t, i) => {
        const started = Date.now();
        let result: Check;
        try {
          const n = await t.test();
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          result = n > 0 ? { name: t.name, ok: true, note: `${secs}s` } : { name: t.name, ok: false, note: 'Answered, but found nothing' };
        } catch (e) {
          result = { name: t.name, ok: false, note: e instanceof Error ? e.message : String(e) };
        }
        setChecks((cur) => cur && cur.map((c, j) => (j === i ? result : c)));
      }),
    );
    setBusy(false);
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Button label="Check connections" loading={busy} onPress={run} disabled={busy} />
      {checks?.map((c) => (
        <View key={c.name} style={styles.row}>
          <Text style={[styles.mark, { color: c.ok === undefined ? Colors.textSecondary : c.ok ? Colors.success : Colors.danger }]}>
            {c.ok === undefined ? '…' : c.ok ? '✓' : '✗'}
          </Text>
          <Text style={styles.name} numberOfLines={1}>
            {c.name}
          </Text>
          {c.note ? (
            <Text style={styles.note} numberOfLines={2}>
              {c.note}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mark: { width: 18, fontSize: 16, fontWeight: '800' },
  name: { color: Colors.text, fontSize: 14, fontWeight: '600', flexShrink: 0, maxWidth: '50%' },
  note: { color: Colors.textSecondary, fontSize: 12, flex: 1, textAlign: 'right' },
}));
