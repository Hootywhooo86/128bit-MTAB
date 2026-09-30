import { router } from 'expo-router';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';

export default function SettingsScreen() {
  return (
    <SettingsPage title="Settings">
      <SectionTitle>Account</SectionTitle>
      <Group>
        <Row
          icon="sync"
          title="Tracking"
          subtitle="Connect Trakt to scrobble what you watch and power Continue Watching."
          onPress={() => router.push('/settings/tracking')}
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
          subtitle="Manage audiobooks saved on this phone."
          onPress={() => router.push('/settings/downloads')}
        />
        <Row
          icon="play"
          title="Playback"
          subtitle="Skip times, speed, resume and stream order"
          onPress={() => router.push('/settings/playback')}
        />
        <Row
          icon="link"
          title="Integrations"
          subtitle="TorBox"
          onPress={() => router.push('/settings/integrations')}
        />
      </Group>

      <SectionTitle>About</SectionTitle>
      <Group>
        <Row
          icon="information-circle"
          title="About 128bit"
          subtitle="Version, data sources and licences"
          onPress={() => router.push('/settings/about')}
        />
      </Group>
    </SettingsPage>
  );
}
