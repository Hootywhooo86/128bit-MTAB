import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { HeaderButtons } from '@/components/header-buttons';
import { MiniPlayer } from '@/components/mini-player';
import { useColors } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon = (name: IconName) =>
  function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };

export default function TabLayout() {
  const Colors = useColors();
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
        tabBarStyle: {
          backgroundColor: Colors.background,
          borderTopColor: Colors.border,
        },
        // Six tabs: keep the labels small enough to fit on a phone.
        tabBarLabelStyle: { fontSize: 10 },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        headerRight: () => <HeaderButtons />,
      }}>
      <Tabs.Screen
        name="audiobooks"
        options={{
          title: 'Audiobooks',
          tabBarLabel: 'Books',
          tabBarIcon: icon('headset-outline'),
        }}
      />
      {/* "/" just sends you to Audiobooks; it has no tab of its own. */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="shows" options={{ title: 'Shows', tabBarIcon: icon('tv-outline') }} />
      <Tabs.Screen name="movies" options={{ title: 'Movies', tabBarIcon: icon('film-outline') }} />
      <Tabs.Screen name="anime" options={{ title: 'Anime', tabBarIcon: icon('sparkles-outline') }} />
      <Tabs.Screen name="live" options={{ title: 'Live TV', tabBarIcon: icon('radio-outline') }} />
      <Tabs.Screen name="comics" options={{ title: 'Comics', tabBarIcon: icon('book-outline') }} />
    </Tabs>
  );
}
