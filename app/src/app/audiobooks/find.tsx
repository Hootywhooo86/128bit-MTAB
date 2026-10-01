import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { SourceResults } from '@/components/source-results';
import { Body, Button, Cover, Input, Title } from '@/components/ui';
import { Spacing, makeStyles } from '@/constants/theme';
import { cleanTitle, getSources, isCatalog } from '@/lib/sources';

/** A book from a catalog (iTunes, Audible…): details, then torrents for it from your download sources. */
export default function FindBookScreen() {
  const styles = useStyles();
  const p = useLocalSearchParams<{
    title: string;
    author?: string;
    narrator?: string;
    cover?: string;
    description?: string;
    year?: string;
    minutes?: string;
    series?: string;
    source?: string;
  }>();
  const [query, setQuery] = useState(cleanTitle(p.title ?? ''));
  const [submitted, setSubmitted] = useState(query);
  const [downloadSources, setDownloadSources] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getSources().then((all) =>
      setDownloadSources(all.filter((s) => s.enabled !== false && !isCatalog(s.config)).length),
    );
  }, []);

  const minutes = Number(p.minutes) || 0;
  const facts = [
    p.year,
    minutes ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : null,
    p.series,
    p.source,
  ].filter(Boolean);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingVertical: Spacing.three, gap: Spacing.four }}>
      <Stack.Screen options={{ title: '' }} />
      <View style={styles.header}>
        <Cover uri={p.cover || undefined} size={120} />
        <View style={{ flex: 1, gap: 4 }}>
          <Title style={{ fontSize: 22 }}>{p.title}</Title>
          {p.author ? <Body>{p.author}</Body> : null}
          {p.narrator ? <Body muted>Narrated by {p.narrator}</Body> : null}
          {facts.length ? <Body muted style={{ fontSize: 13 }}>{facts.join(' · ')}</Body> : null}
        </View>
      </View>
      {p.description ? (
        <Text
          style={styles.description}
          numberOfLines={expanded ? undefined : 4}
          onPress={() => setExpanded(!expanded)}>
          {p.description}
        </Text>
      ) : null}
      <View style={{ paddingHorizontal: Spacing.three, gap: Spacing.two }}>
        <Body muted style={{ fontSize: 13 }}>
          Not finding it? Change the search words:
        </Body>
        <Input
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => setSubmitted(query.trim())}
        />
      </View>
      {downloadSources === 0 ? (
        <View style={{ paddingHorizontal: Spacing.three, gap: Spacing.two }}>
          <Body muted>Add a download source to look for this book and send it to TorBox.</Body>
          <Button label="Add download sources" onPress={() => router.push('/settings/sources')} />
        </View>
      ) : submitted ? (
        <SourceResults
          key={submitted}
          query={submitted}
          author={p.author || undefined}
          title="Get it with TorBox"
        />
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.three },
  description: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: Spacing.three,
  },
}));
