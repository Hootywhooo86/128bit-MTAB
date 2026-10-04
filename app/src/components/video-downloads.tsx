import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { SectionTitle } from '@/components/settings-ui';
import { ProgressBar, formatBytes } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { setNowWatching } from '@/lib/video';
import {
  deleteVideo,
  getVideoDownloads,
  onVideoDownloads,
  pauseVideo,
  resumeVideo,
  videoDownloadsSupported,
  type VideoDownload,
} from '@/lib/video-downloads';
import { Pressable } from '@/components/focusable';

function confirmDelete(title: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`Delete ${title}?`)) onYes();
    return;
  }
  Alert.alert('Delete download', title, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onYes },
  ]);
}

/** Movies or episodes saved on the phone, with live progress. Episodes are grouped by show. */
export function VideoDownloads({ kind }: { kind: 'movie' | 'episode' }) {
  const styles = useStyles();
  const [list, setList] = useState<VideoDownload[]>([]);

  useEffect(() => {
    getVideoDownloads().then((l) => setList([...l]));
    return onVideoDownloads((l) => setList([...l]));
  }, []);

  const items = list.filter((d) => d.kind === kind);
  const total = items.reduce((n, d) => n + (d.state === 'done' ? (d.bytes ?? 0) : 0), 0);

  if (!videoDownloadsSupported) {
    return <Text style={styles.hint}>Downloads work in the phone app, not on the web.</Text>;
  }
  if (!items.length) {
    return (
      <Text style={styles.hint}>
        Nothing yet. Open a {kind === 'movie' ? 'movie' : 'show’s episode'}, then hold a stream and
        choose Download.
      </Text>
    );
  }

  const groups =
    kind === 'movie'
      ? [{ title: `Movies · ${formatBytes(total) || '0 B'}`, items }]
      : [...new Set(items.map((d) => d.title))].map((show) => ({
          title: show,
          items: items.filter((d) => d.title === show),
        }));

  return (
    <View style={{ gap: Spacing.two }}>
      {kind === 'episode' ? (
        <Text style={styles.hint}>{formatBytes(total) || '0 B'} of episodes on this phone</Text>
      ) : null}
      {groups.map((g) => (
        <View key={g.title} style={{ gap: Spacing.two }}>
          <SectionTitle>{g.title}</SectionTitle>
          {g.items.map((d) => (
            <DownloadRow key={d.key} d={d} />
          ))}
        </View>
      ))}
    </View>
  );
}

function DownloadRow({ d }: { d: VideoDownload }) {
  const Colors = useColors();
  const styles = useStyles();
  const status =
    d.state === 'done'
      ? `Downloaded · ${formatBytes(d.bytes) || ''}`
      : d.state === 'torbox'
        ? `Waiting for TorBox · ${Math.round(d.progress * 100)}%`
        : d.state === 'downloading'
          ? `Downloading · ${Math.round(d.progress * 100)}%${d.bytes ? ` of ${formatBytes(d.bytes)}` : ''}`
          : d.state === 'paused'
            ? 'Paused'
            : `Failed: ${d.error ?? 'unknown error'}`;

  function play() {
    if (!d.file) return;
    setNowWatching({
      key: d.key,
      title: d.title,
      subtitle: d.subtitle,
      poster: d.poster,
      uri: d.file,
      link: d.link,
    });
    router.push('/watch');
  }

  return (
    <View style={styles.row}>
      <View style={styles.poster}>
        {d.poster ? <Image source={{ uri: d.poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={2}>
          {d.kind === 'episode' ? (d.subtitle ?? d.title) : d.title}
        </Text>
        <Text style={[styles.meta, d.state === 'error' && { color: Colors.danger }]} numberOfLines={2}>
          {status}
        </Text>
        {d.state === 'downloading' || d.state === 'torbox' ? <ProgressBar value={d.progress} /> : null}
      </View>
      <View style={styles.actions}>
        {d.state === 'done' ? (
          <Action icon="play" label="Play" onPress={play} />
        ) : d.state === 'downloading' ? (
          <Action icon="pause" label="Pause" onPress={() => pauseVideo(d.key)} />
        ) : d.state === 'paused' || d.state === 'error' ? (
          <Action icon="refresh" label="Resume" onPress={() => resumeVideo(d.key)} />
        ) : null}
        <Action
          icon="trash-outline"
          label="Delete"
          color={Colors.danger}
          onPress={() => confirmDelete(d.subtitle ? `${d.title} · ${d.subtitle}` : d.title, () => deleteVideo(d.key))}
        />
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  color,
  onPress,
}: {
  icon: 'play' | 'pause' | 'refresh' | 'trash-outline';
  label: string;
  color?: string;
  onPress: () => void;
}) {
  const Colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={color ?? Colors.text} />
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  hint: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  poster: { width: 48, height: 72, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.surfaceRaised },
  title: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  actions: { flexDirection: 'row', gap: Spacing.three },
}));
