/**
 * Pre-generates a book: scenes, simple-English rewrites, illustrations, narration audio
 * and word-level timings. Run locally once:
 *
 *   OPENAI_API_KEY=... npx tsx scripts/build-book.ts            # chapters 1-2
 *   CHAPTERS=1 MAX_SCENES=4 npx tsx scripts/build-book.ts       # quick test
 *
 * Re-runs skip any asset that already exists on disk (delete a file to regenerate it).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import type { Book, Scene, Token, Track, VoiceTracks } from "../lib/book";

const BOOK_ID = "alice";
const SOURCE_URL = "https://www.gutenberg.org/cache/epub/11/pg11.txt";
const CHAPTERS = Number(process.env.CHAPTERS ?? 2);
const MAX_SCENES = Number(process.env.MAX_SCENES ?? 999);
const SCENE_CHARS = 1100;

const LLM = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const TTS = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = process.env.OPENAI_VOICE ?? "fable"; // default narrator, embedded in book.json
// Extra narrator voices: timings go to tracks/<voice>.json, audio to audio/<voice>/.
const EXTRA_VOICES = (process.env.EXTRA_VOICES ?? "coral,ash").split(",").filter(Boolean);
const IMAGE = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";

const OUT = path.join(process.cwd(), "public", "books", BOOK_ID);
const CACHE = path.join(process.cwd(), ".cache", BOOK_ID);

const STYLE =
  "Soft watercolor and ink storybook illustration, inspired by classic Victorian book art, warm golden palette, gentle light, whimsical, detailed but uncluttered, cinematic wide composition, no text, no letters, no captions.";
const CHARACTER_SHEET: Record<string, string> = {
  Alice:
    "Alice: a 7-year-old girl with long straight blonde hair held by a black headband, light-blue knee-length dress, white pinafore apron, white stockings, black shoes.",
  Rabbit:
    "White Rabbit: a white rabbit with pink eyes standing upright, wearing a checked waistcoat and a red jacket, carrying a gold pocket-watch.",
  sister: "Alice's sister: a teenage girl with brown hair in a lavender dress, reading a book.",
  Mouse: "The Mouse: a small grey-brown field mouse.",
};
const CHARACTERS = Object.values(CHARACTER_SHEET).join(" ");
/** Only the sheet entries for characters the prompt actually mentions (otherwise they all get drawn). */
const charactersIn = (prompt: string) =>
  Object.entries(CHARACTER_SHEET)
    .filter(([k]) => new RegExp(`\\b${k}`, "i").test(prompt))
    .map(([, v]) => v)
    .join(" ");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "missing" });

// ---------- text ----------

type RawScene = { chapter: number; chapterTitle: string; paragraphs: string[] };

async function loadChapters(): Promise<RawScene[]> {
  const raw = await (await fetch(SOURCE_URL)).text();
  const text = raw.replace(/\r\n/g, "\n");
  const body = text.slice(text.indexOf("CHAPTER I.\nDown the Rabbit-Hole"));
  const parts = body.split(/\nCHAPTER [IVXL]+\.\n/).map((s, i) => (i === 0 ? s.replace(/^CHAPTER I\.\n/, "") : s));

  const scenes: RawScene[] = [];
  for (let c = 0; c < CHAPTERS; c++) {
    const [titleLine, ...rest] = parts[c].trim().split("\n");
    const paragraphs = rest
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/_/g, "").trim())
      .filter((p) => p && !/^[*\s]+$/.test(p));

    let cur: string[] = [];
    let len = 0;
    for (const p of paragraphs) {
      if (cur.length && len + p.length > SCENE_CHARS) {
        scenes.push({ chapter: c + 1, chapterTitle: titleLine.trim(), paragraphs: cur });
        cur = [];
        len = 0;
      }
      cur.push(p);
      len += p.length;
    }
    if (cur.length) scenes.push({ chapter: c + 1, chapterTitle: titleLine.trim(), paragraphs: cur });
  }
  return scenes.slice(0, MAX_SCENES);
}

// ---------- LLM enrichment ----------

type Enrichment = {
  simple: string[];
  summary: string;
  imagePrompt: string;
  glossary: { word: string; meaning: string }[];
};

