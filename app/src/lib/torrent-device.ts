/**
 * Torrents on this device (no TorBox needed): the app's own libtorrent engine
 * (modules/torrent-engine). The rest of the app keeps talking "TorBox": lib/torbox.ts sends
 * the calls here when there's no TorBox key (or Settings says "On this device"), and device
 * torrents get negative ids so both kinds can live side by side.
 *
 * Files are served from 127.0.0.1, so a video streams while it downloads, audiobooks play
 * from disk and comics are copied in like any other download.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { Alert, PermissionsAndroid, Platform } from 'react-native';

import { readPrefs } from './prefs';
import { getTorboxKey } from './storage';

type NativeFile = { id: number; name: string; short_name: string; size: number; done: number; wanted: boolean };
export type DeviceStatus = {
  id: number;
  hash: string;
  name: string;
  hasMetadata: boolean;
  progress: number;
  finished: boolean;
  paused: boolean;
  state: string;
  downloadRate?: number;
  uploadRate?: number;
  peers?: number;
  seeds?: number;
  downloaded?: number;
  total?: number;
  /** "Waiting for Wi-Fi" / "Waiting for a VPN" */
  blocked?: string | null;
  files: NativeFile[];
};

type Engine = {
  add(magnet: string, name: string | null): Promise<DeviceStatus>;
  status(id: number): Promise<DeviceStatus>;
  list(): Promise<DeviceStatus[]>;
  setWanted(id: number, files: number[] | null): Promise<void>;
  fileUrl(id: number, fileIndex: number, stream: boolean): Promise<string>;
  pause(id: number): Promise<void>;
  resume(id: number): Promise<void>;
  remove(id: number, deleteFiles: boolean): Promise<void>;
  wake(): Promise<void>;
  setOptions(wifiOnly: boolean | null, vpnOnly: boolean | null, seedRatioPct: number | null): Promise<{ blocked: string | null }>;
  batteryUnrestricted(): boolean;
  askBatteryUnrestricted(): void;
};

const engine = requireOptionalNativeModule<Engine>('TorrentEngine');

/** The engine is in this build (the Android phone and TV apps). */
export const deviceTorrentsSupported = !!engine;

/** Device torrents show up as negative ids next to TorBox's positive ones. */
export const isDeviceId = (id: number) => id < 0;
const toEngine = (id: number) => -id;

/** Where torrents go right now: TorBox (when set up) or this device. */
export async function torrentsOnDevice(): Promise<boolean> {
  if (!engine) return false;
  const { torrentMode } = await readPrefs();
  if (torrentMode === 'device') return true;
  if (torrentMode === 'torbox') return false;
  return !(await getTorboxKey());
}

/** Torrents can be fetched at all (TorBox key, or the device engine). */
export async function canGetTorrents(): Promise<boolean> {
  return (await torrentsOnDevice()) || !!(await getTorboxKey());
}

function need(): Engine {
  if (!engine) throw new Error('Downloading torrents on the device works in the Android app.');
  return engine;
}

// --- What each torrent is for (so streamed videos can be cleaned up) ---------------------

const META_KEY = '128bit.deviceTorrents';
type Purpose = 'video' | 'keep';
type Meta = Record<string, { purpose: Purpose; usedAt: number }>;

async function readMeta(): Promise<Meta> {
  try {
    return JSON.parse((await AsyncStorage.getItem(META_KEY)) ?? '{}');
  } catch {
    return {};
  }
}

