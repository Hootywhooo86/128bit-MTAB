import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Switch, Text, View } from 'react-native';

import { Body, formatBytes } from '@/components/ui';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  cancelComic,
  checkFollows,
  dismissNewIssue,
  getComicWanted,
  getFollows,
  grabComic,
  onComicWanted,
  onFollows,
  removeComicWanted,
  retryComic,
  runComicQueue,
  setFollowAuto,
  unfollowSeries,
  type ComicFollow,
  type WantedComic,
} from '@/lib/comic-grab';
import { Pressable } from '@/components/focusable';

const STATE_LABEL: Record<WantedComic['state'], string> = {
  queued: 'Waiting…',
  torbox: 'In TorBox',
  downloading: 'Downloading to phone',
  done: 'On this phone ▶ read',
  error: 'Failed',
};

const active = (w: WantedComic) => w.state === 'queued' || w.state === 'torbox' || w.state === 'downloading';

/** "123 MB of 565 MB · 4.2 MB/s" (or the TorBox percentage before it reaches the phone). */
function detail(w: WantedComic) {
  if (w.state === 'downloading' && w.bytes) {
    return [
      w.total ? `${formatBytes(w.bytes)} of ${formatBytes(w.total)}` : formatBytes(w.bytes),
      w.speed && w.phase !== 'Unpacking' ? `${formatBytes(w.speed)}/s` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return w.progress ? `${Math.round(w.progress * 100)}%` : '';
}

/** ✕: stop it and delete what came down. Big ones (or ones in TorBox) ask first. */
function askCancel(w: WantedComic) {
  const big = (w.total ?? w.release.size ?? 0) > 100 * 1024 * 1024;
  if (!big && !w.torboxId) {
    cancelComic(w.id);
    return;
  }
  const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
    { text: 'Keep going', style: 'cancel' },
    { text: 'Cancel download', style: 'destructive', onPress: () => cancelComic(w.id) },
  ];
  if (w.torboxId) {
    buttons.push({ text: 'Cancel + delete from TorBox', style: 'destructive', onPress: () => cancelComic(w.id, true) });
  }
  Alert.alert('Cancel this download?', `${w.title}\n\nWhat has downloaded so far will be deleted.`, buttons);
}

/** Comics you grabbed (and where they are), plus followed series and their new issues. */
export function ComicWanted() {
  const Colors = useColors();
  const styles = useStyles();
  const [wanted, setWanted] = useState<WantedComic[] | null>(null);
  const [follows, setFollows] = useState<ComicFollow[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getComicWanted().then((l) => setWanted([...l]));
    getFollows().then((l) => setFollows([...l]));
    runComicQueue().catch(() => {});
    const a = onComicWanted((l) => setWanted([...l]));
    const b = onFollows((l) => setFollows([...l]));
    return () => {
      a();
      b();
    };
  }, []);

  const newIssues = follows.flatMap((f) => f.newIssues.map((r) => ({ f, r })));

  return (
    <View style={{ gap: Spacing.four, paddingHorizontal: Spacing.three }}>
      {newIssues.length ? (
        <View style={{ gap: Spacing.two }}>
          <Text style={styles.heading}>★ NEW ISSUES</Text>
          {newIssues.map(({ f, r }) => (
            <View key={r.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {r.title}
                </Text>
                <Text style={styles.muted}>{r.source === 'tpb' ? 'Pirate Bay' : 'GetComics'}</Text>
              </View>
              <Pressable
                style={[styles.btn, styles.btnMain]}
                onPress={async () => {
                  await grabComic(r).catch(() => {});
                  await dismissNewIssue(f.key, r.id);
                }}>
                <Text style={[styles.btnText, { color: Colors.accentText }]}>GET</Text>
              </Pressable>
              <Pressable style={styles.btn} onPress={() => dismissNewIssue(f.key, r.id)}>
                <Text style={styles.btnText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: Spacing.two }}>
        <Text style={styles.heading}>WANTED</Text>
        {!wanted ? <ActivityIndicator color={Colors.accent} /> : null}
        {wanted?.length === 0 ? (
          <Body muted>Nothing yet. Use Find to search GetComics and The Pirate Bay, then tap Get.</Body>
        ) : null}
        {wanted?.map((w) => (
          <Pressable
            key={w.id}
            style={styles.row}
            onPress={() =>
              w.seriesId
                ? router.push({ pathname: '/comics/[id]', params: { id: w.seriesId } })
                : undefined
            }
            onLongPress={() => (active(w) ? askCancel(w) : removeComicWanted(w.id))}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.title} numberOfLines={2}>
                {w.title}
              </Text>
              <Text
                style={[
                  styles.muted,
                  w.state === 'done' && { color: Colors.success },
                  w.state === 'error' && { color: Colors.danger },
                ]}>
                {active(w) && w.phase ? w.phase : STATE_LABEL[w.state]}
                {w.error ? ` · ${w.error}` : ''}
              </Text>
              {active(w) ? (
                <>
                  <PixelProgress value={w.progress} busy={w.phase === 'Unpacking'} />
                  {detail(w) ? <Text style={styles.muted}>{detail(w)}</Text> : null}
                </>
              ) : null}
            </View>
            {active(w) ? (
              <Pressable style={styles.btn} onPress={() => askCancel(w)} hitSlop={8} accessibilityLabel="Cancel download">
                <Text style={styles.btnText}>✕</Text>
              </Pressable>
            ) : null}
            {w.state === 'error' ? (
              <Pressable style={styles.btn} onPress={() => retryComic(w.id)}>
                <Text style={styles.btnText}>RETRY</Text>
              </Pressable>
            ) : null}
          </Pressable>
        ))}
        {wanted?.length ? <Body muted style={{ fontSize: 12 }}>Hold one to remove it from the list. Downloads keep going when you leave this page.</Body> : null}
      </View>

      <View style={{ gap: Spacing.two }}>
        <Text style={styles.heading}>FOLLOWING</Text>
        {follows.length === 0 ? (
          <Body muted>Tap Follow on a result to hear about the next issues.</Body>
        ) : null}
        {follows.map((f) => (
          <View key={f.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{f.name}</Text>
              <Text style={styles.muted}>
                {f.lastIssue ? `After #${f.lastIssue}` : 'Any issue'}
                {f.checkedAt ? ` · checked ${new Date(f.checkedAt).toLocaleString()}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <Switch
                  value={f.auto}
                  onValueChange={(v) => setFollowAuto(f.key, v)}
                  trackColor={{ true: Colors.accent }}
                />
                <Text style={styles.muted}>Get new issues automatically</Text>
              </View>
            </View>
            <Pressable style={styles.btn} onPress={() => unfollowSeries(f.key)}>
              <Text style={styles.btnText}>✕</Text>
            </Pressable>
          </View>
        ))}
        {follows.length ? (
          <Pressable
            style={styles.btn}
            disabled={checking}
            onPress={async () => {
              setChecking(true);
              await checkFollows(true).catch(() => {});
              setChecking(false);
            }}>
            {checking ? (
              <ActivityIndicator color={Colors.accent} />
            ) : (
              <Text style={[styles.btnText, { textAlign: 'center' }]}>CHECK FOR NEW ISSUES</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function PixelProgress({ value, busy }: { value: number; busy?: boolean }) {
  const styles = useStyles();
  const blocks = 16;
  const filled = busy ? blocks : Math.round(Math.max(0, Math.min(1, value)) * blocks);
  return (
    <View style={{ flexDirection: 'row', gap: 2, height: 8 }}>
      {Array.from({ length: blocks }, (_, i) => (
        <View key={i} style={[styles.block, i < filled && styles.blockOn]} />
      ))}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  heading: { color: Colors.accent, fontFamily: PixelFont, fontSize: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { color: Colors.text, fontWeight: '700', fontSize: 14 },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  btn: {
    borderWidth: 2,
    borderColor: Colors.text,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  btnMain: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  btnText: { color: Colors.text, fontFamily: PixelFont, fontSize: 9 },
  block: { flex: 1, backgroundColor: Colors.surfaceRaised },
  blockOn: { backgroundColor: Colors.accent },
}));
