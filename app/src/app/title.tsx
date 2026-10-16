import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import { DownloadedPlay } from '@/components/downloaded-play';
import { LinkToTrakt, TraktActions, useTraktConnected } from '@/components/trakt-actions';
import { getShowProgress, onEpisodeFinished, rememberEpisode, setEpisodeWatched, traktLink } from '@/lib/trakt-library';
import { TrackerActions, idsFor } from '@/components/tracker-actions';
import { StreamList } from '@/components/stream-list';
import { MoreLikeThis, RatingsRow, TmdbDetails, useEnrichment } from '@/components/title-extras';
import { Body, EmptyState, Heading, Title } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchMeta } from '@/lib/addons';
import { kitsuMeta } from '@/lib/kitsu';
import { getActiveAddons } from '@/lib/storage';
import type { Episode, MetaDetail } from '@/lib/types';
import { getWatchProgress, setSeriesContext } from '@/lib/video';
import { getStats } from '@/lib/stats';
import { getTrackerWatchedEpisodes } from '@/lib/tracker';
import { PixelCheck } from '@/components/pixel-check';
import { Pressable } from '@/components/focusable';

const episodeNumber = (e: Episode) => e.episode ?? e.number ?? 0;

/** The episode in Trakt's numbering (Kitsu gives IMDb season/episode when they differ). */
const traktEp = (e: Episode) => `${e.imdbSeason ?? e.season}:${e.imdbEpisode ?? episodeNumber(e)}`;

function episodeLabel(e: Episode) {
  const name = e.title ?? e.name;
  const code = e.season !== undefined ? `S${e.season} E${episodeNumber(e)}` : '';
  return [code, name].filter(Boolean).join(' · ');
}

