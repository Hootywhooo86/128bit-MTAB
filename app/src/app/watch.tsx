import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { router, Stack } from 'expo-router';
import {
  useVideoPlayer,
  VideoView,
  type AudioTrack,
  type SubtitleTrack,
  type VideoPlayer,
  type VideoSource,
} from 'expo-video';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TrackSheet, type SubtitleChoice } from '@/components/track-sheet';
import { EmptyState } from '@/components/ui';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';
import { usePlayer } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';
import {
  cueAt,
  fetchAddonSubtitles,
  findPreferred,
  loadSubtitle,
  sortSubtitles,
  type AddonSubtitle,
  type Cue,
} from '@/lib/subtitles';
import { MANUAL_SKIP_S, MANUAL_WINDOW_S, getSegments, type Segment } from '@/lib/skip';
import { addWatching, markWatched, type WatchKind } from '@/lib/stats';
import { simklScrobble } from '@/lib/simkl';
import { scrobble } from '@/lib/trakt';
import {
  checkTorboxStream,
  getNowWatching,
  getWatchProgress,
  isAnime,
  nextEpisode,
  pickNextStream,
  resolveStream,
  saveWatchProgress,
  streamsRoute,
  type StreamResult,
  type WatchItem,
} from '@/lib/video';

const SAVE_EVERY_S = 10;
/** Show "Next episode" this many seconds before the end. */
const NEXT_WINDOW_S = 45;
const SUB_SIZES = { small: 16, medium: 20, large: 26 };

const toSource = (item: WatchItem): VideoSource => ({
  uri: item.uri,
  headers: item.headers,
  contentType: /\.m3u8(\?|$)/i.test(item.uri) ? 'hls' : 'auto',
  metadata: { title: item.title, artist: item.subtitle, artwork: item.poster },
});

// Track switching mutates the native player; kept outside the component for the React Compiler.
function setSubtitleTrack(player: VideoPlayer, track: SubtitleTrack | null) {
  player.subtitleTrack = track;
}

function setAudioTrack(player: VideoPlayer, track: AudioTrack) {
  player.audioTrack = track;
}

function seekTo(player: VideoPlayer, t: number) {
  try {
    player.currentTime = t;
  } catch {
    // Released.
  }
}

/** A released player throws on every read; treat that as "unknown". */
function safeDuration(player: VideoPlayer) {
  try {
    return Number.isFinite(player.duration) ? player.duration : 0;
  } catch {
    return 0;
  }
}

const isEnglish = (t: { language?: string | null; label?: string | null }) =>
  /^en(g|-|_|$)/i.test(t.language ?? '') || /\b(english|eng)\b/i.test(t.label ?? '');

/** Best English subtitle track: full dialogue before "signs & songs" / forced tracks. */
function englishSubtitle(tracks: SubtitleTrack[]) {
  const en = tracks.filter(isEnglish);
  return en.find((t) => !/sign|song|forced/i.test(t.label ?? '')) ?? en[0];
}

type NextState =
  | { status: 'idle' }
  | { status: 'loading'; label: string }
  | { status: 'downloading'; label: string; progress: number }
  | { status: 'error'; message: string };

