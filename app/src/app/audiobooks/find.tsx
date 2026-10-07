import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AbbResults } from '@/components/abb-results';
import { SourceResults } from '@/components/source-results';
import { TorboxMatches } from '@/components/torbox-matches';
import { Body, Button, Cover, Input, Title } from '@/components/ui';
import { Spacing, makeStyles } from '@/constants/theme';
import { cleanTitle, getSources, isCatalog } from '@/lib/sources';
import { addWanted, isWanted, markSent, wantedId } from '@/lib/wanted';

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
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    isWanted(p.title ?? '', p.author || undefined).then(setWanted);
  }, [p.title, p.author]);

  // Sending something for a wanted book records it, so the Wanted tab can follow TorBox.
  const onSent = (torboxId: number, name: string) => {
    if (wanted) markSent(wantedId(p.title ?? '', p.author || undefined), name, torboxId);
  };

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
      <View style={{ paddingHorizontal: Spacing.three }}>
        <Button
          label={wanted ? '✓ On your Wanted list' : 'Add to Wanted'}
          variant="secondary"
          disabled={wanted}
          onPress={async () => {
            await addWanted({
              title: p.title ?? '',
              author: p.author || undefined,
              cover: p.cover || undefined,
            });
            setWanted(true);
          }}
        />
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
      {submitted ? <TorboxMatches key={`tb:${submitted}`} query={submitted} onPick={onSent} /> : null}
      {submitted ? <AbbResults key={`abb:${submitted}`} query={submitted} onSent={onSent} /> : null}
      {submitted && downloadSources ? (
        <SourceResults
          key={submitted}
          query={submitted}
          author={p.author || undefined}
          title="Other download sources"
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
