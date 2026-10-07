import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { Input } from '@/components/ui';
import { Spacing, makeStyles, textOn } from '@/constants/theme';
import { ACCENTS, usePrefs } from '@/lib/prefs';
import { Pressable } from '@/components/focusable';

export default function LayoutSettings() {
  const styles = useStyles();
  const { prefs, setPref } = usePrefs();
  const [hex, setHex] = useState(prefs.customAccent);
  const valid = /^#?[0-9a-f]{6}$/i.test(hex.trim());
  const typed = valid ? `#${hex.trim().replace('#', '').toUpperCase()}` : null;
  const swatches = [
    ...(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((id) => ({ id, ...ACCENTS[id] })),
    { id: 'custom' as const, name: 'Custom', color: prefs.customAccent, onAccent: textOn(prefs.customAccent) },
  ];

  return (
    <SettingsPage>
      <SectionTitle>Theme</SectionTitle>
      <View style={styles.grid}>
        {swatches.map((accent) => {
          const id = accent.id;
          const selected = prefs.accent === id;
          return (
            <Pressable
              key={id}
              style={styles.swatchCell}
              onPress={() => setPref('accent', id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={accent.name}>
              <View style={[styles.ring, selected && styles.ringSelected]}>
                <View style={[styles.swatch, { backgroundColor: accent.color }]}>
                  {selected ? (
                    <Ionicons name="checkmark" size={26} color={accent.onAccent} />
                  ) : null}
                </View>
              </View>
              <Text style={[styles.swatchLabel, selected && styles.swatchLabelSelected]}>
                {accent.name}
              </Text>
              <View style={[styles.underline, { backgroundColor: accent.color }]} />
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Your own colour</SectionTitle>
      <View style={styles.custom}>
        <View style={[styles.preview, { backgroundColor: typed ?? prefs.customAccent }]} />
        <View style={{ flex: 1 }}>
          <Input
            value={hex}
            onChangeText={setHex}
            placeholder="#00E5FF"
            autoCapitalize="characters"
            maxLength={7}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (!typed) return;
              setPref('customAccent', typed);
              setPref('accent', 'custom');
            }}
          />
        </View>
      </View>
      <View style={styles.hues}>
        {HUES.map((c) => (
          <Pressable
            key={c}
            accessibilityLabel={c}
            style={[styles.hue, { backgroundColor: c }]}
            onPress={() => {
              setHex(c);
              setPref('customAccent', c);
              setPref('accent', 'custom');
            }}
          />
        ))}
      </View>
      <Text style={styles.hint}>Type a colour code (like #00E5FF) and press done, or tap one above.</Text>

      <SectionTitle>Display</SectionTitle>
      <Group>
        <ToggleRow
          title="AMOLED Black"
          subtitle="Use pure black backgrounds for OLED screens."
          value={prefs.amoled}
          onChange={(v) => setPref('amoled', v)}
        />
      </Group>
    </SettingsPage>
  );
}

/** A spread of extra colours for one-tap "Custom". */
const HUES = [
  '#FF1744', '#FF9100', '#FFEA00', '#76FF03', '#00E676', '#1DE9B6',
  '#00E5FF', '#2979FF', '#651FFF', '#D500F9', '#F50057', '#BCAAA4',
];

const useStyles = makeStyles((Colors) => ({
  custom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  preview: { width: 44, height: 44, borderRadius: 22 },
  hues: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  hue: { width: 36, height: 36, borderRadius: 18 },
  hint: { color: Colors.textSecondary, fontSize: 12, marginTop: Spacing.two },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingVertical: Spacing.four,
    rowGap: Spacing.four,
  },
  swatchCell: { width: '33.33%', alignItems: 'center', gap: 6 },
  ring: {
    padding: 4,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  ringSelected: { borderColor: Colors.text },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: {
    color: Colors.textSecondary,
    fontSize: 15,
    letterSpacing: 0.5,
  },
  swatchLabelSelected: { color: Colors.text, fontWeight: '800' },
  underline: { width: 40, height: 3, borderRadius: 2 },
}));
