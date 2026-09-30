/**
 * Trakt: sign in with a device code, scrobble what you watch, and read
 * "continue watching" back.
 *
 * Needs a Trakt API app (https://trakt.tv/oauth/applications) with redirect URI
 * `urn:ietf:wg:oauth:2.0:oob`. Put its keys in app/.env:
 *   EXPO_PUBLIC_TRAKT_CLIENT_ID=...
 *   EXPO_PUBLIC_TRAKT_CLIENT_SECRET=...
 */
import { secureGet, secureSet } from './storage';
import type { WatchProgress } from './video';

const API = 'https://api.trakt.tv';
const CLIENT_ID = process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.EXPO_PUBLIC_TRAKT_CLIENT_SECRET ?? '';
const TOKEN_KEY = '128bit.trakt';

export const traktConfigured = !!(CLIENT_ID && CLIENT_SECRET);

type Tokens = {
  access_token: string;
  refresh_token: string;
  created_at: number;
  expires_in: number;
};

async function getTokens(): Promise<Tokens | null> {
  const raw = await secureGet(TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

const saveTokens = (t: Tokens | null) => secureSet(TOKEN_KEY, t ? JSON.stringify(t) : null);

async function post<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': CLIENT_ID,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}

/** A valid access token, refreshed if it's about to expire. Null when not signed in. */
async function accessToken(): Promise<string | null> {
  const t = await getTokens();
  if (!t) return null;
  const expiresAt = (t.created_at + t.expires_in) * 1000;
  if (Date.now() < expiresAt - 24 * 3600_000) return t.access_token;
  const { status, data } = await post<Tokens>('/oauth/token', {
    refresh_token: t.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    grant_type: 'refresh_token',
  });
  if (status !== 200 || !data) {
    await saveTokens(null);
    return null;
  }
  await saveTokens(data);
  return data.access_token;
}

async function get<T>(path: string): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('Not connected to Trakt');
  const res = await fetch(`${API}${path}`, {
    headers: {
      'trakt-api-version': '2',
      'trakt-api-key': CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Trakt ${res.status}`);
  return (await res.json()) as T;
}

// --- Signing in -------------------------------------------------------------

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
};

export async function startDeviceAuth(): Promise<DeviceCode> {
  if (!traktConfigured) throw new Error('Trakt keys are missing (see app/.env.example)');
  const { status, data } = await post<DeviceCode>('/oauth/device/code', {
    client_id: CLIENT_ID,
  });
  if (status !== 200 || !data) throw new Error(`Trakt refused the request (${status})`);
  return data;
}

/** One poll: 'pending' until the user approves, then 'ok'. */
export async function pollDeviceAuth(
  code: string,
): Promise<'ok' | 'pending' | 'slow' | 'expired' | 'denied'> {
  const { status, data } = await post<Tokens>('/oauth/device/token', {
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  if (status === 200 && data) {
    await saveTokens(data);
    return 'ok';
  }
  if (status === 429) return 'slow';
  if (status === 410 || status === 404) return 'expired';
  if (status === 418) return 'denied';
  return 'pending';
}

export async function disconnect() {
  const token = (await getTokens())?.access_token;
  await saveTokens(null);
  if (token) {
    post('/oauth/revoke', {
      token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).catch(() => {});
  }
}

export async function isConnected() {
  return !!(await getTokens());
}

export async function getUsername(): Promise<string> {
  const data = await get<{ user: { username: string; name?: string } }>('/users/settings');
  return data.user.username;
}

// --- Scrobbling -------------------------------------------------------------

/**
 * Stremio ids are IMDb based: "tt0133093" for a movie, "tt0903747:1:2" for an episode.
 * Anything else (e.g. a live channel) can't be scrobbled.
 */
function scrobbleTarget(key: string, type?: string) {
  const [imdb, season, episode] = key.split(':');
  if (!/^tt\d+$/.test(imdb)) return null;
  if (season !== undefined && episode !== undefined) {
    return {
      show: { ids: { imdb } },
      episode: { season: Number(season), number: Number(episode) },
    };
  }
  if (type === 'series') return null;
  return { movie: { ids: { imdb } } };
}

export async function scrobble(
  action: 'start' | 'pause' | 'stop',
  key: string,
  type: string | undefined,
  progressPercent: number,
) {
  const target = scrobbleTarget(key, type);
  if (!target || !traktConfigured) return;
  const token = await accessToken();
  if (!token) return;
  await post(
    `/scrobble/${action}`,
    { ...target, progress: Math.min(100, Math.max(0, progressPercent)) },
    token,
  );
}

// --- Continue watching ------------------------------------------------------

type PlaybackItem = {
  progress: number;
  paused_at: string;
  type: 'movie' | 'episode';
  movie?: { title: string; year?: number; ids: { imdb?: string } };
  episode?: { season: number; number: number; title?: string };
  show?: { title: string; ids: { imdb?: string } };
};

const backdrop = (imdb: string) => `https://images.metahub.space/background/medium/${imdb}/img`;

/** Trakt's paused items, shaped like local Continue watching entries. */
export async function getPlayback(): Promise<WatchProgress[]> {
  const items = await get<PlaybackItem[]>('/sync/playback?limit=30');
  return items.flatMap<WatchProgress>((p) => {
    const updatedAt = Date.parse(p.paused_at) || 0;
    if (p.type === 'movie' && p.movie?.ids.imdb) {
      const imdb = p.movie.ids.imdb;
      return [
        {
          key: imdb,
          title: p.movie.title,
          subtitle: p.movie.year ? String(p.movie.year) : undefined,
          poster: backdrop(imdb),
          position: p.progress,
          duration: 100,
          updatedAt,
          link: { type: 'movie', id: imdb },
        },
      ];
    }
    if (p.type === 'episode' && p.show?.ids.imdb && p.episode) {
      const imdb = p.show.ids.imdb;
      const e = p.episode;
      return [
        {
          key: `${imdb}:${e.season}:${e.number}`,
          title: p.show.title,
          subtitle: `S${e.season} E${e.number}${e.title ? ` · ${e.title}` : ''}`,
          poster: backdrop(imdb),
          position: p.progress,
          duration: 100,
          updatedAt,
          link: { type: 'series', id: imdb },
        },
      ];
    }
    return [];
  });
}
