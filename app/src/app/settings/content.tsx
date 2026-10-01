import { router } from 'expo-router';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';

export default function ContentSettings() {
  return (
    <SettingsPage>
      <SectionTitle>Sources</SectionTitle>
      <Group>
        <Row
          icon="extension-puzzle"
          title="Addons"
          subtitle="Install, remove, refresh, and sort your content sources."
          onPress={() => router.push('/addons')}
        />
        <Row
          icon="radio"
          title="Live TV playlists"
          subtitle="Add M3U playlists from your TV provider."
          onPress={() => router.push('/settings/playlists')}
        />
        <Row
          icon="cloud-download"
          title="Audiobook download sources"
          subtitle="Pageturner-style sources. Search them from Audiobooks and send to TorBox."
          onPress={() => router.push('/settings/sources')}
        />
      </Group>
    </SettingsPage>
  );
}
