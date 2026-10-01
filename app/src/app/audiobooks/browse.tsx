import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { CatalogRows } from '@/components/catalog-rows';
import { SourceResults } from '@/components/source-results';
import { Body, Button, Cover, EmptyState, Heading, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchCatalog, supportsSearch } from '@/lib/addons';
import { useAddons } from '@/lib/hooks';
import { getFeeds, type Feed } from '@/lib/feeds';
import { getSources, isCatalog } from '@/lib/sources';
import type { BookPreview, CatalogDef, InstalledAddon } from '@/lib/types';

type Row = {
  key: string;
  addon: InstalledAddon;
  catalog: CatalogDef;
  search?: string;
};

/** Find audiobooks: your TorBox cloud plus every audiobook addon catalog. */
export default function BrowseAudiobooksScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { addons } = useAddons();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [sourceCount, setSourceCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [feeds, setFeeds] = useState<Feed[]>([]);

  useFocusEffect(
    useCallback(() => {
      getSources().then((all) => {
        const on = all.filter((x) => x.enabled !== false);
        setSourceCount(on.filter((x) => !isCatalog(x.config)).length);
        setCatalogCount(on.filter((x) => isCatalog(x.config)).length);
      });
      getFeeds().then((all) => setFeeds(all.filter((f) => f.enabled !== false)));
    }, []),
  );

  const rows: Row[] = addons.flatMap((addon) => {
    const catalogs = addon.manifest.catalogs.filter((c) => c.type === 'audiobook');
    return submitted
      ? catalogs.filter(supportsSearch).map((catalog) => ({
          key: `${addon.manifest.id}/${catalog.id}/s`,
          addon,
          catalog,
          search: submitted,
        }))
      : catalogs.map((catalog) => ({
          key: `${addon.manifest.id}/${catalog.id}`,
          addon,
          catalog,
        }));
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingVertical: Spacing.three,
        gap: Spacing.four,
      }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Input
          placeholder="Search audiobooks"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => setSubmitted(query.trim())}
          clearButtonMode="while-editing"
        />
      </View>
      {!submitted ? (
        <Pressable style={styles.cloud} onPress={() => router.push('/audiobooks/cloud')}>
          <Ionicons name="cloud-outline" size={24} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Heading>Your TorBox cloud</Heading>
            <Body muted style={{ fontSize: 13 }}>
              Audiobooks already in your TorBox account
            </Body>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </Pressable>
      ) : null}
      {!submitted ? (
        <Pressable style={styles.cloud} onPress={() => router.push('/audiobooks/abs')}>
          <Ionicons name="server-outline" size={24} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Heading>Audiobookshelf</Heading>
            <Body muted style={{ fontSize: 13 }}>
              Your own audiobook server
            </Body>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </Pressable>
      ) : null}
      {!submitted ? (
        <Pressable style={styles.cloud} onPress={() => router.push('/settings/sources')}>
          <Ionicons name="cloud-download-outline" size={24} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Heading>Sources</Heading>
            <Body muted style={{ fontSize: 13 }}>
              {sourceCount || catalogCount
                ? `${catalogCount} catalogs, ${sourceCount} download sources. Tap a book to send it to TorBox`
                : 'Add Pageturner catalogs and download sources'}
            </Body>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </Pressable>
      ) : null}
      {!submitted
        ? feeds.map((f) => (
            <Pressable
              key={f.url}
              style={styles.cloud}
              onPress={() =>
                router.push({ pathname: '/audiobooks/feed', params: { url: f.url, name: f.name } })
              }>
              <Ionicons name="logo-rss" size={24} color={Colors.accent} />
              <View style={{ flex: 1 }}>
                <Heading>New on {f.name}</Heading>
                <Body muted style={{ fontSize: 13 }}>
                  Latest uploads from the RSS feed. Send any to TorBox
                </Body>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
            </Pressable>
          ))
        : null}
      <CatalogRows query={submitted || undefined} />
      {submitted ? <SourceResults key={submitted} query={submitted} /> : null}
      {rows.length === 0 && !sourceCount && !catalogCount ? (
        <EmptyState
          title={submitted ? 'Nothing to search' : 'No audiobook addons'}
          body={
            submitted
              ? 'None of your audiobook addons support search, and no download sources are set up.'
              : 'Install an audiobook addon to browse catalogs here.'
          }>
          <Button label="Manage addons" onPress={() => router.push('/addons')} />
        </EmptyState>
      ) : null}
      {rows.map(({ key, ...row }) => (
        <CatalogRow key={`${key}:${row.search ?? ''}`} {...row} />
      ))}
    </ScrollView>
  );
}

function CatalogRow({ addon, catalog, search }: Omit<Row, 'key'>) {
  const Colors = useColors();
  const styles = useStyles();
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog(addon, catalog, search)
      .then((b) => !cancelled && setBooks(b))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [addon, catalog, search]);

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Heading>{search ? `“${search}” in ${catalog.name}` : catalog.name}</Heading>
        <Body muted style={{ fontSize: 12 }}>
          {addon.manifest.name}
        </Body>
      </View>
      {error ? (
        <Body muted style={{ paddingHorizontal: Spacing.three, color: Colors.danger }}>
          {error}
        </Body>
      ) : !books ? (
        <ActivityIndicator
          color={Colors.accent}
          style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }}
        />
      ) : books.length === 0 ? (
        <Body muted style={{ paddingHorizontal: Spacing.three }}>
          No results
        </Body>
      ) : (
        <FlatList
          horizontal
          data={books}
          keyExtractor={(b) => b.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: Spacing.three,
            gap: Spacing.three,
          }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.tile}
              onPress={() =>
                router.push({
                  pathname: '/book',
                  params: { addon: addon.manifest.id, id: item.id },
                })
              }>
              <Cover uri={item.cover} size={130} title={item.title} author={item.author} />
              <Text numberOfLines={2} style={styles.tileTitle}>
                {item.title}
              </Text>
              {item.author ? (
                <Text numberOfLines={1} style={styles.tileSub}>
                  {item.author}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  cloud: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tile: { width: 130, gap: 4 },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
}));
