import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ChoiceRow, Group, Row, SectionTitle, ToggleRow } from '@/components/settings-ui';
import { formatBytes } from '@/components/ui';
import { Spacing, makeStyles } from '@/constants/theme';
import { usePrefs } from '@/lib/prefs';
import {
  applyDeviceTorrentPrefs,
  deviceList,
  deviceRemove,
  deviceTorrentsSupported,
} from '@/lib/torrent-device';

type Item = Awaited<ReturnType<typeof deviceList>>[number];

/** Settings → Integrations → Torrents on this device (no TorBox needed). */
export function DeviceTorrentSettings() {
  const styles = useStyles();
  const { prefs, setPref } = usePrefs();
  const [items, setItems] = useState<Item[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const load = useCallback(() => {
    deviceList().then(setItems, () => setItems([]));
  }, []);

  useEffect(() => {
    if (!deviceTorrentsSupported) return;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Network rules and seeding go to the engine whenever they change.
  useEffect(() => {
    applyDeviceTorrentPrefs().then((r) => setBlocked(r?.blocked ?? null), () => {});
  }, [prefs.torrentWifiOnly, prefs.torrentVpnOnly, prefs.torrentSeedRatio]);

  if (!deviceTorrentsSupported) return null;

  const used = (items ?? []).reduce((n, i) => n + (i.device.downloaded ?? 0), 0);

  return (
    <>
      <SectionTitle>Torrents on this device</SectionTitle>
      <Group>
        <ChoiceRow
          title="Torrents go to"
          subtitle="Automatic: TorBox when you've added a key, otherwise this device downloads them itself."
          value={prefs.torrentMode}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'device', label: 'This device' },
            { value: 'torbox', label: 'TorBox only' },
          ]}
          onChange={(v) => setPref('torrentMode', v)}
        />
        <ToggleRow
          title="Only on Wi-Fi"
          subtitle="Pause device torrents on mobile data."
          value={prefs.torrentWifiOnly}
          onChange={(v) => setPref('torrentWifiOnly', v)}
        />
        <ToggleRow
          title="Only with a VPN on"
          subtitle="Pause device torrents unless a VPN is connected. Others sharing a torrent can see your IP address; a VPN hides it."
          value={prefs.torrentVpnOnly}
          onChange={(v) => setPref('torrentVpnOnly', v)}
        />
        <ChoiceRow
          title="Share back after downloading"
          subtitle="Off stops a torrent as soon as it's done."
          value={prefs.torrentSeedRatio}
          options={[
            { value: 0, label: 'Off' },
            { value: 1, label: '1×' },
            { value: 2, label: '2×' },
          ]}
          onChange={(v) => setPref('torrentSeedRatio', v)}
        />
      </Group>
      {blocked ? <Text style={styles.note}>{blocked}: device torrents are paused.</Text> : null}
      <Text style={styles.note}>
        Streamed videos are cleared off the device two days after you last watched them; comics are
        removed once they’re in your library. {used ? `In use now: ${formatBytes(used)}.` : ''}
      </Text>
      {items?.length ? (
        <Group>
          {items.map((i) => (
            <Row
              key={i.id}
              icon={i.download_finished ? 'checkmark-circle' : 'cloud-download'}
              title={i.name}
              subtitle={[
                i.download_finished ? 'Done' : i.download_state,
                `${Math.round(i.progress * 100)}%`,
                i.device.downloadRate ? `${formatBytes(i.device.downloadRate)}/s` : '',
                i.device.peers ? `${i.device.peers} peers` : '',
                i.size ? formatBytes(i.size) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              danger
              onPress={() =>
                Alert.alert('Delete from this device?', i.name, [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      await deviceRemove(i.id).catch(() => {});
                      load();
                    },
                  },
                ])
              }
            />
          ))}
        </Group>
      ) : null}
      <View style={{ height: Spacing.two }} />
    </>
  );
}

const useStyles = makeStyles((Colors) => ({
  note: { color: Colors.textSecondary, fontSize: 12, marginHorizontal: Spacing.two, marginBottom: Spacing.two },
}));
