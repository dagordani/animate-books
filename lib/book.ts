// Shared types + helpers for pre-generated books.

export type Mode = "orig" | "simple";

/** One displayed word with its narration timing. p = paragraph index within the scene. */
export type Token = { t: string; s: number; e: number; p: number };

export type Track = {
  paragraphs: string[];
  audio: string;
  duration: number;
  tokens: Token[];
};

/** Narration for one voice: same text/tokenization as the default track, different audio + timings. */
export type VoiceTrack = Omit<Track, "paragraphs">;
/** tracks/<voice>.json: sceneId -> mode -> track */
export type VoiceTracks = Record<string, Record<Mode, VoiceTrack>>;

export const NARRATOR_VOICES = [
  { id: "fable", label: "Fable", note: "British storyteller" },
  { id: "coral", label: "Coral", note: "bright & friendly" },
  { id: "ash", label: "Ash", note: "calm & clear" },
] as const;
export const DEFAULT_NARRATOR = "fable";

export type GlossaryItem = { word: string; meaning: string };

export type Scene = {
  id: string;
  index: number;
  chapter: number;
  chapterTitle: string;
  summary: string;
  image: string;
  thumb: string;
  glossary: GlossaryItem[];
  orig: Track;
  simple: Track;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  blurb: string;
  scenes: Scene[];
};

/** Index of the token being spoken at time t (last token whose start <= t). */
export function tokenAt(tokens: Token[], t: number): number {
  let lo = 0;
  let hi = tokens.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].s <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const SENTENCE_END = /[.!?]['"’”)\]]*$/;

/** [startTokenIdx, endTokenIdx] (inclusive) of the sentence containing token i. */
export function sentenceRange(tokens: Token[], i: number): [number, number] {
  if (tokens.length === 0) return [0, -1];
  i = Math.max(0, Math.min(i, tokens.length - 1));
  let start = i;
  while (start > 0 && !SENTENCE_END.test(tokens[start - 1].t) && tokens[start - 1].p === tokens[i].p) start--;
  let end = i;
  while (end < tokens.length - 1 && !SENTENCE_END.test(tokens[end].t) && tokens[end + 1].p === tokens[i].p) end++;
  return [start, end];
}

export function sentenceText(tokens: Token[], i: number): string {
  const [a, b] = sentenceRange(tokens, i);
  return tokens.slice(a, b + 1).map((x) => x.t).join(" ");
}

/** Start time of the first token in paragraph p (falls back to 0). */
export function paragraphStart(tokens: Token[], p: number): number {
  const tok = tokens.find((x) => x.p >= p);
  return tok ? tok.s : 0;
}

/** Strip punctuation for lookups / definitions. */
export function cleanWord(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** True if token i starts a sentence (or a paragraph). */
export function isSentenceStart(tokens: Token[], i: number): boolean {
  return i === 0 || tokens[i - 1].p !== tokens[i].p || SENTENCE_END.test(tokens[i - 1].t);
}

/** Text of whole sentences in [a, b] joined. */
export function joinTokens(tokens: Token[], a: number, b: number): string {
  return tokens
    .slice(a, b + 1)
    .map((x) => x.t)
    .join(" ");
}

const BREAK_AFTER = /[,;:)—–]['"’”)]*$|[”"]$/;
const BREAK_BEFORE = /^[(“"—]/;

/**
 * Subtitle-sized chunk of the sentence containing token i: at most ~maxWords / maxChars,
 * preferably cut after punctuation (, ; : — ) ”) so long sentences become several short captions.
 */
export function captionRange(tokens: Token[], i: number, maxWords = 16, maxChars = 100): [number, number] {
  const [sa, sb] = sentenceRange(tokens, i);
  let a = sa;
  while (a <= sb) {
    let b = a;
    let chars = 0;
    let lastBreak = -1;
    let overflow = false;
    for (; b <= sb; b++) {
      chars += tokens[b].t.length + 1;
      if (b > a && (b - a + 1 > maxWords || chars > maxChars)) {
        overflow = true;
        break;
      }
      // A good place to cut: after punctuation, or before an opening bracket/quote/dash; keep >= 4 words per caption.
      if (b < sb && b - a >= 3 && (BREAK_AFTER.test(tokens[b].t) || BREAK_BEFORE.test(tokens[b + 1].t))) lastBreak = b;
    }
    let end = overflow ? (lastBreak >= a ? lastBreak : b - 1) : sb;
    // Avoid leaving a tiny orphan (< 4 words) at the end of the sentence.
    if (overflow && sb - end < 4 && sb - a + 1 <= maxWords + 4) end = sb;
    if (i <= end) return [a, end];
    a = end + 1;
  }
  return [sa, sb];
}
