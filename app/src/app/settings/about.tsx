import Constants from 'expo-constants';
import { Linking, Text } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { makeStyles } from '@/constants/theme';

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
    title: 'Expo & React Native',
    subtitle: 'App framework (MIT)',
    url: 'https://expo.dev',
  },
];

export default function AboutSettings() {
  const styles = useStyles();
  return (
    <SettingsPage>
      <SectionTitle>App</SectionTitle>
      <Group>
        <Row
          icon="information-circle"
          title="128bit"
          value={`v${Constants.expoConfig?.version ?? '1.0.0'}`}
        />
      </Group>

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
