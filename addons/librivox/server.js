/**
 * Example 128bit audiobook addon: public-domain LibriVox recordings hosted on archive.org.
 *
 * Zero dependencies. Run with `node server.js`, then install
 * http://<your-computer-ip>:7000/manifest.json in the app.
 *
 * Every book gets two sources, to show both ways the app can play something:
 *   1. Direct MP3 chapters streamed from archive.org.
 *   2. archive.org's own torrent for the item, which the app sends to TorBox.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 7000;
const PAGE_SIZE = 40;

const manifest = {
  id: 'org.librivox.archive',
  name: 'LibriVox (archive.org)',
  version: '1.0.0',
  description: 'Free public-domain audiobooks read by LibriVox volunteers.',
  logo: 'https://archive.org/services/img/librivoxaudio',
  types: ['audiobook'],
  resources: ['catalog', 'book'],
  catalogs: [
    { type: 'audiobook', id: 'popular', name: 'Popular on LibriVox', extra: [{ name: 'search' }] },
    { type: 'audiobook', id: 'new', name: 'Newly added' },
  ],
};

// --- archive.org helpers ----------------------------------------------------

const cache = new Map();

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': '128bit-librivox-addon/1.0' } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

const cover = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;

function toPreview(doc) {
  return {
    id: doc.identifier,
    title: String(doc.title ?? doc.identifier).replace(/\s*\(?librivox\)?\s*$/i, ''),
    author: Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator,
    cover: cover(doc.identifier),
    duration: doc.runtime,
  };
}

async function search({ sort, query }) {
  const q = ['collection:librivoxaudio', 'mediatype:audio'];
  if (query) q.push(`(${query.replace(/[()":]/g, ' ')})`);
  const params = new URLSearchParams({ q: q.join(' AND '), rows: String(PAGE_SIZE), output: 'json' });
  for (const f of ['identifier', 'title', 'creator', 'runtime']) params.append('fl[]', f);
  params.append('sort[]', sort);
  const data = await getJson(`https://archive.org/advancedsearch.php?${params}`);
  return data.response.docs.map(toPreview);
}

/** Computes a torrent's info hash: SHA-1 of the bencoded `info` dictionary. */
function infoHashOf(buf) {
  let i = 0;
  const skip = () => {
    const c = buf[i];
    if (c === 0x69 /* i */) {
      i = buf.indexOf(0x65, i) + 1;
    } else if (c === 0x6c /* l */ || c === 0x64 /* d */) {
      i++;
      while (buf[i] !== 0x65 /* e */) skip();
      i++;
    } else {
      const colon = buf.indexOf(0x3a, i);
      i = colon + 1 + Number(buf.toString('latin1', i, colon));
    }
  };
  if (buf[i++] !== 0x64) throw new Error('Not a torrent file');
  while (buf[i] !== 0x65) {
    const colon = buf.indexOf(0x3a, i);
    const len = Number(buf.toString('latin1', i, colon));
    const key = buf.toString('latin1', colon + 1, colon + 1 + len);
    i = colon + 1 + len;
    const start = i;
    skip();
    if (key === 'info') return crypto.createHash('sha1').update(buf.subarray(start, i)).digest('hex');
  }
  throw new Error('Torrent has no info dictionary');
}

async function torrentSource(id, title) {
  const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_archive.torrent`;
  const res = await fetch(url, { headers: { 'User-Agent': '128bit-librivox-addon/1.0' } });
  if (!res.ok) return null;
  const infoHash = infoHashOf(Buffer.from(await res.arrayBuffer()));
  const magnet =
    `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}` +
    `&tr=${encodeURIComponent('http://bt1.archive.org:6969/announce')}` +
    `&tr=${encodeURIComponent('http://bt2.archive.org:6969/announce')}`;
  return {
    name: 'Torrent → TorBox',
    title: "archive.org's official torrent (all formats)",
    infoHash,
    magnet,
  };
}

async function getBook(id) {
  const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!meta.metadata) throw new Error('Not found');
  const m = meta.metadata;
  const mp3s = meta.files
    .filter((f) => f.format === '64Kbps MP3')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const title = String(m.title ?? id);

  const sources = [];
  if (mp3s.length) {
    sources.push({
      name: 'Direct stream',
      title: `archive.org · 64kbps MP3 · ${mp3s.length} chapters`,
      size: mp3s.reduce((sum, f) => sum + Number(f.size || 0), 0),
      chapters: mp3s.map((f) => ({
        title: f.title || f.name.replace(/(_64kb)?\.mp3$/, ''),
        url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`,
      })),
    });
  }
  // LibriVox also publishes the whole book as one .m4b with chapter markers.
  const m4b = meta.files.find((f) => /\.m4b$/i.test(f.name));
  if (m4b) {
    sources.push({
      name: 'Single file',
      title: 'archive.org · .m4b with chapters',
      size: Number(m4b.size) || undefined,
      chapters: [
        {
          title,
          url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(m4b.name)}`,
        },
      ],
    });
  }
  const torrent = await torrentSource(id, title).catch(() => null);
  if (torrent) sources.push({ ...torrent, size: Number(meta.item_size) || undefined });

  return {
    ...toPreview({ identifier: id, title, creator: m.creator, runtime: m.runtime }),
    description: String(m.description ?? '')
      .replace(/<[^>]+>/g, '')
      .trim(),
    sources,
  };
}

// --- HTTP -------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function route(path) {
  if (path === '/' || path === '/manifest.json') return manifest;

  let m = path.match(/^\/catalog\/audiobook\/([^/]+?)(?:\/search=([^/]+))?\.json$/);
  if (m) {
    const [, catalog, rawQuery] = m;
    const query = rawQuery ? decodeURIComponent(rawQuery) : '';
    const sort = catalog === 'new' ? 'addeddate desc' : 'downloads desc';
    if (!['popular', 'new'].includes(catalog)) return null;
    return { books: await cached(`c:${catalog}:${query}`, 30 * 60_000, () => search({ sort, query })) };
  }

  m = path.match(/^\/book\/audiobook\/([^/]+)\.json$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    return { book: await cached(`b:${id}`, 6 * 3600_000, () => getBook(id)) };
  }
  return null;
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const body = await route(path);
      body ? send(res, 200, body) : send(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error(path, e);
      send(res, 500, { error: String(e.message ?? e) });
    }
  })
  .listen(PORT, () => {
    console.log(`LibriVox addon running → http://localhost:${PORT}/manifest.json`);
  });
