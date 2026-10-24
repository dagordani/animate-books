import { NextResponse } from "next/server";
import { BOOKS } from "@/lib/books";
import { sentenceText, tokenAt, type Mode } from "@/lib/book";
import { LLM, openai } from "@/lib/openai";

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant"; content: string };

const ACTIONS = ["resume", "reread_sentence", "reread_scene", "goto_scene", "switch_simple", "switch_original", "stay_paused"] as const;

export async function POST(req: Request) {
  const { bookId, sceneIndex, mode, time, question, history = [], lang, heard } = (await req.json()) as {
    bookId: string;
    sceneIndex: number;
    mode: Mode;
    time: number;
    question: string;
    history?: Msg[];
    lang?: string;
    /** What the listener actually heard around the interruption (client knows the narrator voice/timings). */
    heard?: { recent?: string; current?: string; next?: string };
  };
  const book = BOOKS[bookId];
  const scene = book?.scenes[sceneIndex];
  if (!scene || !question?.trim()) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const track = scene[mode] ?? scene.orig;
  const current = heard?.current?.slice(0, 1500) || sentenceText(track.tokens, tokenAt(track.tokens, time));
  const prev = book.scenes[sceneIndex - 1];
  const storySoFar = book.scenes
    .slice(0, sceneIndex)
    .map((s) => `#${s.index} ${s.summary}`)
    .join("\n");
  const sceneList = book.scenes.map((s) => `#${s.index} (ch.${s.chapter}) ${s.summary}`).join("\n");

  const system = `You are Page, a warm, encouraging reading companion inside an app that narrates "${book.title}" by ${book.author} with illustrations.
The listener paused the narration to talk to you. Your reply will be SPOKEN aloud, so:
- Keep it short: 1-3 sentences (max ~60 words). No lists, no markdown, no emojis.
- Use simple, friendly English. ${lang && lang !== "English" ? `The listener's native language is ${lang}: when explaining a word or idea, also give the ${lang} translation, and answer fully in ${lang} if they write in ${lang}.` : ""}
- Stay about the book. If asked something off-topic, kindly steer back to the story in one sentence (action "stay_paused").
- Never spoil events after the current scene.
- Questions like "what does that mean?" or "read that again" almost always refer to the marked sentence or the lines just before it, even across a scene change.

Pick ONE action to happen after your reply. For reread_*, goto_scene and switch_* the narrator does the work, so your reply must be ONLY a short acknowledgement (max 10 words, e.g. "Sure, here it is again." / "Okay, let's try simpler words."), never retell the text yourself.
- "resume": continue the story from the current sentence (use when the question is answered; end your reply with a short bridge like "Let's keep going!").
- "reread_sentence": they want the last sentence again.
- "reread_scene": they want this whole part again / from the beginning of the scene.
- "goto_scene": they want to jump to another scene; set sceneIndex. Only scenes up to #${book.scenes.length - 1} exist.
- "switch_simple": they find the text hard / want simpler English (story continues in simple mode).
- "switch_original": they want the original wording again.
- "stay_paused": your answer invites a follow-up, or they asked you to wait/stop.

All scenes:
${sceneList}`;

  const context = `STORY SO FAR:
${storySoFar || "(this is the first scene)"}

PREVIOUS SCENE TEXT:
${prev ? prev.orig.paragraphs.join("\n") : "(none)"}

CURRENT SCENE #${scene.index} (chapter ${scene.chapter}: ${scene.chapterTitle}), reading in ${mode === "simple" ? "SIMPLE English" : "ORIGINAL text"}:
${track.paragraphs.join("\n")}

WHAT THE LISTENER JUST HEARD (oldest first; "[new scene]" marks a scene change):
${heard?.recent ? heard.recent.slice(0, 2000) + "\n" : ""}>>> "${current}"   <-- sentence they were on when they paused${heard?.next ? `\n(After that, the narrator had just started the next scene: "${heard.next.slice(0, 400)}")` : ""}`;

  try {
    const res = await openai.chat.completions.create({
      model: LLM,
      temperature: 0.5,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tutor",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["reply", "action", "sceneIndex"],
            properties: {
              reply: { type: "string" },
              action: { type: "string", enum: [...ACTIONS] },
              sceneIndex: { type: ["integer", "null"] },
            },
          },
        },
      },
      messages: [
        { role: "system", content: system },
        { role: "system", content: context },
        ...history.slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1000) })),
        { role: "user", content: question.slice(0, 1000) },
      ],
    });
    return NextResponse.json(JSON.parse(res.choices[0].message.content!));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ reply: "Sorry, I lost my place for a second. Could you ask me again?", action: "stay_paused", sceneIndex: null });
  }
}
