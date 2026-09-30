import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { StreamList } from '@/components/stream-list';
import { Body, EmptyState, Heading, Title } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchMeta } from '@/lib/addons';
import { getActiveAddons } from '@/lib/storage';
import type { Episode, MetaDetail } from '@/lib/types';
import { setSeriesContext } from '@/lib/video';

const episodeNumber = (e: Episode) => e.episode ?? e.number ?? 0;

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
  const [meta, setMeta] = useState<MetaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    getActiveAddons()
      .then((addons) => fetchMeta(addons, type, id, addon))
      .then(setMeta)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [type, id, addon]);

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
        <Stack.Screen options={{ title: '' }} />
        {error ? (
          <EmptyState title="Couldn’t load this title" body={error} />
        ) : (
          <ActivityIndicator color={Colors.accent} />
        )}
      </View>
    );
  }

  const isSeries = type === 'series' && (meta.videos?.length ?? 0) > 0;
  const facts = [meta.releaseInfo, meta.runtime, meta.imdbRating ? `★ ${meta.imdbRating}` : null]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: Spacing.five }}>
      <Stack.Screen options={{ title: '', headerTransparent: true }} />
      <View style={styles.hero}>
        {meta.background || meta.poster ? (
          <Image
            source={{ uri: meta.background ?? meta.poster }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : null}
        <View style={styles.heroShade} />
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
        {meta.description ? (
          <Body muted numberOfLines={6}>
            {meta.description}
          </Body>
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
            {episodes.map((e) => (
              <Pressable
                key={e.id}
                style={styles.episode}
                onPress={() => {
                  // Watch order for "Next episode": regular seasons in order, specials skipped.
                  setSeriesContext({
                    metaId: id,
                    episodes: (meta.videos ?? [])
                      .filter((v) => (v.season ?? 0) > 0)
                      .sort((a, b) => a.season! - b.season! || episodeNumber(a) - episodeNumber(b))
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
              </Pressable>
            ))}
          </>
        ) : (
          <>
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
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  hero: { height: 240, backgroundColor: Colors.surface },
  heroShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10,10,10,0.45)',
  },
  body: { padding: Spacing.three, gap: Spacing.three, marginTop: -80 },
  header: { flexDirection: 'row', gap: Spacing.three },
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
  epTitle: { color: Colors.text, fontWeight: '600' },
  epSub: { color: Colors.textSecondary, fontSize: 12 },
}));
