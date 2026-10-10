import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar, Tabs, type BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Image, View, type ColorValue } from 'react-native';

import { Pressable } from '@/components/focusable';
import { HeaderButtons } from '@/components/header-buttons';
import { MiniPlayer } from '@/components/mini-player';
import { UpdateBanner } from '@/components/update-banner';
import { useColors } from '@/constants/theme';
import { IS_TV } from '@/constants/tv';
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
    if (IS_TV) return;
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
      tabBar={(props) =>
        // The TV app is video only: no audiobook mini player.
        IS_TV ? (
          <>
            <UpdateBanner />
            <BottomTabBar {...props} />
          </>
        ) : (
          <>
            <UpdateBanner />
            <MiniPlayer />
            <BottomTabBar {...props} />
          </>
        )
      }
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
        tabBarLabelStyle: { fontSize: IS_TV ? 14 : 10 },
        // TV remote: tab buttons show the focus ring.
        ...(IS_TV
          ? {
              tabBarButton: ({ ref: _ref, ...p }: BottomTabBarButtonProps) => (
                <Pressable {...(p as ComponentProps<typeof Pressable>)} />
              ),
            }
          : {}),
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        headerRight: () => <HeaderButtons />,
      }}>
      <Tabs.Screen
        name="audiobooks"
        options={{
          title: 'Audiobooks',
          tabBarLabel: 'Books',
          // Books and Comics are phone-only; the TV app has Shows, Movies, Anime and Sports.
          href: IS_TV ? null : undefined,
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
      <Tabs.Screen name="live" options={{ title: 'Sports', tabBarIcon: icon('football-outline') }} />
      <Tabs.Screen
        name="comics"
        options={{
          title: 'Comics',
          href: IS_TV ? null : undefined,
          tabBarIcon: icon('book-outline'),
          // Downloads carry on in the background; the badge shows how many are coming.
          tabBarBadge: comicsComing || undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.accent, color: Colors.accentText, fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
