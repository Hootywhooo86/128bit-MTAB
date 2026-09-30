/** SRT / WebVTT parsing, kept free of app imports so it's easy to test. */

export type Cue = { start: number; end: number; text: string };

function toSeconds(stamp: string) {
  const m = stamp.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return NaN;
  return (
    Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
  );
}

/** Parses SRT or WebVTT into timed cues. */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text
    .replace(/\r/g, '')
    .replace(/^﻿/, '')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split('-->');
    const start = toSeconds(from);
    const end = toSeconds(to);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const body = lines
      .slice(timing + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The line to show at time `t` (binary search; cues are sorted by start). */
export function cueAt(cues: Cue[], t: number): string | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  // Check a few cues back in case of overlaps.
  for (let i = hi; i >= 0 && i > hi - 3; i--) {
    if (cues[i].start <= t && t <= cues[i].end) return cues[i].text;
  }
  return null;
}
