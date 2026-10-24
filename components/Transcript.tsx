"use client";

import { useEffect, useRef } from "react";
import { captionRange, isSentenceStart, sentenceRange, type Token } from "@/lib/book";

/**
 * Karaoke text: current word highlighted, current sentence tinted, upcoming text softened.
 * Tap a word for its meaning, double-click to read from it, tap a ▸ marker to read from that sentence.
 */
export function Transcript({
  tokens,
  current,
  active,
  onWord,
  onReadFrom,
}: {
  tokens: Token[];
  current: number;
  active: boolean;
  onWord: (i: number, el: HTMLElement) => void;
  onReadFrom: (i: number) => void;
}) {
  const [sa, sb] = current >= 0 ? sentenceRange(tokens, current) : [-1, -1];
  const box = useRef<HTMLDivElement>(null);

  // Keep the current sentence in view inside the scroll box.
  useEffect(() => {
    if (sa < 0 || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-i="${sa}"]`);
    if (!el) return;
    const top = el.offsetTop; // box is the offsetParent (position: relative)
    if (top < box.current.scrollTop || top > box.current.scrollTop + box.current.clientHeight - 80) {
      box.current.scrollTo({ top: Math.max(0, top - 40), behavior: "smooth" });
    }
  }, [sa]);

  const paras: number[][] = [];
  tokens.forEach((t, i) => (paras[t.p] ??= []).push(i));

  return (
    <div ref={box} className="transcript relative max-h-[42vh] overflow-y-auto pr-2 font-serif text-[1.2rem] leading-[1.9] sm:text-[1.3rem]">
      {paras.map((idxs, p) => (
        <p key={p} className="mb-4">
          {idxs.map((i) => {
            const isCur = active && i === current;
            const inSentence = i >= sa && i <= sb;
            const future = active && current >= 0 && i > sb;
            return (
              <span key={i} className={inSentence && i < sb ? "bg-hl-soft" : ""}>
                {isSentenceStart(tokens, i) && (
                  <button
                    onClick={() => onReadFrom(i)}
                    className="sent-mark mr-0.5 inline-grid h-5 w-4 -translate-y-px place-items-center align-middle font-sans text-[0.7rem] text-accent"
                    aria-label="Read from this sentence"
                    title="Read from this sentence"
                  >
                    ▸
                  </button>
                )}
                <span
                  data-i={i}
                  onClick={(e) => onWord(i, e.currentTarget)}
                  onDoubleClick={() => onReadFrom(i)}
                  className={`word cursor-pointer px-[0.06em] hover:underline hover:decoration-accent/50 ${
                    isCur ? "bg-hl text-ink" : i === sb ? "bg-hl-soft" : future ? "text-ink/45" : ""
                  }`}
                >
                  {tokens[i].t}
                </span>{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

/** Subtitle-style caption: the current sentence, cut into short chunks when it's long (cinema mode). */
export function Caption({ tokens, current, onWord }: { tokens: Token[]; current: number; onWord: (i: number, el: HTMLElement) => void }) {
  if (current < 0) return null;
  const [sa, sb] = captionRange(tokens, current);
  return (
    <div className="absolute inset-x-0 bottom-0 p-4 sm:p-8">
      <p className="mx-auto max-w-3xl text-center font-serif text-xl leading-relaxed text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] sm:text-3xl">
        {tokens.slice(sa, sb + 1).map((t, k) => {
          const i = sa + k;
          return (
            <span key={i}>
              <span
                onClick={(e) => onWord(i, e.currentTarget)}
                className={`word cursor-pointer px-[0.08em] ${i === current ? "bg-hl text-ink" : i < current ? "" : "text-white/70"}`}
              >
                {t.t}
              </span>{" "}
            </span>
          );
        })}
      </p>
    </div>
  );
}