async function touch(id: number, purpose?: Purpose) {
  const meta = await readMeta();
  const prev = meta[id];
  meta[id] = { purpose: purpose ?? prev?.purpose ?? 'keep', usedAt: Date.now() };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

/** Streamed (not saved) videos are deleted from the device two days after they were last played. */
export async function cleanUpDeviceTorrents(maxAgeMs = 2 * 24 * 3600_000) {
  if (!engine) return;
  const meta = await readMeta();
  for (const [id, m] of Object.entries(meta)) {
    if (m.purpose === 'video' && Date.now() - m.usedAt > maxAgeMs) {
      await engine.remove(Number(id), true).catch(() => {});
      delete meta[id];
    }
  }
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

// --- One-time privacy notice ---------------------------------------------------------------

const NOTICE_KEY = '128bit.deviceTorrents.noticeSeen';

async function noticeOnce() {
  if (await AsyncStorage.getItem(NOTICE_KEY)) return;
  await AsyncStorage.setItem(NOTICE_KEY, '1');
  Alert.alert(
    'Downloading on this device',
    'Without TorBox, torrents download straight to this device. Other people sharing the same torrent can see your internet address (IP), so using a VPN is a good idea.\n\nSettings → Integrations → Torrents on this device has "Only on Wi-Fi" and "Only with a VPN on".',
  );
}

// --- The TorBox-shaped calls ------------------------------------------------------------

/** Android 13+: ask so the player and "Downloading…" notifications can show (no-op once allowed). */
async function askNotifications() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!(await PermissionsAndroid.check(perm))) await PermissionsAndroid.request(perm);
}

/** Android's battery saver can't pause the app in the background (true where it doesn't apply). */
export const batteryUnrestricted = () => engine?.batteryUnrestricted() ?? true;

/** Opens Android's "Let 128bitPlay always run in the background?" dialog. */
export const askBatteryUnrestricted = () => engine?.askBatteryUnrestricted();

const BATTERY_ASKED = '128bit.batteryAsked';

/**
 * Playing a book: the player notification and lock-screen controls need notification permission
 * (Android 13+), then ask once for Unrestricted battery so books never get paused in the background.
 */
export async function askBackgroundPlaybackOnce() {
  await askNotifications().catch(() => {});
  if (batteryUnrestricted() || (await AsyncStorage.getItem(BATTERY_ASKED))) return;
  await AsyncStorage.setItem(BATTERY_ASKED, '1');
  askBatteryUnrestricted();
}

/** App opened: carry on with saved torrents (Android 15 limits background time per day). */
export async function wakeDeviceTorrents() {
  await engine?.wake();
}

export async function deviceAddMagnet(magnet: string, name?: string, purpose?: Purpose): Promise<{ id: number }> {
  const s = await need().add(magnet, name ?? null);
  noticeOnce().catch(() => {});
  askNotifications().catch(() => {});
  await touch(s.id, purpose);
  return { id: -s.id };
}

/** A device torrent in the same shape as a TorBox item. */
export async function deviceItem(id: number) {
  const s = await need().status(toEngine(id));
  return {
    id,
    hash: s.hash,
    name: s.name,
    size: s.total ?? s.files.reduce((n, f) => n + f.size, 0),
    progress: s.progress,
    download_state: s.blocked ?? (s.hasMetadata ? s.state : 'Finding peers…'),
    // Needs at least the file list; "finished" means everything wanted is on the device.
    download_finished: s.hasMetadata && s.finished,
    files: s.files.map((f) => ({ id: f.id, name: f.name, short_name: f.short_name, size: f.size })),
    kind: 'torrent' as const,
    device: s,
  };
}

export async function deviceList() {
  const all = await need().list();
  return Promise.all(all.map((s) => deviceItem(-s.id)));
}

/** Local URL for a file; the file is fetched first (in order), so it can play right away. */
export async function deviceFileUrl(id: number, fileId: number) {
  await touch(toEngine(id));
  return need().fileUrl(toEngine(id), fileId, true);
}

/** Only these files (by id) are downloaded; null = all. */
export const deviceSetFiles = (id: number, files: number[] | null) => need().setWanted(toEngine(id), files);

export async function deviceRemove(id: number) {
  await need().remove(toEngine(id), true);
  const meta = await readMeta();
  delete meta[toEngine(id)];
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

export const devicePause = (id: number) => need().pause(toEngine(id));
export const deviceResume = (id: number) => need().resume(toEngine(id));

/** Settings → Torrents on this device. */
export async function applyDeviceTorrentPrefs() {
  if (!engine) return null;
  const p = await readPrefs();
  return engine.setOptions(p.torrentWifiOnly, p.torrentVpnOnly, Math.round(p.torrentSeedRatio * 100));
}
