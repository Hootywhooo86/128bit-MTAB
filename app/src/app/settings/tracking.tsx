import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text } from 'react-native';

import { Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { Radius, Spacing, makeStyles } from '@/constants/theme';
import { usePrefs } from '@/lib/prefs';
import {
  disconnect,
  getUsername,
  isConnected,
  pollDeviceAuth,
  startDeviceAuth,
  traktConfigured,
  type DeviceCode,
} from '@/lib/trakt';

export default function TrackingSettings() {
  const styles = useStyles();
  const { prefs, setPref } = usePrefs();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const yes = await isConnected();
    setConnected(yes);
    if (yes)
      getUsername()
        .then(setUsername)
        .catch(() => setUsername(null));
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

  async function connect() {
    setError(null);
    try {
      const dc = await startDeviceAuth();
      setCode(dc);
      Clipboard.setStringAsync(dc.user_code).catch(() => {});
      Linking.openURL(dc.verification_url);
      const deadline = Date.now() + dc.expires_in * 1000;
      let interval = dc.interval * 1000;
      const poll = async () => {
        if (Date.now() > deadline) {
          setCode(null);
          setError('The code expired. Try again.');
          return;
        }
        const result = await pollDeviceAuth(dc.device_code).catch(() => 'pending' as const);
        if (result === 'ok') {
          setCode(null);
          load();
        } else if (result === 'denied' || result === 'expired') {
          setCode(null);
          setError(
            result === 'denied' ? 'Access was denied on Trakt.' : 'The code expired. Try again.',
          );
        } else {
          if (result === 'slow') interval += 1000;
          timer.current = setTimeout(poll, interval);
        }
      };
      timer.current = setTimeout(poll, interval);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function signOut() {
    await disconnect();
    setUsername(null);
    load();
  }

  return (
    <SettingsPage>
      <LinearGradient
        colors={['#8E2DE2', '#D6206A', '#ED1C24']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.trakt}>
        <Text style={styles.traktLogo}>trakt</Text>
        {connected === null ? (
          <ActivityIndicator color="#fff" style={{ alignSelf: 'flex-start' }} />
        ) : connected ? (
          <>
            <Text style={styles.traktStatus}>Connected{username ? ` as ${username}` : ''}</Text>
            <Text style={styles.traktBody}>
              128bit scrobbles what you watch to Trakt and shows your Trakt progress in Continue
              Watching.
            </Text>
            <Pressable onPress={signOut} hitSlop={8}>
              <Text style={styles.traktLink}>Disconnect</Text>
            </Pressable>
          </>
        ) : code ? (
          <>
            <Text style={styles.traktStatus}>Enter this code on Trakt</Text>
            <Text style={styles.code}>{code.user_code}</Text>
            <Text style={styles.traktBody}>
              It’s been copied. Go to {code.verification_url.replace(/^https?:\/\//, '')} and
              approve 128bit. This page updates by itself.
            </Text>
            <ActivityIndicator color="#fff" style={{ alignSelf: 'flex-start' }} />
          </>
        ) : (
          <>
            <Text style={styles.traktBody}>
              Sync watch progress, continue watching and scrobbles with Trakt.
            </Text>
            {traktConfigured ? (
              <Pressable style={styles.connectButton} onPress={connect}>
                <Text style={styles.connectLabel}>Connect Trakt</Text>
              </Pressable>
            ) : (
              <Text style={styles.traktBody}>
                Trakt isn’t set up in this build yet: add EXPO_PUBLIC_TRAKT_CLIENT_ID and
                EXPO_PUBLIC_TRAKT_CLIENT_SECRET to app/.env (see .env.example).
              </Text>
            )}
          </>
        )}
        {error ? <Text style={styles.traktError}>{error}</Text> : null}
      </LinearGradient>

      <SectionTitle>Trakt features</SectionTitle>
      <Group>
        <ToggleRow
          title="Scrobble"
          subtitle="Tell Trakt what you're watching, and mark it watched when you finish."
          value={prefs.traktScrobble}
          onChange={(v) => setPref('traktScrobble', v)}
        />
        <ToggleRow
          title="Continue Watching from Trakt"
          subtitle="Add paused items from Trakt to Continue Watching on Shows and Movies."
          value={prefs.traktContinueWatching}
          onChange={(v) => setPref('traktContinueWatching', v)}
        />
      </Group>
    </SettingsPage>
  );
}

const useStyles = makeStyles(() => ({
  trakt: {
    borderRadius: 28,
    padding: Spacing.four,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  traktLogo: {
    color: '#fff',
    fontSize: 54,
    fontWeight: '900',
    letterSpacing: -2,
  },
  traktStatus: { color: '#fff', fontSize: 20, fontWeight: '700' },
  traktBody: { color: 'rgba(255,255,255,0.9)', fontSize: 15, lineHeight: 21 },
  traktLink: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    marginTop: Spacing.three,
    letterSpacing: 0.5,
  },
  traktError: { color: '#fff', fontWeight: '700', marginTop: Spacing.two },
  code: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 6,
    marginVertical: Spacing.two,
  },
  connectButton: {
    backgroundColor: '#fff',
    borderRadius: Radius.lg * 2,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  connectLabel: { color: '#000', fontWeight: '700', fontSize: 17 },
}));
