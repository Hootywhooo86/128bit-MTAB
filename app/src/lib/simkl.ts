/**
 * Simkl: sign in with a code, then scrobble what you watch (movies, shows and
 * anime). Needs a Simkl app's Client ID (simkl.com/settings/developer), typed in
 * Settings → Tracking. No secret needed.
 *
 * New Simkl apps are "AUTH V2" (OAuth 2.0 device flow: /oauth2/device, 7-day tokens
 * refreshed automatically); older apps use the V1 PIN flow (/oauth/pin). Both work.
 */
import { secureGet, secureSet } from './storage';

const API = 'https://api.simkl.com';
const APP_KEY = '128bit.simklApp';
const TOKEN_KEY = '128bit.simkl';

let clientId: string | null | undefined;

async function getClientId() {
  if (clientId === undefined) clientId = await secureGet(APP_KEY);
  return clientId;
}

export async function simklConfigured() {
  return !!(await getClientId());
}

export async function setSimklClientId(id: string) {
  clientId = id.trim() || null;
  await secureSet(APP_KEY, clientId);
  await secureSet(TOKEN_KEY, null);
}

/** V1: the token string. V2: JSON with the refresh token and expiry. */
type V2Token = { access: string; refresh: string; expiresAt: number };

const form = (body: Record<string, string>) =>
  Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

async function oauth2<T>(path: string, body: Record<string, string>) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': '128bit/1.0' },
    body: form(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; error_description?: string })
    | null;
  return { status: res.status, data };
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };

async function saveV2(t: TokenResponse) {
  const token: V2Token = {
    access: t.access_token!,
    refresh: t.refresh_token ?? '',
    expiresAt: Date.now() + (t.expires_in ?? 7 * 86400) * 1000,
  };
  await secureSet(TOKEN_KEY, JSON.stringify(token));
}

let refreshing: Promise<string | null> | null = null;

/** V2 access tokens last 7 days: refresh a day early (one refresh at a time). */
async function refreshV2(t: V2Token): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const id = await getClientId();
      const { data } = await oauth2<TokenResponse>('/oauth2/token', {
        grant_type: 'refresh_token',
        client_id: id ?? '',
        refresh_token: t.refresh,
      });
      if (!data?.access_token) return null;
      await saveV2({ refresh_token: t.refresh, ...data });
      return data.access_token;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function getToken(forceRefresh = false): Promise<string | null> {
  const raw = await secureGet(TOKEN_KEY);
  if (!raw || !raw.startsWith('{')) return raw;
  const t = JSON.parse(raw) as V2Token;
  if (t.refresh && (forceRefresh || t.expiresAt - Date.now() < 86400_000)) {
    return (await refreshV2(t)) ?? (forceRefresh ? null : t.access);
  }
  return t.access;
}

export async function simklConnected() {
  return !!(await getToken());
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  const id = await getClientId();
  if (!id) throw new Error('Add your Simkl Client ID first');
  const send = (t: string | null) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'simkl-api-key': id,
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...init.headers,
      },
    });
  const token = await getToken();
  let res = await send(token);
  // V2 token expired early (or was revoked): refresh once and retry.
  if (res.status === 401 && token) {
    const fresh = await getToken(true);
    if (fresh && fresh !== token) res = await send(fresh);
  }
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    // Not JSON (e.g. an empty 204).
  }
  return { status: res.status, data };
}

// --- Signing in -------------------------------------------------------------

export type SimklPin = {
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
  /** AUTH V2 apps: the code the app polls with (never shown). */
  device_code?: string;
};

