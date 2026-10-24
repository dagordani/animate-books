import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "missing" });
export const LLM = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
// The reading companion uses the managed Agents API. Keep LLM above for the
// lightweight book-building and word-definition calls.
export const TUTOR_AGENT_MODEL = process.env.OPENAI_TUTOR_AGENT_MODEL ?? "gpt-6-astra";
export const TTS = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
export const TUTOR_VOICE = process.env.OPENAI_TUTOR_VOICE ?? "coral";
export const STT = process.env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe";
