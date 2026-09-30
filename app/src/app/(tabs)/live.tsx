import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, Button, EmptyState, Input } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { fetchMetas, isBrowsable } from '@/lib/addons';
import { fetchPlaylist, getPlaylists } from '@/lib/m3u';
import { getAddons } from '@/lib/storage';
import { setNowWatching } from '@/lib/video';

type Row = {
  id: string;
  name: string;
  logo?: string;
  group?: string;
  /** M3U channels play straight away; addon channels open their stream list. */
  url?: string;
  meta?: { type: string; id: string; addon: string };
};

const ALL = 'All';

export default function LiveScreen() {
  const [channels, setChannels] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [group, setGroup] = useState(ALL);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const [playlists, addons] = await Promise.all([getPlaylists(), getAddons()]);
    const errs: string[] = [];
    const lists = await Promise.all([
      ...playlists.map((p) =>
        fetchPlaylist(p).catch((e) => {
          errs.push(String(e.message ?? e));
          return [];
        }),
      ),
      ...addons.flatMap((a) =>
        a.manifest.catalogs
          .filter((c) => c.type === 'tv' && isBrowsable(c))
          .map((c) =>
            fetchMetas(a, c)
              .then((metas) =>
                metas.map<Row>((m) => ({
                  id: `${a.manifest.id}:${m.id}`,
                  name: m.name,
                  logo: m.logo ?? m.poster,
                  group: m.genres?.[0] ?? c.name,
                  meta: { type: m.type || 'tv', id: m.id, addon: a.manifest.id },
                })),
              )
              .catch((e) => {
                errs.push(`${a.manifest.name}: ${e.message ?? e}`);
                return [] as Row[];
              }),
          ),
      ),
    ]);
    setChannels(lists.flat());
    setErrors(errs);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const groups = useMemo(
    () => [ALL, ...new Set((channels ?? []).map((c) => c.group).filter(Boolean) as string[])],
    [channels],
  );
  const q = query.trim().toLowerCase();
  const visible = (channels ?? []).filter(
    (c) => (group === ALL || c.group === group) && (!q || c.name.toLowerCase().includes(q)),
  );

  function open(c: Row) {
    if (c.url) {
      setNowWatching({ key: c.id, title: c.name, subtitle: c.group, poster: c.logo, uri: c.url, live: true });
      router.push('/watch');
    } else if (c.meta) {
      router.push({ pathname: '/title', params: c.meta });
    }
  }

  if (!channels) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  if (channels.length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="No channels yet"
          body="Add an M3U playlist from your TV provider, or install an addon with TV channels.">
          <Button label="Add a playlist or addon" onPress={() => router.push('/addons')} />
          {errors.map((e) => (
            <Body key={e} style={{ color: Colors.danger, fontSize: 12 }}>
              {e}
            </Body>
          ))}
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ padding: Spacing.three, gap: Spacing.two }}>
        <Input placeholder="Search channels" value={query} onChangeText={setQuery} clearButtonMode="while-editing" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
          {groups.map((g) => (
            <Pressable key={g} onPress={() => setGroup(g)} style={[styles.chip, g === group && styles.chipActive]}>
              <Text style={[styles.chipText, g === group && { color: Colors.accentText }]}>{g}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.five }}
        ListHeaderComponent={
          errors.length ? (
            <Body style={{ color: Colors.danger, fontSize: 12, marginBottom: Spacing.two }}>{errors.join('\n')}</Body>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open(item)}>
            <View style={styles.logo}>
              {item.logo ? (
                <Image source={{ uri: item.logo }} style={StyleSheet.absoluteFill} contentFit="contain" />
              ) : (
                <Text style={styles.logoFallback}>{item.name.slice(0, 2).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.group ? <Text style={styles.group}>{item.group}</Text> : null}
            </View>
            <Text style={styles.live}>● LIVE</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipActive: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  logo: {
    width: 64,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallback: { color: Colors.textSecondary, fontWeight: '800' },
  name: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  group: { color: Colors.textSecondary, fontSize: 12 },
  live: { color: Colors.danger, fontSize: 10, fontWeight: '800' },
});
