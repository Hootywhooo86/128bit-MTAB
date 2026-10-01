/**
 * Suwayomi (github.com/Suwayomi/Suwayomi-Server): runs Mihon/Tachiyomi extensions,
 * such as the Keiyoushi repo, on a computer or a host like ElfHosted. 128bit
 * talks to it over its GraphQL API to manage repos and extensions, browse sources
 * and read chapters.
 *
 * Sign-in: none, basic auth (username + password on every request), or the
 * login screen mode (username + password exchanged for a token).
 */
import { secureGet, secureSet } from './storage';

const KEY = '128bit.suwayomi';

export const KEIYOUSHI_REPO = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json';

export type SuwayomiConfig = { url: string; username?: string; password?: string };

let config: SuwayomiConfig | null | undefined;
let token: string | null = null;

export async function getSuwayomi(): Promise<SuwayomiConfig | null> {
  if (config === undefined) {
    const raw = await secureGet(KEY);
    config = raw ? (JSON.parse(raw) as SuwayomiConfig) : null;
  }
  return config;
}

/** Synchronous view of the saved server (after getSuwayomi has run once), for image headers. */
export const suwayomiNow = () => config ?? null;

const cleanUrl = (url: string) => {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
};

/** Tests the server, then saves it. Returns the server version. */
export async function connectSuwayomi(c: SuwayomiConfig): Promise<string> {
  const next = { ...c, url: cleanUrl(c.url) };
  const prev = config;
  config = next;
  token = null;
  try {
    const info = await gql<{ aboutServer: { name: string; version: string } }>(
      'query { aboutServer { name version } }',
    );
    await secureSet(KEY, JSON.stringify(next));
    return `${info.aboutServer.name} ${info.aboutServer.version}`;
  } catch (e) {
    config = prev;
    throw e;
  }
}

export async function disconnectSuwayomi() {
  config = null;
  token = null;
  await secureSet(KEY, null);
}

function authHeaders(): Record<string, string> {
  const c = config;
  if (token) return { Authorization: `Bearer ${token}` };
  if (c?.username) return { Authorization: `Basic ${btoa(`${c.username}:${c.password ?? ''}`)}` };
  return {};
}

/** Headers needed to load the server's images (covers, pages). */
export function suwayomiImageHeaders() {
  return authHeaders();
}

/** Turns the server's relative paths ("/api/v1/manga/1/thumbnail") into full URLs. */
export function suwayomiUrl(path?: string | null) {
  if (!path) return undefined;
  if (/^https?:/i.test(path)) return path;
  return `${config?.url ?? ''}${path.startsWith('/') ? '' : '/'}${path}`;
}

type GqlError = { message: string };

async function post<T>(query: string, variables: Record<string, unknown>) {
  const c = await getSuwayomi();
  if (!c) throw new Error('Connect your Suwayomi server in Settings → Comics first');
  const res = await fetch(`${c.url}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: GqlError[] } | null;
  return { status: res.status, body };
}

const authProblem = (status: number, errors?: GqlError[]) =>
  status === 401 ||
  status === 403 ||
  !!errors?.some((e) => /unauthori[sz]ed|not logged in|authentication|forbidden/i.test(e.message));

async function login() {
  const c = config;
  if (!c?.username) return false;
  token = null;
  const res = await fetch(`${c.url}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query:
        'mutation L($u: String!, $p: String!) { login(input: { username: $u, password: $p }) { accessToken } }',
      variables: { u: c.username, p: c.password ?? '' },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { login?: { accessToken?: string } };
  } | null;
  token = body?.data?.login?.accessToken ?? null;
  return !!token;
}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let { status, body } = await post<T>(query, variables);
  // Login-screen servers want a token: get one with the username and password, then retry.
  if (authProblem(status, body?.errors) && (await login())) {
    ({ status, body } = await post<T>(query, variables));
  }
  if (authProblem(status, body?.errors)) {
    throw new Error('Suwayomi didn’t accept the username or password');
  }
  if (!body || body.errors?.length || !body.data) {
    const msg = body?.errors?.[0]?.message?.replace(/^Exception while fetching data \([^)]*\)\s*:\s*/, '');
    throw new Error(
      msg?.match(/HTTP error (\d+)/)
        ? `Suwayomi couldn’t download it (HTTP ${msg.match(/HTTP error (\d+)/)![1]})`
        : (msg ?? `Suwayomi answered ${status}`),
    );
  }
  return body.data;
}

