/**
 * Simkl: sign in with a PIN code, then scrobble what you watch (movies, shows and
 * anime). Needs a Simkl app's Client ID (simkl.com/settings/developer), typed in
 * Settings → Tracking. Simkl's PIN sign-in doesn't need the secret.
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

const getToken = () => secureGet(TOKEN_KEY);

export async function simklConnected() {
  return !!(await getToken());
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  const id = await getClientId();
  if (!id) throw new Error('Add your Simkl Client ID first');
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'simkl-api-key': id,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
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

export type SimklPin = { user_code: string; verification_url: string; expires_in: number; interval: number };

export async function startSimklPin(): Promise<SimklPin> {
  const id = await getClientId();
  const { status, data } = await call<SimklPin & { message?: string }>(
    `/oauth/pin?client_id=${encodeURIComponent(id ?? '')}&redirect=`,
  );
  if (status !== 200 || !data?.user_code) {
    throw new Error(data?.message ?? `Simkl refused the request (${status})`);
  }
  return data;
}

/** One poll: 'pending' until you approve the code on simkl.com. */
export async function pollSimklPin(code: string): Promise<'ok' | 'pending'> {
  const id = await getClientId();
  const { data } = await call<{ result?: string; access_token?: string }>(
    `/oauth/pin/${encodeURIComponent(code)}?client_id=${encodeURIComponent(id ?? '')}`,
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
