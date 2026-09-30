/**
 * Reads chapter markers from an .m4b / .m4a / .mp4 audiobook without downloading it:
 * only the file's index ("moov" box) and the chapter titles are fetched, using HTTP
 * range requests.
 *
 * Two chapter formats exist in the wild and both are supported:
 *  - Nero chapters: a `chpl` box inside moov/udta (start times + titles in one place).
 *  - QuickTime chapters: a text track referenced by another track's `tref/chap`;
 *    each text sample is one chapter title, and its timing comes from the sample table.
 */

export type ChapterMark = { title: string; start: number };

/** Reads bytes [start, end] inclusive. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

type Box = { type: string; start: number; headerSize: number; size: number };

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;

function u32(b: Uint8Array, o: number) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function u64(b: Uint8Array, o: number) {
  return u32(b, o) * 2 ** 32 + u32(b, o + 4);
}

function fourcc(b: Uint8Array, o: number) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function decodeText(bytes: Uint8Array) {
  // UTF-16 with BOM, as some QuickTime writers use.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2)
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Child boxes of the box whose payload spans [from, to) in `b`. */
function children(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let headerSize = 8;
    if (size === 1) {
      size = u64(b, o + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < headerSize || o + size > to) break;
    out.push({ type, start: o, headerSize, size });
    o += size;
  }
  return out;
}

const payload = (box: Box) => [box.start + box.headerSize, box.start + box.size] as const;

function find(b: Uint8Array, parent: Box, path: string[]): Box | undefined {
  let current: Box | undefined = parent;
  for (const type of path) {
    if (!current) return undefined;
    // `meta` is a "full box": 4 bytes of version/flags before its children.
    const [from, to]: readonly [number, number] = payload(current);
    const skip: number = current.type === 'meta' ? 4 : 0;
    current = children(b, from + skip, to).find((c) => c.type === type);
  }
  return current;
}

/** Finds the top-level `moov` box and downloads just that. */
async function readMoov(read: RangeReader): Promise<{ bytes: Uint8Array; box: Box }> {
  let offset = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES; i++) {
    const head = await read(offset, offset + 15);
    if (head.length < 8) break;
    let size = u32(head, 0);
    const type = fourcc(head, 4);
    let headerSize = 8;
    if (size === 1) {
      size = u64(head, 8);
      headerSize = 16;
    }
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) throw new Error('Audiobook index is unexpectedly large');
      const bytes = await read(offset, offset + size - 1);
      return { bytes, box: { type, start: 0, headerSize, size: bytes.length } };
    }
    if (size < 8) break;
    offset += size;
  }
  throw new Error('No MP4 index (moov) found');
}

function nero(b: Uint8Array, moov: Box): ChapterMark[] {
  const chpl = find(b, moov, ['udta', 'chpl']);
  if (!chpl) return [];
  let o = chpl.start + chpl.headerSize;
  const version = b[o];
  o += 4; // version + flags
  if (version === 1) o += 4;
  const count = b[o++];
  const marks: ChapterMark[] = [];
  for (let i = 0; i < count && o + 9 <= chpl.start + chpl.size; i++) {
    const start = u64(b, o) / 10_000_000; // 100 ns units
    const len = b[o + 8];
    const title = decodeText(b.subarray(o + 9, o + 9 + len));
    marks.push({ title, start });
    o += 9 + len;
  }
  return marks;
}

type SampleTable = { timescale: number; durations: number[]; offsets: number[]; sizes: number[] };