async function enrich(scene: RawScene, prevSummary: string, file: string): Promise<Enrichment> {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await openai.chat.completions.create({
    model: LLM,
    temperature: 0.4,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scene",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["simple", "summary", "imagePrompt", "glossary"],
          properties: {
            simple: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
            imagePrompt: { type: "string" },
            glossary: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["word", "meaning"],
                properties: { word: { type: "string" }, meaning: { type: "string" } },
              },
            },
          },
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You adapt classic books for English learners (CEFR A2-B1) and readers who struggle to focus. " +
          "Return JSON with:\n" +
          "- simple: the SAME number of paragraphs as the input, each rewritten in simple, clear modern English (short sentences, common words) while keeping the story, dialogue and charm. Do not add events.\n" +
          "- summary: one sentence of what happens in this scene.\n" +
          "- imagePrompt: a vivid visual description of ONE key moment of this scene for an illustrator (setting, characters, action, mood, camera framing). Refer to characters by name (e.g. 'Alice', 'the White Rabbit') and describe them using this sheet; only include characters actually present in the moment: " +
          CHARACTERS +
          "\n- glossary: 3-6 words or phrases from the ORIGINAL text that a learner may not know, with a short simple meaning in context.",
      },
      {
        role: "user",
        content: `Story so far: ${prevSummary || "(beginning of the book)"}\n\nChapter: ${scene.chapterTitle}\n\nParagraphs:\n${scene.paragraphs
          .map((p, i) => `[${i + 1}] ${p}`)
          .join("\n\n")}`,
      },
    ],
  });
  const data = JSON.parse(res.choices[0].message.content!) as Enrichment;
  // Keep paragraph counts aligned so mode switching can map paragraph -> paragraph.
  if (data.simple.length !== scene.paragraphs.length) {
    const joined = data.simple.join(" ");
    data.simple = data.simple.length > scene.paragraphs.length ? [joined] : data.simple;
    while (data.simple.length < scene.paragraphs.length) data.simple.push("");
    data.simple = data.simple.slice(0, scene.paragraphs.length);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

// ---------- images ----------

async function makeImage(prompt: string, file: string) {
  if (fs.existsSync(file)) return;
  const res = await openai.images.generate({
    model: IMAGE,
    prompt: `${STYLE}\n\nScene: ${prompt}\n\nCharacter reference (keep consistent; draw ONLY characters named in the scene): ${charactersIn(prompt) || "none"}`,
    size: "1536x1024",
    quality: "medium",
    n: 1,
  });
  const buf = Buffer.from(res.data![0].b64_json!, "base64");
  await sharp(buf).resize(1440).webp({ quality: 72 }).toFile(file);
}

async function makeThumb(src: string, file: string) {
  if (!fs.existsSync(file)) await sharp(src).resize(360).webp({ quality: 60 }).toFile(file);
}

// ---------- narration + alignment ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]/gu, "");

async function narrate(paragraphs: string[], file: string, timingsFile: string, simple: boolean, voice = VOICE): Promise<Track> {
  const text = paragraphs.filter(Boolean).join("\n\n");
  if (!fs.existsSync(file)) {
    // TTS sometimes stops early on long inputs, so narrate paragraph by paragraph, check each
    // clip's length against its word count, then join them with a short pause.
    const parts: string[] = [];
    for (const [i, para] of paragraphs.filter(Boolean).entries()) {
      const part = `${file}.${i}.tmp.mp3`;
      const minSecs = para.split(/\s+/).length / 4.5;
      for (let attempt = 0; ; attempt++) {
        const speech = await openai.audio.speech.create({
          model: TTS,
          voice,
          input: para,
          response_format: "mp3",
          instructions: simple
            ? "You are a warm, patient storyteller reading to someone learning English. Speak clearly and a little slowly, with gentle expression and short pauses between sentences."
            : `You are a warm, expressive audiobook narrator reading a classic children's story. Use a gentle${voice === "fable" ? " British" : ""} storytelling tone, give characters a little voice, and keep a calm, steady pace.`,
        });
        fs.writeFileSync(part, Buffer.from(await speech.arrayBuffer()));
        const secs = probeDuration(part);
        if (secs >= minSecs || attempt >= 3) break;
        console.log(`    TTS clip too short (${secs.toFixed(1)}s < ${minSecs.toFixed(1)}s), retrying`);
      }
      parts.push(part);
    }
    const inputs = parts.flatMap((p) => ["-i", p]);
    const filter = parts.map((_, i) => `[${i}:a]apad=pad_dur=0.45[a${i}];`).join("") + parts.map((_, i) => `[a${i}]`).join("") + `concat=n=${parts.length}:v=0:a=1[out]`;
    // Mono 48 kbps is plenty for speech and keeps the repo/deploy small.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-b:a", "48k", file]);
    parts.forEach((p) => fs.unlinkSync(p));
  }

  let words: { word: string; start: number; end: number }[];
  let duration: number;
  if (fs.existsSync(timingsFile)) {
    ({ words, duration } = JSON.parse(fs.readFileSync(timingsFile, "utf8")));
  } else {
    const expected = text.split(/\s+/).length;
    // Whisper occasionally truncates long clips; retry with/without a prompt until most words come back.
    // Whisper occasionally truncates or hallucinates; try a few strategies and keep the one that aligns best.
    let best = { words: [] as typeof words, duration: 0, matched: -1 };
    const strategies: (string | undefined | "chunked")[] = [text.slice(0, 800), undefined, "A story read aloud.", "chunked"];
    for (const strat of strategies) {
      let w: typeof words;
      let d = best.duration;
      if (strat === "chunked") {
        console.log(`    transcribing ${path.basename(file)} in chunks`);
        w = await transcribeChunked(file);
        d = d || probeDuration(file);
      } else {
        const tr = await openai.audio.transcriptions.create({
          file: await toFile(fs.readFileSync(file), path.basename(file), { type: "audio/mpeg" }),
          model: "whisper-1",
          response_format: "verbose_json",
          timestamp_granularities: ["word"],
          ...(strat ? { prompt: strat } : {}),
        });
        w = (tr.words ?? []).map((x) => ({ word: x.word, start: x.start, end: x.end }));
        d = tr.duration;
      }
      const { matched } = align(paragraphs, w);
      if (matched > best.matched) best = { words: w, duration: d, matched };
      if (matched >= expected * 0.9) break;
      console.log(`    retrying transcription of ${path.basename(file)} (aligned ${matched}/${expected})`);
    }
    ({ words, duration } = best);
    fs.writeFileSync(timingsFile, JSON.stringify({ words, duration }));
  }

  const { tokens, matched } = align(paragraphs, words);
  console.log(`    aligned ${matched}/${tokens.length} tokens`);

  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    paragraphs,
    audio: "/" + path.relative(path.join(process.cwd(), "public"), file).split(path.sep).join("/"),
    duration: r(duration),
    tokens: tokens.map(({ t, s, e, p }) => ({ t, s: r(s), e: r(e), p })),
  };
}

