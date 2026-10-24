import { NextResponse } from "next/server";
import { toFile } from "openai";
import { STT, openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ text: "" });
  if (audio.size > 10_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const t = audio.type;
  const ext = t.includes("mp4") || t.includes("m4a") ? "mp4" : t.includes("ogg") ? "ogg" : t.includes("mpeg") ? "mp3" : t.includes("wav") ? "wav" : "webm";
  try {
    const tr = await openai.audio.transcriptions.create({
      file: await toFile(audio, `question.${ext}`, { type: t || "audio/webm" }),
      model: STT,
      prompt: "A listener asking a question about Alice's Adventures in Wonderland.",
    });
    return NextResponse.json({ text: tr.text });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ text: "", error: "transcription failed" }, { status: 502 });
  }
}
