import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { SectionTitle, SettingsPage } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { getTorboxKey, setTorboxKey } from '@/lib/storage';
import { testKey } from '@/lib/torbox';

export default function IntegrationsSettings() {
  const Colors = useColors();
  const styles = useStyles();
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
      setMessage({
        ok: true,
        text: `Connected${me.email ? ` as ${me.email}` : ''}.`,
      });
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
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
    <SettingsPage>
      <SectionTitle>TorBox</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.body}>
          128bit sends torrents and links to your TorBox account, then streams the finished files
          from there (and saves audiobooks to your phone if you want). Your key is stored in the
          device’s secure storage.
        </Text>
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
          <Text style={{ color: message.ok ? Colors.success : Colors.danger }}>{message.text}</Text>
        ) : null}
        <Button
          label={saved ? 'Test again' : 'Save & test'}
          onPress={save}
          loading={busy}
          disabled={!key.trim()}
        />
        {saved ? <Button label="Disconnect" variant="danger" onPress={disconnect} /> : null}
        <Button
          label="Get your API key"
          variant="secondary"
          onPress={() => Linking.openURL('https://torbox.app/settings')}
        />
      </View>
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
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
}));