export async function startSimklPin(): Promise<SimklPin> {
  const id = await getClientId();
  if (!id) throw new Error('Add your Simkl Client ID first');
  // AUTH V2 (all new Simkl apps): OAuth 2.0 device flow.
  const v2 = await oauth2<{
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
  }>('/oauth2/device', { client_id: id, scope: 'media:read media:write' });
  if (v2.data?.device_code && v2.data.user_code) {
    return {
      user_code: v2.data.user_code,
      verification_url:
        v2.data.verification_uri_complete ?? v2.data.verification_uri ?? 'https://simkl.com/pin',
      expires_in: v2.data.expires_in ?? 900,
      interval: v2.data.interval ?? 5,
      device_code: v2.data.device_code,
    };
  }
  // Older (AUTH V1) apps: the PIN flow.
  const { status, data } = await call<SimklPin & { message?: string; error_description?: string }>(
    `/oauth/pin?client_id=${encodeURIComponent(id)}&redirect=`,
  );
  if (status !== 200 || !data?.user_code) {
    throw new Error(
      data?.message ??
        data?.error_description ??
        v2.data?.error_description ??
        `Simkl refused the request (${status})`,
    );
  }
  return data;
}

/** One poll: 'pending' until you approve the code on simkl.com; 'slow' = wait 5 s longer. */
export async function pollSimklPin(pin: SimklPin): Promise<'ok' | 'pending' | 'slow'> {
  const id = await getClientId();
  if (pin.device_code) {
    const { data } = await oauth2<TokenResponse>('/oauth2/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: id ?? '',
      device_code: pin.device_code,
    });
    if (data?.access_token) {
      await saveV2(data);
      return 'ok';
    }
    if (data?.error === 'slow_down') return 'slow';
    if (data?.error && data.error !== 'authorization_pending') {
      throw new Error(data.error_description ?? data.error);
    }
    return 'pending';
  }
  const { data } = await call<{ result?: string; access_token?: string }>(
    `/oauth/pin/${encodeURIComponent(pin.user_code)}?client_id=${encodeURIComponent(id ?? '')}`,
  );
  if (data?.result === 'OK' && data.access_token) {
    await secureSet(TOKEN_KEY, data.access_token);
    return 'ok';
  }
  return 'pending';
}

export async function disconnectSimkl() {
  await secureSet(TOKEN_KEY, null);
}

export async function simklUsername(): Promise<string | null> {
  const { data } = await call<{ user?: { name?: string } }>('/users/settings', { method: 'POST' });
  return data?.user?.name ?? null;
}

// --- Scrobbling ---------------------------------------------------------------

/** "tt0133093" → movie; "tt0903747:1:2" → episode; "kitsu:123:4" → anime episode. */
function target(key: string, type?: string) {
  const [id, season, episode] = key.split(':');
  if (/^tt\d+$/.test(id)) {
    if (season !== undefined && episode !== undefined) {
      return { show: { ids: { imdb: id } }, episode: { season: Number(season), number: Number(episode) } };
    }
    return type === 'series' ? null : { movie: { ids: { imdb: id } } };
  }
  if (id === 'kitsu' && season) {
    // Kitsu ids: "kitsu:<show>" or "kitsu:<show>:<episode>".
    const ep = episode ?? undefined;
    return ep
      ? { show: { ids: { kitsu: Number(season) } }, episode: { number: Number(ep) } }
      : { movie: { ids: { kitsu: Number(season) } } };
  }
  return null;
}

/**
 * Tell Simkl what's playing. Simkl marks it watched when a "stop" arrives past 80%.
 * Does nothing unless Simkl is connected.
 */
export async function simklScrobble(
  action: 'start' | 'pause' | 'stop',
  key: string,
  type: string | undefined,
  progressPercent: number,
) {
  const t = target(key, type);
  if (!t || !(await getToken())) return;
  const progress = Math.min(100, Math.max(0, progressPercent));
  const { status } = await call(`/scrobble/${action}`, {
    method: 'POST',
    body: JSON.stringify({ ...t, progress }),
  });
  // If scrobbling isn't accepted, still record a finished watch in the history.
  if (action === 'stop' && progress >= 80 && status >= 400) {
    const body =
      'movie' in t
        ? { movies: [{ ...t.movie, watched_at: new Date().toISOString() }] }
        : {
            shows: [
              {
                ...t.show,
                seasons: [
                  {
                    number: 'season' in t.episode ? t.episode.season : 1,
                    episodes: [{ number: t.episode.number, watched_at: new Date().toISOString() }],
                  },
                ],
              },
            ],
          };
    await call('/sync/history', { method: 'POST', body: JSON.stringify(body) });
  }
}
