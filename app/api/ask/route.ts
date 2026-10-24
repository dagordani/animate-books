import { NextResponse } from "next/server";
import { BOOKS } from "@/lib/books";
import { sentenceText, tokenAt, type Mode } from "@/lib/book";
import { TUTOR_AGENT_MODEL, TUTOR_AGENT_SPEND_LIMIT_CENTS, openai } from "@/lib/openai";

export const runtime = "nodejs";
// Agent runs can include research and sandbox work; Vercel supports this App
// Router setting for the route's serverless invocation.
export const maxDuration = 180;

type Msg = { role: "user" | "assistant"; content: string };

const ACTIONS = ["resume", "reread_sentence", "reread_scene", "goto_scene", "switch_simple", "switch_original", "stay_paused"] as const;

const tutorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "action", "sceneIndex"],
  properties: {
    reply: { type: "string" },
    action: { type: "string", enum: [...ACTIONS] },
    sceneIndex: { type: ["integer", "null"] },
  },
};

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
The listener paused the narration to talk to you. You have a managed sandbox and web search: use them when they would make an answer more accurate or useful. You may investigate, write code, and run small experiments before answering, but never mention your private work or tools to the listener. Your reply will be SPOKEN aloud, so:
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
    const input = [
      context,
      "RECENT CONVERSATION:",
      ...history.slice(-8).map((m) => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 1000)}`),
      `LISTENER'S QUESTION: ${question.slice(0, 1000)}`,
      "Return only the JSON object that matches the requested schema.",
    ].join("\n\n");
    const stream = await openai.beta.agents.sessions.create({
      stream: true,
      environment: {
        type: "openai_hosted",
        network: { access: "enabled" },
      },
      spend_control: { limit: TUTOR_AGENT_SPEND_LIMIT_CENTS },
      agent: {
        model: TUTOR_AGENT_MODEL,
        instructions: system,
        reasoning: { effort: "medium" },
        text: { verbosity: "low", format: { type: "json_schema", schema: tutorSchema } },
        tools: [{ type: "web_search" }, { type: "programmatic_tool_calling" }],
        multi_agent: { enabled: true, max_concurrent_subagents: 2 },
      },
      input,
    });
    const result = await stream.finalResult();
    try {
      return NextResponse.json(JSON.parse(result.output_text));
    } finally {
      // Each request currently creates an ephemeral session, so retain neither
      // the conversation nor its hosted sandbox after its final answer.
      await openai.beta.agents.sessions.delete(result.session_id).catch((error) => {
        console.error("Failed to delete completed tutor agent session", error);
      });
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ reply: "Sorry, I lost my place for a second. Could you ask me again?", action: "stay_paused", sceneIndex: null });
  }
}
