import { router } from 'expo-router';
import { Linking } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { IS_TV } from '@/constants/tv';

export default function SettingsScreen() {
  return (
    <SettingsPage title="Settings">
      <SectionTitle>Account</SectionTitle>
      <Group>
        <Row
          icon="person-circle"
          title="Account & sync"
          subtitle={IS_TV ? 'Sign in with your phone to bring your add-ons and settings here.' : 'Your add-ons and settings on every phone and TV.'}
          onPress={() => router.push('/settings/account')}
        />
        <Row
          icon="sync"
          title="Tracking"
          subtitle="Trakt and Simkl for what you watch."
          onPress={() => router.push('/settings/tracking')}
        />
        <Row
          icon="stats-chart"
          title="Statistics"
          subtitle="Listening, watching and reading time"
          onPress={() => router.push('/settings/stats')}
        />
      </Group>

      <SectionTitle>General</SectionTitle>
      <Group>
        <Row
          icon="color-palette"
          title="Layout"
          subtitle="Accent colour and AMOLED black"
          onPress={() => router.push('/settings/layout')}
        />
        <Row
          icon="extension-puzzle"
          title="Content & Discovery"
          subtitle="Manage addons and Live TV playlists."
          onPress={() => router.push('/settings/content')}
        />
        <Row
          icon="cloud-download"
          title="Downloads"
          subtitle={IS_TV ? 'Movies and shows saved on this TV.' : 'Movies, TV, audiobooks and comics saved on this phone.'}
          onPress={() => router.push('/settings/downloads')}
        />
        {IS_TV ? null : (
          <Row
            icon="book"
            title="Comics"
            subtitle="Suwayomi, extension repos (Keiyoushi), extensions and the reader"
            onPress={() => router.push('/settings/comics')}
          />
        )}
        <Row
          icon="play"
          title="Playback"
          subtitle="Skip times, speed, resume and stream order"
          onPress={() => router.push('/settings/playback')}
        />
        <Row
          icon="link"
          title="Integrations"
          subtitle="TorBox, TMDB, MDBList and Audiobookshelf"
          onPress={() => router.push('/settings/integrations')}
        />
      </Group>

      <SectionTitle>About</SectionTitle>
      <Group>
        <Row
          icon="information-circle"
          title="About 128bit"
          subtitle="Version, check for updates, data sources"
          onPress={() => router.push('/settings/about')}
        />
        <Row
          icon="cafe"
          title="Buy me a Ko-fi"
          subtitle="Enjoying 128bitPlay? Support it at ko-fi.com/128bit"
          onPress={() => Linking.openURL('https://ko-fi.com/128bit')}
        />
      </Group>
    </SettingsPage>
  );
}
