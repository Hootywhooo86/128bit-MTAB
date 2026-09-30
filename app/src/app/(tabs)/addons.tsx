import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Body, Button, Card, Heading, Input } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { installAddon, uninstallAddon } from '@/lib/addons';
import { useAddons } from '@/lib/hooks';

export default function AddonsScreen() {
  const { addons, refresh } = useAddons();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await installAddon(url);
      setUrl('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string, name: string) {
    const doRemove = async () => {
      await uninstallAddon(id);
      refresh();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${name}?`)) doRemove();
      return;
    }
    Alert.alert('Remove addon', `Remove ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: doRemove,
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Heading>Install an addon</Heading>
        <Body muted>Paste the addon’s manifest URL (it ends in /manifest.json).</Body>
        <Input
          placeholder="https://example.com/manifest.json"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          onSubmitEditing={install}
        />
        {error ? <Body style={{ color: Colors.danger }}>{error}</Body> : null}
        <Button label="Install" onPress={install} loading={busy} />
      </Card>

      <Heading>Installed</Heading>
      {addons.length === 0 ? <Body muted>Nothing installed yet.</Body> : null}
      {addons.map(({ manifest, baseUrl }) => (
        <Card key={manifest.id}>
          <View style={styles.row}>
            {manifest.logo ? <Image source={{ uri: manifest.logo }} style={styles.logo} /> : null}
            <View style={{ flex: 1 }}>
              <Heading>{manifest.name}</Heading>
              <Body muted style={{ fontSize: 12 }}>
                v{manifest.version} · {manifest.catalogs.length} catalog
                {manifest.catalogs.length === 1 ? '' : 's'}
              </Body>
            </View>
          </View>
          {manifest.description ? <Body muted>{manifest.description}</Body> : null}
          <Body muted numberOfLines={1} style={{ fontSize: 11 }}>
            {baseUrl}
          </Body>
          <Button label="Remove" variant="danger" onPress={() => remove(manifest.id, manifest.name)} />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  logo: { width: 40, height: 40, borderRadius: 8 },
});
