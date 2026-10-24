"use client";

import { CloseIcon, PlayIcon, SpeakerIcon } from "./icons";

export type Definition = { word: string; partOfSpeech: string; meaning: string; example: string; translation: string };

export function WordPopover({
  word,
  lang,
  def,
  rect,
  onClose,
  onSay,
  onAsk,
  onContinue,
}: {
  word: string;
  lang: string;
  def: Definition | null;
  rect: DOMRect;
  onClose: () => void;
  onSay: () => void;
  onAsk: () => void;
  onContinue: () => void;
}) {
  const width = 320;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const below = rect.bottom + 260 < window.innerHeight;
  const top = below ? rect.bottom + 10 : Math.max(12, rect.top - 10 - 240);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        className="fixed z-50 rounded-2xl border border-ink/10 bg-white p-4 shadow-2xl"
        style={{ left, top, width }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-serif text-2xl leading-tight">{def?.word ?? word}</div>
            {def && <div className="text-sm italic text-ink-soft">{def.partOfSpeech}</div>}
          </div>
          <div className="flex gap-1">
            <button onClick={onSay} className="rounded-full p-2 hover:bg-paper-2" aria-label="Pronounce">
              <SpeakerIcon />
            </button>
            <button onClick={onClose} className="rounded-full p-2 hover:bg-paper-2" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
        </div>
        {!def ? (
          <div className="mt-3 space-y-2">
            <div className="h-3 w-5/6 animate-pulse rounded bg-paper-2" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-paper-2" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-paper-2" />
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-[0.95rem]">
            <p>{def.meaning}</p>
            {lang !== "English" && def.translation && (
              <p className="rounded-lg bg-accent-soft/60 px-2 py-1">
                <span className="text-xs font-bold uppercase tracking-wide text-accent">{lang}</span>{" "}
                <span className="font-bold">{def.translation}</span>
              </p>
            )}
            <p className="italic text-ink-soft">“{def.example}”</p>
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button onClick={onAsk} className="flex-1 rounded-full border border-ink/15 px-3 py-1.5 text-sm hover:bg-paper-2">
            Ask Page more
          </button>
          <button
            onClick={onContinue}
            className="flex flex-1 items-center justify-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-white hover:brightness-110"
          >
            <PlayIcon className="h-4 w-4" /> Continue
          </button>
        </div>
      </div>
    </>
  );
}
