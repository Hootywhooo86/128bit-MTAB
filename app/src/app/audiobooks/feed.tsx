import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { Body, Cover, EmptyState, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { fetchFeed, resolveTorrent, type FeedItem, type Torrent } from '@/lib/feeds';
import { getTorboxKey } from '@/lib/storage';
import { addMagnet, checkCached } from '@/lib/torbox';

/** The newest posts in an RSS feed; send any of them to TorBox. */
export default function FeedScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { url, name } = useLocalSearchParams<{ url: string; name?: string }>();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await fetchFeed(url)).items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    fetchFeed(url).then(
      (f) => !cancelled && setItems(f.items),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const q = query.trim().toLowerCase();
  const visible = (items ?? []).filter(
    (i) => !q || `${i.title} ${i.author ?? ''} ${i.narrator ?? ''}`.toLowerCase().includes(q),
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: name || 'Latest uploads' }} />
      {error && !items ? (
        <EmptyState title="Couldn’t load the feed" body={error} />
      ) : !items ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.five }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(i, n) => i.link ?? `${n}:${i.title}`}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
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
          ListHeaderComponent={
            <View style={{ gap: Spacing.two, marginBottom: Spacing.two }}>
              <Input placeholder="Filter" value={query} onChangeText={setQuery} />
              <Body muted style={{ fontSize: 12 }}>
                The newest uploads. Tap one for details; TorBox sends it to your TorBox account.
              </Body>
            </View>
          }
          ListEmptyComponent={<Body muted>Nothing here.</Body>}
          renderItem={({ item }) => <FeedRow item={item} />}
        />
      )}
    </View>
  );
}

type SendState = 'idle' | 'sending' | 'sent' | { error: string };

function FeedRow({ item }: { item: FeedItem }) {
  const Colors = useColors();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [cached, setCached] = useState(false);
  const [state, setState] = useState<SendState>('idle');

  // Look up the torrent (cover, size, hash) the first time the row is opened.
  async function lookup() {
    if (torrent) return torrent;
    const t = await resolveTorrent(item);
    setTorrent(t);
    if (await getTorboxKey()) {
      checkCached([t.infoHash])
        .then((c) => setCached(c.has(t.infoHash)))
        .catch(() => {});
    }
    return t;
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !torrent) lookup().catch((e) => setState({ error: e.message }));
  }

  async function send() {
    if (!(await getTorboxKey())) {
      router.push('/settings/integrations');
      return;
    }
    setState('sending');
    try {
      const t = await lookup();
      await addMagnet(t.magnet, item.title);
      setState('sent');
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  const facts = [item.author, item.narrator && `read by ${item.narrator}`, item.format, item.bitrate]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable style={styles.row} onPress={toggle}>
      <View style={styles.top}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title} numberOfLines={open ? undefined : 2}>
            {cached ? '⚡ ' : ''}
            {item.title}
          </Text>
          {facts ? (
            <Text style={styles.meta} numberOfLines={open ? undefined : 1}>
              {facts}
            </Text>
          ) : null}
        </View>
        {state === 'sent' ? (
          <Pressable style={styles.sent} onPress={() => router.push('/audiobooks/cloud')}>
            <Ionicons name="checkmark" size={16} color={Colors.success} />
            <Text style={[styles.buttonText, { color: Colors.success }]}>In TorBox</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.button}
            disabled={state === 'sending'}
            onPress={send}
            accessibilityLabel="Send to TorBox">
            {state === 'sending' ? (
              <ActivityIndicator size="small" color={Colors.accentText} />
            ) : (
              <>
                <Ionicons name="cloud-download" size={16} color={Colors.accentText} />
                <Text style={styles.buttonText}>TorBox</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
      {typeof state === 'object' ? (
        <Text style={[styles.meta, { color: Colors.danger }]}>{state.error}</Text>
      ) : null}
      {open ? (
        <View style={styles.details}>
          <Cover uri={torrent?.cover} size={90} title={item.title} author={item.author} />
          <View style={{ flex: 1, gap: 4 }}>
            {torrent?.size ? <Text style={styles.meta}>{torrent.size}</Text> : null}
            {item.sharedBy ? <Text style={styles.meta}>Shared by {item.sharedBy}</Text> : null}
            {!torrent && typeof state !== 'object' ? (
              <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start' }} />
            ) : null}
            {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  row: {
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    gap: Spacing.two,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  summary: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  details: { flexDirection: 'row', gap: Spacing.three },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 84,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.accent,
  },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: Spacing.two },
  buttonText: { color: Colors.accentText, fontWeight: '700', fontSize: 13 },
}));
