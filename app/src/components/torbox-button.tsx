import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { bookDownloads, offlineSupported, onBookDownloads, type BookDownload } from '@/lib/downloads';
import { addMagnet } from '@/lib/torbox';
import { Pressable } from '@/components/focusable';
import { canGetTorrents } from '@/lib/torrent-device';
import { downloadWanted, playable, sendToPhone, type WantedInput } from '@/lib/wanted';

type State = 'idle' | 'sending' | 'sent' | { error: string };

/** "TorBox" button: gets the magnet, adds it to TorBox, then links to the TorBox cloud. */
export function TorboxButton({
  name,
  getMagnet,
  onSent,
}: {
  name: string;
  getMagnet: () => Promise<string>;
  /** Called with the TorBox torrent id and the release name. */
  onSent?: (torboxId: number, name: string) => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<State>('idle');

  async function send() {
    // TorBox, or this device when there's no TorBox key.
    if (!(await canGetTorrents())) {
      router.push('/settings/integrations');
      return;
    }
    setState('sending');
    try {
      const { id } = await addMagnet(await getMagnet(), name);
      setState('sent');
      onSent?.(id, name);
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

/** A book downloading to the phone right now (live progress), by its Library key. */
export function useBookDownload(key?: string): BookDownload | undefined {
  const get = () => (key ? bookDownloads().get(key) : undefined);
  return useSyncExternalStore(onBookDownloads, get, get);
}

/** "Title - Author" release name → a book for Wanted, when the row isn't for a known book. */
const bookFromName = (name: string): WantedInput => {
  const [title, author] = name.split(/\s+[-–—]\s+(?=[^-–—]+$)/);
  return { title: title?.trim() || name, author: author?.trim() || undefined };
};

type PhoneState = 'idle' | 'sending' | 'queued' | 'done' | { key: string } | { error: string };

/**
 * "⬇ Download": sends the release to TorBox (like the TorBox button) and saves the book to
 * the phone as soon as TorBox has it: right away when it's already there, else when it's
 * ready (Wanted's "download when ready", checked every minute).
 */
export function PhoneButton({
  name,
  getMagnet,
  book,
  cached,
  onSent,
}: {
  name: string;
  getMagnet: () => Promise<string>;
  /** The book this release is for (else it's taken from the release name). */
  book?: WantedInput;
  /** TorBox already has it cached (⚡), so it's ready almost at once. */
  cached?: boolean;
  onSent?: (torboxId: number, name: string) => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<PhoneState>('idle');
  const live = useBookDownload(typeof state === 'object' && 'key' in state ? state.key : undefined);

  if (!offlineSupported) return null;

  async function send() {
    if (!(await canGetTorrents())) {
      router.push('/settings/integrations');
      return;
    }
    setState('sending');
    try {
      const { wanted, torboxId, item } = await sendToPhone(book ?? bookFromName(name), await getMagnet(), name, cached);
      onSent?.(torboxId, name);
      if (!item) return setState('queued');
      setState({ key: playable(wanted, item).key });
      await downloadWanted(wanted, item);
      setState('done');
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  const note = (text: string, color: string) => (
    <Text style={[styles.note, { color }]}>{text}</Text>
  );

  return (
    <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 140 }}>
      {state === 'queued' ? (
        note('Sent · downloads to phone when ready', Colors.success)
      ) : state === 'done' ? (
        note('✓ On your phone', Colors.success)
      ) : typeof state === 'object' && 'key' in state ? (
        note(`Downloading to phone…${live ? ` ${Math.round(live.fraction * 100)}%` : ''}`, Colors.accent)
      ) : (
        <Pressable
          style={[styles.button, styles.secondary]}
          disabled={state === 'sending'}
          onPress={send}
          accessibilityLabel="Send to TorBox and download to the phone">
          {state === 'sending' ? (
            <ActivityIndicator size="small" color={Colors.text} />
          ) : (
            <>
              <Ionicons name="download" size={16} color={Colors.text} />
              <Text style={[styles.label, { color: Colors.text }]}>Download</Text>
            </>
          )}
        </Pressable>
      )}
      {typeof state === 'object' && 'error' in state ? (
        <Text style={{ color: Colors.danger, fontSize: 11, textAlign: 'right' }}>{state.error}</Text>
      ) : null}
    </View>
  );
}

/** TorBox and Download, one above the other, for a release row. */
export function ReleaseButtons(props: {
  name: string;
  getMagnet: () => Promise<string>;
  book?: WantedInput;
  cached?: boolean;
  onSent?: (torboxId: number, name: string) => void;
}) {
  return (
    <View style={{ gap: 6, alignItems: 'flex-end' }}>
      <TorboxButton name={props.name} getMagnet={props.getMagnet} onSent={props.onSent} />
      <PhoneButton {...props} />
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
  secondary: { backgroundColor: Colors.surfaceRaised },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: Spacing.two },
  note: { fontSize: 12, fontWeight: '700', textAlign: 'right', paddingVertical: Spacing.one },
  label: { color: Colors.accentText, fontWeight: '700', fontSize: 13 },
}));
