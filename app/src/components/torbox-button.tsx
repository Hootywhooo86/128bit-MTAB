import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { getTorboxKey } from '@/lib/storage';
import { addMagnet } from '@/lib/torbox';

type State = 'idle' | 'sending' | 'sent' | { error: string };

/** "TorBox" button: gets the magnet, adds it to TorBox, then links to the TorBox cloud. */
export function TorboxButton({
  name,
  getMagnet,
  onSent,
}: {
  name: string;
  getMagnet: () => Promise<string>;
  onSent?: () => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<State>('idle');

  async function send() {
    if (!(await getTorboxKey())) {
      router.push('/settings/integrations');
      return;
    }
    setState('sending');
    try {
      await addMagnet(await getMagnet(), name);
      setState('sent');
      onSent?.();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 140 }}>
      {state === 'sent' ? (
        <Pressable style={styles.sent} onPress={() => router.push('/audiobooks/cloud')}>
          <Ionicons name="checkmark" size={16} color={Colors.success} />
          <Text style={[styles.label, { color: Colors.success }]}>In TorBox</Text>
        </Pressable>
      ) : (
        <Pressable
          style={styles.button}
          disabled={state === 'sending'}
          onPress={send}
          accessibilityLabel="Send to TorBox">
          {state === 'sending' ? (
            <ActivityIndicator size="small" color={Colors.accentText} />
          ) : (
            <>
              <Ionicons name="cloud-download" size={16} color={Colors.accentText} />
              <Text style={styles.label}>TorBox</Text>
            </>
          )}
        </Pressable>
      )}
      {typeof state === 'object' ? (
        <Text style={{ color: Colors.danger, fontSize: 11, textAlign: 'right' }}>
          {state.error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 84,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.accent,
  },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: Spacing.two },
  label: { color: Colors.accentText, fontWeight: '700', fontSize: 13 },
}));
