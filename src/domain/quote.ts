import type { Media, Mood, Quote } from "../data/moods";

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

export function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit space; a plain `*` overflows
    // into float territory and stops being a hash.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * `mediaIndex` is the position of the chosen entry in `mood.media`, and it is
 * null exactly when `media` is. The caller needs it to build the same-origin
 * proxy path (see src/app/media.ts), which names a catalogue entry rather than
 * carrying an upstream URL.
 */
export function pickQuote(
  mood: Mood,
  seed: number,
): { quote: Quote; media: Media | null; mediaIndex: number | null } {
  const hash = fnv1a(`${seed}${mood.id}`);
  const quote = mood.quotes[hash % mood.quotes.length] as Quote;
  if (mood.media.length === 0) return { quote, media: null, mediaIndex: null };

  const mediaIndex = hash % mood.media.length;
  return { quote, media: mood.media[mediaIndex] as Media, mediaIndex };
}
