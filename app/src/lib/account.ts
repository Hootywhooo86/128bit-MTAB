/**
 * Accounts & sync through the user's own Supabase project (Settings → Account).
 *
 * Signing in on a phone, a second phone or the TV app brings the same settings over:
 * add-ons (in order), preferences, Live TV playlists, TorBox / Trakt / Simkl / TMDB
 * connections, Continue watching, and on phones also books and comics. Changes are
 * pushed a few seconds after they happen and pulled when the app opens.
 *
 * Talks to Supabase's REST endpoints (Auth + PostgREST RPC) with fetch, so there's no
 * SDK. The SQL to run once in the project is SETUP_SQL below; everything goes through
 * those functions, so the tables need no other access.
 *
 * TVs sign in with a pairing code: the TV signs in anonymously and shows a code (and a
 * QR code); a signed-in phone enters it, which links the TV to that account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { IS_TV } from '@/constants/tv';

import { notifyAddonsChanged, onSecureChange, secureGet, secureSet } from './storage';

// --- Project (URL + anon key) ------------------------------------------------------

const PROJECT_KEY = '128bit.account.project';
const SESSION_KEY = '128bit.account.session';
const TIMES_KEY = '128bit.account.times';
const LAST_KEY = '128bit.account.last';

export type Project = { url: string; anonKey: string };

/** Baked into the build from the SUPABASE_URL / SUPABASE_ANON_KEY repo secrets, if set. */
const BUILT_IN: Project | null =
  process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ? { url: process.env.EXPO_PUBLIC_SUPABASE_URL, anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY }
    : null;

export const projectBuiltIn = !!BUILT_IN;

export async function getProject(): Promise<Project | null> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    if (raw) return JSON.parse(raw) as Project;
  } catch {
    // fall through
  }
  return BUILT_IN;
}

export async function setProject(p: Project | null) {
  if (!p) return AsyncStorage.removeItem(PROJECT_KEY);
  const url = p.url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(url)) throw new Error('The Project URL looks like https://abcd1234.supabase.co');
  if (p.anonKey.trim().length < 20) throw new Error('Paste the anon / publishable key from Settings → API.');
  await AsyncStorage.setItem(PROJECT_KEY, JSON.stringify({ url, anonKey: p.anonKey.trim() }));
}

// --- Session -----------------------------------------------------------------------

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds
  user: { id: string; email?: string; is_anonymous?: boolean };
  /** TV: the account (email) a phone linked it to. Until then it isn't signed in. */
  linkedTo?: string;
};

/** Signed in for syncing: a normal account, or a TV that a phone has linked. */
export const isSignedIn = (s: Session | null): s is Session => !!s && (!s.user.is_anonymous || !!s.linkedTo);

let session: Session | null | undefined;
const listeners = new Set<() => void>();

