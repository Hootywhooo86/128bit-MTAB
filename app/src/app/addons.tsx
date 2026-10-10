import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Text, View } from 'react-native';

import { Chip, SectionTitle, SettingsPage, ThemedSwitch } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  DEFAULT_ADDONS,
  installAddon,
  moveAddon,
  needsPlace,
  setAddonPlace,
  refreshAddon,
  resourceNames,
  setAddonEnabled,
  uninstallAddon,
} from '@/lib/addons';
import { useAddons } from '@/lib/hooks';
import { isEnabled } from '@/lib/storage';
import type { AddonPlace, InstalledAddon } from '@/lib/types';
import { Pressable } from '@/components/focusable';

const SUGGESTED = DEFAULT_ADDONS;

const TYPE_LABELS: Record<string, string> = {
  movie: 'Movie',
  series: 'Series',
  tv: 'TV',
  channel: 'Channel',
  sport: 'Sport',
  sports: 'Sports',
  audiobook: 'Audiobook',
  anime: 'Anime',
  other: 'Other',
};

function confirm(message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert('Remove addon', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function AddonsScreen() {
  const styles = useStyles();
  const { all, refresh } = useAddons();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An addon 128bit can't place by itself: ask where it goes.
  const [placing, setPlacing] = useState<InstalledAddon | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const install = (target: string) =>
    target.trim() &&
    run(`install:${target}`, async () => {
      const addon = await installAddon(target);
      setUrl('');
      if (needsPlace(addon)) setPlacing(addon);
    });

  const active = all.filter(isEnabled).length;
  const catalogs = all.reduce((n, a) => n + a.manifest.catalogs.length, 0);
  const suggestions = SUGGESTED.filter(
    (s) => !all.some((a) => a.manifest.id === s.id || `${a.baseUrl}/manifest.json` === s.url),
  );

  return (
    <SettingsPage>
      <SectionTitle>Overview</SectionTitle>
      <View style={styles.stats}>
        <Stat value={all.length} label="Addons" />
        <View style={styles.statDivider} />
        <Stat value={active} label="Active" />
        <View style={styles.statDivider} />
        <Stat value={catalogs} label="Catalogs" />
      </View>

      <SectionTitle>Add addon</SectionTitle>
      <View style={styles.card}>
        <Input
          placeholder="Addon URL"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          onSubmitEditing={() => install(url)}
        />
        <Button
          label="Install Addon"
          onPress={() => install(url)}
          disabled={!url.trim()}
          loading={busy === `install:${url}` && !!url}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {suggestions.map((s) => (
          <View key={s.id} style={styles.suggestion}>
            <View style={{ flex: 1 }}>
              <Text style={styles.suggestionTitle}>Suggested: {s.name}</Text>
              <Text style={styles.description}>{s.description}</Text>
            </View>
            <Button
              label="Add"
              variant="secondary"
              loading={busy === `install:${s.url}`}
              onPress={() => install(s.url)}
            />
          </View>
        ))}
      </View>

      <SectionTitle>Installed addons</SectionTitle>
      {all.length === 0 ? <Text style={styles.description}>Nothing installed yet.</Text> : null}
      {all.map((addon, i) => (
        <AddonCard
          key={addon.manifest.id}
          addon={addon}
          first={i === 0}
          last={i === all.length - 1}
          busy={busy?.endsWith(addon.manifest.id) ? busy : null}
          onToggle={(on) =>
            run(`toggle:${addon.manifest.id}`, () => setAddonEnabled(addon.manifest.id, on))
          }
          onMove={(d) => run(`move:${addon.manifest.id}`, () => moveAddon(addon.manifest.id, d))}
          onRefresh={() =>
            run(`refresh:${addon.manifest.id}`, () => refreshAddon(addon.manifest.id))
          }
          onPlace={addon.place ? () => setPlacing(addon) : undefined}
          onRemove={() =>
            confirm(`Remove ${addon.manifest.name}?`, () =>
              run(`remove:${addon.manifest.id}`, () => uninstallAddon(addon.manifest.id)),
            )
          }
        />
      ))}
      <PlacePicker
        addon={placing}
        onPick={(place) => {
          const id = placing!.manifest.id;
          setPlacing(null);
          run(`place:${id}`, () => setAddonPlace(id, place));
        }}
        onClose={() => setPlacing(null)}
      />
    </SettingsPage>
  );
}

const PLACES: { place: AddonPlace; label: string; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { place: 'series', label: 'Shows', icon: 'tv-outline' },
  { place: 'movie', label: 'Movies', icon: 'film-outline' },
  { place: 'anime', label: 'Anime', icon: 'sparkles-outline' },
  { place: 'all', label: 'All', icon: 'apps-outline' },
];
const placeLabel = (p: AddonPlace) => PLACES.find((x) => x.place === p)!.label;

/** "Where should this addon go?" — only for addons 128bit can't place by itself. */
function PlacePicker({
  addon,
  onPick,
  onClose,
}: {
  addon: InstalledAddon | null;
  onPick: (place: AddonPlace) => void;
  onClose: () => void;
}) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Modal visible={!!addon} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.name}>Where should {addon?.manifest.name} go?</Text>
          <Text style={styles.description}>128bit couldn’t tell from the addon. You can change this later on its card.</Text>
          <View style={styles.places}>
            {PLACES.map((p) => (
              <Pressable
                key={p.place}
                style={[styles.place, addon?.place === p.place && { borderColor: Colors.accent }]}
                onPress={() => onPick(p.place)}>
                <Ionicons name={p.icon} size={26} color={Colors.accent} />
                <Text style={styles.placeText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type CardProps = {
  addon: InstalledAddon;
  first: boolean;
  last: boolean;
  busy: string | null;
  onToggle: (on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRefresh: () => void;
  onRemove: () => void;
  /** Only for addons whose tab the user picked. */
  onPlace?: () => void;
};

function AddonCard({ addon, first, last, busy, onToggle, onMove, onRefresh, onRemove, onPlace }: CardProps) {
  const Colors = useColors();
  const styles = useStyles();
  const { manifest, baseUrl } = addon;
  const enabled = isEnabled(addon);
  const configurable = !!manifest.behaviorHints?.configurable;
  const resources = resourceNames(addon);
  const idRules = manifest.resources.filter(
    (r) => typeof r === 'object' && r.idPrefixes?.length,
  ).length;
  const types = manifest.types.map((t) => TYPE_LABELS[t] ?? t).join(' / ');
  const footer = [types, resources.join(', '), idRules ? `${idRules} id rules` : null]
    .filter(Boolean)
    .join(' • ');

  return (
    <View style={[styles.card, !enabled && { opacity: 0.6 }]}>
      <View style={styles.header}>
        <View style={styles.logo}>
          {manifest.logo ? (
            <Image
              source={{ uri: manifest.logo }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <Ionicons name="extension-puzzle" size={32} color={Colors.accent} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{manifest.name}</Text>
          <Text style={styles.version}>Version {manifest.version}</Text>
        </View>
        <ThemedSwitch value={enabled} onValueChange={onToggle} />
      </View>

      <View style={styles.actions}>
        {busy ? <ActivityIndicator color={Colors.accent} /> : null}
        {!first ? <Action icon="arrow-up" label="Move up" onPress={() => onMove(-1)} /> : null}
        {!last ? <Action icon="arrow-down" label="Move down" onPress={() => onMove(1)} /> : null}
        <Action icon="refresh" label="Refresh" onPress={onRefresh} />
        {configurable ? (
          <Action
            icon="settings"
            label="Configure"
            color={Colors.accent}
            onPress={() => Linking.openURL(`${baseUrl}/configure`)}
          />
        ) : null}
        <Action icon="trash" label="Remove" color={Colors.danger} onPress={onRemove} />
      </View>

      <View style={styles.divider} />

      <View style={styles.chips}>
        <Chip label={enabled ? 'Active' : 'Off'} />
        <Chip label={`${resources.length} resources`} />
        <Chip label={`${manifest.catalogs.length} catalogs`} />
        {configurable ? <Chip label="Configurable" /> : null}
        {onPlace && addon.place ? (
          <Pressable onPress={onPlace} accessibilityLabel="Change where this addon goes">
            <Chip label={`In: ${placeLabel(addon.place)} ✎`} />
          </Pressable>
        ) : null}
      </View>
      {manifest.description ? <Text style={styles.description}>{manifest.description}</Text> : null}
      <Text style={styles.footer}>{footer}</Text>
    </View>
  );
}

function Action({
  icon,
  label,
  color,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  color?: string;
  onPress: () => void;
}) {
  const Colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={{ padding: 6 }}>
      <Ionicons name={icon} size={24} color={color ?? Colors.text} />
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.four },
  sheet: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.four, gap: Spacing.three },
  places: { flexDirection: 'row', gap: Spacing.two },
  place: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
  },
  placeText: { color: Colors.text, fontWeight: '700' },
  stats: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.four,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { color: Colors.text, fontSize: 30, fontWeight: '700' },
  statLabel: { color: Colors.textSecondary, fontSize: 16 },
  statDivider: { width: 1, backgroundColor: Colors.border },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: Spacing.three,
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  error: { color: Colors.danger },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  suggestionTitle: { color: Colors.text, fontWeight: '700', fontSize: 15 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: Colors.text, fontSize: 22, fontWeight: '700' },
  version: { color: Colors.textSecondary, fontSize: 15, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
  },
  divider: { height: 1, backgroundColor: Colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  description: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22 },
  footer: { color: Colors.textSecondary, fontSize: 14 },
}));
