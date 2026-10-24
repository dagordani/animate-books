import { TTS, TUTOR_VOICE, openai } from "@/lib/openai";

export const runtime = "nodejs";

const VOICES = new Set(["fable", "coral", "ash"]);

async function speak(text: string | null, voice: string | null) {
  if (!text?.trim()) return new Response("missing text", { status: 400 });
  try {
    const speech = await openai.audio.speech.create({
      model: TTS,
      voice: voice && VOICES.has(voice) ? voice : TUTOR_VOICE,
      input: text.slice(0, 1200),
      response_format: "mp3",
      instructions: "Friendly, warm, encouraging reading tutor. Speak clearly at a relaxed pace.",
    });
    // Pass the body through untouched so the browser can start playing the first bytes.
    return new Response(speech.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}

/** GET is used directly as an <audio src> so playback streams. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return speak(q.get("text"), q.get("voice"));
}

export async function POST(req: Request) {
  const { text, voice } = (await req.json()) as { text: string; voice?: string };
  return speak(text, voice ?? null);
}