/** Signed-in state changed, or a sync finished. */
export function onAccount(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const emit = () => listeners.forEach((l) => l());

export async function getSession(): Promise<Session | null> {
  if (session === undefined) {
    try {
      const raw = await secureGet(SESSION_KEY);
      session = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      session = null;
    }
  }
  return session;
}

async function saveSession(s: Session | null) {
  session = s;
  await secureSet(SESSION_KEY, s ? JSON.stringify(s) : null);
  emit();
}

type AuthAnswer = Partial<Session> & {
  expires_in?: number;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
  error_code?: string;
};

async function auth(path: string, body: unknown, token?: string): Promise<AuthAnswer> {
  const p = await getProject();
  if (!p) throw new Error('Add your Supabase project first.');
  let res: Response;
  try {
    res = await fetch(`${p.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: p.anonKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach your Supabase project. Check the URL and the connection.');
  }
  const json = ((await res.json().catch(() => ({}))) ?? {}) as AuthAnswer;
  if (!res.ok) {
    const msg = json.error_description ?? json.msg ?? json.message ?? json.error ?? `Supabase answered ${res.status}`;
    if (/anonymous sign-ins are disabled/i.test(msg)) {
      throw new Error('Turn on Anonymous sign-ins in Supabase (Authentication → Sign In / Providers) so TVs can pair.');
    }
    if (/email not confirmed/i.test(msg)) throw new Error('Confirm your email first (check your inbox), then sign in.');
    throw new Error(msg);
  }
  return json;
}

function toSession(a: AuthAnswer): Session | null {
  if (!a.access_token || !a.refresh_token || !a.user) return null;
  return {
    access_token: a.access_token,
    refresh_token: a.refresh_token,
    expires_at: a.expires_at ?? Math.floor(Date.now() / 1000) + (a.expires_in ?? 3600),
    user: { id: a.user.id, email: a.user.email, is_anonymous: a.user.is_anonymous },
  };
}

export async function signIn(email: string, password: string) {
  const s = toSession(await auth('token?grant_type=password', { email: email.trim(), password }));
  if (!s) throw new Error('Sign-in failed.');
  await saveSession(s);
  await firstSync();
}

/** Creates the account. Returns false when Supabase wants the email confirmed first. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const s = toSession(await auth('signup', { email: email.trim(), password }));
  if (!s) return false;
  await saveSession(s);
  await firstSync();
  return true;
}

export async function signOut() {
  const s = await getSession();
  if (s) await auth('logout', {}, s.access_token).catch(() => {});
  await saveSession(null);
  await AsyncStorage.multiRemove([TIMES_KEY, LAST_KEY]);
}

/** A valid access token, refreshed when it's about to run out. */
async function token(): Promise<string | null> {
  const s = await getSession();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  try {
    const fresh = toSession(await auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }));
    if (!fresh) throw new Error('refresh failed');
    // Keep what we knew about the user (refresh answers include it, but be safe).
    await saveSession({ ...fresh, user: { ...s.user, ...fresh.user }, linkedTo: s.linkedTo });
    return fresh.access_token;
  } catch (e) {
    // Revoked or expired for good: signed out.
    if (e instanceof Error && /invalid|not found|revoked|expired/i.test(e.message)) await saveSession(null);
    return null;
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const p = await getProject();
  const t = await token();
  if (!p || !t) throw new Error('Not signed in.');
  let res: Response;
  try {
    res = await fetch(`${p.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: p.anonKey, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error('Couldn’t reach your Supabase project.');
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.message ?? `Supabase answered ${res.status}`;
    if (/function .* does not exist|Could not find the function/i.test(msg)) {
      throw new Error('Run the setup SQL in your Supabase project first (Settings → Account → Copy setup SQL).');
    }
    throw new Error(msg);
  }
  return body as T;
}

// --- What gets synced -----------------------------------------------------------

type Section = {
  /** Plain storage keys. */
  keys?: string[];
  /** Key prefixes (e.g. one key per book's listening position). */
  prefixes?: string[];
  /** Secrets kept in the secure store. */
  secure?: string[];
  /** Phone-only (books, comics): the TV leaves these alone, both ways. */
  phoneOnly?: boolean;
};

const SECTIONS: Record<string, Section> = {
  addons: { keys: ['128bit.addons'] },
  prefs: { keys: ['128bit.prefs'] },
  live: { keys: ['128bit.playlists'] },
  watching: { keys: ['128bit.watch', '128bit.continueHidden', '128bit.animeIds'] },
  integrations: {
    keys: ['128bit.mdblist.sources'],
    secure: ['128bit.torboxKey', '128bit.tmdb', '128bit.mdblist', '128bit.githubToken'],
  },
  tracking: { secure: ['128bit.trakt', '128bit.traktApp', '128bit.simkl', '128bit.simklApp', '128bit.hardcover'] },
  books: {
    keys: ['128bit.library', '128bit.favorites', '128bit.wanted', '128bit.feeds', '128bit.sources', '128bit.audiobookSearches'],
    prefixes: ['128bit.progress.'],
    secure: ['128bit.abs'],
    phoneOnly: true,
  },
  comics: {
    keys: ['128bit.comics.library', '128bit.comics.progress', '128bit.comicFollows', '128bit.comicSites'],
    secure: ['128bit.suwayomi'],
    phoneOnly: true,
  },
};

const mine = Object.entries(SECTIONS).filter(([, s]) => !(IS_TV && s.phoneOnly));

function sectionOf(key: string, secure: boolean) {
  for (const [name, s] of mine) {
    if (secure ? s.secure?.includes(key) : s.keys?.includes(key) || s.prefixes?.some((p) => key.startsWith(p))) {
      return name;
    }
  }
  return null;
}

type Doc = { v: 1; sections: Record<string, { at: number; data: Record<string, string | null> }> };

async function readTimes(): Promise<Record<string, number>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(TIMES_KEY)) ?? '{}');
  } catch {
    return {};
  }
}

