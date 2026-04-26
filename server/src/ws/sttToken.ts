import { randomBytes } from "node:crypto";

const tokens = new Map<string, { userId: string; sessionId: string; exp: number }>();
const TTL_MS = 5 * 60 * 1_000;

export function createSttToken(userId: string, sessionId: string): { token: string; expiresInSec: number } {
  const token = randomBytes(24).toString("base64url");
  const exp = Date.now() + TTL_MS;
  tokens.set(token, { userId, sessionId, exp });
  return { token, expiresInSec: Math.floor(TTL_MS / 1_000) };
}

export function validateSttToken(
  token: string | null
): { userId: string; sessionId: string } | null {
  if (!token) return null;
  const v = tokens.get(token);
  if (!v || v.exp < Date.now()) {
    if (v) tokens.delete(token);
    return null;
  }
  return { userId: v.userId, sessionId: v.sessionId };
}

export function revokeSttToken(token: string | null) {
  if (token) tokens.delete(token);
}
