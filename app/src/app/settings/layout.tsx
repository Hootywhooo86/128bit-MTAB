import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { Spacing, makeStyles } from '@/constants/theme';
import { ACCENTS, usePrefs, type AccentId } from '@/lib/prefs';

export default function LayoutSettings() {
  const styles = useStyles();
  const { prefs, setPref } = usePrefs();

  return (
    <SettingsPage>
      <SectionTitle>Theme</SectionTitle>
      <View style={styles.grid}>
        {(Object.keys(ACCENTS) as AccentId[]).map((id) => {
          const accent = ACCENTS[id];
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

const useStyles = makeStyles((Colors) => ({
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
