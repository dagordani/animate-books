"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cleanWord, paragraphStart, sentenceRange, sentenceText, tokenAt, type Book, type Mode } from "@/lib/book";
import { MicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ReplayIcon, StopIcon } from "./icons";
import { Stage } from "./Stage";
import { Caption, Transcript } from "./Transcript";
import { TutorPanel, type ChatMsg, type Status } from "./TutorPanel";
import { WordPopover, type Definition } from "./WordPopover";

const LANGS = ["English", "Spanish", "French", "Portuguese", "German", "Italian", "Chinese", "Japanese", "Korean", "Arabic", "Hindi", "Russian", "Turkish", "Hebrew", "Polish", "Ukrainian"];
const RATES = [0.75, 1, 1.25];
// Tiny silent WAV used to "unlock" the tutor audio element during a user gesture (iOS Safari).
const SILENT = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";

type Action = { reply: string; action: string; sceneIndex?: number | null };
type Pop = { i: number; word: string; sentence: string; rect: DOMRect; def: Definition | null };

export function Player({ book }: { book: Book }) {
  const narr = useRef<HTMLAudioElement>(null);
  const tutor = useRef<HTMLAudioElement>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [mode, setMode] = useState<Mode>("orig");
  const [status, setStatusState] = useState<Status>("idle");
  const statusRef = useRef<Status>("idle");
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [lang, setLang] = useState("English");
  const [cinema, setCinema] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pop, setPop] = useState<Pop | null>(null);

  const pending = useRef<{ t: number; play: boolean } | null>(null);
  const advanceTimer = useRef<number | undefined>(undefined);
  const speakDone = useRef<(() => void) | null>(null);
  const askSeq = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const defCache = useRef(new Map<string, Definition>());
  const lastTok = useRef(-2);
  const tutorUnlocked = useRef(false);
  const titled = useRef(new Set<string>()); // chapter title cards already shown

  const scene = book.scenes[sceneIdx];
  const track = scene[mode];
  const current = tokenAt(track.tokens, time);
  const started = status !== "idle" || time > 0;
  const isChapterStart = sceneIdx === 0 || book.scenes[sceneIdx - 1].chapter !== scene.chapter;

  const setStatus = useCallback((s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  // ---------- persistence ----------
  const storeKey = `animate-books:${book.id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "null");
      if (!saved) return;
      const i = Math.min(Math.max(0, saved.sceneIdx ?? 0), book.scenes.length - 1);
      const m: Mode = saved.mode === "simple" ? "simple" : "orig";
      setRate(saved.rate ?? 1);
      setLang(saved.lang ?? "English");
      setCinema(!!saved.cinema);
      go(i, m, saved.time ?? 0, false);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ sceneIdx, mode, time, rate, lang, cinema }));
    } catch {}
  }, [storeKey, sceneIdx, mode, time, rate, lang, cinema]);

  useEffect(() => {
    if (time >= 5) titled.current.add(scene.id);
  }, [time, scene.id]);

  // ---------- narration ----------
  useEffect(() => {
    if (narr.current) narr.current.playbackRate = rate;
  }, [rate]);

  // Follow the audio clock while playing; only re-render when the spoken word changes.
  useEffect(() => {
    if (status !== "playing") return;
    let raf = 0;
    const tick = () => {
      const a = narr.current;
      if (a) {
        const ti = tokenAt(track.tokens, a.currentTime);
        if (ti !== lastTok.current) {
          lastTok.current = ti;
          setTime(a.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, track]);

  const unlockTutor = () => {
    const t = tutor.current;
    if (!t || tutorUnlocked.current) return;
    tutorUnlocked.current = true;
    t.src = SILENT;
    t.play().catch(() => {});
  };

  const stopTutor = () => {
    const t = tutor.current;
    if (t) {
      t.onended = null;
      t.pause();
    }
    speakDone.current?.();
    speakDone.current = null;
  };

  const play = async () => {
    clearTimeout(advanceTimer.current);
    stopTutor();
    unlockTutor();
    const a = narr.current!;
    a.playbackRate = rate;
    setStatus("playing");
    try {
      await a.play();
    } catch {
      if (statusRef.current === "playing") setStatus("paused");
    }
  };

  /** Pause narration + tutor; caller decides the next status. */
  const interrupt = () => {
    clearTimeout(advanceTimer.current);
    stopTutor();
    narr.current?.pause();
    if (narr.current && !pending.current) setTime(narr.current.currentTime);
  };

  const pause = () => {
    interrupt();
    setStatus("paused");
  };

  /** Jump to (scene, mode, time). Works whether or not the audio source changes. */
  const go = (i: number, m: Mode, t: number, autoplay: boolean) => {
    clearTimeout(advanceTimer.current);
    const a = narr.current;
    const target = book.scenes[i][m].audio;
    t = Math.max(0, t);
    lastTok.current = -2;
    setTime(t);
    setSceneIdx(i);
    setMode(m);
    if (a && a.src.endsWith(target) && a.readyState >= 1) {
      pending.current = null;
      a.currentTime = t;
      if (autoplay) play();
      else {
        a.pause();
        if (statusRef.current === "playing") setStatus("paused");
      }
    } else {
      a?.pause();
      pending.current = { t, play: autoplay };
      if (autoplay) setStatus("playing");
      else if (statusRef.current === "playing") setStatus("paused");
    }
  };

  const onLoadedMetadata = () => {
    const a = narr.current!;
    const p = pending.current;
    a.playbackRate = rate;
    if (!p) return;
    pending.current = null;
    a.currentTime = p.t;
    if (p.play) play();
  };

  const onEnded = () => {
    if (statusRef.current !== "playing") return;
    if (sceneIdx < book.scenes.length - 1) {
      advanceTimer.current = window.setTimeout(() => go(sceneIdx + 1, mode, 0, true), 900);
    } else setStatus("finished");
  };

  const sentenceStartTime = (m: Mode, t: number) => {
    const toks = scene[m].tokens;
    const ci = Math.max(0, tokenAt(toks, t));
    return toks[sentenceRange(toks, ci)[0]]?.s ?? 0;
  };

  const switchMode = (m: Mode, autoplay: boolean) => {
    const t = narr.current?.currentTime ?? time;
    const p = track.tokens[Math.max(0, tokenAt(track.tokens, t))]?.p ?? 0;
    go(sceneIdx, m, paragraphStart(scene[m].tokens, p), autoplay);
  };

  // ---------- tutor ----------
  const speak = (text: string) =>
    new Promise<void>((resolve) => {
      setStatus("speaking");
      speakDone.current = resolve;
      (async () => {
        try {
          const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
          if (!r.ok) throw new Error("tts");
          const url = URL.createObjectURL(await r.blob());
          const tu = tutor.current!;
          if (speakDone.current !== resolve) return; // interrupted while loading
          tu.src = url;
          tu.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          tu.onerror = () => resolve();
          await tu.play();
        } catch {
          setTimeout(resolve, 1500); // reply is still visible in the chat
        }
      })();
    });

  const doAction = (res: Action, t: number) => {
    const toks = track.tokens;
    const ci = Math.max(0, tokenAt(toks, t));
    const [sa] = sentenceRange(toks, ci);
    switch (res.action) {
      case "resume": {
        // Back to the start of the sentence, but in long sentences only rewind ~4 s (to a word boundary).
        let k = sa;
        while (k < ci && t - (toks[k]?.s ?? 0) > 4) k++;
        return go(sceneIdx, mode, (toks[k]?.s ?? 0) - 0.15, true);
      }
      case "reread_sentence": {
        let start = sa;
        if (sa > 0 && t - (toks[sa]?.s ?? 0) < 1.2) start = sentenceRange(toks, sa - 1)[0];
        return go(sceneIdx, mode, (toks[start]?.s ?? 0) - 0.1, true);
      }
      case "reread_scene":
        return go(sceneIdx, mode, 0, true);
      case "goto_scene": {
        const i = Math.min(Math.max(0, res.sceneIndex ?? sceneIdx), book.scenes.length - 1);
        return go(i, mode, 0, true);
      }
      case "switch_simple":
      case "switch_original": {
        const m: Mode = res.action === "switch_simple" ? "simple" : "orig";
        const p = toks[ci]?.p ?? 0;
        return go(sceneIdx, m, paragraphStart(scene[m].tokens, p), true);
      }
      default:
        setStatus("paused");
    }
  };

  const ask = async (q: string) => {
    interrupt();
    unlockTutor();
    setPop(null);
    const id = ++askSeq.current;
    const t = pending.current?.t ?? narr.current?.currentTime ?? time;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setStatus("thinking");
    let res: Action;
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id, sceneIndex: sceneIdx, mode, time: t, question: q, history, lang }),
      });
      res = await r.json();
      if (!res.reply) throw new Error("empty");
    } catch {
      res = { reply: "Hmm, I couldn't reach my notes just now. Could you try again?", action: "stay_paused" };
    }
    if (askSeq.current !== id || statusRef.current !== "thinking") return;
    setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
    await speak(res.reply);
    if (askSeq.current !== id || (statusRef.current as Status) !== "speaking") return; // user took over
    doAction(res, t);
  };

  const skipTutor = () => {
    tutor.current?.pause();
    speakDone.current?.();
    speakDone.current = null;
  };

  const mic = async () => {
    if (statusRef.current === "listening") {
      recorder.current?.stop();
      return;
    }
    interrupt();
    unlockTutor();
    setPop(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        recorder.current = null;
        if (statusRef.current !== "listening") return;
        setStatus("thinking");
        const fd = new FormData();
        fd.append("audio", new Blob(chunks, { type: rec.mimeType }));
        try {
          const { text } = await (await fetch("/api/transcribe", { method: "POST", body: fd })).json();
          if (text?.trim()) ask(text.trim());
          else setStatus("paused");
        } catch {
          setStatus("paused");
        }
      };
      recorder.current = rec;
      rec.start();
      setStatus("listening");
      setTimeout(() => rec.state === "recording" && rec.stop(), 30000);
    } catch {
      setStatus("paused");
      alert("The microphone isn't available. You can type your question instead.");
    }
  };

  // ---------- words ----------
  const onWord = async (i: number, el: HTMLElement) => {
    if (statusRef.current === "listening" || statusRef.current === "thinking") return;
    interrupt();
    setStatus(started ? "paused" : "idle");
    const toks = track.tokens;
    const word = cleanWord(toks[i].t);
    if (!word) return;
    const key = `${word.toLowerCase()}|${lang}`;
    const cached = defCache.current.get(key) ?? null;
    const sentence = sentenceText(toks, i);
    setPop({ i, word, sentence, rect: el.getBoundingClientRect(), def: cached });
    if (cached) return;
    try {
      const r = await fetch("/api/define", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word, sentence, lang }) });
      const def = (await r.json()) as Definition;
      if (!def.meaning) return;
      defCache.current.set(key, def);
      setPop((p) => (p && p.i === i ? { ...p, def } : p));
    } catch {}
  };

  const sayWord = async (w: string) => {
    unlockTutor();
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: w }) });
      const tu = tutor.current!;
      tu.onended = null;
      tu.src = URL.createObjectURL(await r.blob());
      await tu.play();
    } catch {}
  };

  // ---------- keyboard ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "m" || e.key === "M") mic();
    else if (e.key === "ArrowRight" && sceneIdx < book.scenes.length - 1) go(sceneIdx + 1, mode, 0, statusRef.current === "playing");
    else if (e.key === "ArrowLeft") go(Math.max(0, sceneIdx - 1), mode, 0, statusRef.current === "playing");
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const togglePlay = () => {
    const s = statusRef.current;
    if (s === "playing") pause();
    else if (s === "finished") go(0, mode, 0, true);
    else if (s === "listening") recorder.current?.stop();
    else if (s === "speaking" || s === "thinking") {
      askSeq.current++;
      go(sceneIdx, mode, sentenceStartTime(mode, narr.current?.currentTime ?? time) - 0.15, true);
    } else play();
  };

  const playing = status === "playing";
  const progress = track.duration ? Math.min(1, time / track.duration) : 0;
  const statusText: Record<Status, string> = {
    idle: "Press play to begin",
    playing: "Reading…",
    paused: "Paused. Ask anything, or press play",
    listening: "Listening… tap the mic again to send",
    thinking: "Page is thinking…",
    speaking: "Page is answering",
    finished: "The end of this sample. Press play to start again",
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 lg:py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Link href="/" className="shrink-0 text-sm whitespace-nowrap text-ink-soft hover:text-accent">
          ← Animate Books
        </Link>
        <div className="min-w-0 text-right">
          <div className="truncate font-serif text-lg leading-tight">{book.title}</div>
          <div className="truncate text-xs text-ink-soft">
            Chapter {scene.chapter}: {scene.chapterTitle} · part {sceneIdx + 1} of {book.scenes.length}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <Stage scene={scene} playing={playing} duration={track.duration} showTitle={started && isChapterStart && time < 5 && !titled.current.has(scene.id)}>
            {cinema && started && <Caption tokens={track.tokens} current={current} onWord={onWord} />}
            {(status === "thinking" || status === "speaking" || status === "listening") && (
              <div className="absolute inset-x-3 top-3 flex justify-center sm:inset-x-6 sm:top-5">
                <div className="fade-in max-w-xl rounded-2xl bg-white/95 px-4 py-3 text-[0.95rem] leading-snug shadow-xl">
                  <span className="mr-1.5 font-bold text-accent">Page:</span>
                  {status === "listening" ? "I'm listening…" : status === "thinking" ? "Hmm, let me think…" : messages[messages.length - 1]?.content}
                  {status === "speaking" && (
                    <button onClick={skipTutor} className="ml-2 text-xs text-accent underline">
                      skip
                    </button>
                  )}
                </div>
              </div>
            )}
            {!started && (
              <button onClick={play} className="absolute inset-0 grid place-items-center" aria-label="Play">
                <span className="grid h-20 w-20 place-items-center rounded-full bg-white/90 text-accent shadow-xl transition hover:scale-105">
                  <PlayIcon className="h-9 w-9 translate-x-0.5" />
                </span>
              </button>
            )}
          </Stage>

          <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>

          {/* Controls */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => go(Math.max(0, sceneIdx - 1), mode, 0, playing)} className="rounded-full p-2.5 hover:bg-paper-2" aria-label="Previous part">
              <PrevIcon />
            </button>
            <button
              onClick={togglePlay}
              className="grid h-12 w-12 place-items-center rounded-full bg-ink text-paper hover:brightness-125"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon /> : <PlayIcon className="h-5 w-5 translate-x-px" />}
            </button>
            <button
              onClick={() => go(Math.min(book.scenes.length - 1, sceneIdx + 1), mode, 0, playing)}
              className="rounded-full p-2.5 hover:bg-paper-2"
              aria-label="Next part"
            >
              <NextIcon />
            </button>
            <button
              onClick={() => go(sceneIdx, mode, sentenceStartTime(mode, narr.current?.currentTime ?? time) - 0.1, true)}
              className="rounded-full p-2.5 hover:bg-paper-2"
              aria-label="Replay sentence"
              title="Replay this sentence"
            >
              <ReplayIcon />
            </button>
            <button
              onClick={mic}
              disabled={status === "thinking"}
              className={`ml-1 flex items-center gap-2 rounded-full px-4 py-2.5 font-bold text-white ${status === "listening" ? "pulse-ring bg-red-600" : "bg-accent hover:brightness-110"}`}
            >
              {status === "listening" ? <StopIcon className="h-4 w-4" /> : <MicIcon className="h-5 w-5" />}
              {status === "listening" ? "Send" : "Ask"}
            </button>
            <span className="ml-1 text-sm text-ink-soft" aria-live="polite">
              {statusText[status]}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Segmented
              value={mode}
              options={[
                ["orig", "Original"],
                ["simple", "Simple English"],
              ]}
              onChange={(m) => switchMode(m as Mode, playing)}
            />
            <Segmented value={String(rate)} options={RATES.map((r) => [String(r), `${r}×`])} onChange={(r) => setRate(Number(r))} />
            <Segmented
              value={cinema ? "cinema" : "read"}
              options={[
                ["read", "Read along"],
                ["cinema", "Cinema"],
              ]}
              onChange={(v) => setCinema(v === "cinema")}
            />
            <label className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5">
              <span className="text-ink-soft">My language</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="bg-transparent font-bold outline-none">
                {LANGS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>

          {!cinema && (
            <div className="mt-4 rounded-2xl border border-ink/10 bg-white/60 px-5 pt-5 pb-1">
              <Transcript tokens={track.tokens} current={started ? current : -1} active={started} onWord={onWord} />
            </div>
          )}

          {/* Filmstrip */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {book.scenes.map((s) => (
              <button
                key={s.id}
                onClick={() => go(s.index, mode, 0, playing)}
                title={s.summary}
                className={`relative shrink-0 overflow-hidden rounded-lg ring-2 transition ${s.index === sceneIdx ? "ring-accent" : "opacity-70 ring-transparent hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.thumb} alt="" loading="lazy" className="h-14 w-20 object-cover sm:h-16 sm:w-24" />
                <span className="absolute bottom-0.5 left-1 text-[10px] font-bold text-white drop-shadow">{s.index + 1}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <TutorPanel messages={messages} status={status} glossary={scene.glossary} onAsk={ask} onMic={mic} onSkip={skipTutor} />
        </div>
      </div>

      <audio ref={narr} src={track.audio} preload="auto" onLoadedMetadata={onLoadedMetadata} onEnded={onEnded} />
      <audio ref={tutor} />

      {pop && (
        <WordPopover
          word={pop.word}
          lang={lang}
          def={pop.def}
          rect={pop.rect}
          onClose={() => setPop(null)}
          onSay={() => sayWord(pop.def?.word ?? pop.word)}
          onAsk={() => ask(`What does "${pop.word}" mean in this sentence: "${pop.sentence}"?`)}
          onContinue={() => {
            setPop(null);
            go(sceneIdx, mode, sentenceStartTime(mode, narr.current?.currentTime ?? time) - 0.1, true);
          }}
        />
      )}
    </main>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-full border border-ink/15 bg-white p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1 ${value === v ? "bg-ink font-bold text-paper" : "text-ink-soft hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
