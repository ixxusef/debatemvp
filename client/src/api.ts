import { getToken } from "./authGetToken";

const base = "";

async function withAuth(path: string, init?: RequestInit) {
  const h = new Headers(init?.headers);
  h.set("Content-Type", "application/json");
  const t = await getToken();
  if (t) h.set("Authorization", `Bearer ${t}`);
  return fetch(`${base}${path}`, { ...init, headers: h, credentials: "include" });
}

export async function getMeUsage() {
  const r = await withAuth("/api/debate/me/usage");
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{
    subscriptionTier: string;
    debatesUsed: number;
    freeLimit: number;
    isPro: boolean;
  }>;
}

export async function getDebateConfig() {
  const r = await withAuth("/api/debate/config");
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ avatarImageUrl: string | null; timeLimitDefaultSec: number }>;
}

export async function createSession(body: { topic: string; difficulty: string; customTopic: boolean }) {
  const r = await withAuth("/api/debate/sessions", { method: "POST", body: JSON.stringify(body) });
  if (r.status === 402) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error("paywall:" + (j.message ?? "Upgrade required"));
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ session: { id: string; topic: string; difficulty: string } }>;
}

export async function startSession(id: string) {
  const r = await withAuth(`/api/debate/sessions/${id}/start`, { method: "POST" });
  if (r.status === 402) throw new Error("paywall");
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ session: object }>;
}

export async function getSttToken(sessionId: string) {
  const r = await withAuth(`/api/debate/sessions/${sessionId}/stt-token`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ token: string; expiresInSec: number }>;
}

export async function postTurn(
  sessionId: string,
  userText: string,
  history: { role: "user" | "assistant"; text: string; t?: number }[]
) {
  const t0 = performance.now();
  const r = await withAuth(`/api/debate/sessions/${sessionId}/turn`, {
    method: "POST",
    body: JSON.stringify({ userText, history }),
  });
  if (r.status === 400) {
    const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.error === "moderation" ? "moderation:" + (j.message ?? "") : (await r.text()));
  }
  if (!r.ok) throw new Error(await r.text());
  const j = (await r.json()) as {
    text: string;
    tts: { base64: string; mime: string } | null;
    ttsError?: string;
    latencyMs: number;
  };
  j.latencyMs = Math.round(performance.now() - t0);
  return j;
}

export async function endSession(sessionId: string) {
  const r = await withAuth(`/api/debate/sessions/${sessionId}/end`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{
    scorecard: {
      argumentStrength: number;
      fallacies: { name: string; example?: string; explanation: string }[];
      missedCounterarguments: string[];
      persuasion: number;
      overallGrade: string;
      overallFeedback: string;
    };
  }>;
}

export async function startCheckout() {
  const r = await withAuth("/api/billing/checkout", { method: "POST" });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t);
  }
  return r.json() as Promise<{ url: string }>;
}
