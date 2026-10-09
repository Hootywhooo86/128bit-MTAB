/**
 * 128bit family — open a sibling app.
 */
import { Linking } from 'react-native';

import { appLink, FAMILY, type Bit128App } from './apps';

/**
 * Opens a sibling app, optionally at a path. Resolves to null on success, or
 * one sentence to show the user when it couldn't (not shipped, not installed).
 *
 * openURL is tried directly rather than gated on canOpenURL, which on Android
 * 11+ answers false for any scheme not declared in the manifest's <queries>.
 */
export async function openFamilyApp(app: Bit128App, path = ''): Promise<string | null> {
  const url = appLink(app, path);
  const name = FAMILY[app].name;
  if (!url) return `${name} isn't out yet.`;
  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return `${name} isn't installed on this phone.`;
  }
}
