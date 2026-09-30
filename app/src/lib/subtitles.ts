/**
 * Subtitles from Stremio addons (e.g. OpenSubtitles). The files are SRT or VTT;
 * we parse them and the watch screen draws the current line over the video.
 */
import { supports } from './addons';
import { parseSubtitles, type Cue } from './subtitle-format';
import { getActiveAddons } from './storage';

export type AddonSubtitle = { id: string; url: string; lang: string; addon: string };

const LANGUAGES: Record<string, string> = {
  eng: 'English',
  en: 'English',
  spa: 'Spanish',
  es: 'Spanish',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  ita: 'Italian',
  it: 'Italian',
  por: 'Portuguese',
  pt: 'Portuguese',
  pob: 'Portuguese (BR)',
  dut: 'Dutch',
  nld: 'Dutch',
  nl: 'Dutch',
  pol: 'Polish',
  pl: 'Polish',
  rus: 'Russian',
  ru: 'Russian',
  tur: 'Turkish',
  tr: 'Turkish',
  ara: 'Arabic',
  ar: 'Arabic',
  hin: 'Hindi',
  hi: 'Hindi',
  jpn: 'Japanese',
  ja: 'Japanese',
  kor: 'Korean',
  ko: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  swe: 'Swedish',
  sv: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  gre: 'Greek',
  ell: 'Greek',
  heb: 'Hebrew',
  hun: 'Hungarian',
  cze: 'Czech',
  ces: 'Czech',
  rum: 'Romanian',
  ron: 'Romanian',
  vie: 'Vietnamese',
  tha: 'Thai',
  ind: 'Indonesian',
  ukr: 'Ukrainian',
};

export const languageName = (code: string) => LANGUAGES[code.toLowerCase()] ?? code;

/** Languages offered in Settings → Playback, as 3-letter codes like the addons use. */
export const SUBTITLE_LANGUAGES = [
  'eng',
  'spa',
  'fre',
  'ger',
  'ita',
  'por',
  'dut',
  'pol',
  'rus',
  'tur',
  'ara',
  'hin',
  'jpn',
  'kor',
  'chi',
];

const sameLanguage = (a: string, b: string) => languageName(a) === languageName(b);

export async function fetchAddonSubtitles(type: string, id: string): Promise<AddonSubtitle[]> {
  const addons = (await getActiveAddons()).filter((a) => supports(a, 'subtitles', type, id));
  const lists = await Promise.all(
    addons.map(async (a) => {
      try {
        const res = await fetch(`${a.baseUrl}/subtitles/${type}/${encodeURIComponent(id)}.json`);
        const data = (await res.json()) as {
          subtitles?: { id?: string; url: string; lang: string }[];
        };
        return (data.subtitles ?? []).map((s, i) => ({
          id: s.id ?? `${a.manifest.id}:${i}`,
          url: s.url,
          lang: s.lang,
          addon: a.manifest.name,
        }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

/** Preferred language first, then alphabetical by language. */
export function sortSubtitles(subs: AddonSubtitle[], preferred: string) {
  return [...subs].sort(
    (a, b) =>
      Number(sameLanguage(b.lang, preferred)) - Number(sameLanguage(a.lang, preferred)) ||
      languageName(a.lang).localeCompare(languageName(b.lang)),
  );
}

export function findPreferred(subs: AddonSubtitle[], preferred: string) {
  return subs.find((s) => sameLanguage(s.lang, preferred));
}

export async function loadSubtitle(url: string): Promise<Cue[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subtitle download failed (${res.status})`);
  return parseSubtitles(await res.text());
}

export { cueAt, parseSubtitles, type Cue } from './subtitle-format';
