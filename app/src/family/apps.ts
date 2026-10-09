/**
 * 128bit family — who's in it and how to reach each app.
 *
 * Pure data, no platform imports. open.ts does the actual opening.
 */

export type Bit128App = 'fit' | 'play' | 'trip' | 'gold' | 'life' | 'fantasy';

export type FamilyApp = {
  id: Bit128App;
  name: string;
  /** One line, for a "more from 128bit" list. */
  tagline: string;
  /** The app's URL scheme, from its app.json. Null until it ships. */
  scheme: string | null;
  /** The Android package, from its app.json. Null until it ships. */
  androidPackage: string | null;
};

export const FAMILY: Record<Bit128App, FamilyApp> = {
  fit: {
    id: 'fit',
    name: '128BIT FIT',
    tagline: 'Training and nutrition',
    scheme: 'bitfit',
    androidPackage: 'com.hootywhooo86.bit128fit',
  },
  play: {
    id: 'play',
    name: '128bitPlay',
    tagline: 'Audiobooks, shows, movies, live TV, comics',
    scheme: 'bit128',
    androidPackage: 'app.bit128.mtab',
  },
  trip: {
    id: 'trip',
    name: '128bittrip',
    tagline: 'Quests, not itineraries',
    scheme: 'bit128trip',
    androidPackage: 'com.hootywhooo86.bit128trip',
  },
  gold: { id: 'gold', name: '128bitgold', tagline: 'Budget', scheme: null, androidPackage: null },
  life: { id: 'life', name: '128bitlife', tagline: 'Your whole life, one character sheet', scheme: null, androidPackage: null },
  fantasy: { id: 'fantasy', name: '128bitfantasy', tagline: 'Fantasy sports', scheme: null, androidPackage: null },
};

/** The apps that exist today, in a stable order. */
export function shippedApps(): FamilyApp[] {
  return Object.values(FAMILY).filter((a) => a.scheme != null);
}

/**
 * A deep link into a sibling, e.g. appLink('trip', 'passport') →
 * "bit128trip://passport". Null for an app that hasn't shipped.
 */
export function appLink(app: Bit128App, path = ''): string | null {
  const scheme = FAMILY[app].scheme;
  if (!scheme) return null;
  return `${scheme}://${path.replace(/^\/+/, '')}`;
}
