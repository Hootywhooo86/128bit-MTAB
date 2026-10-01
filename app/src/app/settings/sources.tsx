import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { SectionTitle, SettingsPage, ThemedSwitch } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  getSources,
  installSource,
  removeSource,
  setSourceEnabled,
  type InstalledSource,
} from '@/lib/sources';

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

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await installSource(url);
      setUrl('');
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
          Paste a download source URL in Pageturner’s format. Pick a source on the config site,
          tap Copy next to its Source URL, and paste it here. When you search in Audiobooks, these
          sources are searched too; tap TorBox on a result to send it to your TorBox account.
        </Text>
        <Input
          placeholder="https://…/meta/addons/….json"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          onSubmitEditing={add}
        />
        {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
        <Button label="Add source" onPress={add} loading={busy} disabled={!url.trim()} />
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
              {s.config.icon ? (
                <Image source={{ uri: s.config.icon }} style={{ width: 28, height: 28 }} />
              ) : (
                <Ionicons name="cloud-download" size={24} color={Colors.accent} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.config.name}</Text>
              <Text style={styles.body}>
                {s.config.type} · v{s.config.version ?? '1'}
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
            <Pressable
              hitSlop={10}
              onPress={() => installSource(s.url).then(load, (e) => setError(String(e.message)))}
              accessibilityLabel="Refresh">
              <Ionicons name="refresh" size={22} color={Colors.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              onPress={() => removeSource(s.config.id).then(load)}
              accessibilityLabel="Remove">
              <Ionicons name="trash" size={22} color={Colors.danger} />
            </Pressable>
          </View>
        </View>
      ))}
      <Text style={styles.small}>
        Sources only search other sites; 128bit doesn’t host anything. Only download what you have
        the right to.
      </Text>
    </SettingsPage>
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
