import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { MdblistCard, TmdbCard } from '@/components/metadata-cards';
import { SectionTitle, SettingsPage } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { absAccount, absLogin, absLoginWithApiKey, absLogout } from '@/lib/audiobookshelf';
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

      <SectionTitle>Metadata & ratings</SectionTitle>
      <View style={{ gap: Spacing.three }}>
        <TmdbCard />
        <MdblistCard />
      </View>

      <SectionTitle>Audiobookshelf</SectionTitle>
      <AudiobookshelfCard />
    </SettingsPage>
  );
}

function AudiobookshelfCard() {
  const Colors = useColors();
  const styles = useStyles();
  const [account, setAccount] = useState<{ server: string; username?: string } | null>(null);
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [useKey, setUseKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    absAccount().then(setAccount);
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      if (useKey) await absLoginWithApiKey(server, apiKey);
      else await absLogin(server, username, password);
      setPassword('');
      setApiKey('');
      setAccount(await absAccount());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (account) {
    return (
      <View style={styles.card}>
        <Text style={{ color: Colors.success }}>
          Connected{account.username ? ` as ${account.username}` : ''} · {account.server}
        </Text>
        <Text style={styles.body}>
          Your libraries show up under Audiobooks → search → Audiobookshelf. Listening progress
          syncs back to your server.
        </Text>
        <Button
          label="Disconnect"
          variant="danger"
          onPress={async () => {
            await absLogout();
            setAccount(null);
          }}
        />
      </View>
    );
  }

  const ready = server.trim() && (useKey ? apiKey.trim() : username.trim() && password);
  return (
    <View style={styles.card}>
      <Text style={styles.body}>
        Play audiobooks from your own Audiobookshelf server, with progress synced both ways.
      </Text>
      <Input
        placeholder="Server address, e.g. http://192.168.1.20:13378"
        value={server}
        onChangeText={setServer}
        keyboardType="url"
      />
      {useKey ? (
        <Input
          placeholder="API key (ABS → Settings → API Keys)"
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
        />
      ) : (
        <>
          <Input placeholder="Username" value={username} onChangeText={setUsername} />
          <Input
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </>
      )}
      {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
      <Button label="Connect" onPress={connect} loading={busy} disabled={!ready} />
      <Button
        label={useKey ? 'Use username & password instead' : 'Use an API key instead'}
        variant="secondary"
        onPress={() => setUseKey(!useKey)}
      />
    </View>
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
