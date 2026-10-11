/**
 * "Check for updates": compares this build with the newest GitHub release of the
 * app (every push builds one). A private repo needs a read-only GitHub token.
 */
import { Platform } from 'react-native';

import { IS_TV } from '@/constants/tv';

import { secureGet, secureSet } from './storage';

export const BUILD = Number(process.env.EXPO_PUBLIC_BUILD_NUMBER ?? 0);
const REPO = process.env.EXPO_PUBLIC_RELEASES_REPO ?? 'Hootywhooo86/128bit-MTAB';
const TOKEN_KEY = '128bit.githubToken';

export const getGithubToken = () => secureGet(TOKEN_KEY);
export const setGithubToken = (t: string | null) => secureSet(TOKEN_KEY, t?.trim() || null);

export type UpdateCheck =
  | { status: 'latest'; build: number }
  | { status: 'available'; build: number; name: string; pageUrl: string; apkUrl?: string; notes?: string }
  | { status: 'needs-token' };

type Release = {
  tag_name: string;
  name: string;
  html_url: string;
  draft: boolean;
  body?: string;
  assets: { name: string; browser_download_url: string }[];
};

/** "v1.0.0-build14" → 14. */
const buildOf = (tag: string) => Number(tag.match(/build(\d+)/)?.[1] ?? 0);

export async function checkForUpdate(): Promise<UpdateCheck> {
  const token = await getGithubToken();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  // Private repos answer 404 without a token (and 401 with a bad one).
  if (res.status === 404 || res.status === 401) return { status: 'needs-token' };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const releases = ((await res.json()) as Release[]).filter((r) => !r.draft);
  const newest = releases.sort((a, b) => buildOf(b.tag_name) - buildOf(a.tag_name))[0];
  if (!newest) return { status: 'latest', build: BUILD };
  const build = buildOf(newest.tag_name);
  if (build <= BUILD) return { status: 'latest', build: BUILD };
  return {
    status: 'available',
    build,
    name: newest.name,
    pageUrl: newest.html_url,
    // Each release has the phone APK, the TV APK ("…-tv-…") and the Windows installer; pick this app's.
    apkUrl: newest.assets.find((a) =>
      Platform.OS === 'web' ? a.name.endsWith('.exe') : a.name.endsWith('.apk') && /-tv-/.test(a.name) === IS_TV,
    )?.browser_download_url,
  };
}
