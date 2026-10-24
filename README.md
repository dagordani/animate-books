# Animate Books

Illustrated, narrated books with a reading buddy ("Page") you can interrupt at any time. It's built for people who find it hard to focus on a page and for second-language readers.

- **Watch and listen:** each part of the story has an AI illustration with a slow pan/zoom and a narrator. Words highlight karaoke-style as they're read.
- **Interrupt anytime:** tap **Ask** and speak (or type), e.g. "what does that mean?", "read that again", "simpler please". Page answers out loud, then continues from where you were. Questions asked just after a scene change are understood as being about the end of the previous scene.
- **Made for learners:**
  - switch between Original and Simple English;
  - choose 0.75× / 1× / 1.25× speed;
  - use Cinema (subtitles) or Read-along view;
  - tap any word for a definition and a translation into your language;
  - use "Read from here" or the ▸ sentence markers to jump within a scene.
- **Voices:** three narrator voices (Fable, Coral, Ash) and a separate choice for Page, including "Same as narrator".

The demo book is chapters 1–2 of *Alice's Adventures in Wonderland* (public domain, from Project Gutenberg): 28 scenes, about 43 minutes of narration per voice across both versions.

---

## Contents
- [How it works](#how-it-works)
- [Which model does what, and why](#which-model-does-what-and-why)
- [Time and cost](#time-and-cost)
- [Project structure](#project-structure)
- [Design trade-offs](#design-trade-offs)
- [Limitations](#limitations)
- [Security: prompt injection and abuse](#security-prompt-injection-and-abuse)
- [Path to a production app](#path-to-a-production-app)
- [Run locally / regenerate / deploy](#run-locally)

---

## How it works

The book is split into **two phases**:

**1. Offline build (`scripts/build-book.ts`, run once on a laptop).** Everything about the book is generated ahead of time and committed under `public/books/<id>/`:

1. Download the Gutenberg text, strip the license header, split chapters into paragraphs, and group them into scenes of about 1,100 characters. This step is deterministic code, not an LLM, so the original text is never altered.
2. An LLM call per scene, in order so each one sees a summary of the story so far, returns structured JSON with these fields:
   - `simple`: a Simple-English rewrite, paragraph-for-paragraph
   - `summary`: a one-line summary
   - `glossary`: 3–6 tricky words
   - `imagePrompt`: a description of one key moment
3. An image model draws each scene. The prompt has a fixed style prefix and a character sheet, filtered to the characters that scene mentions, which keeps Alice and the Rabbit consistent.
4. TTS narrates every scene in both versions, **one paragraph at a time**. Each clip's duration is checked against its word count and the clip is retried if it's too short, because long TTS inputs sometimes stop early. The clips are joined with short pauses and compressed to mono 48 kbps with `ffmpeg`.
5. Whisper transcribes each narration file with **word timestamps**, and the transcript is **aligned** back to the original text, punctuation included.
   - Attempts are judged by how many words align, because Whisper occasionally truncates or invents text. The script retries with different prompts, then falls back to transcribing 15-second chunks.
   - These timings power karaoke highlighting, tap-a-word, "read that again", "read from here", resume points and keeping your place when you switch voice.
6. Write `book.json`, which embeds the default voice's timings. Each extra voice gets `tracks/<voice>.json` plus `audio/<voice>/*.mp3`.

**2. Runtime (Next.js on Vercel).** The page loads static assets. Only the interactive parts call OpenAI, through API routes:

| Route | Purpose |
| --- | --- |
| `POST /api/ask` | The tutor. It receives the current scene and what was just heard, crossing scene boundaries if needed, plus the story-so-far summaries and recent chat. It returns `{reply, action}`, where action is one of: `resume`, `reread_sentence`, `reread_scene`, `goto_scene`, `switch_simple`, `switch_original`, `stay_paused`. One fast `gpt-4.1-mini` call with a strict JSON schema (see [trade-offs](#tutor-fast-llm-call-vs-agent)). |
| `GET /api/tts?text&voice` | Speaks tutor replies. The `<audio>` element plays it directly, so the voice starts as soon as the first bytes arrive. `POST` is also accepted. |
| `POST /api/transcribe` | Push-to-talk audio → text. |
| `POST /api/define` | Tap-a-word definition, example sentence and translation. |

The client player (`components/Player.tsx`) is a small state machine:

```
idle → playing ⇄ paused → listening → thinking → speaking → (do the tutor's action) → playing…
```

Safeguards on the tutor's voice:
- **Start watchdog:** if the voice hasn't started within 8 s, the player stops waiting.
- **Length watchdog:** playback can't run much longer than the text needs.
- **On failure:** the player stays paused with a visible message, and the tutor's action runs on the next ▶. It never hangs.

---

## Which model does what, and why

All models come from one vendor (OpenAI) and can be changed with environment variables.

| Job | When | Model (default) | Why this model |
| --- | --- | --- | --- |
| Scene enrichment: simple rewrite, summary, glossary, image prompt | Build | `gpt-4.1-mini` (`OPENAI_MODEL`) | Cheap and fast, strong at following instructions, and supports strict JSON-schema output. Writing at an A2–B1 level doesn't need a frontier model. |
| Illustrations | Build | `gpt-image-2` (`OPENAI_IMAGE_MODEL`, script default `gpt-image-1`) | Best character consistency and painterly style in our tests. Slow (about 1 min per image), which is fine offline. |
| Narration | Build | `gpt-4o-mini-tts`, voices `fable` / `coral` / `ash` | Takes style instructions ("warm storyteller, give characters a little voice") and costs far less than premium TTS. |
| Word timing alignment | Build | `whisper-1` | The only OpenAI transcription model that returns **word-level timestamps**. |
| Tutor ("Page") | Runtime | `gpt-4.1-mini` with chat completions (`OPENAI_MODEL`) | Low latency matters most: the listener has paused mid-story. Strict JSON output with a fixed action list keeps answers short and on-script. No reasoning model needed for vocabulary and plot questions. |
| Tutor voice | Runtime | `gpt-4o-mini-tts`, voice chosen by the listener (default `coral`) | Streams; the first audio arrives in about 1 s. |
| Mic input | Runtime | `gpt-4o-mini-transcribe` (`OPENAI_STT_MODEL`) | More accurate than Whisper for short, noisy questions. No timestamps needed. |
| Tap-a-word | Runtime | `gpt-4.1-mini` | One small JSON call. The result is cached per word and language in the browser. |

---

## Time and cost

These are measured on the demo book (28 scenes, about 4.2k words of original text and 3.4k words of Simple English). Costs are **approximate list prices at build time**; check OpenAI's pricing page before relying on them.

### One-off generation

| Asset | Volume | Wall-clock time | Approx. cost |
| --- | --- | --- | --- |
| Scene enrichment (LLM) | 28 calls | about 1 min (sequential) | < $0.10 |
| Illustrations (`gpt-image-2`, 1536×1024, medium) | 28 images (+2 tests) | about 15–20 min (4 at a time, about 1 min each) | about $2–3 |
| Narration, one voice, both versions | about 43 min of audio, 56 files | about 8–10 min | about $0.65 |
| Word timings (`whisper-1`, including retries) | about 43 min per voice | included above | about $0.30 per voice |
| **First full build (1 voice)** | | **about 25 min** | **about $3–4** |
| Each extra narrator voice | about 46 min of audio | about 10–12 min | about $1–1.5 |

Disk footprint:
- images: 5.8 MB (webp)
- audio: about 16 MB per voice (47 MB for 3 voices)
- timings: about 350 KB per voice

Rule of thumb: a full ~300-page novel is about 25× this sample. That's roughly 700 scenes, about $50–75 of images, and about $15–20 of audio per voice. Image generation dominates both time and cost.

### Per interaction (runtime)

| Action | Latency (measured) | Approx. cost |
| --- | --- | --- |
| Tutor answer (`gpt-4.1-mini`) | 1.3–2 s to text | < $0.001 |
| Total time from asking to hearing Page's voice | about 2.4 s | |
| Tutor voice (streamed) | about 1 s to first audio | about $0.001–0.003 |
| Voice question → text | about 0.5–1 s | < $0.001 |
| Tap-a-word definition | about 1 s, then instant from cache | < $0.001 |

Narration playback is free at runtime because it's pre-generated.

---

## Project structure

```
app/
  page.tsx                 Landing page
  read/[book]/page.tsx     Reader page (static, one per book in lib/books.ts)
  api/ask/route.ts         Tutor: context assembly → LLM → {reply, action}
  api/tts/route.ts         Streaming TTS (voice allowlist)
  api/transcribe/route.ts  Mic audio → text
  api/define/route.ts      Tap-a-word dictionary
  layout.tsx, globals.css  Fonts (Literata + Atkinson Hyperlegible), theme, pan/zoom + caption animations
components/
  Player.tsx               State machine: narration, tutor, actions, scene-boundary logic, voices, persistence
  Stage.tsx                Illustration with Ken Burns pan/zoom, crossfade, chapter title card
  Transcript.tsx           Karaoke read-along, sentence ▸ markers, Cinema captions (chunked)
  TutorPanel.tsx           Chat, quick-ask chips, mic + text input, glossary
  WordPopover.tsx          Definition / translation / "Read from here"
  icons.tsx
lib/
  book.ts                  Types + timing helpers (tokenAt, sentenceRange, captionRange, …), voice list
  books.ts                 Book registry (imports book.json)
  openai.ts                Client + model/voice env defaults
scripts/
  build-book.ts            Offline generator (text → scenes → images, audio, timings)
public/books/alice/
  book.json                Scenes, text, glossary, default-voice timings
  tracks/<voice>.json      Timings for extra narrator voices
  img/*.webp               Illustrations + thumbnails
  audio/[<voice>/]*.mp3    Narration (default voice at top level)
.cache/                    Build cache (LLM outputs, raw word timings); git-ignored
```

---

## Design trade-offs

### Chaining specialist models vs. one large multimodal model
The app chains **text LLM → image model → TTS → speech-to-text alignment** rather than asking one multimodal model to "turn this chapter into an illustrated audiobook".

**Why chaining fits:**
- **Word timings.** Highlighting, tap-a-word, "read that again" and voice switching all depend on exact word timestamps. Separate TTS + Whisper alignment gives them to us; a single multimodal model's audio output doesn't.
- **The text stays exact.** The original text is never passed through a generator; only the Simple-English version is AI-written.
- **Each stage can be cached, retried and validated on its own.** Examples: re-run one truncated audio file, or swap the image model without touching narration.
- **Cost and quality per job.** A mini LLM for rewriting, the best image model for art, cheap TTS for long narration.

**What chaining costs:**
- More moving parts and more failure modes (truncated TTS, Whisper hallucinations), each needing its own guardrail.
- Some consistency only exists through prompts (style prefix, character sheet), not from one model "remembering" the story.
- Higher overall latency if you tried to do it live.

**Realtime speech-to-speech models** (one model listening and talking) would make Page feel more conversational: barge-in and lower latency. But it's harder to keep a voice model grounded in exact book state and to return structured actions reliably. It's the natural next step for the tutor only (see the roadmap).

### Pre-generated vs. live generation
- **Pre-generated (chosen for the demo):** instant start, zero runtime cost for narration, no mid-demo failures.
  - Costs: a 25-minute build per book, and new voices or styles require regeneration.
  - Static audio also bloats the git repo (47 MB). Fine for a demo, but it belongs in object storage.
- **Live:** any book and any voice, but a 1–2-minute wait for the first scene unless it's pipelined (see the roadmap).

### Tutor: fast LLM call vs. agent
- **Current: a single chat completion** (`gpt-4.1-mini`):
  - answers in about 1.5 s, and the action list keeps it on-script;
  - for readers who struggle to focus, a quick answer and an immediate return to the story matter more than depth;
  - weaker on open-ended "why" questions or anything that needs outside knowledge (historical context, author background).
- **Alternative: an agent** with web search and a sandbox:
  - richer answers;
  - but about 9–15 s per answer in our test, higher and less predictable cost, and a much larger security surface (an internet-connected agent driven by public input).
- **Suggested middle ground:** keep the fast model by default. Escalate to a research agent only when the fast model flags `needs_research`, and play a spoken filler ("Good question, let me check…") while it works.

### Stack
- **Next.js + Vercel, single app:** no separate backend, queue or database. Deploy is `git push`.
  - Limits: serverless function timeouts, no background jobs, no persistent storage beyond static files.
  - That's fine for one pre-built book, not for user uploads (see the roadmap).
- **One vendor (OpenAI):** one key and one bill, the simplest possible demo. Alternatives may be better per stage:
  - ElevenLabs for the most natural narration;
  - Flux via fal/Replicate for faster, cheaper images;
  - Claude for the tutor.

  The model defaults in `lib/openai.ts` are a single point to change.
- **Browser state only:** reading position, voice and language live in `localStorage`. There are no accounts, and the chat history is lost on reload.

---

## Limitations

- **One pre-built sample book.** No uploads yet.
- **Alignment isn't perfect.** About 1–3% of words get interpolated timings, and the weakest tracks (one per voice) keep about 84–89% of words in sync. Highlighting can lag slightly on those.
- **Characters drift a little** between images (outfits, the Rabbit's jacket). There are no reference-image or LoRA consistency controls.
- **Illustrations are static.** "Animation" means pan/zoom and crossfades; there's no motion or lip-sync.
- **Simple English is AI-written** and not reviewed by a teacher. It can occasionally flatten tone or miss wordplay, which Carroll uses a lot.
- **Only the UI's tutor and definitions can switch language.** Narration is English-only.
- **The tutor only knows the book text it's given** (current and previous scene, the story-so-far summaries) plus general model knowledge. It can't look things up. There's also no client-side timeout on `/api/ask`; the voice has watchdogs but the text answer doesn't.
- **Mobile Safari autoplay rules.** The app "unlocks" audio on the first tap, but blocked playback falls back to "press ▶ to continue". The mic flow hasn't been tested on iOS.
- **Chat isn't persisted,** and the tutor only sees the last 8 messages.
- **No analytics or learning record** (e.g. which words a reader struggled with).
- **No automated tests in the repo.** The end-to-end checks were run ad hoc with puppeteer.

---

## Security: prompt injection and abuse

The API routes are **public and unauthenticated**, and they spend money on your OpenAI key.

| Risk | Where | Current mitigation | Next step |
| --- | --- | --- | --- |
| **Cost abuse / denial of wallet.** Anyone can script calls to `/api/ask`, `/api/tts`, `/api/transcribe`, `/api/define`. | All routes | Input length caps (question 1k chars, TTS 1.2k, audio 10 MB, 30 s of recording). A spending limit on the OpenAI dashboard. Each call is cheap (fractions of a cent), but nothing limits how many calls one client can make. | Per-IP and per-session rate limits (e.g. Upstash Ratelimit / Vercel KV), Vercel BotID or Turnstile, auth for heavy features, daily budget caps per user |
| **Prompt injection by the listener** ("ignore your instructions…", role-play, extracting the system prompt) | `/api/ask`, `/api/define` | Structured JSON output with a fixed **action enum**, so the model can only trigger 7 harmless client actions. `sceneIndex` is clamped client-side, and replies are rendered as text, not HTML. | Output moderation, keep untrusted input clearly delimited, refuse off-topic requests server-side, log and red-team |
| **Adding tools to the tutor later** (web search, code execution, agents) | `/api/ask` | Not applicable today: the tutor has **no tools**, so injected instructions can only change its words or pick one of the 7 actions | If tools are added: keep public traffic tool-less, or restrict to allowlisted domains with no network/sandbox. Cap tool calls, time and spend per request. Treat web results as untrusted (indirect prompt injection). |
| **Indirect injection from book content** (once users upload books, the text could contain "SYSTEM: …") | Build-time LLM, tutor context | N/A (the only book is trusted public-domain text) | Treat uploaded text as data: delimit it, strip control-like patterns, never give the build pipeline tools, validate every LLM output against its schema |
| **Unsafe or inappropriate generations** (images, Simple-English text, tutor answers) | Build + `/api/ask` | Provider safety filters; the content is a children's classic | Moderation on generated text and images before publishing, human review for public books, age-appropriate system prompts |
| **Voice/TTS misuse** (making the app speak arbitrary text) | `GET /api/tts?text=` | Voice allowlist, 1.2k-char cap | Only speak text the tutor produced: sign/HMAC the reply ID from `/api/ask`, or return audio from `/api/ask` itself |
| **Secrets** | `OPENAI_API_KEY` | Server-side only; `.env*` is git-ignored | Use project-scoped keys with only the needed model permissions, rotate them, and use separate keys per environment |
| **Copyright** | Uploaded books | Demo uses public-domain text | Restrict uploads to public-domain or user-owned content, keep each user's uploads private, add terms of use and a takedown process |

---

## Path to a production app

### 1. Bring your own book, with no long wait
- **Ingest:** EPUB (best: chapters and paragraphs are already structured), plain text and DOCX, then PDF with layout-aware extraction (PyMuPDF / `unpdf`) as a stretch. Detect chapters and paragraphs deterministically; use an LLM only to clean up odd cases.
- **"Play in under a minute" pipeline:**
  1. On upload, split the book into scenes (instant) and enqueue jobs.
  2. Generate **scenes 1–2 first**, with images and audio in parallel. For the very first scene, use a fast image model (e.g. `gpt-image-1-mini` or Flux schnell, about 2–5 s) and show the text with a soft placeholder image until the art lands.
  3. Start playback as soon as scene 1's audio and timings exist, which takes about 30–60 s.
  4. Workers keep generating **N scenes ahead of the reader** (e.g. 3–5), prioritising the reader's position. They pause if the reader stops, which saves cost on books that are abandoned.
  5. The client subscribes to progress (SSE/WebSocket). If the reader catches up, show "illustrating the next part…" and keep narrating text-only if needed.
- **Infrastructure for this:**
  - a job queue and workers outside serverless timeouts (Inngest / Trigger.dev / a small worker on Fly or Render with BullMQ + Redis);
  - **object storage + CDN** for images and audio (S3/R2 + CloudFront, or Vercel Blob) instead of git;
  - **Postgres** (Neon/Supabase) for books, scenes, jobs, users and progress.
- **Caching and sharing:** content-hash each scene so popular public-domain books are generated once and shared by every user.

### 2. Better tutor experience
- **Realtime voice** (speech-to-speech) for Page, with barge-in: interrupt the tutor mid-answer just by speaking. Keep structured actions via tool calls.
- A fast-first answer with optional deep research (see trade-offs), plus a spoken filler while thinking.
- Stream the LLM reply into TTS sentence by sentence to cut time-to-voice to under 1 s.
- **Memory per reader:** words they asked about, their level, their native language. These drive personalised Simple-English levels (A1/A2/B1) and vocabulary review flashcards with spaced repetition.
- Comprehension check-ins at chapter ends ("What do you think Alice will do?"), with gentle feedback.

### 3. Richer "animation"
- Image-to-video clips (a few seconds) for key moments only, generated in the background. Video costs about 10–50× an image per scene.
- Character reference images (or a fine-tuned style/LoRA) for stronger consistency.
- Multiple images per long scene, timed to paragraphs.
- Distinct voices for characters' dialogue (multi-speaker TTS).

### 4. Accessibility and learning
- Narration in other languages (translated text + timings) and bilingual side-by-side mode.
- Dyslexia-friendly font toggle, adjustable text size and line spacing, and high-contrast and dark themes.
- Full keyboard and screen-reader support for every control; captions are already text.
- Teacher/parent dashboards for classroom use.

### 5. Production hardening
- Auth (Clerk / Auth.js), per-user quotas and billing (Stripe) for generation.
- The security next steps above (rate limits, moderation, signed TTS requests).
- Observability: request tracing (latency per model), error tracking (Sentry), cost dashboards per book and per user.
- Tests:
  - unit tests for timing helpers (`sentenceRange`, `captionRange`, alignment);
  - Playwright end-to-end tests for play → ask → resume, the scene boundary case, and voice switching;
  - an automatic alignment-quality gate in the build pipeline.
- Evals for the tutor: a fixed set of listener questions with expected actions and answer-quality grading, run whenever prompts or models change.

---

## Run locally

```bash
npm install
echo 'OPENAI_API_KEY=sk-...' > .env.local
npm run dev            # http://localhost:3000
```

### Regenerate or extend the book

Needs `ffmpeg` and `ffprobe` installed locally.

```bash
OPENAI_IMAGE_MODEL=gpt-image-2 npm run build:book     # CHAPTERS=2 by default, + EXTRA_VOICES=coral,ash
CHAPTERS=1 MAX_SCENES=2 EXTRA_VOICES= npm run build:book   # quick test
DRY=1 npm run build:book                              # just print the scene split
```

Every generated file is reused on re-runs. Delete a file in `public/books/alice/` or `.cache/alice/` to regenerate it.

## Deploy (Vercel)

1. Push to GitHub, then **Import project** in Vercel.
2. Add `OPENAI_API_KEY`.
3. Deploy. **Set a monthly usage limit in the OpenAI dashboard**, since the API routes are public (see [Security](#security-prompt-injection-and-abuse)).
   - Add authentication or distributed rate limiting before sharing it broadly.

### Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `OPENAI_API_KEY` | (required) | everything |
| `OPENAI_MODEL` | `gpt-4.1-mini` | book build, `/api/ask`, `/api/define` |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | build narration, `/api/tts` |
| `OPENAI_TUTOR_VOICE` | `coral` | `/api/tts` fallback voice |
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe` | `/api/transcribe` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | build (we used `gpt-image-2`) |
| `OPENAI_VOICE` / `EXTRA_VOICES` | `fable` / `coral,ash` | build: default and extra narrator voices |
