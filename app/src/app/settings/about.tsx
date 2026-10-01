import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Linking, Text, View } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { UpdateCard } from '@/components/update-card';
import { BUILD } from '@/lib/app-update';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';

const SOURCES = [
  {
    title: 'Cinemeta & Metahub',
    subtitle: 'Movie and show details, posters (Stremio)',
    url: 'https://www.stremio.com',
  },
  {
    title: 'Trakt',
    subtitle: 'Watch history and scrobbling',
    url: 'https://trakt.tv',
  },
  {
    title: 'TorBox',
    subtitle: 'Cloud downloads and streaming',
    url: 'https://torbox.app',
  },
  {
    title: 'LibriVox',
    subtitle: 'Public-domain audiobooks (example addon)',
    url: 'https://librivox.org',
  },
  {
    title: 'MangaDex',
    subtitle: 'Comics and manga',
    url: 'https://mangadex.org',
  },
  {
    title: 'Suwayomi',
    subtitle: 'Runs Mihon extensions (Keiyoushi) for the Comics tab',
    url: 'https://github.com/Suwayomi/Suwayomi-Server',
  },
  {
    title: 'Expo & React Native',
    subtitle: 'App framework (MIT)',
    url: 'https://expo.dev',
  },
];

export default function AboutSettings() {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <SettingsPage>
      <View style={{ alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three }}>
        <Image
          source={require('../../../assets/images/icon.png')}
          style={{ width: 112, height: 112 }}
          contentFit="contain"
        />
        <Text style={{ color: Colors.accent, fontFamily: PixelFont, fontSize: 16 }}>128BITPLAY</Text>
      </View>
      <SectionTitle>App</SectionTitle>
      <Group>
        <Row
          icon="information-circle"
          title="128bitPlay"
          value={`v${Constants.expoConfig?.version ?? '1.0.0'}${BUILD ? ` · build ${BUILD}` : ''}`}
        />
      </Group>

      <SectionTitle>Updates</SectionTitle>
      <UpdateCard />

      <SectionTitle>Data sources & attribution</SectionTitle>
      <Group>
        {SOURCES.map((s) => (
          <Row
            key={s.title}
            icon="open-outline"
            title={s.title}
            subtitle={s.subtitle}
            onPress={() => Linking.openURL(s.url)}
          />
        ))}
      </Group>

      <SectionTitle>Content</SectionTitle>
      <Text style={styles.body}>
        128bit is a player. It doesn’t host or provide any content, and ships without any addons
        that link to copyrighted material. What you can find depends on the addons you install, and
        you’re responsible for having the rights to what you watch, listen to or download.
      </Text>
    </SettingsPage>
  );
}

const useStyles = makeStyles((Colors) => ({
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22 },
}));
