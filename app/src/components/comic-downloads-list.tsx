import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ComicTile } from '@/components/comic-tile';
import { formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { getAllComicProgress } from '@/lib/comics';
import {
  comicDownloadsSupported,
  deleteReadChapters,
  deleteSeries,
  getComicDownloads,
  onComicDownloads,
  type LocalSeries,
} from '@/lib/comic-downloads';

/** Settings → Downloads → Comics: series saved or imported on the phone. */
export function ComicDownloadsList() {
  const Colors = useColors();
  const styles = useStyles();
  const [list, setList] = useState<LocalSeries[]>([]);
  const [freed, setFreed] = useState<string | null>(null);

  async function deleteRead() {
    const before = list.flatMap((s) => s.chapters).reduce((n, c) => n + (c.bytes ?? 0), 0);
    const progress = await getAllComicProgress();
    const removed = await deleteReadChapters((id) => progress[id]?.read ?? []);
    const after = (await getComicDownloads()).flatMap((s) => s.chapters).reduce((n, c) => n + (c.bytes ?? 0), 0);
    setFreed(removed ? `Deleted ${removed} read chapter${removed === 1 ? '' : 's'} · freed ${formatBytes(before - after) || '0 B'}` : 'No read chapters on the phone.');
  }
  useEffect(() => {
    getComicDownloads().then((l) => setList([...l]));
    return onComicDownloads((l) => setList([...l]));
  }, []);

  if (!comicDownloadsSupported) return <Text style={styles.hint}>Downloads work in the phone app.</Text>;
  if (!list.length) {
    return (
      <Text style={styles.hint}>
        Nothing yet. On a comic, tap “Download unread chapters to phone” or hold a chapter; or import
        CBZ files from the Comics tab.
      </Text>
    );
  }
  const total = list.flatMap((s) => s.chapters).reduce((n, c) => n + (c.bytes ?? 0), 0);
  return (
    <View style={{ gap: Spacing.two, marginTop: Spacing.three }}>
      <Pressable style={styles.freeButton} onPress={deleteRead}>
        <Text style={styles.freeText}>Delete read chapters · {formatBytes(total) || '0 B'} used</Text>
      </Pressable>
      {freed ? <Text style={styles.meta}>{freed}</Text> : null}
      <Text style={styles.meta}>
        Turn on “Delete chapters after reading” in Settings → Comics to do this automatically.
      </Text>
      {list.map((s) => {
        const done = s.chapters.filter((c) => c.state === 'done');
        const bytes = done.reduce((n, c) => n + (c.bytes ?? 0), 0);
        const busy = s.chapters.filter((c) => c.state === 'downloading').length;
        return (
          <View key={s.comic.id} style={styles.row}>
            <ComicTile comic={s.comic} width={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.title} numberOfLines={2} onPress={() => router.push({ pathname: '/comics/[id]', params: { id: s.comic.id } })}>
                {s.comic.title}
              </Text>
              <Text style={styles.meta}>
                {done.length} chapters · {formatBytes(bytes) || '0 B'}
                {busy ? ` · downloading ${busy}` : ''}
                {s.comic.id.startsWith('local:') ? ' · imported' : ''}
              </Text>
            </View>
            <Pressable onPress={() => deleteSeries(s.comic.id)} hitSlop={8}>
              <Text style={{ color: Colors.danger, fontWeight: '700' }}>Delete</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  hint: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, borderRadius: Radius.md, backgroundColor: Colors.surface },
  title: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  freeButton: { borderWidth: 2, borderColor: Colors.danger, padding: Spacing.three, alignItems: 'center' },
  freeText: { color: Colors.danger, fontWeight: '700' },
}));
