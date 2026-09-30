import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Text } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { formatBytes } from '@/components/ui';
import { makeStyles, useColors } from '@/constants/theme';
import {
  deleteDownload,
  downloadedBytes,
  getDownloadedBooks,
  offlineSupported,
} from '@/lib/downloads';
import type { PlayableBook } from '@/lib/types';

function confirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function DownloadsSettings() {
  const Colors = useColors();
  const styles = useStyles();
  const [books, setBooks] = useState<PlayableBook[]>([]);

  const load = useCallback(() => {
    getDownloadedBooks().then(setBooks);
  }, []);
  useFocusEffect(load);

  const total = books.reduce((n, b) => n + downloadedBytes(b), 0);

  return (
    <SettingsPage>
      {!offlineSupported ? (
        <Text style={styles.hint}>Downloads work in the iOS and Android app, not on the web.</Text>
      ) : null}

      <SectionTitle>Storage</SectionTitle>
      <Group>
        <Row icon="folder" title="Audiobooks on this phone" value={formatBytes(total) || '0 B'} />
        {books.length ? (
          <Row
            icon="trash"
            title="Delete all downloads"
            danger
            onPress={() =>
              confirm(
                'Delete all downloads',
                `${books.length} books will be removed from this phone.`,
                async () => {
                  for (const b of books) await deleteDownload(b.key);
                  load();
                },
              )
            }
          />
        ) : null}
      </Group>

      <SectionTitle>Downloaded books</SectionTitle>
      {books.length === 0 ? (
        <Text style={styles.hint}>
          Nothing downloaded. Open a book and tap “Download to phone”.
        </Text>
      ) : (
        <Group>
          {books.map((b) => (
            <Row
              key={b.key}
              icon="headset"
              title={b.title}
              subtitle={[b.author, formatBytes(downloadedBytes(b))].filter(Boolean).join(' · ')}
              onPress={() =>
                confirm('Delete download', b.title, async () => {
                  await deleteDownload(b.key);
                  load();
                })
              }
              right={<Text style={{ color: Colors.danger, fontWeight: '600' }}>Delete</Text>}
            />
          ))}
        </Group>
      )}
    </SettingsPage>
  );
}

const useStyles = makeStyles((Colors) => ({
  hint: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
}));
