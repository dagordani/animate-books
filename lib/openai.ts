import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "missing" });
export const LLM = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
// The reading companion uses the managed Agents API. Keep LLM above for the
// lightweight book-building and word-definition calls.
export const TUTOR_AGENT_MODEL = process.env.OPENAI_TUTOR_AGENT_MODEL ?? "gpt-6-astra";
const configuredTutorSpendLimit = Number(process.env.OPENAI_TUTOR_AGENT_SPEND_LIMIT_CENTS ?? "100");
// A public-facing endpoint should have a per-session ceiling even when project
// spend limits and rate limiting are configured outside the application.
export const TUTOR_AGENT_SPEND_LIMIT_CENTS =
  Number.isFinite(configuredTutorSpendLimit) && configuredTutorSpendLimit > 0 ? Math.floor(configuredTutorSpendLimit) : 100;
export const TTS = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
export const TUTOR_VOICE = process.env.OPENAI_TUTOR_VOICE ?? "coral";
export const STT = process.env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe";