/** Details for a movie or show. Movies list streams here; shows list seasons and episodes. */
export default function TitleScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { type, id, addon } = useLocalSearchParams<{
    type: string;
    id: string;
    addon?: string;
  }>();
  // The backdrop runs from the very top (behind the status bar and a see-through header),
  // 16:9 of the screen width (at least 260, and no more than ~60% of a TV screen).
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const heroHeight = Math.round(Math.min(Math.max(260, (width * 9) / 16), Math.max(260, height * 0.6)));
  const [meta, setMeta] = useState<MetaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  // TMDB extras (cast, trailer, age rating, More like this) when a TMDB key is set.
  const extra = useEnrichment(id, type);
  // Trakt: which episodes you've watched (hold an episode to change it).
  const trakt = useTraktConnected();
  const [watchedEps, setWatchedEps] = useState<Set<string>>(new Set());
  const [epError, setEpError] = useState<string | null>(null);
  // The IMDb id Trakt knows this by (anime from Kitsu etc. get linked); undefined while looking.
  const [imdb, setImdb] = useState<string | null | undefined>(/^tt\d+$/.test(id) ? id : undefined);
  useEffect(() => {
    if (!trakt || type === 'movie' || !imdb) return;
    getShowProgress(imdb).then((p) => setWatchedEps(new Set(p.done)), () => {});
    // Finished in the player: tick it now.
    return onEpisodeFinished((show, key) => {
      if (show === imdb) setWatchedEps((cur) => new Set(cur).add(key));
    });
  }, [trakt, type, imdb]);
  async function toggleEpisode(e: Episode) {
    if (!trakt || !imdb) return;
    const key = traktEp(e);
    const [season, ep] = key.split(':').map(Number);
    if (!Number.isFinite(season) || !Number.isFinite(ep)) return;
    const on = !watchedEps.has(key);
    setWatchedEps((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    try {
      setEpError(null);
      await setEpisodeWatched(imdb, season, ep, on);
    } catch (e) {
      setEpError(e instanceof Error ? e.message : String(e));
    }
  }

  // Watched marks without Trakt: what you finished here, how far into each episode, and
  // what your 128bit Tracker says (Tracker counts episodes watched anywhere).
  const [doneHere, setDoneHere] = useState<Set<string>>(new Set());
  const [partial, setPartial] = useState<Map<string, number>>(new Map());
  const [trackerEps, setTrackerEps] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      if (type === 'movie') return;
      let cancelled = false;
      (async () => {
        const stats = await getStats().catch(() => null);
        const done = new Set(Object.entries(stats?.watched ?? {}).filter(([, w]) => w.finished).map(([k]) => k));
        const part = new Map<string, number>();
        for (const p of await getWatchProgress().catch(() => [])) if (p.duration > 0) part.set(p.key, Math.min(1, p.position / p.duration));
        if (!cancelled) {
          setDoneHere(done);
          setPartial(part);
        }
        const ids: Record<string, string | number> | null = /^tt\d+$/.test(id) ? { imdb: id } : id.startsWith('kitsu:') ? { kitsu: Number(id.split(':')[1]) } : null;
        if (ids) getTrackerWatchedEpisodes(ids).then((s) => !cancelled && setTrackerEps(s), () => {});
      })();
      return () => {
        cancelled = true;
      };
    }, [id, type]),
  );
  const isWatched = (e: Episode) =>
    watchedEps.has(traktEp(e)) || doneHere.has(e.id) || trackerEps.has(`${e.season ?? 1}:${episodeNumber(e)}`);

  useEffect(() => {
    getActiveAddons()
      .then((addons) => fetchMeta(addons, type, id, addon))
      // A Kitsu search result no addon can show: Kitsu's own details (so Tracker buttons work).
      .catch((e) => (id.startsWith('kitsu:') ? kitsuMeta(id) : Promise.reject(e)))
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [type, id, addon]);
  useEffect(() => {
    if (!trakt || !meta || imdb) return;
    traktLink(id, meta, type === 'movie' ? 'movie' : 'show').then(setImdb, () => setImdb(null));
  }, [trakt, meta, id, type, imdb]);

  const seasons = useMemo(() => {
    const set = new Set((meta?.videos ?? []).map((v) => v.season ?? 0));
    // Season 0 is usually "specials": list it last.
    return [...set].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  }, [meta]);
  const currentSeason = season ?? seasons[0] ?? null;
  const episodes = (meta?.videos ?? [])
    .filter((v) => (v.season ?? 0) === currentSeason)
    .sort((a, b) => episodeNumber(a) - episodeNumber(b));

  if (!meta) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={heroHeader} />
        {error ? (
          <EmptyState title="Couldn’t load this title" body={error} />
        ) : (
          <ActivityIndicator color={Colors.accent} />
        )}
      </View>
    );
  }

  const isSeries = (type === 'series' || type === 'anime') && (meta.videos?.length ?? 0) > 0;
  const facts = [meta.releaseInfo, meta.runtime, meta.imdbRating ? `★ ${meta.imdbRating}` : null]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingBottom: Spacing.five }}>
      <Stack.Screen options={heroHeader} />
      <View style={[styles.hero, { height: heroHeight + insets.top }]}>
        {meta.background || extra?.backdrop || meta.poster ? (
          <Image
            source={{ uri: meta.background ?? extra?.backdrop ?? meta.poster }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : null}
        {/* Dark only at the top (so the back button shows) and the bottom (into the page). */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', Colors.background]}
          locations={[0, 0.3, 0.7, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>

      <View style={styles.body}>
        <View style={styles.header}>
          {meta.poster ? (
            <Image source={{ uri: meta.poster }} style={styles.poster} contentFit="cover" />
          ) : null}
          <View style={{ flex: 1, gap: 4, justifyContent: 'flex-end' }}>
            <Title style={{ fontSize: 24 }}>{meta.name}</Title>
            {facts ? <Body muted>{facts}</Body> : null}
            {meta.genres?.length ? (
              <Body muted style={{ fontSize: 12 }}>
                {meta.genres.slice(0, 4).join(' · ')}
              </Body>
            ) : null}
          </View>
        </View>
        <RatingsRow id={id} type={type} />
        {meta.description || extra?.overview ? (
          <Body muted numberOfLines={6}>
            {meta.description || extra?.overview}
          </Body>
        ) : null}
        {extra ? <TmdbDetails data={extra} /> : null}
        <TrackerActions
          item={{
            type: type === 'movie' ? 'movie' : type === 'anime' || id.startsWith('kitsu:') ? 'anime' : 'show',
            title: meta.name,
            year: Number(String(meta.releaseInfo ?? '').slice(0, 4)) || undefined,
            poster: meta.poster,
            ids: { ...idsFor(id), ...idsFor(imdb) },
          }}
        />
        {imdb ? (
          <TraktActions type={type} imdb={imdb} />
        ) : imdb === null ? (
          <LinkToTrakt id={id} name={meta.name} kind={type === 'movie' ? 'movie' : 'show'} onLinked={setImdb} />
        ) : null}

        {isSeries ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: Spacing.two }}>
              {seasons.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setSeason(s)}
                  style={[styles.chip, s === currentSeason && styles.chipActive]}>
                  <Text
                    style={[styles.chipText, s === currentSeason && { color: Colors.accentText }]}>
                    {s === 0 ? 'Specials' : `Season ${s}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {trakt && imdb ? (
              <Text style={styles.epSub}>Hold an episode to mark it watched on Trakt.</Text>
            ) : null}
            {epError ? <Text style={[styles.epSub, { color: Colors.danger }]}>{epError}</Text> : null}
            {episodes.map((e) => (
              <Pressable
                key={e.id}
                style={styles.episode}
                onLongPress={() => toggleEpisode(e)}
                onPress={() => {
                  // Anime: remember its Trakt episode so finishing it ticks it on Trakt.
                  if (imdb && imdb !== id) rememberEpisode(e.id, `${imdb}:${traktEp(e)}`);
                  // Watch order for "Next episode": regular seasons in order, specials skipped.
                  setSeriesContext({
                    metaId: id,
                    episodes: (meta.videos ?? [])
                      // Anime often has no seasons at all: then every episode counts.
                      .filter((v) => (v.season ?? 0) > 0 || !meta.videos?.some((x) => x.season))
                      .sort(
                        (a, b) =>
                          (a.season ?? 0) - (b.season ?? 0) || episodeNumber(a) - episodeNumber(b),
                      )
                      .map((v) => ({ id: v.id, label: episodeLabel(v) })),
                  });
                  router.push({
                    pathname: '/streams',
                    params: {
                      type,
                      id: e.id,
                      title: meta.name,
                      subtitle: episodeLabel(e),
                      poster: e.thumbnail ?? meta.background ?? meta.poster ?? '',
                      linkId: id,
                    },
                  });
                }}>
                <View style={styles.thumb}>
                  {e.thumbnail ? (
                    <Image
                      source={{ uri: e.thumbnail }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  ) : null}
                  {/* Part-way through: how far, along the bottom of the picture. */}
                  {!isWatched(e) && (partial.get(e.id) ?? 0) > 0.01 ? (
                    <View style={styles.thumbBar}>
                      <View style={[styles.thumbBarFill, { width: `${Math.round((partial.get(e.id) ?? 0) * 100)}%` }]} />
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.epTitle} numberOfLines={2}>
                    {episodeNumber(e)}. {e.title ?? e.name ?? 'Episode'}
                  </Text>
                  {e.released ? (
                    <Text style={styles.epSub}>{new Date(e.released).toLocaleDateString()}</Text>
                  ) : null}
                  {e.overview || e.description ? (
                    <Text style={styles.epSub} numberOfLines={2}>
                      {e.overview ?? e.description}
                    </Text>
                  ) : null}
                </View>
                {isWatched(e) ? <PixelCheck /> : null}
              </Pressable>
            ))}
          </>
        ) : (
          <>
            <DownloadedPlay itemKey={id} />
            <Heading>Streams</Heading>
            <StreamList
              type={type}
              id={id}
              title={meta.name}
              poster={meta.background ?? meta.poster}
              link={{ type, id }}
            />
          </>
        )}
      </View>
      {extra?.similar.length ? <MoreLikeThis items={extra.similar} /> : null}
    </ScrollView>
  );
}

/** A see-through header over the backdrop (the back button floats on the image). */
const heroHeader = {
  title: '',
  headerTransparent: true,
  headerStyle: { backgroundColor: 'transparent' },
  headerShadowVisible: false,
} as const;

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  hero: { backgroundColor: Colors.surface, overflow: 'hidden' },
  // The poster sits on the backdrop's bottom edge; the title and year beside it, below the image.
  body: { padding: Spacing.three, gap: Spacing.three, marginTop: -56 },
  header: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-end' },
  poster: {
    width: 100,
    height: 150,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipActive: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontWeight: '700' },
  episode: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  thumb: {
    width: 128,
    height: 72,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
  },
  thumbBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.5)' },
  thumbBarFill: { height: 4, backgroundColor: Colors.accent },
  epTitle: { color: Colors.text, fontWeight: '600' },
  epSub: { color: Colors.textSecondary, fontSize: 12 },
}));
