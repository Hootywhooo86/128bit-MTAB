import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Button, Cover, EmptyState, ProgressBar, formatBytes } from '@/components/ui';
import { Spacing, makeStyles, useColors } from '@/constants/theme';
import { getTorboxKey } from '@/lib/storage';
import { listAudioItems, type TorboxItem } from '@/lib/torbox';

/** Everything with audio files in the user's TorBox account. */
export default function TorboxCloudScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [items, setItems] = useState<TorboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!(await getTorboxKey())) {
      setNeedsKey(true);
      return;
    }
    setNeedsKey(false);
    try {
      setItems(await listAudioItems());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (needsKey) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="Connect TorBox"
          body="Add your TorBox API key to see your cloud audiobooks.">
          <Button label="Open Settings" onPress={() => router.push('/settings/integrations')} />
        </EmptyState>
      </View>
    );
  }
  if (error) return <EmptyState title="Couldn’t reach TorBox" body={error} />;
  if (!items) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={items}
      keyExtractor={(i) => `${i.kind}:${i.id}`}
      contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={Colors.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListEmptyComponent={<EmptyState title="No audiobooks in your TorBox yet" />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            router.push({
              pathname: '/cloud/[kind]/[id]',
              params: { kind: item.kind, id: String(item.id) },
            })
          }>
          <Cover size={52} title={item.name} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={2} style={styles.title}>
              {item.name}
            </Text>
            {item.download_finished ? (
              <Text style={styles.sub}>{formatBytes(item.size)}</Text>
            ) : (
              <>
                <Text style={styles.sub}>
                  {item.download_state ?? 'downloading'} · {Math.round(item.progress * 100)}%
                </Text>
                <ProgressBar value={item.progress} />
              </>
            )}
          </View>
        </Pressable>
      )}
    />
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  sub: { color: Colors.textSecondary, fontSize: 12 },
}));