// --- Repos (extension stores) and extensions -------------------------------------

/** Repo URLs the server knows. Newer servers call them extension stores. */
export async function getRepos(): Promise<string[]> {
  try {
    const d = await gql<{ extensionStores: { nodes: { indexUrl: string }[] } }>(
      'query { extensionStores { nodes { indexUrl } } }',
    );
    return d.extensionStores.nodes.map((n) => n.indexUrl);
  } catch {
    const d = await gql<{ settings: { extensionRepos: string[] } }>('query { settings { extensionRepos } }');
    return d.settings.extensionRepos;
  }
}

/** The server doesn't have the newer "extension store" API (older Suwayomi versions). */
const oldServer = (e: unknown) => /FieldUndefined|is undefined|Unknown field/i.test(String(e));

export async function addRepo(url: string) {
  const u = url.trim();
  try {
    await gql('mutation A($u: String!) { addExtensionStore(input: { indexUrl: $u }) { clientMutationId } }', {
      u,
    });
  } catch (e) {
    // Older servers: a plain list in the settings.
    if (!oldServer(e)) throw e;
    const repos = await getRepos();
    await gql('mutation S($r: [String!]) { setSettings(input: { settings: { extensionRepos: $r } }) { clientMutationId } }', {
      r: [...new Set([...repos, u])],
    });
  }
}

export async function removeRepo(url: string) {
  try {
    await gql('mutation R($u: String!) { removeExtensionStore(input: { indexUrl: $u }) { clientMutationId } }', {
      u: url,
    });
  } catch (e) {
    if (!oldServer(e)) throw e;
    const repos = await getRepos();
    await gql('mutation S($r: [String!]) { setSettings(input: { settings: { extensionRepos: $r } }) { clientMutationId } }', {
      r: repos.filter((r) => r !== url),
    });
  }
}

export type Extension = {
  pkgName: string;
  name: string;
  lang: string;
  versionName: string;
  iconUrl?: string;
  isInstalled: boolean;
  hasUpdate: boolean;
  isNsfw: boolean;
};

const EXT_FIELDS = 'pkgName name lang versionName iconUrl isInstalled hasUpdate isNsfw';

/** Asks the server to re-read every repo from GitHub and returns all extensions. */
export async function refreshExtensions(): Promise<Extension[]> {
  const d = await gql<{ fetchExtensions: { extensions: Extension[] } }>(
    `mutation { fetchExtensions(input: {}) { extensions { ${EXT_FIELDS} } } }`,
  );
  return d.fetchExtensions.extensions;
}

export async function listExtensions(): Promise<Extension[]> {
  const d = await gql<{ extensions: { nodes: Extension[] } }>(`query { extensions { nodes { ${EXT_FIELDS} } } }`);
  return d.extensions.nodes;
}

export async function changeExtension(pkgName: string, action: 'install' | 'update' | 'uninstall') {
  await gql(
    `mutation U($id: String!) { updateExtension(input: { id: $id, patch: { ${action}: true } }) { extension { pkgName } } }`,
    { id: pkgName },
  );
}

export async function updateAllExtensions(pkgNames: string[]) {
  if (!pkgNames.length) return;
  await gql(
    'mutation U($ids: [String!]!) { updateExtensions(input: { ids: $ids, patch: { update: true } }) { clientMutationId } }',
    { ids: pkgNames },
  );
}

// --- Sources, browsing and reading ----------------------------------------------

