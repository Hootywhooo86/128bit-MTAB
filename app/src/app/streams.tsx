import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { DownloadedPlay } from '@/components/downloaded-play';
import { StreamList } from '@/components/stream-list';
import { Body, Title } from '@/components/ui';
import { Spacing, makeStyles } from '@/constants/theme';

/** Streams for one episode. */
export default function StreamsScreen() {
  const styles = useStyles();
  const p = useLocalSearchParams<{
    type: string;
    id: string;
    title: string;
    subtitle?: string;
    poster?: string;
    linkId: string;
  }>();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: p.title }} />
      <Title style={{ fontSize: 20 }}>{p.subtitle ?? p.title}</Title>
      <DownloadedPlay itemKey={p.id} />
      <Body muted>Pick a stream</Body>
      <StreamList
        type={p.type}
        id={p.id}
        title={p.title}
        subtitle={p.subtitle}
        poster={p.poster || undefined}
        link={{ type: p.type, id: p.linkId }}
      />
    </ScrollView>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
}));
