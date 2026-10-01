import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { getAddons, isEnabled, onAddonsChanged } from './storage';
import type { InstalledAddon } from './types';

/**
 * Installed addons, re-read whenever the screen comes into focus.
 * `addons` is only the switched-on ones; `all` includes switched-off ones.
 */
export function useAddons() {
  const [all, setAll] = useState<InstalledAddon[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setAll(await getAddons());
    setLoaded(true);
  }, []);
  const addons = all.filter(isEnabled);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useEffect(() => onAddonsChanged(refresh), [refresh]);

  return { addons, all, loaded, refresh };
}
