import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Pressable } from '@/components/focusable';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { BUILD, checkForUpdate, getGithubToken } from '@/lib/app-update';

const DISMISSED_KEY = '128bit.update.dismissed';

/** "Build N is ready": a slim bar above the tabs when GitHub has a newer build (checked at launch). */
export function UpdateBanner() {
  const Colors = useColors();
  const styles = useStyles();
  const [update, setUpdate] = useState<{ build: number; url: string } | null>(null);

  useEffect(() => {
    if (!BUILD) return; // local/dev builds
    (async () => {
      // The repo is private: without a saved token (About → Updates) there's nothing to check.
      if (!(await getGithubToken())) return;
      const r = await checkForUpdate();
      if (r.status !== 'available') return;
      if (Number(await AsyncStorage.getItem(DISMISSED_KEY)) >= r.build) return;
      setUpdate({ build: r.build, url: r.apkUrl ?? r.pageUrl });
    })().catch(() => {});
  }, []);

  if (!update) return null;
  return (
    <View style={styles.bar}>
      <Pressable style={styles.main} onPress={() => Linking.openURL(update.url)}>
        <Ionicons name="arrow-down-circle" size={20} color={Colors.accent} />
        <Text style={styles.text}>Build {update.build} is ready · tap to update</Text>
      </Pressable>
      <Pressable
        hitSlop={10}
        onPress={() => {
          AsyncStorage.setItem(DISMISSED_KEY, String(update.build)).catch(() => {});
          setUpdate(null);
        }}>
        <Ionicons name="close" size={20} color={Colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { color: Colors.text, fontSize: 13, fontWeight: '600' },
}));
