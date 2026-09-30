import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Cover, EmptyState, Heading, Input } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { fetchCatalog, supportsSearch } from '@/lib/addons';
import { useAddons } from '@/lib/hooks';
import type { BookPreview, CatalogDef, InstalledAddon } from '@/lib/types';

type Row = { key: string; addon: InstalledAddon; catalog: CatalogDef; search?: string };

export default function DiscoverScreen() {
  const { addons, loaded } = useAddons();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  if (loaded && addons.length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="No addons yet"
          body="Addons are where audiobooks come from. Install one by pasting its manifest URL.">
          <Button label="Add an addon" onPress={() => router.navigate('/addons')} />
        </EmptyState>
      </View>
    );
  }

  const rows: Row[] = addons.flatMap((addon) =>
    submitted
      ? addon.manifest.catalogs
          .filter(supportsSearch)
          .map((catalog) => ({ key: `${addon.manifest.id}/${catalog.id}/s`, addon, catalog, search: submitted }))
      : addon.manifest.catalogs.map((catalog) => ({ key: `${addon.manifest.id}/${catalog.id}`, addon, catalog })),
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingVertical: Spacing.three, gap: Spacing.four }}>
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
      {submitted && rows.length === 0 ? (
        <EmptyState title="Nothing to search" body="None of your addons support search." />
      ) : null}
      {rows.map(({ key, ...row }) => (
        <CatalogRow key={`${key}:${row.search ?? ''}`} {...row} />
      ))}
    </ScrollView>
  );
}

function CatalogRow({ addon, catalog, search }: Omit<Row, 'key'>) {
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
        <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start', marginLeft: Spacing.three }} />
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
          contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.tile}
              onPress={() =>
                router.push({ pathname: '/book', params: { addon: addon.manifest.id, id: item.id } })
              }>
              <Cover uri={item.cover} size={130} />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  tile: { width: 130, gap: 4 },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
});
