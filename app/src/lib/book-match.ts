/**
 * Book titles vs release names: the search words to try and how well a release fits.
 *
 * Torrent sites are literal. "Azarinth Healer Book Seven" finds nothing while the
 * release is called "Azarinth Healer, Book 7 - Rhaegar", so we try simpler questions
 * (number words as digits, the series on its own, then with the author) and rank what
 * comes back by the book number: the right book first, other books in the series well
 * below. Small pure functions, no network.
 */

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];
const ORDINALS = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth',
  'nineteenth', 'twentieth',
];
const NUMBER_WORD = [...UNITS.slice(1), ...ORDINALS.slice(1)].sort((a, b) => b.length - a.length).join('|');
/** Words that come before a book's number: "Book 7", "Vol. 7", "Part VII", "#7". */
const MARKER = '(?:book|bk|vol(?:ume)?|part|tome|episode|ep)\\.?';
/** A number as written in a title: 7, 7.5, seven, seventh, 7th, VII. */
const NUM = `(?:\\d{1,3}(?:\\.\\d)?(?:st|nd|rd|th)?|${NUMBER_WORD}|[ivx]{1,5})`;

/** I..XXX. */
function romanValue(s: string): number | undefined {
  const m = /^(x{0,3})(ix|iv|v?i{0,3})$/i.exec(s);
  if (!m || !s) return undefined;
  const ones: Record<string, number> = { '': 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
  const n = m[1].length * 10 + ones[m[2].toLowerCase()];
  return n || undefined;
}

/** "7", "07", "7th", "seven", "seventh" (and "VII" with `roman`) → 7. */
export function numberValue(word: string, roman = false): number | undefined {
  const w = word.toLowerCase();
  const digits = /^(\d{1,3}(?:\.\d)?)(?:st|nd|rd|th)?$/.exec(w);
  if (digits) return Number(digits[1]);
  const unit = UNITS.indexOf(w);
  if (unit > 0) return unit;
  const ordinal = ORDINALS.indexOf(w);
  if (ordinal > 0) return ordinal;
  return roman ? romanValue(w) : undefined;
}

/** "Azarinth Healer Book Seven" → "Azarinth Healer Book 7" (Roman numerals only after Book/Vol/Part). */
export function toDigits(s: string) {
  return s
    .replace(new RegExp(`\\b(${NUMBER_WORD})\\b`, 'gi'), (w) => String(numberValue(w)))
    .replace(new RegExp(`\\b(${MARKER}\\s*)([ivx]{1,5})\\b`, 'gi'), (all, marker: string, r: string) => {
      const n = romanValue(r);
      return n ? `${marker}${n}` : all;
    });
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

/** "Azarinth Healer Book 7" → "Azarinth Healer Book Seven" (only numbers after Book/Vol/Part/#). */
export function toWords(s: string) {
  return s.replace(new RegExp(`\\b(${MARKER}\\s*|#\\s*)(\\d{1,2})\\b`, 'gi'), (all, marker: string, d: string) => {
    const n = Number(d);
    return n > 0 && n < UNITS.length ? `${marker.replace('#', 'Book ')}${cap(UNITS[n])}` : all;
  });
}

const FILLER = [
  // "(Unabridged)", "[A LitRPG Adventure]", "(Audiobook)"
  /\s*[([][^)\]]*\b(?:unabridged|abridged|audiobook|litrpg|gamelit|progression|cultivation|novel|adventure)\b[^)\]]*[)\]]/gi,
  // "A LitRPG Adventure", "An Apocalyptic LitRPG", "A Progression Fantasy Epic"
  /\s*[:,–—-]?\s*\b(?:(?:an?|the)\s+(?:[\w'-]+\s+){0,2})?(?:litrpg|gamelit|progression fantasy|cultivation (?:novel|fantasy)|dungeon core|isekai)(?:\s+(?:adventure|novel|series|saga|epic|story|fantasy|book))*\b/gi,
];

/** Drops marketing filler: "(Unabridged)", "A LitRPG Adventure", "An Apocalyptic LitRPG". */
export function stripFiller(s: string) {
  let out = s;
  for (const re of FILLER) out = out.replace(re, '');
  return tidy(out) || tidy(s);
}

const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.–—-]+|[\s:;,–—-]+$/g, '')
    .trim();