/** Align displayed tokens (with punctuation) to transcribed words; unmatched tokens are interpolated. */
function align(paragraphs: string[], words: { word: string; start: number; end: number }[]) {
  const tokens: (Token & { ok: boolean })[] = [];
  paragraphs.forEach((para, p) =>
    para
      .split(/\s+/)
      .filter(Boolean)
      .forEach((t) => tokens.push({ t, s: 0, e: 0, p, ok: false })),
  );
  let j = 0;
  for (const tok of tokens) {
    const n = norm(tok.t);
    if (!n) continue;
    search: for (let k = 0; k < 6 && j + k < words.length; k++) {
      let acc = "";
      for (let m = 0; m < 4 && j + k + m < words.length; m++) {
        acc += norm(words[j + k + m].word);
        if (acc === n) {
          tok.s = words[j + k].start;
          tok.e = words[j + k + m].end;
          tok.ok = true;
          j = j + k + m + 1;
          break search;
        }
        if (!n.startsWith(acc)) break;
      }
    }
  }
  // Interpolate unmatched tokens between their matched neighbours.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].ok) continue;
    const prev = tokens.slice(0, i).reverse().find((x) => x.ok);
    const next = tokens.slice(i + 1).find((x) => x.ok);
    tokens[i].s = prev ? prev.e : 0;
    tokens[i].e = next ? next.s : prev ? prev.e + 0.3 : 0.3;
  }
  const matched = tokens.filter((t) => t.ok).length;
  return { tokens, matched };
}

