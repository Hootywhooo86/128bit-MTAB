import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { StreamList } from '@/components/stream-list';
import { Body, Title } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';

/** Streams for one episode. */
export default function StreamsScreen() {
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
});
