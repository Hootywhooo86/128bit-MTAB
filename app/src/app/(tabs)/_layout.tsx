import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Image, View, type ColorValue } from 'react-native';

import { HeaderButtons } from '@/components/header-buttons';
import { MiniPlayer } from '@/components/mini-player';
import { PixelFont, useColors } from '@/constants/theme';
import { activeComicCount, getComicWanted, onComicWanted } from '@/lib/comic-grab';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon = (name: IconName) =>
  function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };

/**
 * The Anime tab's own icon: the crystal-wing face, half white and half the accent colour
 * (the dark parts stay see-through to the black tab bar). Dimmed when not selected.
 */
function AnimeIcon({ focused, size, accent }: { focused: boolean; size: number; accent: string }) {
  const s = size + 4;
  const style = { position: 'absolute' as const, width: s, height: s };
  return (
    <View style={{ width: s, height: s, opacity: focused ? 1 : 0.55 }}>
      <Image source={require('../../../assets/images/anime-tab-left.png')} style={[style, { tintColor: '#FFFFFF' }]} />
      <Image source={require('../../../assets/images/anime-tab-right.png')} style={[style, { tintColor: accent }]} />
    </View>
  );
}

/** Comics on their way to the phone, for the badge on the Comics tab. */
function useComicsComing() {
  const [n, setN] = useState(0);
  useEffect(() => {
    getComicWanted().then((l) => setN(activeComicCount(l)), () => {});
    return onComicWanted((l) => setN(activeComicCount(l)));
  }, []);
  return n;
}

export default function TabLayout() {
  const Colors = useColors();
  const comicsComing = useComicsComing();
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
        headerTitleStyle: { fontFamily: PixelFont, fontSize: 16 },
        tabBarStyle: {
          backgroundColor: Colors.background,
          borderTopColor: Colors.border,
        },
        // Six tabs: keep the labels small enough to fit on a phone.
        tabBarLabelStyle: { fontFamily: PixelFont, fontSize: 6, marginTop: 2 },
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
      <Tabs.Screen
        name="anime"
        options={{
          title: 'Anime',
          tabBarIcon: ({ focused, size }) => (
            <AnimeIcon focused={focused} size={size} accent={Colors.accent} />
          ),
        }}
      />
      <Tabs.Screen name="live" options={{ title: 'Live TV', tabBarIcon: icon('radio-outline') }} />
      <Tabs.Screen
        name="comics"
        options={{
          title: 'Comics',
          tabBarIcon: icon('book-outline'),
          // Downloads carry on in the background; the badge shows how many are coming.
          tabBarBadge: comicsComing || undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.accent, color: Colors.accentText, fontFamily: PixelFont, fontSize: 7 },
        }}
      />
    </Tabs>
  );
}
