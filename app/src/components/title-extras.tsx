import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Heading } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { getRatings, type Rating } from '@/lib/mdblist';
import { enrich, imdbIdFor, type Enrichment, type Similar } from '@/lib/tmdb';

/** TMDB details for a title, loaded once per screen; null when TMDB isn't set up. */
export function useEnrichment(id: string, type: string) {
  const [data, setData] = useState<{ id: string; value: Enrichment | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    enrich(id, type).then(
      (value) => !cancelled && setData({ id, value }),
      () => !cancelled && setData({ id, value: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [id, type]);
  return data?.id === id ? data.value : null;
}

/** Ratings chips from MDBList (IMDb, Rotten Tomatoes, Metacritic…). */
export function RatingsRow({ id, type }: { id: string; type: string }) {
  const styles = useStyles();
  const [ratings, setRatings] = useState<Rating[]>([]);
  useEffect(() => {
    let cancelled = false;
    getRatings(id, type).then(
      (r) => !cancelled && setRatings(r),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [id, type]);
  if (!ratings.length) return null;
  return (
    <View style={styles.chips}>
      {ratings.map((r) => (
        <View key={r.source} style={styles.rating}>
          <Text style={styles.ratingValue}>{r.text}</Text>
          <Text style={styles.ratingLabel}>{r.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Age rating, runtime, trailer and cast from TMDB. */
export function TmdbDetails({ data }: { data: Enrichment }) {
  const Colors = useColors();
  const styles = useStyles();
  const facts = [
    data.certification,
    data.runtime,
    data.seasons ? `${data.seasons} season${data.seasons === 1 ? '' : 's'}` : null,
    data.network,
    data.status && data.status !== 'Released' ? data.status : null,
  ].filter(Boolean);
  return (
    <View style={{ gap: Spacing.three }}>
      {data.tagline ? <Text style={styles.tagline}>“{data.tagline}”</Text> : null}
      {facts.length ? <Text style={styles.facts}>{facts.join('  ·  ')}</Text> : null}
      {data.trailer ? (
        <Pressable
          style={styles.trailer}
          onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${data.trailer!.youtubeKey}`)}>
          <Text style={styles.trailerText}>▶  Watch trailer</Text>
        </Pressable>
      ) : null}
      {data.cast.length ? (
        <View style={{ gap: Spacing.two }}>
          <Heading>Cast</Heading>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.three }}>
            {data.cast.map((p) => (
              <View key={`${p.name}:${p.role}`} style={styles.person}>
                <View style={styles.photo}>
                  {p.photo ? (
                    <Image source={{ uri: p.photo }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Text style={{ color: Colors.textSecondary, fontWeight: '800' }}>
                      {p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </Text>
                  )}
                </View>
                <Text style={styles.personName} numberOfLines={2}>
                  {p.name}
                </Text>
                {p.role ? (
                  <Text style={styles.personRole} numberOfLines={2}>
                    {p.role}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** TMDB recommendations; tapping one opens it in 128bit. */
export function MoreLikeThis({ items }: { items: Similar[] }) {
  const Colors = useColors();
  const styles = useStyles();
  const [opening, setOpening] = useState<number | null>(null);
  if (!items.length) return null;

  async function open(s: Similar) {
    setOpening(s.tmdbId);
    try {
      const imdb = await imdbIdFor(s.tmdbId, s.kind);
      if (imdb) {
        router.push({ pathname: '/title', params: { type: s.kind === 'tv' ? 'series' : 'movie', id: imdb } });
      }
    } finally {
      setOpening(null);
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      <Heading style={{ paddingHorizontal: Spacing.three }}>More like this</Heading>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}>
        {items.map((s) => (
          <Pressable key={`${s.kind}:${s.tmdbId}`} style={{ width: 110, gap: 4 }} onPress={() => open(s)}>
            <View style={styles.poster}>
              {s.poster ? <Image source={{ uri: s.poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              {opening === s.tmdbId ? <ActivityIndicator color={Colors.accent} /> : null}
            </View>
            <Text style={styles.personName} numberOfLines={2}>
              {s.title}
            </Text>
            {s.year ? <Text style={styles.personRole}>{s.year}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  rating: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    minWidth: 72,
  },
  ratingValue: { color: Colors.text, fontWeight: '800', fontSize: 16 },
  ratingLabel: { color: Colors.textSecondary, fontSize: 11 },
  tagline: { color: Colors.textSecondary, fontStyle: 'italic', fontSize: 14 },
  facts: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  trailer: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
  },
  trailerText: { color: Colors.text, fontWeight: '700' },
  person: { width: 84, gap: 4, alignItems: 'center' },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personName: { color: Colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  personRole: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center' },
  poster: {
    width: 110,
    height: 160,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