/** The title before the subtitle: "The Primal Hunter: An Apocalyptic LitRPG" → "The Primal Hunter". */
export const mainTitle = (s: string) => tidy(s.split(':')[0]) || tidy(s);

/** "Title - Author" (how AudiobookBay and most sites name releases) → the title part. */
const titlePart = (name: string) => name.split(/\s+[-–—]\s+(?=[^-–—]+$)/)[0];

/**
 * The book's number in a title or release name: "Book 7", "Book Seven", "#7", "Vol. 7",
 * "Part VII", "Azarinth Healer, 7 - …", "Book 5 of Ajax's Ascension", "Monsters 10".
 * Undefined when it has none.
 */
export function bookNumber(name: string): number | undefined {
  const s = name.replace(/[‘’]/g, "'");
  for (const m of s.matchAll(new RegExp(`\\b${MARKER}\\s*[#:]?\\s*(${NUM})\\b`, 'gi'))) {
    const n = numberValue(m[1], true);
    if (n) return n;
  }
  const hash = /#\s*(\d{1,3}(?:\.\d)?)\b/.exec(s);
  if (hash) return Number(hash[1]);
  // "Azarinth Healer, 7 - Rhaegar", "(7)", "[07]"
  const comma = /,\s*(\d{1,3}(?:\.\d)?)(?=\s*(?:$|[-–—:([\]),]))/.exec(s) ?? /[([](\d{1,3})[)\]]/.exec(s);
  if (comma && Number(comma[1]) > 0) return Number(comma[1]);
  // A number at the end of the title: "He Who Fights with Monsters 10 - Shirtaloon".
  const end = /\s(\d{1,3})$/.exec(mainTitle(titlePart(s)).replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').trim());
  if (end && Number(end[1]) > 0) return Number(end[1]);
  return undefined;
}

/**
 * The title without its "Book N" part: "Azarinth Healer Book Seven" and "Azarinth Healer,
 * Book 7" → "Azarinth Healer"; "The Delves: Book 5 of Ajax's Ascension" → "Ajax's Ascension".
 * Undefined when there's no number to take off.
 */
export function seriesName(title: string): string | undefined {
  const s = toDigits(title);
  const of = new RegExp(`\\b${MARKER}\\s*(${NUM})\\s+of\\s+(.+)$`, 'i').exec(s);
  if (of && numberValue(of[1], true)) return tidy(of[2]);
  const out = tidy(
    s
      .replace(new RegExp(`\\s*[([]?\\s*\\b${MARKER}\\s*[#:]?\\s*\\d{1,3}(?:\\.\\d)?(?:st|nd|rd|th)?\\b\\s*[)\\]]?`, 'gi'), ' ')
      .replace(/\s*[([]?#\s*\d{1,3}(?:\.\d)?[)\]]?/g, ' ')
      .replace(/,\s*\d{1,3}(?:\.\d)?(?=\s*(?:$|[-–—:([\]),]))/g, ' ')
      .replace(/\s\d{1,3}$/, ''),
  );
  return out && out.toLowerCase() !== tidy(s).toLowerCase() ? out : undefined;
}

/**
 * What to search for, in order (stop at the first that finds something):
 * the title as given, without filler, with number words as digits (and back), the main
 * title (no subtitle), the series on its own, then the series / title with the author.
 */
export function searchQueries(title: string, author?: string): string[] {
  const out: string[] = [];
  const add = (q?: string) => {
    const t = q ? tidy(q) : '';
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  const plain = stripFiller(title);
  const digits = toDigits(plain);
  const series = seriesName(digits) ?? seriesName(mainTitle(digits));
  const lead = author?.split(/,|&|\band\b/)[0]?.trim();
  add(title);
  add(plain);
  add(digits);
  add(toWords(digits));
  add(mainTitle(digits));
  add(series);
  if (lead) {
    add(`${series ?? mainTitle(digits)} ${lead}`);
    add(`${mainTitle(digits)} ${lead}`);
  }
  return out;
}

// --- Ranking ----------------------------------------------------------------

const SKIP = new Set(
  'the a an and of in on to for by at from with book books bk vol volume part tome audiobook audiobooks audio m4b mp3 aac flac kbps unabridged abridged series edition novel retail chapterized chapterised complete narrated read'.split(' '),
);

/** Lower-case words (number words as digits, possessives off), filler dropped. */
export function titleWords(s: string, keepNumbers = false) {
  return toDigits(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map((w) => (/^\d+$/.test(w) ? String(Number(w)) : w))
    .filter((w) => w && !SKIP.has(w) && (keepNumbers || !/^\d+$/.test(w)) && !/^\d+k$/.test(w));
}

/**
 * Share (0..1) of the title's words found in the release name. Numbers don't count here
 * (see numberFit); the subtitle can be missing from the name at a small cost.
 */
export function titleScore(title: string, name: string) {
  const have = new Set(titleWords(name, true));
  const share = (q: string) => {
    let want = titleWords(stripFiller(q));
    if (!want.length) want = titleWords(q, true);
    return want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
  };
  const full = share(title);
  return title.includes(':') ? Math.max(full, share(mainTitle(title)) * 0.95) : full;
}

export type NumberFit = 'same' | 'other' | 'none';

/** Does the release carry the wanted book number ('same'), another one ('other'), or none? */
export function numberFit(want: number | undefined, name: string): NumberFit {
  if (want == null) return 'none';
  const have = bookNumber(name);
  if (have == null) {
    // "Books 1-3" style bundles and "Azarinth Healer 7" without a marker.
    return titleWords(name, true).includes(String(want)) ? 'same' : 'none';
  }
  return have === want ? 'same' : 'other';
}

type Book = { title: string; author?: string; series?: string };

/** The book number we're after: from the title, else from the series ("Ajax's Ascension, Book 5"). */
export const wantedNumber = (book: Book) =>
  bookNumber(book.title) ?? (book.series ? bookNumber(book.series) : undefined);

/** Bonus for the right book, a clear drop for another book in the series. */
const FIT_BONUS: Record<NumberFit, number> = { same: 0.3, none: 0, other: -0.6 };

/** How well a release name fits a free search ("Azarinth Healer Book Seven"): title words + book number. */
export function searchScore(query: string, name: string) {
  const want = bookNumber(query);
  const base = titleScore(seriesName(query) ?? query, name) * 0.5 + titleScore(query, name) * 0.5;
  return base + (want == null ? 0 : FIT_BONUS[numberFit(want, name)]);
}

/**
 * How well a release name fits the wanted book. The title match counts most; extra
 * title words (another book's subtitle) and the wrong book number count against it,
 * so "Ajax's Ascension" picks Book 1, not Book 7.
 */
export function rankRelease(book: Book, name: string) {
  const want = wantedNumber(book);
  const title = stripFiller(book.title);
  const series = seriesName(title);
  let score = Math.max(titleScore(title, name), series ? titleScore(series, name) * 0.9 : 0);
  const allowed = new Set([
    ...titleWords(title),
    ...titleWords(book.author ?? ''),
    ...titleWords(book.series ?? ''),
    ...titleWords(series ?? ''),
  ]);
  const extra = titleWords(titlePart(name)).filter((w) => !allowed.has(w) && !/^(19|20)\d\d$/.test(w));
  score -= Math.min(0.4, extra.length * 0.08);
  if (want != null) score += FIT_BONUS[numberFit(want, name)];
  return score;
}

/**
 * Can an automatic pick (Download / Wanted's best match) take this release? A title with a
 * number ("Book Seven") only takes a release with that number; a number known only from the
 * series ("Ajax's Ascension, Book 5") just rules out other books' numbers.
 */
export function autoPickable(book: Book, name: string) {
  const fromTitle = bookNumber(book.title);
  if (fromTitle != null) return numberFit(fromTitle, name) === 'same';
  const fromSeries = book.series ? bookNumber(book.series) : undefined;
  return fromSeries == null || numberFit(fromSeries, name) !== 'other';
}
