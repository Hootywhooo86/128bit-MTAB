import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet } from 'react-native';

import { Body, Button, Card, Heading, Input } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { getTorboxKey, setTorboxKey } from '@/lib/storage';
import { testKey } from '@/lib/torbox';

export default function SettingsScreen() {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getTorboxKey().then((k) => {
      if (k) {
        setKey(k);
        setSaved(true);
      }
    });
  }, []);

  async function save() {
    const trimmed = key.trim();
    setBusy(true);
    setMessage(null);
    try {
      const me = await testKey(trimmed);
      await setTorboxKey(trimmed);
      setSaved(true);
      setMessage({ ok: true, text: `Connected${me.email ? ` as ${me.email}` : ''}.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await setTorboxKey(null);
    setKey('');
    setSaved(false);
    setMessage(null);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Heading>TorBox</Heading>
        <Body muted>
          128bit sends torrents and links to your TorBox account, then streams or downloads the finished audio
          files from there. Your key is stored in the device’s secure storage.
        </Body>
        <Input
          placeholder="TorBox API key"
          value={key}
          onChangeText={(t) => {
            setKey(t);
            setSaved(false);
          }}
          secureTextEntry
        />
        {message ? (
          <Body style={{ color: message.ok ? Colors.success : Colors.danger }}>{message.text}</Body>
        ) : null}
        <Button label={saved ? 'Test again' : 'Save & test'} onPress={save} loading={busy} disabled={!key.trim()} />
        {saved ? <Button label="Disconnect" variant="danger" onPress={disconnect} /> : null}
        <Button
          label="Get your API key"
          variant="secondary"
          onPress={() => Linking.openURL('https://torbox.app/settings')}
        />
      </Card>

      <Card>
        <Heading>About</Heading>
        <Body muted>
          128bit is a player. It doesn’t host or provide any content. What you can find depends on the addons
          you install, and you’re responsible for having the rights to what you download.
        </Body>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.three, gap: Spacing.three },
});