/** Fallback for clips Whisper truncates: transcribe fixed 15 s chunks and offset their timestamps. */
async function transcribeChunked(file: string, seg = 15) {
  const dir = fs.mkdtempSync(path.join(CACHE, "chunks-"));
  execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-f", "segment", "-segment_time", String(seg), "-ac", "1", "-b:a", "48k", `${dir}/%03d.mp3`]);
  const out: { word: string; start: number; end: number }[] = [];
  for (const [i, f] of fs.readdirSync(dir).sort().entries()) {
    const tr = await openai.audio.transcriptions.create({
      file: await toFile(fs.readFileSync(`${dir}/${f}`), f, { type: "audio/mpeg" }),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
    for (const w of tr.words ?? []) out.push({ word: w.word, start: w.start + i * seg, end: w.end + i * seg });
  }
  fs.rmSync(dir, { recursive: true });
  return out;
}

function probeDuration(file: string) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

// ---------- main ----------

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function main() {
  for (const d of [OUT, `${OUT}/img`, `${OUT}/audio`, CACHE]) fs.mkdirSync(d, { recursive: true });
  const raw = await loadChapters();
  console.log(`${raw.length} scenes from ${CHAPTERS} chapter(s)`);
  if (process.env.DRY) {
    raw.forEach((r, i) => console.log(i, r.chapterTitle, r.paragraphs.join(" ").length, r.paragraphs[0].slice(0, 60)));
    return;
  }

  // Enrichment runs sequentially so each scene knows the story so far.
  const enriched: Enrichment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const prev = enriched.map((e) => e.summary).slice(-4).join(" ");
    console.log(`enrich ${i + 1}/${raw.length}`);
    enriched.push(await enrich(raw[i], prev, `${CACHE}/scene-${i}.json`));
  }

  const scenes: Scene[] = new Array(raw.length);
  await pool(raw, 4, async (rs, i) => {
    const e = enriched[i];
    const id = `s${String(i).padStart(2, "0")}`;
    console.log(`assets ${id}`);
    const img = `${OUT}/img/${id}.webp`;
    const [, orig, simple] = await Promise.all([
      makeImage(e.imagePrompt, img),
      narrate(rs.paragraphs, `${OUT}/audio/${id}-orig.mp3`, `${CACHE}/${id}-orig.words.json`, false),
      narrate(e.simple, `${OUT}/audio/${id}-simple.mp3`, `${CACHE}/${id}-simple.words.json`, true),
    ]);
    await makeThumb(img, `${OUT}/img/${id}-thumb.webp`);
    scenes[i] = {
      id,
      index: i,
      chapter: rs.chapter,
      chapterTitle: rs.chapterTitle,
      summary: e.summary,
      image: `/books/${BOOK_ID}/img/${id}.webp`,
      thumb: `/books/${BOOK_ID}/img/${id}-thumb.webp`,
      glossary: e.glossary,
      orig,
      simple,
    };
  });

  const book: Book = {
    id: BOOK_ID,
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    blurb: "A curious girl follows a White Rabbit down a hole and into a world where nothing makes sense.",
    scenes,
  };
  fs.writeFileSync(`${OUT}/book.json`, JSON.stringify(book));
  console.log(`wrote ${OUT}/book.json`);

  for (const voice of EXTRA_VOICES) {
    for (const d of [`${OUT}/audio/${voice}`, `${OUT}/tracks`, `${CACHE}/${voice}`]) fs.mkdirSync(d, { recursive: true });
    const tracks: VoiceTracks = {};
    await pool(scenes, 4, async (sc) => {
      console.log(`voice ${voice} ${sc.id}`);
      const [orig, simple] = await Promise.all(
        (["orig", "simple"] as const).map((m) =>
          narrate(sc[m].paragraphs, `${OUT}/audio/${voice}/${sc.id}-${m}.mp3`, `${CACHE}/${voice}/${sc.id}-${m}.words.json`, m === "simple", voice),
        ),
      );
      const strip = ({ audio, duration, tokens }: Track) => ({ audio, duration, tokens });
      tracks[sc.id] = { orig: strip(orig), simple: strip(simple) };
    });
    fs.writeFileSync(`${OUT}/tracks/${voice}.json`, JSON.stringify(tracks));
    console.log(`wrote tracks/${voice}.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
