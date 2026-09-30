import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { MiniPlayer } from '@/components/mini-player';
import { Colors } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon = (name: IconName) =>
  function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => (
        <>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </>
      )}
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', fontSize: 22 },
        tabBarStyle: { backgroundColor: Colors.background, borderTopColor: Colors.border },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Shows', tabBarIcon: icon('tv-outline') }} />
      <Tabs.Screen name="movies" options={{ title: 'Movies', tabBarIcon: icon('film-outline') }} />
      <Tabs.Screen name="live" options={{ title: 'Live TV', tabBarIcon: icon('radio-outline') }} />
      <Tabs.Screen
        name="audiobooks"
        options={{ title: 'Audiobooks', tabBarIcon: icon('headset-outline') }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}
