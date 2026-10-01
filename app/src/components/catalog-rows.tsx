import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { Body, Cover, Heading } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  discoverSection,
  getSources,
  isCatalog,
  searchCatalog,
  type CatalogBook,
  type DiscoverSection,
  type SourceConfig,
} from '@/lib/sources';

/** Rows of books from catalog sources: their discover sections, or search results for `query`. */
export function CatalogRows({ query }: { query?: string }) {
  const [catalogs, setCatalogs] = useState<SourceConfig[]>([]);

  useFocusEffect(
    useCallback(() => {
      getSources().then((all) =>
        setCatalogs(all.filter((s) => s.enabled !== false && isCatalog(s.config)).map((s) => s.config)),
      );
    }, []),
  );

  return (
    <>
      {catalogs.flatMap((c) =>
        query
          ? [<BookRow key={`${c.id}:s:${query}`} source={c} query={query} />]
          : (c.discover?.sections ?? []).map((section) => (
              <BookRow key={`${c.id}:${section.id}`} source={c} section={section} />
            )),
      )}
    </>
  );
}

function BookRow({
  source,
  section,
  query,
}: {
  source: SourceConfig;
  section?: DiscoverSection;
  query?: string;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [books, setBooks] = useState<CatalogBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (section ? discoverSection(source, section) : searchCatalog(source, query ?? ''))
      .then((b) => !cancelled && setBooks(b))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [source, section, query]);

  if (books?.length === 0 && !query) return null;

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Heading>{section ? section.title : `“${query}” in ${source.name}`}</Heading>
        {section ? (
          <Body muted style={{ fontSize: 12 }}>
            {source.name}
          </Body>
        ) : null}
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
          keyExtractor={(b, i) => `${b.id}:${i}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.three, gap: Spacing.three }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.tile}
              onPress={() =>
                router.push({
                  pathname: '/audiobooks/find',
                  params: {
                    title: item.title,
                    author: item.author ?? '',
                    narrator: item.narrator ?? '',
                    cover: item.cover ?? '',
                    description: item.description?.slice(0, 1500) ?? '',
                    year: item.year ?? '',
                    minutes: item.minutes ? String(Math.round(item.minutes)) : '',
                    series: item.series ?? '',
                    source: source.name,
                  },
                })
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

const useStyles = makeStyles((Colors) => ({
  tile: { width: 130, gap: 4 },
  tileTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
}));
