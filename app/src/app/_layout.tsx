import { PressStart2P_400Regular, useFonts } from '@expo-google-fonts/press-start-2p';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useColors } from '@/constants/theme';
import { IS_TV } from '@/constants/tv';
import { startAccountSync } from '@/lib/account';
import { applyDeviceTorrentPrefs, cleanUpDeviceTorrents, wakeDeviceTorrents } from '@/lib/torrent-device';
import { installDefaultAddons } from '@/lib/addons';
import { PlayerProvider } from '@/lib/player';
import { installDefaultFeeds } from '@/lib/feeds';
import { installDefaultSources } from '@/lib/sources';
import { checkFollows, runComicQueue } from '@/lib/comic-grab';
import { syncHardcover } from '@/lib/hardcover';
import { getSuwayomi } from '@/lib/suwayomi';
import { runVideoQueue } from '@/lib/video-downloads';
import { runAutoDownloads } from '@/lib/wanted';
import { watchSeries } from '@/lib/series-watch';
import { PrefsProvider, usePrefs } from '@/lib/prefs';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <PrefsProvider>
      <AppNavigator />
    </PrefsProvider>
  );
}

function AppNavigator() {
  const Colors = useColors();
  const { loaded: prefsLoaded } = usePrefs();
  // The 128bit pixel font (headings, player); if it fails to load, the normal font is used.
  const [fontLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const loaded = prefsLoaded && (fontLoaded || !!fontError);

  // Keep the splash screen up until the saved theme is known, so it doesn't flash.
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // First launch: add Cinemeta + OpenSubtitles so there's something to browse right away.
  useEffect(() => {
    installDefaultAddons().catch(() => {});
    // Account sync (Settings → Account): pull from your other devices, push changes made here.
    startAccountSync();
    // Torrents on this device: apply Wi-Fi/VPN rules, clear streamed videos after a while.
    applyDeviceTorrentPrefs().catch(() => {});
    cleanUpDeviceTorrents().catch(() => {});
    // Audiobook sources/feeds and comics aren't part of the TV app.
    if (IS_TV) return;
    installDefaultSources().catch(() => {});
    installDefaultFeeds().catch(() => {});
    // Load the Suwayomi server early so comic images get their sign-in headers.
    getSuwayomi().catch(() => {});
  }, []);

  // Device torrents: pick up again each time the app is opened.
  useEffect(() => {
    wakeDeviceTorrents().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') wakeDeviceTorrents().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // Hardcover: bring audiobook progress in line both ways each time the app is opened.
  useEffect(() => {
    if (IS_TV) return;
    syncHardcover().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncHardcover().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // Wanted books marked "download when ready": check TorBox every minute while the app is open.
  useEffect(() => {
    const tick = () => {
      runVideoQueue().catch(() => {});
      if (IS_TV) return; // audiobooks and comics are phone-only
      runAutoDownloads().catch(() => {});
      watchSeries().catch(() => {}); // once a day
      // Comics: TorBox → phone, and new issues of followed series (every 6 h).
      runComicQueue().catch(() => {});
      checkFollows().catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const theme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: Colors.background,
        card: Colors.background,
        border: Colors.border,
        primary: Colors.accent,
        text: Colors.text,
      },
    }),
    [Colors],
  );

  // The player reads saved preferences (default speed), so it starts once they're loaded.
  if (!loaded) return null;

  return (
    <PlayerProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerTintColor: Colors.text,
            headerShadowVisible: false,
            headerStyle: { backgroundColor: Colors.background },
            headerTitleStyle: { fontWeight: '800' },
            contentStyle: { backgroundColor: Colors.background },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="title" options={{ title: '' }} />
          <Stack.Screen name="streams" options={{ title: '' }} />
          <Stack.Screen
            name="watch"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              orientation: 'all',
            }}
          />
          <Stack.Screen name="comics/[id]" options={{ title: '' }} />
          <Stack.Screen
            name="comics/read"
            options={{ headerShown: false, presentation: 'fullScreenModal', orientation: 'all' }}
          />
          <Stack.Screen name="trakt" options={{ title: 'Trakt library' }} />
          <Stack.Screen name="settings/comics" options={{ title: 'Comics' }} />
          <Stack.Screen name="settings/stats" options={{ title: 'Statistics' }} />
          <Stack.Screen name="settings/account" options={{ title: 'Account & sync' }} />
          <Stack.Screen name="settings/index" options={{ title: '' }} />
          <Stack.Screen name="addons" options={{ title: 'Addons' }} />
          <Stack.Screen name="settings/content" options={{ title: 'Content & Discovery' }} />
          <Stack.Screen name="settings/playlists" options={{ title: 'Live TV playlists' }} />
          <Stack.Screen name="settings/sources" options={{ title: 'Download sources' }} />
          <Stack.Screen name="settings/layout" options={{ title: 'Layout' }} />
          <Stack.Screen name="settings/tracking" options={{ title: 'Tracking' }} />
          <Stack.Screen name="settings/playback" options={{ title: 'Playback' }} />
          <Stack.Screen name="settings/downloads" options={{ title: 'Downloads' }} />
          <Stack.Screen name="settings/integrations" options={{ title: 'Integrations' }} />
          <Stack.Screen name="settings/about" options={{ title: 'About' }} />
          <Stack.Screen name="audiobooks/browse" options={{ title: 'Find audiobooks' }} />
          <Stack.Screen name="audiobooks/details" options={{ title: 'Book Details' }} />
          <Stack.Screen name="audiobooks/feed" options={{ title: 'Latest uploads' }} />
          <Stack.Screen name="audiobooks/find" options={{ title: '' }} />
          <Stack.Screen name="audiobooks/cloud" options={{ title: 'TorBox cloud' }} />
          <Stack.Screen name="audiobooks/abs" options={{ title: 'Audiobookshelf' }} />
          <Stack.Screen name="audiobooks/abs-item" options={{ title: '' }} />
          <Stack.Screen name="book" options={{ title: '' }} />
          <Stack.Screen name="cloud/[kind]/[id]" options={{ title: '' }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', title: 'Now playing' }} />
        </Stack>
      </ThemeProvider>
    </PlayerProvider>
  );
}
