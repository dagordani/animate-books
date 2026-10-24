# Animate Books

Illustrated, narrated books with a reading buddy ("Page") you can interrupt at any time. It's built for people who find it hard to focus on a page and for second-language readers.

- **Watch and listen:** each part of the story has an AI illustration with a slow pan/zoom and a narrator. Words highlight karaoke-style as they're read.
- **Interrupt anytime:** tap **Ask** and speak (or type), e.g. "what does that mean?", "read that again", "simpler please". Page answers out loud, then resumes from the sentence you were on.
- **Made for learners:** switch between Original and Simple English, choose 0.75×/1×/1.25× speed, Cinema (subtitles) or Read-along view, and tap any word for a definition plus a translation into your language.

## How it works

Everything about the book is **pre-generated** by `scripts/build-book.ts` and committed under `public/books/<id>/`:

1. Download the public-domain text (Project Gutenberg) and split it into scenes of about 1–3 paragraphs.
2. An LLM writes a Simple-English version, a summary, a glossary and an image prompt for each scene.
3. An image model draws each scene, using a fixed style and a character sheet for consistency.
4. TTS narrates both versions. Whisper word timestamps are then aligned back to the text, which drives highlighting, "read that again" seeks and resume points.

At runtime, only the conversation calls OpenAI, through Next.js API routes:

| Route | Purpose |
| --- | --- |
| `POST /api/ask` | Tutor: gets the current scene, the sentence being read, the story so far and the chat. Returns `{reply, action}` where action is `resume`, `reread_sentence`, `reread_scene`, `goto_scene`, `switch_simple`, `switch_original` or `stay_paused`. |
| `POST /api/tts` | Speaks the tutor's reply. |
| `POST /api/transcribe` | Push-to-talk audio → text. |
| `POST /api/define` | Tap-a-word definition and translation. |

The client player (`components/Player.tsx`) is a small state machine: `idle → playing ⇄ paused → listening → thinking → speaking → (action) → playing…`.

## Run locally

```bash
npm install
echo 'OPENAI_API_KEY=sk-...' > .env.local
npm run dev
```

### Regenerate or extend the book

Needs `ffmpeg` installed locally. Costs roughly $2–4 for two chapters.

```bash
OPENAI_IMAGE_MODEL=gpt-image-2 npm run build:book           # CHAPTERS=2 by default
CHAPTERS=1 MAX_SCENES=2 npm run build:book                  # quick test
```

Generated files are reused on re-runs. Delete a file in `public/books/alice/` or `.cache/` to regenerate it.

## Deploy (Vercel)

1. Push to GitHub, then **Import project** in Vercel.
2. Add the `OPENAI_API_KEY` environment variable.
3. Deploy. Set a monthly usage limit in your OpenAI dashboard, since the API routes are public.

Optional env vars: `OPENAI_MODEL` (default `gpt-4.1-mini`), `OPENAI_TTS_MODEL` (`gpt-4o-mini-tts`), `OPENAI_TUTOR_VOICE` (`coral`), `OPENAI_STT_MODEL` (`gpt-4o-mini-transcribe`).
