import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { SectionTitle, SettingsPage, ThemedSwitch } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  DEFAULT_FEEDS,
  addFeed,
  getFeeds,
  removeFeed,
  setFeedEnabled,
  type Feed,
} from '@/lib/feeds';
import {
  DEFAULT_SOURCES,
  getSources,
  installSource,
  SOURCE_TEMPLATE,
  isCatalog,
  removeSource,
  setSourceEnabled,
  type InstalledSource,
} from '@/lib/sources';
import { Pressable } from '@/components/focusable';

const CONFIG_SITE = 'https://pageturner-dsc.elfhosted.com/';

export default function SourcesSettings() {
  const Colors = useColors();
  const styles = useStyles();
  const [sources, setSources] = useState<InstalledSource[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getSources().then(setSources);
  }, []);
  useFocusEffect(load);

  async function add(target = url) {
    setBusy(true);
    setError(null);
    try {
      await installSource(target);
      if (target === url) setUrl('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage>
      <SectionTitle>Add a source</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.body}>
          Paste a source link in Pageturner’s format, or the source’s JSON itself to build your
          own. Book catalogs (iTunes, Audible…) fill Find audiobooks; download sources (torrent
          indexes) find the files. {'{TITLE}'} in the address is replaced with the book title.
        </Text>
        <Input
          placeholder="https://… or { …source JSON… }"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={{ maxHeight: 260, fontFamily: url.trim().startsWith('{') ? 'monospace' : undefined }}
        />
        {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
        <Button label="Add source" onPress={() => add()} loading={busy} disabled={!url.trim()} />
        <Button label="Start from a template" variant="secondary" onPress={() => setUrl(SOURCE_TEMPLATE)} />
        {DEFAULT_SOURCES.filter((d) => !sources.some((s) => s.url === d.url)).map((d) => (
          <View key={d.url} style={styles.header}>
            <Text style={[styles.body, { flex: 1 }]}>Suggested: {d.name}</Text>
            <Button label="Add" variant="secondary" onPress={() => add(d.url)} />
          </View>
        ))}
        <Button
          label="Open the Pageturner source config site"
          variant="secondary"
          onPress={() => Linking.openURL(CONFIG_SITE)}
        />
      </View>

      <SectionTitle>Your sources</SectionTitle>
      {sources.length === 0 ? <Text style={styles.body}>None yet.</Text> : null}
      {sources.map((s) => (
        <View key={s.config.id} style={[styles.card, s.enabled === false && { opacity: 0.6 }]}>
          <View style={styles.header}>
            <View style={styles.logo}>
              {s.config.icon?.startsWith('http') ? (
                <Image source={{ uri: s.config.icon }} style={{ width: 28, height: 28 }} />
              ) : (
                <Ionicons name="cloud-download" size={24} color={Colors.accent} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.config.name}</Text>
              <Text style={styles.body}>
                {isCatalog(s.config) ? 'Book catalog' : `${s.config.type} download source`} · v
                {s.config.version ?? '1'}
              </Text>
            </View>
            <ThemedSwitch
              value={s.enabled !== false}
              onValueChange={(on) => setSourceEnabled(s.config.id, on).then(load)}
            />
          </View>
          {s.config.description ? <Text style={styles.body}>{s.config.description}</Text> : null}
          {s.config.legal?.disclaimer ? (
            <Text style={styles.small}>{s.config.legal.disclaimer}</Text>
          ) : null}
          <View style={styles.actions}>
            {s.url.startsWith('custom:') ? (
              // Your own source: load its JSON into the box above to change it.
              <Pressable hitSlop={10} onPress={() => setUrl(JSON.stringify(s.config, null, 2))} accessibilityLabel="Edit">
                <Ionicons name="create" size={22} color={Colors.text} />
              </Pressable>
            ) : (
              <Pressable
                hitSlop={10}
                onPress={() => installSource(s.url).then(load, (e) => setError(String(e.message)))}
                accessibilityLabel="Refresh">
                <Ionicons name="refresh" size={22} color={Colors.text} />
              </Pressable>
            )}
            <Pressable
              hitSlop={10}
              onPress={() => removeSource(s.config.id).then(load)}
              accessibilityLabel="Remove">
              <Ionicons name="trash" size={22} color={Colors.danger} />
            </Pressable>
          </View>
        </View>
      ))}
      <FeedsCard />
      <Text style={styles.small}>
        Sources only search other sites; 128bit doesn’t host anything. Only download what you have
        the right to.
      </Text>
    </SettingsPage>
  );
}

/** RSS feeds of new uploads, shown as "New on …" in Find audiobooks. */
function FeedsCard() {
  const Colors = useColors();
  const styles = useStyles();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getFeeds().then(setFeeds);
  }, []);
  useFocusEffect(load);

  async function add(target: string) {
    setBusy(true);
    setError(null);
    try {
      await addFeed(target);
      if (target === url) setUrl('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>RSS feeds</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.body}>
          A feed of new uploads (like AudiobookBay’s /rss). 128bit finds each post’s torrent (from
          the feed, or the post’s page) and sends it to TorBox.
        </Text>
        <Input
          placeholder="http://… /rss"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          onSubmitEditing={() => add(url)}
        />
        {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
        <Button label="Add feed" onPress={() => add(url)} loading={busy} disabled={!url.trim()} />
        {DEFAULT_FEEDS.filter((d) => !feeds.some((f) => f.url === d.url)).map((d) => (
          <View key={d.url} style={styles.header}>
            <Text style={[styles.body, { flex: 1 }]}>Suggested: {d.name}</Text>
            <Button label="Add" variant="secondary" onPress={() => add(d.url)} />
          </View>
        ))}
      </View>
      {feeds.map((f) => (
        <View key={f.url} style={[styles.card, f.enabled === false && { opacity: 0.6 }]}>
          <View style={styles.header}>
            <View style={styles.logo}>
              <Ionicons name="logo-rss" size={24} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{f.name}</Text>
              <Text style={styles.small} numberOfLines={1}>
                {f.url}
              </Text>
            </View>
            <ThemedSwitch
              value={f.enabled !== false}
              onValueChange={(on) => setFeedEnabled(f.url, on).then(load)}
            />
          </View>
          <View style={styles.actions}>
            <Pressable
              hitSlop={10}
              onPress={() => removeFeed(f.url).then(load)}
              accessibilityLabel="Remove feed">
              <Ionicons name="trash" size={22} color={Colors.danger} />
            </Pressable>
          </View>
        </View>
      ))}
    </>
  );
}

const useStyles = makeStyles((Colors) => ({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  small: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  name: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.four },
}));
