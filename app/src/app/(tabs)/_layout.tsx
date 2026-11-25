import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomTabBar, Tabs, type BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Image, View, type ColorValue } from 'react-native';

import { Pressable } from '@/components/focusable';
import { Wiggle } from '@/components/fx';
import { HeaderButtons } from '@/components/header-buttons';
import { MiniPlayer } from '@/components/mini-player';
import { UpdateBanner } from '@/components/update-banner';
import { Pixel, PixelFont, PixelFontBold, useColors } from '@/constants/theme';
import { HAS_BOOKS, HAS_COMICS, IS_TV } from '@/constants/tv';
import { activeComicCount, getComicWanted, onComicWanted } from '@/lib/comic-grab';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Each tab icon does a quick 8-bit wiggle when its tab is picked.
const icon = (name: IconName) =>
  function TabBarIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return (
      <Wiggle focused={focused}>
        <Ionicons name={name} color={color} size={size} />
      </Wiggle>
    );
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
    if (!HAS_COMICS) return;
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
      // Phones open on Audiobooks; the TV and Windows apps (no audiobooks) on Shows.
      initialRouteName={HAS_BOOKS ? 'audiobooks' : 'shows'}
      tabBar={(props) =>
        // No audiobooks on the TV or Windows app: no audiobook mini player.
        !HAS_BOOKS ? (
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
        headerTitleStyle: { fontFamily: PixelFontBold, fontSize: 28 },
        // TV: the tabs sit across the top (where the remote starts), big, label beside the icon.
        tabBarPosition: IS_TV ? 'top' : 'bottom',
        ...(IS_TV ? { tabBarLabelPosition: 'beside-icon' as const } : {}),
        tabBarStyle: IS_TV
          ? {
              backgroundColor: Colors.surface,
              borderBottomColor: Colors.border,
              borderBottomWidth: Pixel.border,
              borderTopWidth: 0,
              height: 76,
              paddingHorizontal: 48,
            }
          : {
              backgroundColor: Colors.background,
              borderTopColor: Colors.border,
              borderTopWidth: Pixel.border,
            },
        // Six tabs: keep the labels small enough to fit on a phone.
        // The pixel font sits taller than the system one: a little more room under the labels.
        tabBarLabelStyle: IS_TV
          ? { fontFamily: PixelFont, fontSize: 22, marginLeft: 12 }
          : { fontFamily: PixelFont, fontSize: 11, lineHeight: 13 },
        tabBarIconStyle: IS_TV ? undefined : { marginTop: -3 },
        ...(IS_TV ? { tabBarItemStyle: { marginHorizontal: 8, marginVertical: 8 } } : {}),
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
          // Books: phone only. Comics: phone and Windows. The TV app has Shows, Movies, Anime and Sports.
          href: HAS_BOOKS ? undefined : null,
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
            <Wiggle focused={focused}>
              <AnimeIcon focused={focused} size={size} accent={Colors.accent} />
            </Wiggle>
          ),
        }}
      />
      <Tabs.Screen name="live" options={{ title: 'Sports', tabBarIcon: icon('football-outline') }} />
      <Tabs.Screen
        name="comics"
        options={{
          title: 'Comics',
          href: HAS_COMICS ? undefined : null,
          tabBarIcon: icon('book-outline'),
          // Downloads carry on in the background; the badge shows how many are coming.
          tabBarBadge: comicsComing || undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.accent, color: Colors.accentText, fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
