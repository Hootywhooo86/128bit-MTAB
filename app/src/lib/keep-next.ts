/**
 * "Keep the next N episodes downloaded" (Settings → Playback): while you watch an episode,
 * the next few download to the phone in the background (same kind of stream the player
 * would pick), and ones it downloaded for episodes you've since moved past are deleted.
 */
import { pickNextStream, type WatchItem } from './video';
import { deleteVideo, downloadVideo, getVideoDownloads, videoDownloadsSupported } from './video-downloads';

let running: string | null = null;

export async function keepNextEpisodes(item: WatchItem, count: number) {
  if (!count || !videoDownloadsSupported || item.live || !item.series || running === item.key) return;
  const eps = item.series.episodes;
  const at = eps.findIndex((e) => e.id === item.key);
  if (at < 0) return;
  running = item.key;
  try {
    const list = await getVideoDownloads();
    const have = new Set(list.map((d) => d.key));
    // Auto-downloads of this show you've already watched past: free the space.
    const behind = new Set(eps.slice(0, at).map((e) => e.id));
    for (const d of list) if (d.auto && behind.has(d.key)) await deleteVideo(d.key).catch(() => {});
    // One at a time, so the stream addons and TorBox aren't asked for everything at once.
    for (const ep of eps.slice(at + 1, at + 1 + count)) {
      if (have.has(ep.id)) continue;
      const pick = await pickNextStream(ep.id, item.source).catch(() => null);
      if (!pick || (!pick.stream.infoHash && !pick.stream.url) || /\.m3u8(\?|$)/i.test(pick.stream.url ?? '')) continue;
      await downloadVideo({
        key: ep.id,
        kind: 'episode',
        title: item.title,
        subtitle: ep.label,
        poster: item.poster,
        link: item.link,
        stream: pick.stream,
        auto: true,
      }).catch(() => {});
    }
  } finally {
    running = null;
  }
}
