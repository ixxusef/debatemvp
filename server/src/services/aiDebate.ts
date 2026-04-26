import OpenAI from "openai";
import { config } from "../config.js";
import type { Difficulty } from "@prisma/client";

const openai = config.openaiKey
  ? new OpenAI({ apiKey: config.openaiKey })
  : null;

const difficultyStyle: Record<Difficulty, string> = {
  FRIENDLY: "Stay respectful and constructive; you may point out issues gently.",
  NEUTRAL: "Be firm but not personal; refute on substance.",
  AGGRESSIVE: "Be sharp, fast, and unrelenting; challenge every weak premise without insults or slurs.",
  EXPERT: "Use precise, technical debate tactics; name fallacies, demand evidence, and structure rebuttals like a high-level competitor.",
};

export function buildDebateSystemPrompt(
  topic: string,
  difficulty: Difficulty,
  userPosition: "affirm" | "negate" | "unknown" = "unknown"
): string {
  const d = difficultyStyle[difficulty];
  const pos =
    userPosition === "affirm"
      ? "The user is arguing FOR the resolution. You must argue against it."
      : userPosition === "negate"
        ? "The user is arguing AGAINST the resolution. You must argue in favor of it (switch sides to oppose the user’s stance)."
        : "Infer the user’s stance from their lines and take the opposite side. Never agree with their conclusion mid-debate.";

  return `You are DebateAI, a skilled debate opponent in a live practice session.

Topic / resolution: "${topic}"

${pos}

Rules:
- ${d}
- Argue the opposing position at all times. Do not concede the debate or agree with the user’s core claim.
- You may name logical fallacies when present (e.g. straw man, ad hominem, false dichotomy, hasty generalization, appeal to emotion, red herring, slippery slope) and briefly explain.
- If the user makes a factual claim that is uncertain or false, call it out and request evidence; offer a short correction when appropriate.
- Keep your reply under ~120 words so it can be read aloud in under 30 seconds.
- Be concise, clear, and debate-focused. No preambles like "As an AI", no apologies for disagreeing.`;
}

export type TranscriptLine = { role: "user" | "assistant"; text: string; t?: number };

export async function generateDebateResponse(args: {
  topic: string;
  difficulty: Difficulty;
  history: TranscriptLine[];
}): Promise<{ text: string; error?: string }> {
  if (!openai) {
    return { text: "", error: "OpenAI is not configured." };
  }
  const system = buildDebateSystemPrompt(args.topic, args.difficulty);
  const historyMessages = args.history
    .filter((h) => h.text.trim())
    .map((h) => ({
      role: h.role === "user" ? ("user" as const) : ("assistant" as const),
      content: h.text,
    }));
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.75,
    max_tokens: 500,
    messages: [{ role: "system" as const, content: system }, ...historyMessages],
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!text) return { text: "", error: "Empty model response" };
  return { text };
}

export type ScorecardResult = {
  argumentStrength: number;
  fallacies: { name: string; example?: string; explanation: string }[];
  missedCounterarguments: string[];
  persuasion: number;
  overallGrade: string;
  overallFeedback: string;
};

export async function generateScorecard(args: {
  topic: string;
  difficulty: Difficulty;
  transcript: TranscriptLine[];
}): Promise<ScorecardResult> {
  if (!openai) {
    return {
      argumentStrength: 0,
      fallacies: [],
      missedCounterarguments: [],
      persuasion: 0,
      overallGrade: "N/A",
      overallFeedback: "Scoring is unavailable: OpenAI is not configured.",
    };
  }
  const t = args.transcript
    .map((l) => `${l.role.toUpperCase()}: ${l.text}`)
    .join("\n");
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system" as const,
        content: `You are a debate coach. Given the topic, difficulty, and transcript, output ONLY valid JSON with:
{
  "argumentStrength": 1-10 (integer),
  "fallacies": [{ "name": string, "example"?: string, "explanation": string }],
  "missedCounterarguments": string[] (1-5 key angles the user could have addressed),
  "persuasion": 1-10 (integer),
  "overallGrade": string (letter A-F with optional + or -),
  "overallFeedback": string (2-4 sentences, specific and encouraging)
}
Topic: ${args.topic}
Difficulty: ${args.difficulty}`,
      },
      { role: "user" as const, content: `Transcript:\n${t}` },
    ],
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) {
    return {
      argumentStrength: 5,
      fallacies: [],
      missedCounterarguments: [],
      persuasion: 5,
      overallGrade: "?",
      overallFeedback: "Could not parse scorecard.",
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ScorecardResult>;
    return {
      argumentStrength: clampInt(parsed.argumentStrength, 1, 10, 5),
      fallacies: Array.isArray(parsed.fallacies) ? parsed.fallacies : [],
      missedCounterarguments: Array.isArray(parsed.missedCounterarguments)
        ? parsed.missedCounterarguments
        : [],
      persuasion: clampInt(parsed.persuasion, 1, 10, 5),
      overallGrade: typeof parsed.overallGrade === "string" ? parsed.overallGrade : "?",
      overallFeedback:
        typeof parsed.overallFeedback === "string" ? parsed.overallFeedback : "",
    };
  } catch {
    return {
      argumentStrength: 5,
      fallacies: [],
      missedCounterarguments: [],
      persuasion: 5,
      overallGrade: "?",
      overallFeedback: "Invalid scorecard JSON.",
    };
  }
}

function clampInt(n: unknown, a: number, b: number, d: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return d;
  return Math.max(a, Math.min(b, Math.round(n)));
}
