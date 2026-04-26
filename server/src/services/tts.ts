import OpenAI from "openai";
import { config } from "../config.js";

const openai = config.openaiKey
  ? new OpenAI({ apiKey: config.openaiKey })
  : null;

/**
 * Synthesize speech; returns base64 audio/mpeg (fast path for <3s target).
 * ElevenLabs can be added behind the same function with TTS_ENGINE=elevenlabs.
 */
export async function textToSpeechBase64(
  text: string,
  voice: "alloy" | "onyx" | "nova" = "onyx"
): Promise<{ base64: string; mime: string; error?: string }> {
  if (!text.trim()) {
    return { base64: "", mime: "audio/mpeg", error: "empty text" };
  }
  if (!openai) {
    return { base64: "", mime: "audio/mpeg", error: "TTS: OpenAI not configured" };
  }
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    response_format: "mp3",
  });
  const buf = Buffer.from(await mp3.arrayBuffer());
  return { base64: buf.toString("base64"), mime: "audio/mpeg" };
}