/** Full-screen video player for movies, episodes and live channels. */
export default function WatchScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [item, setItem] = useState<WatchItem | null>(getNowWatching);
  const audio = usePlayer();
  const { prefs } = usePrefs();

  const player = useVideoPlayer(item ? toSource(item) : null, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.showNowPlayingNotification = true;
    // Start as soon as a couple of seconds are buffered instead of waiting for more.
    p.bufferOptions = {
      minBufferForPlayback: 2,
      preferredForwardBufferDuration: 30,
      waitsToMinimizeStalling: false,
    };
    p.play();
  });

  // Video needs the screen: keep it on while watching. (Only audiobooks play with it off.)
  useKeepAwake();

  // Android back (button or swipe from the edge) leaves the player, back to the episodes.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      try {
        player.pause();
      } catch {
        // Already released.
      }
      if (router.canGoBack()) router.back();
      else router.replace('/');
      return true;
    });
    return () => sub.remove();
  }, [player]);

  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const resumedFor = useRef<string | null>(null);
  // Last known position/length. Leaving the screen releases the player before the
  // cleanups below run, and reading a released player throws (that crashed the app on
  // back), so the cleanups use these instead.
  const known = useRef({ time: 0, duration: 0 });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime: t }) => {
      known.current = { time: t, duration: safeDuration(player) || known.current.duration };
    });
    return () => sub.remove();
  }, [player]);
  const lastSaved = useRef(0);

  // --- Tracks & subtitles ---
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addonSubs, setAddonSubs] = useState<AddonSubtitle[]>([]);
  const [subtitle, setSubtitle] = useState<SubtitleChoice>({ kind: 'off' });
  const [cues, setCues] = useState<Cue[]>([]);
  const [delay, setDelay] = useState(0);
  const [subError, setSubError] = useState<string | null>(null);
  const { availableSubtitleTracks } = useEvent(player, 'availableSubtitleTracksChange', {
    availableSubtitleTracks: [],
  });
  const { availableAudioTracks } = useEvent(player, 'availableAudioTracksChange', {
    availableAudioTracks: [],
  });

  // Show the poster until the picture actually starts (not just "ready").
  const [startedFor, setStartedFor] = useState<string | null>(null);
  const startedKey = item?.key;
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying && startedKey) setStartedFor(startedKey);
    });
    return () => sub.remove();
  }, [player, startedKey]);

  // From Continue watching: if the saved stream errors or hasn't started in 30 s, go to
  // the stream picker for this episode instead.
  const fallbackFor = item?.fallback ? item : null;
  const started = startedFor === item?.key;
  const failed = status === 'error';
  useEffect(() => {
    if (!fallbackFor || started) return;
    const go = () => {
      try {
        player.pause();
      } catch {
        // Already released.
      }
      router.replace(streamsRoute(fallbackFor));
    };
    if (failed) {
      go();
      return;
    }
    const t = setTimeout(go, 30_000);
    return () => clearTimeout(t);
  }, [fallbackFor, started, failed, player]);

  // --- Skip intro ---
  const [segments, setSegments] = useState<{ key: string; list: Segment[] } | null>(null);
  const skippedFor = useRef<string | null>(null);
  const segKey = item && !item.live && item.link?.type !== 'movie' ? item.key : null;
  const segLink = item?.link;
  const segReady = status === 'readyToPlay';
  useEffect(() => {
    if (!segKey || !segReady) return;
    let cancelled = false;
    (async () => {
      const anime = await isAnime(segLink).catch(() => false);
      const list = await getSegments(segKey, anime, known.current.duration);
      if (!cancelled) setSegments({ key: segKey, list });
    })();
    return () => {
      cancelled = true;
    };
  }, [segKey, segLink, segReady]);
  const skipList = segments && segments.key === segKey ? segments.list : null;
  const inSegment = skipList?.find(
    (s) => s.kind !== 'outro' && currentTime >= s.start - 0.5 && currentTime < s.end - 2,
  );
  const manualSkip =
    !!segKey && skipList !== null && !skipList.some((s) => s.kind === 'intro') && currentTime > 2 && currentTime < MANUAL_WINDOW_S;
  const skipTo = useCallback((t: number) => seekTo(player, t), [player]);
  // Auto-skip (Settings → Playback): once per segment.
  const autoSkip = prefs.autoSkipIntro && inSegment ? `${segKey}:${inSegment.start}` : null;
  useEffect(() => {
    if (!autoSkip || !inSegment || skippedFor.current === autoSkip) return;
    skippedFor.current = autoSkip;
    skipTo(inSegment.end);
  }, [autoSkip, inSegment, skipTo]);

  // English first (Settings → Playback, on by default): the English audio track when the
  // video has one, and English subtitles on whenever there are any — for every video.
  const englishFirst = prefs.englishFirst;
  const userPickedSubs = useRef(false);
  const audioSetFor = useRef<string | null>(null);
  const subsSetFor = useRef<string | null>(null);

  // --- Next episode ---
  const [next, setNext] = useState<NextState>({ status: 'idle' });
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upNext = item ? nextEpisode(item) : undefined;

  // Stop any audiobook so the two don't play over each other.
  const pauseAudio = audio.playing ? audio.toggle : null;
  useEffect(() => {
    pauseAudio?.();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume where you left off (not for live TV).
  useEffect(() => {
    if (!item || item.live || !prefs.resumeVideos || status !== 'readyToPlay') return;
    if (resumedFor.current === item.key) return;
    resumedFor.current = item.key;
    getWatchProgress().then((all) => {
      const saved = all.find((p) => p.key === item.key);
      // Trakt entries store a percentage (duration 100), which isn't a real position.
      if (saved && saved.position > 30 && saved.duration !== 100)
        try {
          player.currentTime = saved.position;
        } catch {
          // Left the player already.
        }
    });
  }, [status, item, player, prefs.resumeVideos]);

  // Remember the position every few seconds, and when leaving.
  useEffect(() => {
    if (!item || item.live) return;
    const save = () => {
      const { time, duration } = known.current;
      if (duration > 0) {
        saveWatchProgress({
          key: item.key,
          title: item.title,
          subtitle: item.subtitle,
          poster: item.poster,
          position: time,
          duration,
          link: item.link,
          stream: item.stream,
          source: item.source,
          series: item.series,
        });
      }
    };
    const sub = player.addListener('timeUpdate', ({ currentTime: t }) => {
      known.current = { time: t, duration: safeDuration(player) || known.current.duration };
      if (Math.abs(t - lastSaved.current) >= SAVE_EVERY_S) {
        lastSaved.current = t;
        save();
      }
    });
    return () => {
      sub.remove();
      save();
    };
  }, [item, player]);

  // Statistics: count watch time while playing; "watched" once you're near the end.
  useEffect(() => {
    if (!item) return;
    const kind: WatchKind = item.live ? 'live' : item.link?.type === 'movie' ? 'movie' : 'episode';
    const entry = { key: item.key, title: item.title, subtitle: item.subtitle, kind };
    let counted = false;
    const tick = setInterval(() => {
      let playing = false;
      try {
        playing = player.playing;
      } catch {
        return; // released
      }
      if (!playing) return;
      addWatching(entry, 10);
      if (
        !counted &&
        !item.live &&
        known.current.duration > 0 &&
        known.current.time / known.current.duration > 0.9
      ) {
        counted = true;
        markWatched(entry);
      }
    }, 10_000);
    return () => clearInterval(tick);
  }, [item, player]);

  // Tell Trakt what's playing (start / pause / stop).
  useEffect(() => {
    if (!item || item.live || !prefs.traktScrobble) return;
    const percent = () => {
      const { time, duration } = known.current;
      return duration > 0 ? (time / duration) * 100 : 0;
    };
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

  // Same for Simkl (only does anything when Simkl is connected).
  useEffect(() => {
    if (!item || item.live) return;
    const percent = () => {
      const { time, duration } = known.current;
      return duration > 0 ? (time / duration) * 100 : 0;
    };
    const send = (action: 'start' | 'pause' | 'stop') =>
      simklScrobble(action, item.key, item.link?.type, percent()).catch(() => {});
    const sub = player.addListener('playingChange', ({ isPlaying }) =>
      send(isPlaying ? 'start' : 'pause'),
    );
    return () => {
      sub.remove();
      send('stop');
    };
  }, [item, player]);

  // Switch to the English audio track once the video is ready (expo-video ignores a track
  // change made before that, which is why the anime dub wasn't being picked).
  const playingKey = item?.key;
  useEffect(() => {
    if (!englishFirst || !playingKey || status !== 'readyToPlay') return;
    if (audioSetFor.current === playingKey || !availableAudioTracks.length) return;
    audioSetFor.current = playingKey;
    const english = availableAudioTracks.find(isEnglish);
    if (english && !isEnglish(player.audioTrack ?? {})) setAudioTrack(player, english);
  }, [englishFirst, playingKey, status, availableAudioTracks, player]);

  const chooseSubtitle = useCallback(
    async (choice: SubtitleChoice) => {
      setSubError(null);
      setSubtitle(choice);
      setCues([]);
      setSubtitleTrack(player, choice.kind === 'embedded' ? choice.track : null);
      if (choice.kind === 'addon') {
        try {
          setCues(await loadSubtitle(choice.sub.url));
        } catch (e) {
          setSubError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [player],
  );

  // English subtitles always on, even with English audio: the video's own English track
  // first; otherwise an English one from your subtitle addons (below).
  useEffect(() => {
    if (!englishFirst || !playingKey || userPickedSubs.current || subsSetFor.current === playingKey) return;
    if (status !== 'readyToPlay') return;
    const track = englishSubtitle(availableSubtitleTracks);
    if (!track) return;
    subsSetFor.current = playingKey;
    // After this render (the tracks just arrived).
    Promise.resolve().then(() => chooseSubtitle({ kind: 'embedded', track }));
  }, [englishFirst, playingKey, status, availableSubtitleTracks, chooseSubtitle]);

  // Load addon subtitles for this movie/episode, and turn on the preferred language if wanted.
  const itemKey = item?.key;
  const itemType = item?.live ? undefined : item?.link?.type;
  useEffect(() => {
    if (!itemKey || !itemType) return;
    let cancelled = false;
    fetchAddonSubtitles(itemType, itemKey).then((subs) => {
      if (cancelled) return;
      const sorted = sortSubtitles(subs, prefs.subtitleLanguage);
      setAddonSubs(sorted);
      const preferred = englishFirst
        ? findPreferred(sorted, 'en')
        : prefs.autoSubtitles
          ? findPreferred(sorted, prefs.subtitleLanguage)
          : undefined;
      // An addon subtitle only if the video's own English track isn't already on.
      if (userPickedSubs.current || subsSetFor.current === itemKey) return;
      if (preferred) chooseSubtitle({ kind: 'addon', sub: preferred });
    });
    return () => {
      cancelled = true;
    };
  }, [itemKey, itemType, prefs.subtitleLanguage, prefs.autoSubtitles, chooseSubtitle, englishFirst]);

  // --- Next episode ---
  const playNext = useCallback(async () => {
    if (!item || !upNext || next.status === 'loading' || next.status === 'downloading') return;
    if (nextTimer.current) clearTimeout(nextTimer.current);
    setNext({ status: 'loading', label: upNext.label });
    const fail = (e: unknown) =>
      setNext({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    try {
      const pick = await pickNextStream(upNext.id, item.source);
      if (!pick) throw new Error('No streams found for the next episode');
      const start = async (result: StreamResult): Promise<void> => {
        if (result.status === 'ready') {
          const nextItem: WatchItem = {
            ...item,
            key: upNext.id,
            subtitle: upNext.label,
            uri: result.uri,
            headers: result.headers,
            source: { addonId: pick.addonId, bingeGroup: pick.stream.behaviorHints?.bingeGroup },
            stream: pick.stream,
            fallback: false,
          };
          await player.replaceAsync(toSource(nextItem));
          player.play();
          setItem(nextItem);
          setAddonSubs([]);
          setSubtitle({ kind: 'off' });
          setCues([]);
          setNext({ status: 'idle' });
        } else if (result.status === 'downloading') {
          setNext({ status: 'downloading', label: upNext.label, progress: result.progress });
          nextTimer.current = setTimeout(
            () => checkTorboxStream(result.itemId, pick.stream).then(start).catch(fail),
            5000,
          );
        } else {
          throw new Error('The next episode’s stream opens outside the app');
        }
      };
      await start(await resolveStream(pick.stream, `${item.title} ${upNext.label}`));
    } catch (e) {
      fail(e);
    }
  }, [item, upNext, next.status, player]);

  useEffect(() => {
    if (!prefs.autoPlayNextEpisode || !upNext) return;
    const sub = player.addListener('playToEnd', () => playNext());
    return () => sub.remove();
  }, [player, playNext, prefs.autoPlayNextEpisode, upNext]);

  useEffect(
    () => () => {
      if (nextTimer.current) clearTimeout(nextTimer.current);
    },
    [],
  );

  if (!item) return <EmptyState title="Nothing to play" />;

  const duration = safeDuration(player);
  const nearEnd =
    !!upNext && Number.isFinite(duration) && duration > 0 && duration - currentTime < NEXT_WINDOW_S;
  const line = subtitle.kind === 'addon' ? cueAt(cues, currentTime - delay) : null;
  const hasTracks =
    !item.live || availableSubtitleTracks.length > 0 || availableAudioTracks.length > 1;

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
      {startedFor !== item.key && status !== 'error' ? (
        <View style={styles.loadingArt} pointerEvents="none">
          {item.poster ? (
            <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          <View style={styles.loadingShade} />
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={styles.loadingSub} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      {status === 'error' ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn’t play this stream.</Text>
          {error?.message ? <Text style={styles.errorDetail}>{error.message}</Text> : null}
          <Pressable onPress={() => router.back()} style={styles.errorBack}>
            <Text style={styles.errorBackText}>‹ Back to pick another stream</Text>
          </Pressable>
        </View>
      ) : null}

      {line ? (
        <View style={styles.subtitleWrap} pointerEvents="none">
          <Text style={[styles.plainSubtitleText, { fontSize: SUB_SIZES[prefs.subtitleSize] }]}>
            {line}
          </Text>
        </View>
      ) : null}

      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="arrow-back" size={28} color="#fff" />
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
        {hasTracks ? (
          <Pressable
            onPress={() => setSheetOpen(true)}
            hitSlop={12}
            accessibilityLabel="Subtitles and audio">
            <Ionicons
              name="text"
              size={24}
              color={subtitle.kind === 'off' ? '#fff' : Colors.accent}
            />
          </Pressable>
        ) : null}
      </SafeAreaView>

      {inSegment && !prefs.autoSkipIntro ? (
        <Pressable style={styles.skipButton} onPress={() => skipTo(inSegment.end)}>
          <Text style={styles.skipText}>{inSegment.kind === 'recap' ? 'SKIP RECAP ▶▶' : 'SKIP INTRO ▶▶'}</Text>
        </Pressable>
      ) : manualSkip && !inSegment ? (
        <Pressable style={[styles.skipButton, styles.skipManual]} onPress={() => skipTo(currentTime + MANUAL_SKIP_S)}>
          <Text style={styles.skipText}>+{MANUAL_SKIP_S}s ▶▶</Text>
        </Pressable>
      ) : null}

      {upNext && (nearEnd || next.status !== 'idle') ? (
        <View style={styles.nextWrap}>
          {next.status === 'idle' ? (
            <Pressable style={styles.nextButton} onPress={playNext}>
              <Text style={styles.nextLabel} numberOfLines={1}>
                Next: {upNext.label}
              </Text>
              <Ionicons name="play-skip-forward" size={18} color={Colors.accentText} />
            </Pressable>
          ) : (
            <View style={styles.nextStatus}>
              {next.status === 'error' ? (
                <Text style={styles.nextStatusText}>{next.message}</Text>
              ) : (
                <>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.nextStatusText} numberOfLines={1}>
                    {next.status === 'downloading'
                      ? `TorBox is fetching ${next.label} · ${Math.round(next.progress * 100)}%`
                      : `Loading ${next.label}…`}
                  </Text>
                </>
              )}
            </View>
          )}
        </View>
      ) : null}

      <TrackSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        embedded={availableSubtitleTracks}
        addon={addonSubs}
        current={subtitle}
        onChoose={(c) => {
          userPickedSubs.current = true;
          chooseSubtitle(c);
        }}
        audioTracks={availableAudioTracks}
        currentAudio={player.audioTrack}
        onChooseAudio={(t) => setAudioTrack(player, t)}
        delay={delay}
        onDelay={setDelay}
        error={subError}
      />
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: '#000' },
  skipButton: {
    position: 'absolute',
    right: Spacing.four,
    bottom: 96,
    backgroundColor: Colors.accent,
    borderWidth: 3,
    borderColor: '#fff',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  skipManual: { backgroundColor: 'rgba(0,0,0,0.7)', borderColor: Colors.accent },
  skipText: { color: '#fff', fontFamily: PixelFont, fontSize: 10 },
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
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
  loadingArt: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    backgroundColor: '#000',
  },
  loadingShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  loadingTitle: { color: '#fff', fontFamily: PixelFont, fontSize: 14, lineHeight: 22, textAlign: 'center', paddingHorizontal: Spacing.four },
  loadingSub: { color: '#ddd', fontFamily: PixelFont, fontSize: 9, lineHeight: 15 },
  errorDetail: { color: '#aaa', fontSize: 12, marginTop: 6, textAlign: 'center' },
  errorBack: { marginTop: Spacing.three, borderWidth: 2, borderColor: '#fff', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  errorBackText: { color: '#fff', fontWeight: '700' },
  subtitleWrap: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    bottom: 96,
    alignItems: 'center',
  },
  plainSubtitleText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  nextWrap: { position: 'absolute', right: Spacing.three, bottom: 110, maxWidth: '80%' },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: 24,
  },
  nextLabel: { color: Colors.accentText, fontWeight: '800', flexShrink: 1 },
  nextStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: 24,
  },
  nextStatusText: { color: '#fff', fontWeight: '600', flexShrink: 1 },
}));
