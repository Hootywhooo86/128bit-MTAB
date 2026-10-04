import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Body, Button, EmptyState, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { CHANNEL_TYPES, SPORT_TYPES, fetchMetas, isBrowsable } from '@/lib/addons';
import { fetchPlaylist, getPlaylists } from '@/lib/m3u';
import { getActiveAddons } from '@/lib/storage';
import { setNowWatching } from '@/lib/video';
import { Pressable } from '@/components/focusable';
import { IS_TV } from '@/constants/tv';

type Row = {
  id: string;
  name: string;
  logo?: string;
  group?: string;
  kind: Kind;
  /** Extra line, e.g. "LIVE" or a kick-off time for sports. */
  info?: string;
  live?: boolean;
  /** M3U channels play straight away; addon channels open their stream list. */
  url?: string;
  meta?: { type: string; id: string; addon: string };
};

const ALL = 'All';
type Kind = 'channels' | 'sports';

export default function LiveScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const [channels, setChannels] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [group, setGroup] = useState(ALL);
  const [kind, setKind] = useState<Kind>('channels');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const [playlists, addons] = await Promise.all([getPlaylists(), getActiveAddons()]);
    const errs: string[] = [];
    const lists = await Promise.all([
      ...playlists.map((p) =>
        fetchPlaylist(p)
          .then((list) => list.map<Row>((c) => ({ ...c, kind: 'channels', live: true })))
          .catch((e) => {
            errs.push(String(e.message ?? e));
            return [] as Row[];
          }),
      ),
      ...addons.flatMap((a) =>
        a.manifest.catalogs
          .filter(
            (c) =>
              (CHANNEL_TYPES.includes(c.type) || SPORT_TYPES.includes(c.type)) && isBrowsable(c),
          )
          .map((c) => {
            const sports = SPORT_TYPES.includes(c.type);
            return fetchMetas(a, c)
              .then((metas) =>
                metas.map<Row>((m) => {
                  const live = sports ? /\blive\b/i.test(m.releaseInfo ?? '') : true;
                  return {
                    id: `${a.manifest.id}:${c.id}:${m.id}`,
                    name: m.name,
                    logo: m.logo ?? m.poster,
                    // Sports are grouped by the addon's catalogs (Live Now, Today, Hockey…).
                    group: sports ? c.name : (m.genres?.[0] ?? c.name),
                    kind: sports ? 'sports' : 'channels',
                    info: sports && !live ? m.releaseInfo : undefined,
                    live,
                    meta: {
                      type: m.type || c.type,
                      id: m.id,
                      addon: a.manifest.id,
                    },
                  };
                }),
              )
              .catch((e) => {
                errs.push(`${a.manifest.name}: ${e.message ?? e}`);
                return [] as Row[];
              });
          }),
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

  const hasSports = (channels ?? []).some((c) => c.kind === 'sports');
  const hasChannels = (channels ?? []).some((c) => c.kind === 'channels');
  // Only sports installed? Show them without making you switch.
  const shown: Kind = kind === 'sports' || !hasChannels ? 'sports' : 'channels';
  const ofKind = useMemo(
    () => (channels ?? []).filter((c) => c.kind === shown),
    [channels, shown],
  );
  const groups = useMemo(
    () => [ALL, ...new Set(ofKind.map((c) => c.group).filter(Boolean) as string[])],
    [ofKind],
  );
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const visible = ofKind.filter((c) => {
    if (group !== ALL && c.group !== group) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    // A match can be in several sports catalogs; list it once under All.
    const key = c.meta ? `${c.meta.addon}:${c.meta.id}` : c.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  function switchKind(k: Kind) {
    setKind(k);
    setGroup(ALL);
  }

  function open(c: Row) {
    if (c.url) {
      // The list you're looking at, so channel up/down works in the player.
      const channels = visible
        .filter((x) => x.url)
        .map((x) => ({ key: x.id, title: x.name, subtitle: x.group, poster: x.logo, uri: x.url! }));
      setNowWatching({
        key: c.id,
        title: c.name,
        subtitle: c.group,
        poster: c.logo,
        uri: c.url,
        live: true,
        channels,
      });
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
          body="Add an M3U playlist from your TV provider, or install an addon with TV channels or live sports.">
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
        {hasSports && hasChannels ? (
          <View style={styles.segment}>
            {(['channels', 'sports'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => switchKind(k)}
                style={[styles.segmentItem, shown === k && styles.segmentActive]}>
                <Text style={[styles.segmentText, shown === k && { color: Colors.accentText }]}>
                  {k === 'channels' ? 'Channels' : 'Sports'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Input
          placeholder={shown === 'sports' ? 'Search matches' : 'Search channels'}
          value={query}
          onChangeText={setQuery}
          clearButtonMode="while-editing"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.two }}>
          {groups.map((g) => (
            <Pressable
              key={g}
              onPress={() => setGroup(g)}
              style={[styles.chip, g === group && styles.chipActive]}>
              <Text style={[styles.chipText, g === group && { color: Colors.accentText }]}>
                {g}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{
          paddingHorizontal: Spacing.three,
          paddingBottom: Spacing.five,
        }}
        ListHeaderComponent={
          errors.length ? (
            <Body
              style={{
                color: Colors.danger,
                fontSize: 12,
                marginBottom: Spacing.two,
              }}>
              {errors.join('\n')}
            </Body>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open(item)}>
            <View style={styles.logo}>
              {item.logo ? (
                <Image
                  source={{ uri: item.logo }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                />
              ) : (
                <Text style={styles.logoFallback}>{item.name.slice(0, 2).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.info || item.group ? (
                <Text style={styles.group} numberOfLines={1}>
                  {[item.info, item.group].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            {item.live ? <Text style={styles.live}>● LIVE</Text> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipActive: { backgroundColor: Colors.accent },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.lg,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
  },
  segmentActive: { backgroundColor: Colors.accent },
  segmentText: { color: Colors.text, fontWeight: '700' },
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
    // Bigger on a TV, read from across the room.
    width: IS_TV ? 120 : 64,
    height: IS_TV ? 80 : 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallback: { color: Colors.textSecondary, fontWeight: '800' },
  name: { color: Colors.text, fontWeight: '600', fontSize: IS_TV ? 22 : 15 },
  group: { color: Colors.textSecondary, fontSize: IS_TV ? 16 : 12 },
  live: { color: Colors.danger, fontSize: 10, fontWeight: '800' },
}));
