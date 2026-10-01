import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Cover, EmptyState, Heading, ProgressBar } from '@/components/ui';
import { CatalogRow, ContinueWatchingRow } from '@/components/video-browse';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchMetas, isBrowsable } from '@/lib/addons';
import { useAddons } from '@/lib/hooks';
import { usePlayer } from '@/lib/player';
import { getLibrary, getProgressMany, type Progress } from '@/lib/storage';
import type { MetaPreview, PlayableBook } from '@/lib/types';

/** How many catalog rows Home shows per type before you go to the Shows/Movies tabs. */
const ROWS_PER_TYPE = 2;

/** Everything at a glance: a featured title, what you're in the middle of, and top catalogs. */
export default function HomeScreen() {
  const styles = useStyles();
  const { addons, loaded } = useAddons();

  const rows = (['movie', 'series'] as const).flatMap((type) =>
    addons
      .flatMap((addon) =>
        addon.manifest.catalogs
          .filter((c) => c.type === type && isBrowsable(c))
          .map((catalog) => ({ addon, catalog })),
      )
      .slice(0, ROWS_PER_TYPE),
  );
  const heroSource = rows.find((r) => r.catalog.type === 'movie') ?? rows[0];

  if (loaded && addons.length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="Welcome to 128bit"
          body="Add addons for shows, movies, live TV and audiobooks to get started. Cinemeta is a good first one.">
          <Button label="Add addons" onPress={() => router.push('/addons')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: Spacing.five, gap: Spacing.four }}>
      {heroSource ? <Hero addon={heroSource.addon} catalog={heroSource.catalog} /> : null}
      <ContinueWatchingRow />
      <ContinueListeningRow />
      {rows.map(({ addon, catalog }) => (
        <CatalogRow
          key={`${addon.manifest.id}/${catalog.type}/${catalog.id}`}
          addon={addon}
          catalog={catalog}
        />
      ))}
    </ScrollView>
  );
}

function Hero({ addon, catalog }: Parameters<typeof CatalogRow>[0]) {
  const Colors = useColors();
  const styles = useStyles();
  const [meta, setMeta] = useState<MetaPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetas(addon, catalog)
      .then((metas) => {
        if (!cancelled) setMeta(metas.find((m) => m.background) ?? metas[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [addon, catalog]);

  if (!meta) return <View style={styles.hero} />;

  const open = () =>
    router.push({
      pathname: '/title',
      params: { type: meta.type, id: meta.id, addon: addon.manifest.id },
    });

  return (
    <Pressable style={styles.hero} onPress={open}>
      <Image
        source={{ uri: meta.background ?? meta.poster }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />
      <LinearGradient
        colors={['transparent', Colors.background]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0.35 }}
        end={{ x: 0, y: 1 }}
      />
      <View style={styles.heroBody}>
        {meta.logo ? (
          <Image source={{ uri: meta.logo }} style={styles.heroLogo} contentFit="contain" />
        ) : (
          <Text style={styles.heroTitle}>{meta.name}</Text>
        )}
        <Text style={styles.heroMeta} numberOfLines={1}>
          {[
            meta.releaseInfo,
            meta.imdbRating ? `★ ${meta.imdbRating}` : null,
            ...(meta.genres ?? []).slice(0, 2),
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        <View style={styles.heroButtons}>
          <Pressable style={styles.heroPrimary} onPress={open}>
            <Ionicons name="play" size={18} color={Colors.accentText} />
            <Text style={styles.heroPrimaryLabel}>Watch</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

/** Audiobooks you've started but not finished. */
function ContinueListeningRow() {
  const styles = useStyles();
  const { playBook } = usePlayer();
  const [items, setItems] = useState<{ book: PlayableBook; progress: Progress }[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const books = await getLibrary();
        const progress = await getProgressMany(books.map((b) => b.key));
        const started = books
          .filter(
            (b) => progress[b.key] && !progress[b.key].finished && progress[b.key].fraction > 0,
          )
          .map((book) => ({ book, progress: progress[book.key] }));
        if (!cancelled) setItems(started);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (!items.length) return null;
  return (
    <View style={{ gap: Spacing.two }}>
      <Heading style={{ paddingHorizontal: Spacing.three }}>Continue listening</Heading>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(i) => i.book.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
        renderItem={({ item }) => (
          <Pressable
            style={{ width: 120, gap: 6 }}
            onPress={() => playBook(item.book).then(() => router.push('/player'))}>
            <Cover
              uri={item.book.cover}
              size={120}
              title={item.book.title}
              author={item.book.author}
            />
            <ProgressBar value={item.progress.fraction} />
            <Text numberOfLines={1} style={styles.tileTitle}>
              {item.book.title}
            </Text>
            <Text style={styles.tileSub}>{Math.round(item.progress.fraction * 100)}%</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  hero: { height: 420, backgroundColor: Colors.surface, justifyContent: 'flex-end' },
  heroBody: { padding: Spacing.three, gap: Spacing.two, alignItems: 'center' },
  heroLogo: { width: '70%', height: 90 },
  heroTitle: { color: Colors.text, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  heroMeta: { color: Colors.textSecondary, fontSize: 14 },
  heroButtons: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
  heroPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 4,
    borderRadius: Radius.lg,
  },
  heroPrimaryLabel: { color: Colors.accentText, fontWeight: '800', fontSize: 16 },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
}));
