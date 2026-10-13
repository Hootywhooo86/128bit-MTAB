import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput } from 'react-native';

import { syncHistoryToTracker } from '@/lib/tracker-sync';
import { Group, Row, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { TraktRowPicker } from '@/components/trakt-row-picker';
import { Radius, Spacing, makeStyles } from '@/constants/theme';
import { HardcoverCard } from '@/components/hardcover-card';
import { SimklCard } from '@/components/simkl-card';
import { usePrefs } from '@/lib/prefs';
import {
  disconnect,
  getUsername,
  isConnected,
  pollDeviceAuth,
  setTraktKeys,
  startDeviceAuth,
  traktBuiltIn,
  traktConfigured,
  type DeviceCode,
} from '@/lib/trakt';
import { Pressable } from '@/components/focusable';
import { IS_TV } from '@/constants/tv';

export default function TrackingSettings() {
  const styles = useStyles();
  const { prefs, setPref } = usePrefs();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [configured, setConfigured] = useState(traktBuiltIn);
  const [editKeys, setEditKeys] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setConfigured(await traktConfigured());
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

  async function saveKeys() {
    setError(null);
    await setTraktKeys(clientId, secret);
    setEditKeys(false);
    setClientId('');
    setSecret('');
    load();
  }

  async function signOut() {
    await disconnect();
    setUsername(null);
    load();
  }

  return (
    <SettingsPage>
      <SectionTitle>128bit Tracker</SectionTitle>
      <Group>
        <ToggleRow
          title="Tracker rows"
          subtitle="Up next, Watchlist and your 128bit Tracker lists (marked “Show in 128bitPlay”) on Shows, Movies and Anime. Uses your 128bit account: everyone sees their own."
          value={prefs.trackerRows}
          onChange={(v) => setPref('trackerRows', v)}
        />
        <Row
          icon="albums-outline"
          title="Where your lists go"
          subtitle="Put each Tracker list on Movies, Shows and/or Anime"
          onPress={() => router.push('/settings/tracker-lists')}
        />
        <Row icon="calendar-outline" title="Up next & coming up" subtitle="New episodes and releases for what you track" onPress={() => router.push('/tracker')} />
        <Row
          icon="cloud-upload-outline"
          title="Send my history to Tracker now"
          subtitle={historyNote ?? 'Audiobooks, comics, movies and shows you’ve read or watched here, plus what you’re in the middle of. Also happens on its own.'}
          onPress={async () => {
            setHistoryNote('Sending…');
            const r = await syncHistoryToTracker(true);
            setHistoryNote(r ? `Done: ${r.added} new, ${r.updated} updated in your Tracker` : 'Sign in first (Settings → Account)');
          }}
        />
      </Group>

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
              Scrobbling, Continue Watching, and your whole Trakt account: watchlist, history,
              collection, ratings, favorites, lists, up next, calendar and recommendations. Title
              pages have Trakt buttons; hold an episode to mark it watched.
            </Text>
            <Pressable style={styles.connectButton} onPress={() => router.push('/trakt')}>
              <Text style={styles.connectLabel}>Open Trakt library</Text>
            </Pressable>
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
            {configured && !editKeys ? (
              <>
                <Pressable style={styles.connectButton} onPress={connect}>
                  <Text style={styles.connectLabel}>Connect Trakt</Text>
                </Pressable>
                {!traktBuiltIn ? (
                  <Pressable onPress={() => setEditKeys(true)} hitSlop={8}>
                    <Text style={styles.traktLink}>Change API keys</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.traktBody}>
                  Trakt needs your own (free) API app. On trakt.tv: Settings → Your API Apps → New
                  application. Name it 128bit, set the redirect URI to{' '}
                  <Text style={{ fontWeight: '800' }}>urn:ietf:wg:oauth:2.0:oob</Text>, save, then
                  paste the Client ID and Client Secret here.
                </Text>
                <Pressable
                  onPress={() => Linking.openURL('https://trakt.tv/oauth/applications/new')}
                  hitSlop={8}>
                  <Text style={styles.traktLink}>Open trakt.tv/oauth/applications</Text>
                </Pressable>
                <TextInput
                  style={styles.keyInput}
                  placeholder="Client ID"
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  value={clientId}
                  onChangeText={setClientId}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={styles.keyInput}
                  placeholder="Client Secret"
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  value={secret}
                  onChangeText={setSecret}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
                <Pressable
                  style={[styles.connectButton, !(clientId.trim() && secret.trim()) && { opacity: 0.5 }]}
                  disabled={!(clientId.trim() && secret.trim())}
                  onPress={saveKeys}>
                  <Text style={styles.connectLabel}>Save keys</Text>
                </Pressable>
              </>
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

      <TraktRowPicker />

      <SectionTitle>Simkl</SectionTitle>
      <SimklCard />

      {IS_TV ? null : (
        <>
          <SectionTitle>Books</SectionTitle>
          <HardcoverCard />
        </>
      )}
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
  keyInput: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
    marginTop: Spacing.two,
  },
}));
