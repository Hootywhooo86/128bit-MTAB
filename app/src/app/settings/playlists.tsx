import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { addPlaylist, getPlaylists, removePlaylist, type Playlist } from '@/lib/m3u';

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

export default function PlaylistsSettings() {
  const Colors = useColors();
  const styles = useStyles();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(() => {
    getPlaylists().then(setPlaylists);
  }, []);
  useFocusEffect(load);

  async function save() {
    if (!isUrl(url)) return;
    await addPlaylist(name, url);
    setName('');
    setUrl('');
    load();
  }

  function remove(p: Playlist) {
    const go = async () => {
      await removePlaylist(p.id);
      load();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${p.name}?`)) go();
      return;
    }
    Alert.alert('Remove playlist', p.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go },
    ]);
  }

  return (
    <SettingsPage>
      <SectionTitle>Add playlist</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Paste an M3U / M3U8 playlist URL from your TV provider. Its channels show up in the Live
          TV tab.
        </Text>
        <Input placeholder="Name (optional)" value={name} onChangeText={setName} />
        <Input
          placeholder="https://provider.example/playlist.m3u"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
        />
        <Button label="Add playlist" onPress={save} disabled={!isUrl(url)} />
      </View>

      <SectionTitle>Your playlists</SectionTitle>
      {playlists.length === 0 ? (
        <Text style={styles.hint}>No playlists yet.</Text>
      ) : (
        <Group>
          {playlists.map((p) => (
            <Row
              key={p.id}
              icon="list"
              title={p.name}
              subtitle={p.url}
              onPress={() => remove(p)}
              right={<Text style={{ color: Colors.danger, fontWeight: '600' }}>Remove</Text>}
            />
          ))}
        </Group>
      )}
    </SettingsPage>
  );
}

const useStyles = makeStyles((Colors) => ({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  hint: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
}));
