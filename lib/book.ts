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
