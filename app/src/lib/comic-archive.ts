/**
 * Comic archives on the phone. Android uses the app's own native module (libarchive):
 * CBZ/ZIP, CBR (RAR4 and RAR5), CB7 and CBT, unpacked file to file without loading the
 * whole archive into memory. Elsewhere only CBZ/ZIP works (fflate, in JS).
 */
import { requireOptionalNativeModule } from 'expo';

type Extracted = { name: string; uri: string };
type ComicArchiveModule = { extractImages(archiveUri: string, outDirUri: string): Promise<Extracted[]> };

const native = requireOptionalNativeModule<ComicArchiveModule>('ComicArchive');

/** True when CBR/CB7 can be opened here (the Android app). */
export const canOpenRar = !!native;

export const extractWithNative = native ? (archiveUri: string, outDirUri: string) => native.extractImages(archiveUri, outDirUri) : null;

/** What a file really is, from its first bytes. */
export function sniffArchive(head: Uint8Array): 'zip' | 'rar' | '7z' | 'pdf' | 'unknown' {
  const s = String.fromCharCode(...head.subarray(0, 6));
  if (s.startsWith('PK')) return 'zip';
  if (s.startsWith('Rar!')) return 'rar';
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return '7z';
  if (s.startsWith('%PDF')) return 'pdf';
  return 'unknown';
}