async function collect(name: string) {
  const s = SECTIONS[name];
  const data: Record<string, string | null> = {};
  const keys = [...(s.keys ?? [])];
  if (s.prefixes?.length) {
    const all = await AsyncStorage.getAllKeys();
    keys.push(...all.filter((k) => s.prefixes!.some((p) => k.startsWith(p))));
  }
  for (const [k, v] of await AsyncStorage.multiGet(keys)) data[k] = v;
  for (const k of s.secure ?? []) data[`secure:${k}`] = await secureGet(k);
  return data;
}

// Writes made while applying a pull mustn't count as local changes.
let applying = false;

async function apply(name: string, data: Record<string, string | null>) {
  applying = true;
  try {
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('secure:')) {
        await secureSet(k.slice(7), v);
      } else if (v === null) {
        await AsyncStorage.removeItem(k);
      } else {
        await AsyncStorage.setItem(k, v);
      }
    }
  } finally {
    applying = false;
  }
  if (name === 'addons') notifyAddonsChanged();
}

// --- Change tracking ----------------------------------------------------------

const dirty = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function touched(key: string, secure: boolean) {
  if (applying || key.startsWith('128bit.account.')) return;
  const name = sectionOf(key, secure);
  if (!name) return;
  dirty.add(name);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    syncNow().catch(() => {});
  }, 4000);
}

let hooked = false;

/** Watches storage writes so changes get pushed; pulls on open. Called once at startup. */
export function startAccountSync() {
  if (hooked) return;
  hooked = true;
  const store = AsyncStorage as unknown as Record<string, (...a: never[]) => Promise<unknown>>;
  const setItem = AsyncStorage.setItem.bind(AsyncStorage);
  const removeItem = AsyncStorage.removeItem.bind(AsyncStorage);
  store.setItem = ((k: string, v: string) => {
    touched(k, false);
    return setItem(k, v);
  }) as never;
  store.removeItem = ((k: string) => {
    touched(k, false);
    return removeItem(k);
  }) as never;
  onSecureChange((k) => touched(k, true));
  syncNow().catch(() => {});
  AppState.addEventListener('change', (state) => {
    if (state === 'active') syncNow().catch(() => {});
  });
}

// --- Sync ---------------------------------------------------------------------------

export type SyncResult = { pulled: string[]; pushed: string[]; at: number };

let running: Promise<SyncResult | null> | null = null;

/** Pull newer sections from the account, push the ones changed here. */
export function syncNow(): Promise<SyncResult | null> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync(): Promise<SyncResult | null> {
  const s = await getSession();
  if (!isSignedIn(s) || !(await getProject())) return null;
  const remote = ((await rpc<Doc | null>('get_settings')) ?? { v: 1, sections: {} }) as Doc;
  remote.sections ??= {};
  const times = await readTimes();
  const pulled: string[] = [];
  const pushed: string[] = [];
  const now = Date.now();

  for (const [name] of mine) {
    const r = remote.sections[name];
    const local = times[name] ?? 0;
    if (dirty.has(name) || (!r && local === 0)) {
      // Changed here (or never uploaded): this device's copy goes up.
      remote.sections[name] = { at: now, data: await collect(name) };
      times[name] = now;
      pushed.push(name);
    } else if (r && r.at > local) {
      await apply(name, r.data);
      times[name] = r.at;
      pulled.push(name);
    }
  }
  dirty.clear();
  if (pushed.length) await rpc('put_settings', { new_data: remote });
  await AsyncStorage.multiSet([
    [TIMES_KEY, JSON.stringify(times)],
    [LAST_KEY, String(now)],
  ]);
  const result = { pulled, pushed, at: now };
  lastResult = result;
  emit();
  return result;
}

