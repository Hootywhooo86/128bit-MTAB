import { router } from 'expo-router';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { IS_TV } from '@/constants/tv';

export default function SettingsScreen() {
  return (
    <SettingsPage title="Settings">
      <SectionTitle>Account</SectionTitle>
      <Group>
        <Row
          icon="sync"
          title="Tracking"
          subtitle={IS_TV ? 'Trakt and Simkl for what you watch.' : 'Trakt and Simkl for what you watch, Hardcover for books.'}
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
      </Group>
    </SettingsPage>
  );
}
