"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_NARRATOR,
  NARRATOR_VOICES,
  cleanWord,
  joinTokens,
  paragraphStart,
  sentenceRange,
  sentenceText,
  tokenAt,
  type Book,
  type Mode,
  type Track,
  type VoiceTracks,
} from "@/lib/book";
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
/** Where a tutor action applies: scene, mode, and the narration time it refers to. */
type Ctx = { i: number; m: Mode; t: number; anchored?: boolean };
// A question asked this soon after an automatic scene change is probably about the previous scene.
const BOUNDARY_SECS = 6;
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
  const [narrator, setNarrator] = useState<string>(DEFAULT_NARRATOR);
  const [tutorVoice, setTutorVoice] = useState<string>("coral"); // or "same"
  const [voiceTracks, setVoiceTracks] = useState<Record<string, VoiceTracks>>({});
  const [audioIssue, setAudioIssue] = useState(false);

  const pending = useRef<{ t: number; play: boolean } | null>(null);
  const advanceTimer = useRef<number | undefined>(undefined);
  const speakDone = useRef<(() => void) | null>(null);
  const askSeq = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const defCache = useRef(new Map<string, Definition>());
  const lastTok = useRef(-2);
  const tutorUnlocked = useRef(false);
  const titled = useRef(new Set<string>()); // chapter title cards already shown
  const lastAuto = useRef<{ from: number; to: number } | null>(null); // last automatic scene change
  const deferredAction = useRef<(() => void) | null>(null); // tutor action to run on ▶ if its voice failed

  const scene = book.scenes[sceneIdx];
  // Narration for the selected voice (same text/tokens as book.json, different audio + timings).
  const trackFor = useCallback(
    (i: number, m: Mode, voice = narrator, vt = voiceTracks): Track => {
      const base = book.scenes[i][m];
      const v = voice !== DEFAULT_NARRATOR ? vt[voice]?.[book.scenes[i].id]?.[m] : undefined;
      return v ? { ...base, ...v } : base;
    },
    [book, narrator, voiceTracks],
  );
  const track = useMemo(() => trackFor(sceneIdx, mode), [trackFor, sceneIdx, mode]);
  const trackRef = useRef(track);
  trackRef.current = track;
  const tutorVoiceId = tutorVoice === "same" ? narrator : tutorVoice;
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
      if (saved.tutorVoice) setTutorVoice(saved.tutorVoice);
      const restore = (vt: Record<string, VoiceTracks>, voice: string) => {
        setVoiceTracks(vt);
        setNarrator(voice);
        setSceneIdx(i);
        setMode(m);
        setTime(saved.time ?? 0);
        pending.current = { t: saved.time ?? 0, play: false };
        const a = narr.current;
        if (a && a.readyState >= 1 && a.src.endsWith(trackFor(i, m, voice, vt).audio)) {
          a.currentTime = saved.time ?? 0;
          pending.current = null;
        }
      };
      const v = NARRATOR_VOICES.some((x) => x.id === saved.narrator) ? saved.narrator : DEFAULT_NARRATOR;
      if (v === DEFAULT_NARRATOR) restore({}, v);
      else
        loadVoice(v)
          .then((t) => restore({ [v]: t }, v))
          .catch(() => restore({}, DEFAULT_NARRATOR));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ sceneIdx, mode, time, rate, lang, cinema, narrator, tutorVoice }));
    } catch {}
  }, [storeKey, sceneIdx, mode, time, rate, lang, cinema, narrator, tutorVoice]);

  const loadVoice = async (v: string): Promise<VoiceTracks> => {
    const r = await fetch(`/books/${book.id}/tracks/${v}.json`);
    if (!r.ok) throw new Error("voice");
    return r.json();
  };

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
    lastAuto.current = null;
    deferredAction.current = null;
    setAudioIssue(false);
    const a = narr.current;
    const target = trackFor(i, m).audio;
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
    if (!p || !a.src.endsWith(trackRef.current.audio)) return; // ignore a stale source
    pending.current = null;
    a.currentTime = p.t;
    if (p.play) play();
  };

  // If a source swap left a pending seek on audio that's already loaded, apply it now.
  useEffect(() => {
    const a = narr.current;
    if (a && pending.current && a.readyState >= 1 && a.src.endsWith(track.audio)) onLoadedMetadata();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.audio]);

  const onEnded = () => {
    if (statusRef.current !== "playing") return;
    if (sceneIdx < book.scenes.length - 1) {
      const from = sceneIdx;
      advanceTimer.current = window.setTimeout(() => {
        go(from + 1, mode, 0, true);
        lastAuto.current = { from, to: from + 1 };
      }, 1500);
    } else setStatus("finished");
  };

  const sentenceStartTime = (m: Mode, t: number) => {
    const toks = trackFor(sceneIdx, m).tokens;
    const ci = Math.max(0, tokenAt(toks, t));
    return toks[sentenceRange(toks, ci)[0]]?.s ?? 0;
  };

  const switchMode = (m: Mode, autoplay: boolean) => {
    const t = narr.current?.currentTime ?? time;
    const p = track.tokens[Math.max(0, tokenAt(track.tokens, t))]?.p ?? 0;
    go(sceneIdx, m, paragraphStart(trackFor(sceneIdx, m).tokens, p), autoplay);
  };

  const changeNarrator = async (v: string) => {
    let vt = voiceTracks;
    if (v !== DEFAULT_NARRATOR && !vt[v]) {
      try {
        vt = { ...vt, [v]: await loadVoice(v) };
      } catch {
        return alert("That voice isn't available yet.");
      }
    }
    // Same words, different timings: keep the listener on the same word.
    const a = narr.current;
    const wasPlaying = statusRef.current === "playing";
    const t = a?.currentTime ?? time;
    const next = trackFor(sceneIdx, mode, v, vt);
    const t2 = t > 0 ? (next.tokens[Math.max(0, tokenAt(track.tokens, t))]?.s ?? 0) : 0;
    a?.pause();
    pending.current = { t: t2, play: wasPlaying };
    lastTok.current = -2;
    setVoiceTracks(vt);
    setNarrator(v);
    setTime(t2);
  };

  /** "Read from here": continue the narration from token i of the current track. */
  const readFrom = (i: number) => {
    setPop(null);
    stopTutor();
    go(sceneIdx, mode, (track.tokens[i]?.s ?? 0) - 0.05, true);
  };

  // ---------- tutor ----------
  /**
   * Speak a tutor reply by streaming /api/tts straight into the <audio> element.
   * Resolves true when finished (or skipped), false if the audio never started or broke.
   */
  const speak = (text: string) =>
    new Promise<boolean>((resolve) => {
      setStatus("speaking");
      const tu = tutor.current!;
      const timers: number[] = [];
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        tu.onended = tu.onerror = tu.onplaying = null;
        tu.pause();
        if (speakDone.current === skip) speakDone.current = null;
        resolve(ok);
      };
      const skip = () => finish(true);
      speakDone.current = skip;
      tu.onended = () => finish(true);
      tu.onerror = () => finish(false);
      // Watchdogs: must start within 8 s, and can't run much longer than the text needs.
      timers.push(window.setTimeout(() => finish(false), 8000));
      tu.onplaying = () => {
        clearTimeout(timers[0]);
        const words = text.split(/\s+/).length;
        timers.push(window.setTimeout(() => finish(true), (words / 2 + 6) * 1000));
      };
      tu.src = `/api/tts?voice=${encodeURIComponent(tutorVoiceId)}&text=${encodeURIComponent(text)}`;
      tu.play().catch(() => finish(false));
    });

  const doAction = (res: Action, { i, m, t, anchored }: Ctx) => {
    const toks = trackFor(i, m).tokens;
    const ci = Math.max(0, tokenAt(toks, t));
    const [sa] = sentenceRange(toks, ci);
    switch (res.action) {
      case "resume": {
        // Back to the start of the sentence, but in long sentences only rewind ~4 s (to a word boundary).
        let k = sa;
        while (k < ci && t - (toks[k]?.s ?? 0) > 4) k++;
        return go(i, m, (toks[k]?.s ?? 0) - 0.15, true);
      }
      case "reread_sentence": {
        let start = sa;
        if (!anchored && sa > 0 && t - (toks[sa]?.s ?? 0) < 1.2) start = sentenceRange(toks, sa - 1)[0];
        return go(i, m, (toks[start]?.s ?? 0) - 0.1, true);
      }
      case "reread_scene":
        return go(i, m, 0, true);
      case "goto_scene": {
        const j = Math.min(Math.max(0, res.sceneIndex ?? i), book.scenes.length - 1);
        return go(j, m, 0, true);
      }
      case "switch_simple":
      case "switch_original": {
        const m2: Mode = res.action === "switch_simple" ? "simple" : "orig";
        const p = toks[ci]?.p ?? 0;
        return go(i, m2, paragraphStart(trackFor(i, m2).tokens, p), true);
      }
      default:
        setStatus("paused");
    }
  };

  /** Sentence being read plus the ~2 sentences before it (crossing into the previous scene if needed). */
  const heardContext = (i: number, m: Mode, t: number) => {
    const toks = trackFor(i, m).tokens;
    const ci = Math.max(0, tokenAt(toks, t));
    const [sa, sb] = sentenceRange(toks, ci);
    const before: string[] = [];
    for (let k = sa - 1; before.length < 2 && k >= 0; ) {
      const [a] = sentenceRange(toks, k);
      before.unshift(joinTokens(toks, a, k));
      k = a - 1;
    }
    if (before.length < 2 && i > 0) {
      const pt = trackFor(i - 1, m).tokens;
      const prev: string[] = [];
      for (let k = pt.length - 1; prev.length < 2 - before.length && k >= 0; ) {
        const [a] = sentenceRange(pt, k);
        prev.unshift(joinTokens(pt, a, k));
        k = a - 1;
      }
      before.unshift(...prev, "[new scene]");
    }
    return { recent: before.join(" "), current: joinTokens(toks, sa, sb) };
  };

  const ask = async (q: string) => {
    const t0 = pending.current?.t ?? narr.current?.currentTime ?? time;
    interrupt();
    unlockTutor();
    setPop(null);
    setAudioIssue(false);
    const id = ++askSeq.current;
    let ctx: Ctx = { i: sceneIdx, m: mode, t: t0 };
    let next: string | undefined;
    // Just auto-advanced? The question is probably about the end of the previous scene:
    // go back there (paused on its last sentence) so the listener sees what's being discussed.
    const auto = lastAuto.current;
    if (auto && auto.to === sceneIdx && t0 < BOUNDARY_SECS) {
      const pt = trackFor(auto.from, mode).tokens;
      const [la] = sentenceRange(pt, pt.length - 1);
      const cur = track.tokens;
      next = cur.length ? joinTokens(cur, 0, Math.max(0, tokenAt(cur, t0))) : undefined;
      ctx = { i: auto.from, m: mode, t: pt[la]?.s ?? 0, anchored: true };
      go(ctx.i, ctx.m, ctx.t, false);
    }
    const heard = { ...heardContext(ctx.i, ctx.m, ctx.t), next };
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setStatus("thinking");
    let res: Action;
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id, sceneIndex: ctx.i, mode: ctx.m, time: ctx.t, question: q, history, lang, heard }),
      });
      res = await r.json();
      if (!res.reply) throw new Error("empty");
    } catch {
      res = { reply: "Hmm, I couldn't reach my notes just now. Could you try again?", action: "stay_paused" };
    }
    if (askSeq.current !== id || statusRef.current !== "thinking") return;
    setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
    const ok = await speak(res.reply);
    if (askSeq.current !== id || (statusRef.current as Status) !== "speaking") return; // user took over
    if (ok) return doAction(res, ctx);
    // The voice didn't play (network / autoplay blocked): don't hang, wait for ▶ and then do the action.
    tutor.current?.pause();
    setAudioIssue(true);
    setStatus("paused");
    deferredAction.current = res.action === "stay_paused" ? null : () => doAction(res, ctx);
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

  const sayWord = (w: string) => {
    unlockTutor();
    const tu = tutor.current!;
    tu.onended = tu.onerror = tu.onplaying = null;
    tu.src = `/api/tts?voice=${encodeURIComponent(tutorVoiceId)}&text=${encodeURIComponent(w)}`;
    tu.play().catch(() => {});
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
    else if (deferredAction.current) {
      const run = deferredAction.current;
      deferredAction.current = null;
      setAudioIssue(false);
      run();
    } else if (s === "finished") go(0, mode, 0, true);
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
    paused: audioIssue ? "Couldn't play Page's voice. Press ▶ to continue" : "Paused. Ask anything, or press play",
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
            <label className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5">
              <span className="text-ink-soft">Narrator</span>
              <select value={narrator} onChange={(e) => changeNarrator(e.target.value)} className="bg-transparent font-bold outline-none">
                {NARRATOR_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.note})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5">
              <span className="text-ink-soft">Page&rsquo;s voice</span>
              <select value={tutorVoice} onChange={(e) => setTutorVoice(e.target.value)} className="bg-transparent font-bold outline-none">
                <option value="same">Same as narrator</option>
                {NARRATOR_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!cinema && (
            <div className="mt-4 rounded-2xl border border-ink/10 bg-white/60 px-5 pt-5 pb-1">
              <Transcript tokens={track.tokens} current={started ? current : -1} active={started} onWord={onWord} onReadFrom={readFrom} />
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
          onReadFrom={() => readFrom(pop.i)}
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
