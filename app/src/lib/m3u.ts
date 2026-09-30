/**
 * M3U playlists for Live TV (the format most IPTV providers give you).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '128bit.playlists';

export type Playlist = { id: string; name: string; url: string };

export type Channel = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  source: string;
};

export async function getPlaylists(): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addPlaylist(name: string, url: string) {
  const list = await getPlaylists();
  const entry = {
    id: `${Date.now()}`,
    name: name.trim() || 'Playlist',
    url: url.trim(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([...list, entry]));
  return entry;
}

export async function removePlaylist(id: string) {
  const list = await getPlaylists();
  await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((p) => p.id !== id)));
}

const attr = (line: string, name: string) => line.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1];

export function parseM3U(text: string, source: string): Channel[] {
  const channels: Channel[] = [];
  let pending: Omit<Channel, 'url' | 'id'> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      pending = {
        name: line.slice(line.lastIndexOf(',') + 1).trim() || attr(line, 'tvg-name') || 'Channel',
        logo: attr(line, 'tvg-logo') || undefined,
        group: attr(line, 'group-title') || undefined,
        source,
      };
    } else if (!line.startsWith('#')) {
      channels.push({
        ...(pending ?? { name: line, source }),
        url: line,
        id: `${source}:${channels.length}`,
      });
      pending = null;
    }
  }
  return channels;
}

export async function fetchPlaylist(playlist: Playlist): Promise<Channel[]> {
  const res = await fetch(playlist.url);
  if (!res.ok) throw new Error(`${playlist.name}: ${res.status} ${res.statusText}`);
  return parseM3U(await res.text(), playlist.name);
}