/** Right after signing in: what's in the account wins; sections it doesn't have yet go up. */
async function firstSync() {
  await AsyncStorage.removeItem(TIMES_KEY);
  dirty.clear();
  await syncNow();
}

let lastResult: SyncResult | null = null;
export const lastSync = () => lastResult;
export async function lastSyncTime() {
  return Number((await AsyncStorage.getItem(LAST_KEY)) ?? 0) || null;
}

// --- TV pairing -------------------------------------------------------------------------

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** TV: sign in anonymously and register a pairing code to show on screen. */
export async function startTvPairing(): Promise<string> {
  let s = await getSession();
  if (!s) {
    s = toSession(await auth('signup', { data: { device: 'tv' } }));
    if (!s) throw new Error('Couldn’t start pairing.');
    await saveSession(s);
  }
  const code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  await rpc('start_tv_pairing', { pair_code: code });
  return code;
}

/** TV: the account it's linked to (its email), once a phone has entered the code. */
export async function tvLinkedTo(): Promise<string | null> {
  const email = await rpc<string | null>('tv_status');
  const s = await getSession();
  if (email && s && s.linkedTo !== email) await saveSession({ ...s, linkedTo: email });
  return email;
}

/** TV: after linking, bring everything over. */
export async function finishTvPairing() {
  await firstSync();
}

/** Phone: link the TV showing this code to this account. */
export async function claimTv(code: string) {
  const ok = await rpc<boolean>('claim_tv', { pair_code: code.trim().toUpperCase() });
  if (!ok) throw new Error('That code didn’t match a TV (codes last 15 minutes). Check it, or show a new one on the TV.');
}

/** Deep link the TV's QR code opens on a phone. */
export const pairLink = (code: string) => `bit128://settings/account?pair=${code}`;

export const SETUP_SQL = `-- 128bitPlay accounts & sync. Run once in Supabase → SQL Editor.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists public.tv_devices (
  device_id uuid primary key references auth.users on delete cascade,
  owner_id uuid references auth.users on delete cascade,
  code text unique,
  created_at timestamptz not null default now()
);
-- No direct access to the tables: everything goes through the functions below.
alter table public.user_settings enable row level security;
alter table public.tv_devices enable row level security;

-- Whose settings this sign-in uses: a paired TV uses its owner's, everyone else their own.
create or replace function public.settings_owner() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select owner_id from tv_devices where device_id = auth.uid() and owner_id is not null),
    auth.uid())
$$;

create or replace function public.get_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select data from user_settings where user_id = settings_owner()
$$;

create or replace function public.put_settings(new_data jsonb) returns void
language sql security definer set search_path = public as $$
  insert into user_settings (user_id, data, updated_at) values (settings_owner(), new_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now()
$$;

create or replace function public.start_tv_pairing(pair_code text) returns void
language sql security definer set search_path = public as $$
  insert into tv_devices (device_id, code, created_at) values (auth.uid(), upper(pair_code), now())
  on conflict (device_id) do update set code = excluded.code, created_at = now(), owner_id = null
$$;

create or replace function public.claim_tv(pair_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in on the phone first';
  end if;
  update tv_devices set owner_id = auth.uid(), code = null
   where code = upper(pair_code) and owner_id is null
     and created_at > now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.tv_status() returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email from tv_devices d join auth.users u on u.id = d.owner_id
   where d.device_id = auth.uid()
$$;

revoke all on function public.settings_owner(), public.get_settings(), public.put_settings(jsonb),
  public.start_tv_pairing(text), public.claim_tv(text), public.tv_status() from public, anon;
grant execute on function public.get_settings(), public.put_settings(jsonb),
  public.start_tv_pairing(text), public.claim_tv(text), public.tv_status() to authenticated;
`;