function sampleTable(b: Uint8Array, trak: Box): SampleTable | null {
  const mdhd = find(b, trak, ['mdia', 'mdhd']);
  const stbl = find(b, trak, ['mdia', 'minf', 'stbl']);
  if (!mdhd || !stbl) return null;
  const mo = mdhd.start + mdhd.headerSize;
  const timescale = b[mo] === 1 ? u32(b, mo + 20) : u32(b, mo + 12);

  const [from, to] = payload(stbl);
  const boxes = children(b, from, to);
  const get = (t: string) => boxes.find((x) => x.type === t);
  const stts = get('stts');
  const stsz = get('stsz');
  const stsc = get('stsc');
  const stco = get('stco') ?? get('co64');
  if (!stts || !stsz || !stsc || !stco) return null;

  const durations: number[] = [];
  let o = stts.start + stts.headerSize + 4;
  for (let n = u32(b, o), i = 0; i < n; i++) {
    const count = u32(b, o + 4 + i * 8);
    const delta = u32(b, o + 8 + i * 8);
    for (let k = 0; k < count; k++) durations.push(delta);
  }

  o = stsz.start + stsz.headerSize + 4;
  const fixed = u32(b, o);
  const sampleCount = u32(b, o + 4);
  const sizes = Array.from({ length: sampleCount }, (_, i) =>
    fixed ? fixed : u32(b, o + 8 + i * 4),
  );

  o = stco.start + stco.headerSize + 4;
  const chunkCount = u32(b, o);
  const chunkOffsets = Array.from({ length: chunkCount }, (_, i) =>
    stco.type === 'co64' ? u64(b, o + 4 + i * 8) : u32(b, o + 4 + i * 4),
  );

  o = stsc.start + stsc.headerSize + 4;
  const entries = Array.from({ length: u32(b, o) }, (_, i) => ({
    firstChunk: u32(b, o + 4 + i * 12),
    perChunk: u32(b, o + 8 + i * 12),
  }));

  // Walk chunks to find each sample's file offset.
  const offsets: number[] = [];
  let sample = 0;
  for (let c = 0; c < chunkCount && sample < sampleCount; c++) {
    const entry = [...entries].reverse().find((e) => e.firstChunk <= c + 1);
    let pos = chunkOffsets[c];
    for (let k = 0; k < (entry?.perChunk ?? 1) && sample < sampleCount; k++) {
      offsets.push(pos);
      pos += sizes[sample++];
    }
  }
  return { timescale, durations, offsets, sizes };
}

async function quicktime(b: Uint8Array, moov: Box, read: RangeReader): Promise<ChapterMark[]> {
  const [from, to] = payload(moov);
  const traks = children(b, from, to).filter((c) => c.type === 'trak');
  const trackId = (t: Box) => {
    const tkhd = find(b, t, ['tkhd']);
    if (!tkhd) return -1;
    const o = tkhd.start + tkhd.headerSize;
    return b[o] === 1 ? u32(b, o + 20) : u32(b, o + 12);
  };
  let chapterId = -1;
  for (const t of traks) {
    const chap = find(b, t, ['tref', 'chap']);
    if (chap) chapterId = u32(b, chap.start + chap.headerSize);
  }
  const chapterTrak = traks.find((t) => trackId(t) === chapterId);
  if (!chapterTrak) return [];
  const table = sampleTable(b, chapterTrak);
  if (!table || !table.offsets.length) return [];

  // Chapter titles usually sit close together; fetch them in one range when they do.
  const lo = Math.min(...table.offsets);
  const hi = Math.max(...table.offsets.map((o, i) => o + table.sizes[i]));
  const oneRange = hi - lo < 1024 * 1024 ? await read(lo, hi - 1) : null;

  const marks: ChapterMark[] = [];
  let time = 0;
  for (let i = 0; i < table.offsets.length; i++) {
    const sample = oneRange
      ? oneRange.subarray(table.offsets[i] - lo, table.offsets[i] - lo + table.sizes[i])
      : await read(table.offsets[i], table.offsets[i] + table.sizes[i] - 1);
    const len = sample.length >= 2 ? (sample[0] << 8) | sample[1] : 0;
    marks.push({
      title: decodeText(sample.subarray(2, 2 + len)) || `Chapter ${i + 1}`,
      start: time / table.timescale,
    });
    time += table.durations[i] ?? 0;
  }
  return marks;
}

/** Chapter markers for an MP4-family audio file, or [] if it has none. */
export async function readMp4Chapters(read: RangeReader): Promise<ChapterMark[]> {
  const { bytes, box } = await readMoov(read);
  const fromNero = nero(bytes, box);
  const marks = fromNero.length ? fromNero : await quicktime(bytes, box, read);
  return marks
    .filter((m, i) => i === 0 || m.start > marks[i - 1].start)
    .map((m) => ({ ...m, title: m.title.trim() }));
}

/** A RangeReader over HTTP. Refuses servers that ignore Range, so a big book is never downloaded by accident. */
export function httpRangeReader(url: string, headers: Record<string, string> = {}): RangeReader {
  return async (start, end) => {
    const res = await fetch(url, { headers: { ...headers, Range: `bytes=${start}-${end}` } });
    if (res.status === 416) return new Uint8Array(0);
    if (res.status !== 206)
      throw new Error(`Server doesn't support range requests (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
