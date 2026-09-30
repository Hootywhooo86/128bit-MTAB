import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { router, Stack } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import { scrobble } from '@/lib/trakt';
import { getNowWatching, getWatchProgress, saveWatchProgress } from '@/lib/video';

const SAVE_EVERY_S = 10;

/** Full-screen video player for movies, episodes and live channels. */
export default function WatchScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [item] = useState(getNowWatching);
  const audio = usePlayer();
  const { prefs } = usePrefs();

  const player = useVideoPlayer(
    item
      ? {
          uri: item.uri,
          headers: item.headers,
          contentType: /\.m3u8(\?|$)/i.test(item.uri) ? 'hls' : 'auto',
          metadata: {
            title: item.title,
            artist: item.subtitle,
            artwork: item.poster,
          },
        }
      : null,
    (p) => {
      p.timeUpdateEventInterval = 1;
      p.showNowPlayingNotification = true;
      p.play();
    },
  );

  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
  });
  const resumed = useRef(false);
  const lastSaved = useRef(0);

  // Stop any audiobook so the two don't play over each other.
  const pauseAudio = audio.playing ? audio.toggle : null;
  useEffect(() => {
    pauseAudio?.();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume where you left off (not for live TV).
  useEffect(() => {
    if (!item || item.live || !prefs.resumeVideos || status !== 'readyToPlay' || resumed.current)
      return;
    resumed.current = true;
    getWatchProgress().then((all) => {
      const saved = all.find((p) => p.key === item.key);
      if (saved && saved.position > 30) player.currentTime = saved.position;
    });
  }, [status, item, player, prefs.resumeVideos]);

  // Remember the position every few seconds, and when leaving.
  useEffect(() => {
    if (!item || item.live) return;
    const save = () => {
      if (Number.isFinite(player.duration) && player.duration > 0) {
        saveWatchProgress({
          key: item.key,
          title: item.title,
          subtitle: item.subtitle,
          poster: item.poster,
          position: player.currentTime,
          duration: player.duration,
          link: item.link,
        });
      }
    };
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (Math.abs(currentTime - lastSaved.current) >= SAVE_EVERY_S) {
        lastSaved.current = currentTime;
        save();
      }
    });
    return () => {
      sub.remove();
      save();
    };
  }, [item, player]);

  // Tell Trakt what's playing (start / pause / stop).
  useEffect(() => {
    if (!item || item.live || !prefs.traktScrobble) return;
    const percent = () => (player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0);
    const send = (action: 'start' | 'pause' | 'stop') =>
      scrobble(action, item.key, item.link?.type, percent()).catch(() => {});
    const sub = player.addListener('playingChange', ({ isPlaying }) =>
      send(isPlaying ? 'start' : 'pause'),
    );
    return () => {
      sub.remove();
      send('stop');
    };
  }, [item, player, prefs.traktScrobble]);

  if (!item) return <EmptyState title="Nothing to play" />;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        fullscreenOptions={{ enable: true }}
      />
      {status === 'loading' ? (
        <ActivityIndicator size="large" color={Colors.accent} style={StyleSheet.absoluteFill} />
      ) : null}
      {status === 'error' ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn’t play this stream.</Text>
          {error?.message ? <Text style={styles.errorDetail}>{error.message}</Text> : null}
        </View>
      ) : null}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={28} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        {item.live ? <Text style={styles.live}>● LIVE</Text> : null}
      </SafeAreaView>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: '#000' },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 16 },
  subtitle: { color: '#ddd', fontSize: 12 },
  live: { color: Colors.danger, fontWeight: '800', fontSize: 12 },
  errorBox: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  errorText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  errorDetail: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
}));
