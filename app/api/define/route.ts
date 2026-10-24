import { NextResponse } from "next/server";
import { LLM, openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { word, sentence, lang } = (await req.json()) as { word: string; sentence: string; lang?: string };
  if (!word?.trim()) return NextResponse.json({ error: "missing word" }, { status: 400 });
  try {
    const res = await openai.chat.completions.create({
      model: LLM,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "definition",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["word", "partOfSpeech", "meaning", "example", "translation"],
            properties: {
              word: { type: "string" },
              partOfSpeech: { type: "string" },
              meaning: { type: "string" },
              example: { type: "string" },
              translation: { type: "string" },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: `You are a learner's dictionary. Define the word AS USED in the given sentence, in very simple English (max 20 words). Give a short new everyday example sentence. "translation" is the word's meaning in ${lang && lang !== "English" ? lang : "English (a simple synonym)"}. "word" is the base dictionary form.`,
        },
        { role: "user", content: `Word: ${word.slice(0, 60)}\nSentence: ${String(sentence).slice(0, 600)}` },
      ],
    });
    return NextResponse.json(JSON.parse(res.choices[0].message.content!));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "define failed" }, { status: 502 });
  }
}
