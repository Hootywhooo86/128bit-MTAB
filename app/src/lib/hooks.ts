import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getAddons } from './storage';
import type { InstalledAddon } from './types';

/** Installed addons, re-read whenever the screen comes into focus. */
export function useAddons() {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setAddons(await getAddons());
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return { addons, loaded, refresh };
}
