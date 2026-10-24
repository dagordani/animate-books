"use client";

import { useEffect, useRef } from "react";
import { sentenceRange, type Token } from "@/lib/book";

/** Karaoke text: current word highlighted, current sentence tinted, upcoming text softened. Words are tappable. */
export function Transcript({
  tokens,
  current,
  active,
  onWord,
}: {
  tokens: Token[];
  current: number;
  active: boolean;
  onWord: (i: number, el: HTMLElement) => void;
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
    <div ref={box} className="relative max-h-[42vh] overflow-y-auto pr-2 font-serif text-[1.2rem] leading-[1.9] sm:text-[1.3rem]">
      {paras.map((idxs, p) => (
        <p key={p} className="mb-4">
          {idxs.map((i) => {
            const isCur = active && i === current;
            const inSentence = i >= sa && i <= sb;
            const future = active && current >= 0 && i > sb;
            return (
              <span key={i}>
                <span
                  data-i={i}
                  onClick={(e) => onWord(i, e.currentTarget)}
                  className={`word cursor-pointer px-[0.06em] hover:underline hover:decoration-accent/50 ${
                    isCur ? "bg-hl text-ink" : inSentence ? "bg-hl-soft" : future ? "text-ink/45" : ""
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

/** Big subtitle-style caption of just the current sentence (cinema / focus mode). */
export function Caption({ tokens, current, onWord }: { tokens: Token[]; current: number; onWord: (i: number, el: HTMLElement) => void }) {
  if (current < 0) return null;
  const [sa, sb] = sentenceRange(tokens, current);
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
