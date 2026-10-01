import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  getHardcoverToken,
  hardcoverMe,
  lastHardcoverSync,
  setHardcoverToken,
} from '@/lib/hardcover';

/** Connect / disconnect Hardcover book tracking. */
export function HardcoverCard() {
  const Colors = useColors();
  const styles = useStyles();
  const [user, setUser] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState(lastHardcoverSync);

  useFocusEffect(
    useCallback(() => {
      setSync(lastHardcoverSync());
      getHardcoverToken().then((t) => {
        setConnected(!!t);
        if (t)
          hardcoverMe()
            .then((me) => setUser(me.username))
            .catch(() => setUser(null));
      });
    }, []),
  );

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const clean = token.trim().replace(/^bearer\s+/i, '');
      const me = await hardcoverMe(clean);
      await setHardcoverToken(clean);
      setUser(me.username);
      setConnected(true);
      setToken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (connected) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Hardcover</Text>
        <Text style={{ color: Colors.success }}>Connected{user ? ` as ${user}` : ''}</Text>
        <Text style={styles.body}>
          Books you listen to are marked Currently Reading on Hardcover, with your listening
          progress, and Read when you finish. If it picks the wrong book, tap Hardcover in the
          player to choose the right one.
        </Text>
        {sync ? (
          <Text style={{ color: sync.ok ? Colors.textSecondary : Colors.danger }}>
            Last sync: {sync.message}
          </Text>
        ) : null}
        <Button
          label="Disconnect"
          variant="danger"
          onPress={async () => {
            await setHardcoverToken(null);
            setConnected(false);
            setUser(null);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Hardcover</Text>
      <Text style={styles.body}>
        Track the audiobooks you listen to on Hardcover. Copy your API token from
        hardcover.app → Settings → Hardcover API and paste it here.
      </Text>
      <Input
        placeholder="Hardcover API token"
        value={token}
        onChangeText={setToken}
        secureTextEntry
      />
      {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
      <Button label="Connect" onPress={connect} loading={busy} disabled={!token.trim()} />
      <Button
        label="Get your API token"
        variant="secondary"
        onPress={() => Linking.openURL('https://hardcover.app/account/api')}
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
  title: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
}));
