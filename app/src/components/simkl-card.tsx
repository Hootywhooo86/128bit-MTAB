import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  disconnectSimkl,
  pollSimklPin,
  setSimklClientId,
  simklConfigured,
  simklConnected,
  simklUsername,
  startSimklPin,
  type SimklPin,
} from '@/lib/simkl';

/** Connect Simkl: Client ID → PIN code on simkl.com → scrobbling. */
export function SimklCard() {
  const Colors = useColors();
  const styles = useStyles();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState<SimklPin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setConfigured(await simklConfigured());
    const yes = await simklConnected();
    setConnected(yes);
    if (yes) simklUsername().then(setUser, () => setUser(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function saveId() {
    setError(null);
    await setSimklClientId(clientId);
    setClientId('');
    setEditing(false);
    load();
  }

  async function connect() {
    setError(null);
    try {
      const p = await startSimklPin();
      setPin(p);
      Clipboard.setStringAsync(p.user_code).catch(() => {});
      Linking.openURL(p.verification_url || 'https://simkl.com/pin/');
      const deadline = Date.now() + p.expires_in * 1000;
      const poll = async () => {
        if (Date.now() > deadline) {
          setPin(null);
          setError('The code expired. Try again.');
          return;
        }
        const r = await pollSimklPin(p.user_code).catch(() => 'pending' as const);
        if (r === 'ok') {
          setPin(null);
          load();
        } else {
          timer.current = setTimeout(poll, Math.max(5, p.interval) * 1000);
        }
      };
      timer.current = setTimeout(poll, Math.max(5, p.interval) * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.logo}>simkl</Text>
      {configured === null ? (
        <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start' }} />
      ) : connected ? (
        <>
          <Text style={{ color: Colors.success }}>Connected{user ? ` as ${user}` : ''}</Text>
          <Text style={styles.body}>
            Movies, episodes and anime you watch are scrobbled to Simkl and marked watched when you
            finish them.
          </Text>
          <Button
            label="Disconnect"
            variant="danger"
            onPress={async () => {
              await disconnectSimkl();
              load();
            }}
          />
        </>
      ) : pin ? (
        <>
          <Text style={styles.status}>Enter this code on Simkl</Text>
          <Text style={styles.code}>{pin.user_code}</Text>
          <Text style={styles.body}>
            It’s been copied. Go to {(pin.verification_url || 'simkl.com/pin').replace(/^https?:\/\//, '')}{' '}
            and approve 128bit. This updates by itself.
          </Text>
          <ActivityIndicator color={Colors.accent} style={{ alignSelf: 'flex-start' }} />
        </>
      ) : configured && !editing ? (
        <>
          <Text style={styles.body}>Track movies, shows and anime on Simkl.</Text>
          <Button label="Connect Simkl" onPress={connect} />
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <Text style={styles.link}>Change Client ID</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.body}>
            Simkl needs your own (free) app: on simkl.com go to Settings → Developer → Create new
            app, name it 128bit, use{' '}
            <Text style={{ fontWeight: '800', color: Colors.text }}>urn:ietf:wg:oauth:2.0:oob</Text>{' '}
            as the redirect URI, then paste the Client ID here.
          </Text>
          <Pressable
            onPress={() => Linking.openURL('https://simkl.com/settings/developer/new/')}
            hitSlop={8}>
            <Text style={styles.link}>Open Simkl developer settings</Text>
          </Pressable>
          <Input
            placeholder="Simkl Client ID"
            value={clientId}
            onChangeText={setClientId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button label="Save Client ID" onPress={saveId} disabled={!clientId.trim()} />
        </>
      )}
      {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
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
  logo: { color: Colors.text, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  status: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  code: { color: Colors.text, fontSize: 34, fontWeight: '900', letterSpacing: 6 },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  link: { color: Colors.accent, fontWeight: '700', fontSize: 15 },
}));
