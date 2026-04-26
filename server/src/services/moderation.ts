import OpenAI from "openai";
import { config } from "../config.js";

const openai = config.openaiKey
  ? new OpenAI({ apiKey: config.openaiKey })
  : null;

export type ModerationResult = { safe: true } | { safe: false; reason: string };

/**
 * Block abusive or policy-violating user content before the debate AI is invoked.
 */
export async function moderateUserText(text: string): Promise<ModerationResult> {
  const trimmed = text.trim();
  if (!trimmed) return { safe: true };
  if (!openai) {
    return { safe: true };
  }
  const res = await openai.moderations.create({ model: "omni-moderation-latest", input: trimmed });
  const top = res.results[0];
  if (!top) return { safe: true };
  if (top.flagged) {
    const cats = Object.entries(top.categories)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return { safe: false, reason: `Content policy: ${cats.join(", ") || "flagged"}` };
  }
  return { safe: true };
}
