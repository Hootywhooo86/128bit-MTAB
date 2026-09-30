import Ionicons from '@expo/vector-icons/Ionicons';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { languageName, type AddonSubtitle } from '@/lib/subtitles';

export type SubtitleChoice =
  | { kind: 'off' }
  | { kind: 'embedded'; track: SubtitleTrack }
  | { kind: 'addon'; sub: AddonSubtitle };

type Props = {
  visible: boolean;
  onClose: () => void;
  embedded: SubtitleTrack[];
  addon: AddonSubtitle[];
  current: SubtitleChoice;
  onChoose: (c: SubtitleChoice) => void;
  audioTracks: AudioTrack[];
  currentAudio: AudioTrack | null;
  onChooseAudio: (t: AudioTrack) => void;
  delay: number;
  onDelay: (seconds: number) => void;
  error: string | null;
};

const trackLabel = (t: { label?: string; name?: string; language?: string }) =>
  t.label || t.name || (t.language ? languageName(t.language) : 'Unknown');

function Option({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Pressable style={styles.option} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionText, selected && { color: Colors.accent }]}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={20} color={Colors.accent} /> : null}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

/** Bottom sheet for picking subtitles, audio track and subtitle timing. */
export function TrackSheet(p: Props) {
  const Colors = useColors();
  const styles = useStyles();
  const isOn = (c: SubtitleChoice) =>
    (c.kind === 'off' && p.current.kind === 'off') ||
    (c.kind === 'embedded' &&
      p.current.kind === 'embedded' &&
      c.track.id === p.current.track.id &&
      c.track.label === p.current.track.label) ||
    (c.kind === 'addon' && p.current.kind === 'addon' && c.sub.id === p.current.sub.id);

  return (
    <Modal
      visible={p.visible}
      transparent
      animationType="slide"
      onRequestClose={p.onClose}
      supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={styles.backdrop} onPress={p.onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three }}>
          <Section title="Subtitles">
            <Option
              label="Off"
              selected={isOn({ kind: 'off' })}
              onPress={() => p.onChoose({ kind: 'off' })}
            />
            {p.embedded.map((t, i) => (
              <Option
                key={`e${i}`}
                label={trackLabel(t)}
                detail="In the video"
                selected={isOn({ kind: 'embedded', track: t })}
                onPress={() => p.onChoose({ kind: 'embedded', track: t })}
              />
            ))}
            {p.addon.map((s) => (
              <Option
                key={s.id}
                label={languageName(s.lang)}
                detail={s.addon}
                selected={isOn({ kind: 'addon', sub: s })}
                onPress={() => p.onChoose({ kind: 'addon', sub: s })}
              />
            ))}
            {!p.embedded.length && !p.addon.length ? (
              <Text style={styles.detail}>
                No subtitles found. Install a subtitles addon (e.g. OpenSubtitles) in Settings →
                Addons.
              </Text>
            ) : null}
            {p.error ? (
              <Text style={[styles.detail, { color: Colors.danger }]}>{p.error}</Text>
            ) : null}
          </Section>

          {p.current.kind === 'addon' ? (
            <Section title="Subtitle timing">
              <View style={styles.delayRow}>
                <Pressable style={styles.delayButton} onPress={() => p.onDelay(p.delay - 0.5)}>
                  <Text style={styles.optionText}>−0.5s</Text>
                </Pressable>
                <Text style={styles.delayValue}>
                  {p.delay > 0 ? '+' : ''}
                  {p.delay.toFixed(1)}s
                </Text>
                <Pressable style={styles.delayButton} onPress={() => p.onDelay(p.delay + 0.5)}>
                  <Text style={styles.optionText}>+0.5s</Text>
                </Pressable>
              </View>
              <Text style={styles.detail}>Positive shows subtitles later.</Text>
            </Section>
          ) : null}

          {p.audioTracks.length > 1 ? (
            <Section title="Audio">
              {p.audioTracks.map((t, i) => (
                <Option
                  key={`a${i}`}
                  label={trackLabel(t)}
                  selected={
                    !!p.currentAudio &&
                    p.currentAudio.id === t.id &&
                    p.currentAudio.label === t.label
                  }
                  onPress={() => p.onChooseAudio(t)}
                />
              ))}
            </Section>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles((Colors) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
  section: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.one,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
  },
  optionText: { color: Colors.text, fontSize: 16, fontWeight: '500' },
  detail: { color: Colors.textSecondary, fontSize: 12 },
  delayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  delayButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
  },
  delayValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 60,
    textAlign: 'center',
  },
}));
