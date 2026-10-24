"use client";

import { useEffect, useRef, useState } from "react";
import type { GlossaryItem } from "@/lib/book";
import { MicIcon, SendIcon, StopIcon } from "./icons";

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type Status = "idle" | "playing" | "paused" | "listening" | "thinking" | "speaking" | "finished";

const CHIPS = ["What does that mean?", "Read that again", "Simpler, please", "What just happened?", "Who is this?"];

export function TutorPanel({
  messages,
  status,
  glossary,
  onAsk,
  onMic,
  onSkip,
}: {
  messages: ChatMsg[];
  status: Status;
  glossary: GlossaryItem[];
  onAsk: (q: string) => void;
  onMic: () => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [messages, status]);
  const busy = status === "thinking" || status === "listening";

  const submit = (q: string) => {
    if (!q.trim() || busy) return;
    onAsk(q.trim());
    setText("");
  };

  return (
    <aside className="flex h-full min-h-[420px] flex-col rounded-2xl border border-ink/10 bg-white/70 backdrop-blur">
      <header className="flex items-center gap-3 border-b border-ink/10 px-4 py-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft font-serif text-lg text-accent">P</div>
        <div>
          <div className="font-bold">Page</div>
          <div className="text-xs text-ink-soft">Your reading buddy. Interrupt me anytime.</div>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-3 text-sm text-ink-soft">
            <p>
              Press <b>play</b> to start the story. Whenever something is confusing, tap <b>Ask</b> and just say it, like{" "}
              <i>“what does ‘curious’ mean?”</i> or <i>“read that again.”</i>
            </p>
            <p>
              Tap any <b>word</b> in the text to see what it means.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-[0.95rem] leading-snug ${
                m.role === "user" ? "rounded-br-sm bg-ink text-paper" : "rounded-bl-sm bg-paper-2"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {status === "thinking" && (
          <div className="flex gap-1 px-2 text-2xl leading-none text-ink-soft">
            <span className="dot">•</span>
            <span className="dot">•</span>
            <span className="dot">•</span>
          </div>
        )}
        {status === "speaking" && (
          <button onClick={onSkip} className="text-xs text-accent underline">
            Skip and continue
          </button>
        )}
        <div ref={end} />
      </div>

      {glossary.length > 0 && (
        <details className="border-t border-ink/10 px-4 py-2 text-sm">
          <summary className="cursor-pointer select-none font-bold text-ink-soft">Tricky words in this part</summary>
          <ul className="mt-2 space-y-1">
            {glossary.map((g) => (
              <li key={g.word}>
                <b className="font-serif">{g.word}</b>: {g.meaning}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="border-t border-ink/10 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c}
              disabled={busy}
              onClick={() => submit(c)}
              className="rounded-full border border-ink/15 bg-white px-3 py-1 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={onMic}
            disabled={status === "thinking"}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-white ${
              status === "listening" ? "pulse-ring bg-red-600" : "bg-accent hover:brightness-110"
            }`}
            aria-label={status === "listening" ? "Stop and send" : "Ask by voice"}
          >
            {status === "listening" ? <StopIcon className="h-4 w-4" /> : <MicIcon />}
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={status === "listening" ? "Listening… tap ■ when done" : "Type a question…"}
            className="min-w-0 flex-1 rounded-full border border-ink/15 bg-white px-4 py-2.5 outline-none focus:border-accent"
          />
          <button type="submit" disabled={!text.trim() || busy} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-paper disabled:opacity-30" aria-label="Send">
            <SendIcon />
          </button>
        </form>
      </div>
    </aside>
  );
}
