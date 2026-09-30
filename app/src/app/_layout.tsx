import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { Colors } from '@/constants/theme';
import { PlayerProvider } from '@/lib/player';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
    card: Colors.background,
    border: Colors.border,
    primary: Colors.accent,
    text: Colors.text,
  },
};

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <PlayerProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerTintColor: Colors.text,
            headerShadowVisible: false,
            headerStyle: { backgroundColor: Colors.background },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="title" options={{ title: '' }} />
          <Stack.Screen name="streams" options={{ title: '' }} />
          <Stack.Screen
            name="watch"
            options={{ headerShown: false, presentation: 'fullScreenModal', orientation: 'all' }}
          />
          <Stack.Screen name="addons" options={{ title: 'Addons & playlists' }} />
          <Stack.Screen name="audiobooks/browse" options={{ title: 'Find audiobooks' }} />
          <Stack.Screen name="audiobooks/cloud" options={{ title: 'TorBox cloud' }} />
          <Stack.Screen name="book" options={{ title: '' }} />
          <Stack.Screen name="cloud/[kind]/[id]" options={{ title: '' }} />
          <Stack.Screen name="player" options={{ presentation: 'modal', title: 'Now playing' }} />
        </Stack>
      </PlayerProvider>
    </ThemeProvider>
  );
}
