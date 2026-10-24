import { TTS, TUTOR_VOICE, openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return new Response("missing text", { status: 400 });
  try {
    const speech = await openai.audio.speech.create({
      model: TTS,
      voice: TUTOR_VOICE,
      input: text.slice(0, 1200),
      response_format: "mp3",
      instructions: "Friendly, warm, encouraging reading tutor. Speak clearly at a relaxed pace.",
    });
    return new Response(speech.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}
