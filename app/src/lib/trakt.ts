/**
 * Trakt: sign in with a device code, scrobble what you watch, and read
 * "continue watching" back.
 *
 * Needs a Trakt API app (https://trakt.tv/oauth/applications) with redirect URI
 * `urn:ietf:wg:oauth:2.0:oob`. Its keys come from the build (app/.env:
 * EXPO_PUBLIC_TRAKT_CLIENT_ID / EXPO_PUBLIC_TRAKT_CLIENT_SECRET) or are typed in
 * Settings → Tracking.
 */
import { secureGet, secureSet } from './storage';
import type { WatchProgress } from './video';

const API = 'https://api.trakt.tv';
const BUILD_ID = process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID ?? '';
const BUILD_SECRET = process.env.EXPO_PUBLIC_TRAKT_CLIENT_SECRET ?? '';
const TOKEN_KEY = '128bit.trakt';
const APP_KEY = '128bit.traktApp';

let CLIENT_ID = BUILD_ID;
let CLIENT_SECRET = BUILD_SECRET;
let keysLoaded = !!(BUILD_ID && BUILD_SECRET);

/** True when the build has keys baked in (then there's nothing to type). */
export const traktBuiltIn = keysLoaded;

async function loadKeys() {
  if (keysLoaded) return;
  const raw = await secureGet(APP_KEY);
  if (raw) {
    const k = JSON.parse(raw) as { id: string; secret: string };
    CLIENT_ID = k.id;
    CLIENT_SECRET = k.secret;
  }
  keysLoaded = true;
}

/** Are Trakt API keys available (from the build or typed in by the user)? */
export async function traktConfigured() {
  await loadKeys();
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/** Saves the user's own Trakt API app keys. Signing in again is needed after a change. */
export async function setTraktKeys(id: string, secret: string) {
  id = id.trim();
  secret = secret.trim();
  await secureSet(APP_KEY, id && secret ? JSON.stringify({ id, secret }) : null);
  await saveTokens(null);
  CLIENT_ID = id || BUILD_ID;
  CLIENT_SECRET = secret || BUILD_SECRET;
}

type Tokens = {
  access_token: string;
  refresh_token: string;
  created_at: number;
  expires_in: number;
};

async function getTokens(): Promise<Tokens | null> {
  await loadKeys();
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

/**
 * Any signed-in Trakt call. Returns the parsed body (null for empty answers).
 * Trakt asks clients to slow down with 429; this waits and retries once.
 */
export async function traktApi<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await accessToken();
  if (!token) throw new Error('Connect Trakt in Settings → Tracking first');
  const call = () =>
    fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await call();
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') ?? '1');
    await new Promise((r) => setTimeout(r, Math.min(10, wait) * 1000));
    res = await call();
  }
  if (!res.ok) {
    const msg = res.status === 401 ? 'Trakt sign-in expired; reconnect in Settings → Tracking' : `Trakt ${res.status}`;
    throw new Error(msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
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
  if (!(await traktConfigured())) throw new Error('Add your Trakt API keys first');
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
  if (!target || !(await traktConfigured())) return;
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
