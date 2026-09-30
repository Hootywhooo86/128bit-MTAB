import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Body, Button, Card, Heading, Input } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { installAddon, uninstallAddon } from '@/lib/addons';
import { useAddons } from '@/lib/hooks';
import { addPlaylist, getPlaylists, removePlaylist, type Playlist } from '@/lib/m3u';

/** Metadata-only addons that are safe to suggest (catalogs and details, no streams). */
const SUGGESTED = [
  {
    id: 'com.linvo.cinemeta',
    name: 'Cinemeta',
    description: 'Catalogs and details for movies and shows (the same one Stremio uses).',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
  },
];

const TYPE_LABELS: Record<string, string> = {
  movie: 'Movies',
  series: 'Shows',
  tv: 'Live TV',
  audiobook: 'Audiobooks',
};

function confirm(message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert('Remove', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function AddonsScreen() {
  const { addons, refresh } = useAddons();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [plName, setPlName] = useState('');
  const [plUrl, setPlUrl] = useState('');

  const loadPlaylists = useCallback(() => {
    getPlaylists().then(setPlaylists);
  }, []);
  useFocusEffect(loadPlaylists);

  async function install(target: string) {
    if (!target.trim()) return;
    setBusy(target);
    setError(null);
    try {
      await installAddon(target);
      setUrl('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePlaylist() {
    if (!/^https?:\/\//i.test(plUrl.trim())) return;
    await addPlaylist(plName, plUrl);
    setPlName('');
    setPlUrl('');
    loadPlaylists();
  }

  const suggestions = SUGGESTED.filter((s) => !addons.some((a) => a.manifest.id === s.id));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Heading>Install an addon</Heading>
        <Body muted>
          Paste a manifest URL. Stremio addons work for movies, shows and live TV; 128bit addons add audiobooks.
        </Body>
        <Input
          placeholder="https://example.com/manifest.json"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          onSubmitEditing={() => install(url)}
        />
        {error ? <Body style={{ color: Colors.danger }}>{error}</Body> : null}
        <Button label="Install" onPress={() => install(url)} loading={busy === url && !!url} />
      </Card>

      {suggestions.map((s) => (
        <Card key={s.id}>
          <Heading>Suggested: {s.name}</Heading>
          <Body muted>{s.description}</Body>
          <Button label="Install" variant="secondary" loading={busy === s.url} onPress={() => install(s.url)} />
        </Card>
      ))}

      <Heading>Installed addons</Heading>
      {addons.length === 0 ? <Body muted>Nothing installed yet.</Body> : null}
      {addons.map(({ manifest, baseUrl }) => (
        <Card key={manifest.id}>
          <View style={styles.row}>
            {manifest.logo ? <Image source={{ uri: manifest.logo }} style={styles.logo} /> : null}
            <View style={{ flex: 1 }}>
              <Heading>{manifest.name}</Heading>
              <Body muted style={{ fontSize: 12 }}>
                v{manifest.version} ·{' '}
                {manifest.types
                  .map((t) => TYPE_LABELS[t])
                  .filter(Boolean)
                  .join(', ')}
              </Body>
            </View>
          </View>
          {manifest.description ? <Body muted numberOfLines={3}>{manifest.description}</Body> : null}
          <Body muted numberOfLines={1} style={{ fontSize: 11 }}>
            {baseUrl}
          </Body>
          <Button
            label="Remove"
            variant="danger"
            onPress={() =>
              confirm(`Remove ${manifest.name}?`, async () => {
                await uninstallAddon(manifest.id);
                refresh();
              })
            }
          />
        </Card>
      ))}

      <Heading>Live TV playlists (M3U)</Heading>
      <Card>
        <Body muted>Add an M3U / M3U8 playlist URL from your TV provider. Channels show up in the Live TV tab.</Body>
        <Input placeholder="Name (optional)" value={plName} onChangeText={setPlName} />
        <Input placeholder="https://provider.example/playlist.m3u" value={plUrl} onChangeText={setPlUrl} keyboardType="url" />
        <Button label="Add playlist" onPress={savePlaylist} disabled={!/^https?:\/\//i.test(plUrl.trim())} />
      </Card>
      {playlists.map((p) => (
        <Card key={p.id}>
          <Heading>{p.name}</Heading>
          <Body muted numberOfLines={1} style={{ fontSize: 11 }}>
            {p.url}
          </Body>
          <Button
            label="Remove"
            variant="danger"
            onPress={() =>
              confirm(`Remove ${p.name}?`, async () => {
                await removePlaylist(p.id);
                loadPlaylists();
              })
            }
          />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  logo: { width: 40, height: 40, borderRadius: 8 },
});
