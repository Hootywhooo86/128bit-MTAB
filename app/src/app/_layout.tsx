import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';

import { useColors } from '@/constants/theme';
import { installDefaultAddons } from '@/lib/addons';
import { PlayerProvider } from '@/lib/player';
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
  const { loaded } = usePrefs();

  // Keep the splash screen up until the saved theme is known, so it doesn't flash.
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  // First launch: add Cinemeta + OpenSubtitles so there's something to browse right away.
  useEffect(() => {
    installDefaultAddons().catch(() => {});
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
