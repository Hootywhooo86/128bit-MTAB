/**
 * Pulls quality, HDR, size and seeders out of the free-text name/title that
 * Stremio addons put on each stream (e.g. "Torrentio\n4k HDR", "👤 52 💾 14.2 GB").
 */
import type { Stream } from './types';

export type Quality = '4K' | '1080p' | '720p' | 'SD';

export type StreamInfo = {
  /** Torrent site, e.g. "ThePirateBay" (when the addon says). */
  site: string | null;
  quality: Quality | null;
  hdr: string[];
  sizeBytes: number | null;
  seeders: number | null;
  /** English audio: "Dual Audio", "English Dub", 🇬🇧/🇺🇸 audio flags… */
  dub: boolean;
};

const DUB =
  /dual[\s._-]?audio|multi[\s._-]?audio|\beng(lish)?[\s._-]?dub(bed)?\b|\bdub(bed)?\b|\[eng?\+jpn?\]|\bjpn?[\s._+-]eng?\b|\beng?[\s._+-]jpn?\b|🇬🇧|🇺🇸/i;

const QUALITY_RANK: Record<Quality, number> = { '4K': 4, '1080p': 3, '720p': 2, SD: 1 };

export function qualityRank(q: Quality | null) {
  return q ? QUALITY_RANK[q] : 0;
}

export function streamText(s: Stream) {
  return [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join(' ');
}

export function parseStream(s: Stream): StreamInfo {
  const text = streamText(s);
  let quality: Quality | null = null;
  if (/\b(2160p|4k|uhd)\b/i.test(text)) quality = '4K';
  else if (/\b1080p\b/i.test(text)) quality = '1080p';
  else if (/\b720p\b/i.test(text)) quality = '720p';
  else if (/\b(480p|576p|360p|sd|dvdrip|xvid)\b/i.test(text)) quality = 'SD';

  const hdr: string[] = [];
  if (/\b(dolby ?vision|dovi|dv)\b/i.test(text)) hdr.push('DV');
  if (/\bhdr10\+/i.test(text)) hdr.push('HDR10+');
  else if (/\bhdr(10)?\b/i.test(text)) hdr.push('HDR');

  const size = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i);
  const unit = size?.[2].toUpperCase();
  const sizeBytes = size
    ? Number(size[1].replace(',', '.')) *
      (unit === 'TB' ? 1024 ** 4 : unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
    : null;

  const seeds = text.match(/👤\s*(\d+)/) ?? text.match(/\bseed(?:ers|s)?:?\s*(\d+)/i);
  // The site a torrent came from: Torrentio "⚙️ ThePirateBay", MediaFusion "🔗 1337x", Comet "🔎 …".
  const site = text.match(/(?:⚙️|⚙|🔗|🔎|🌐)\s*([A-Za-z0-9][\w .+-]{1,30}?)(?=\s*(?:$|\n|👤|💾|📦|⚙|🔗|🇬|\||…|\.\.\.))/m)?.[1]?.trim();
  return {
    quality,
    hdr,
    sizeBytes,
    seeders: seeds ? Number(seeds[1]) : null,
    site: site || null,
    dub: DUB.test(text),
  };
}
