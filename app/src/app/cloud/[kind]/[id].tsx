import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { PlayableActions } from '@/components/playable-actions';
import { Body, Cover, EmptyState, ProgressBar, Title } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { bookFromTorboxItem, type ResolveResult } from '@/lib/resolve';
import { getItem, type TorboxItem } from '@/lib/torbox';

/** A book straight from the user's TorBox cloud (no addon involved). */
export default function CloudItemScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const params = useLocalSearchParams<{
    kind: TorboxItem['kind'];
    id: string;
  }>();
  const itemId = Number(params.id);
  const [name, setName] = useState('');
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try {
        const item = await getItem(params.kind, itemId);
        if (cancelled) return;
        setName(item.name);
        if (item.download_finished) {
          setResult({ status: 'ready', book: bookFromTorboxItem(item) });
        } else {
          setResult({
            status: 'downloading',
            kind: item.kind,
            itemId,
            progress: item.progress,
          });
          timer = setTimeout(poll, 5000);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.kind, itemId]);

  if (error) return <EmptyState title="Couldn't open this item" body={error} />;
  if (!result) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: name }} />
      <View style={styles.header}>
        <Cover size={96} />
        <Title style={{ fontSize: 20, flex: 1 }}>{name}</Title>
      </View>
      {result.status === 'ready' ? (
        <PlayableActions book={result.book} />
      ) : (
        <>
          <Body muted>TorBox is still downloading this. {Math.round(result.progress * 100)}%</Body>
          <ProgressBar value={result.progress} />
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
}));