export type SuwaSource = {
  id: string;
  name: string;
  displayName: string;
  lang: string;
  iconUrl?: string;
  supportsLatest: boolean;
  isNsfw: boolean;
};

export async function listSources(): Promise<SuwaSource[]> {
  const d = await gql<{ sources: { nodes: (SuwaSource & { id: string | number })[] } }>(
    'query { sources { nodes { id name displayName lang iconUrl supportsLatest isNsfw } } }',
  );
  // Source "0" is the server's local folder.
  return d.sources.nodes.map((s) => ({ ...s, id: String(s.id) })).filter((s) => s.id !== '0');
}

export type SuwaManga = {
  id: number;
  title: string;
  thumbnailUrl?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  genre?: string[];
  status?: string;
  inLibrary?: boolean;
};

const MANGA_FIELDS = 'id title thumbnailUrl author artist description genre status inLibrary';

export async function browseSource(
  sourceId: string,
  type: 'POPULAR' | 'LATEST' | 'SEARCH',
  page = 1,
  query?: string,
): Promise<{ mangas: SuwaManga[]; hasNextPage: boolean }> {
  const d = await gql<{ fetchSourceManga: { mangas: SuwaManga[]; hasNextPage: boolean } }>(
    `mutation B($s: LongString!, $t: FetchSourceMangaType!, $p: Int!, $q: String) {
      fetchSourceManga(input: { source: $s, type: $t, page: $p, query: $q }) { hasNextPage mangas { ${MANGA_FIELDS} } }
    }`,
    { s: sourceId, t: type, p: page, q: query ?? null },
  );
  return d.fetchSourceManga;
}

export async function getManga(id: number): Promise<SuwaManga> {
  const d = await gql<{ fetchManga: { manga: SuwaManga } }>(
    `mutation M($id: Int!) { fetchManga(input: { id: $id }) { manga { ${MANGA_FIELDS} } } }`,
    { id },
  );
  return d.fetchManga.manga;
}

export type SuwaChapter = {
  id: number;
  name: string;
  chapterNumber: number;
  scanlator?: string | null;
  uploadDate: string | number;
  sourceOrder: number;
  pageCount: number;
  isRead: boolean;
  lastPageRead: number;
};

/** Chapters in reading order (oldest first). */
export async function getMangaChapters(mangaId: number): Promise<SuwaChapter[]> {
  const d = await gql<{ fetchChapters: { chapters: SuwaChapter[] } }>(
    `mutation C($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters {
      id name chapterNumber scanlator uploadDate sourceOrder pageCount isRead lastPageRead
    } } }`,
    { id: mangaId },
  );
  // Reading order: by chapter number when both have one, else Suwayomi's order (1 = oldest).
  return [...d.fetchChapters.chapters].sort((a, b) =>
    a.chapterNumber >= 0 && b.chapterNumber >= 0 && a.chapterNumber !== b.chapterNumber
      ? a.chapterNumber - b.chapterNumber
      : a.sourceOrder - b.sourceOrder,
  );
}

export async function getChapterPages(chapterId: number): Promise<string[]> {
  const d = await gql<{ fetchChapterPages: { pages: string[] } }>(
    'mutation P($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }',
    { id: chapterId },
  );
  return d.fetchChapterPages.pages.map((p) => suwayomiUrl(p)!);
}

/** Keeps Suwayomi's own read marks in step (so its web UI and other apps agree). */
export async function markChapter(chapterId: number, page: number, read: boolean) {
  await gql(
    'mutation U($id: Int!, $p: Int!, $r: Boolean!) { updateChapter(input: { id: $id, patch: { lastPageRead: $p, isRead: $r } }) { clientMutationId } }',
    { id: chapterId, p: page, r: read },
  );
}

export async function setInLibrary(mangaId: number, inLibrary: boolean) {
  await gql(
    'mutation U($id: Int!, $l: Boolean!) { updateManga(input: { id: $id, patch: { inLibrary: $l } }) { clientMutationId } }',
    { id: mangaId, l: inLibrary },
  );
}
