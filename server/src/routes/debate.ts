import { Router } from "express";
import { type Prisma, type Difficulty, type SubscriptionTier } from "@prisma/client";
import { getAuth, clerkClient } from "@clerk/express";
import { prisma } from "../lib/prisma.js";
import { syncClerkUser, getUserByClerkId } from "../users/syncUser.js";
import { moderateUserText } from "../services/moderation.js";
import { generateDebateResponse, generateScorecard, type TranscriptLine } from "../services/aiDebate.js";
import { textToSpeechBase64 } from "../services/tts.js";
import { didImageUrlForUi } from "../services/avatar/did.js";
import { createSttToken } from "../ws/sttToken.js";

const FREE_LIMIT = 3;
export const debateRouter = Router();

function canDebate(tier: SubscriptionTier, used: number): boolean {
  if (tier === "PRO") return true;
  return used < FREE_LIMIT;
}

debateRouter.get("/config", (_req, res) => {
  res.json({
    avatarImageUrl: didImageUrlForUi(),
    timeLimitDefaultSec: 300,
  });
});

debateRouter.get("/health", (_req, res) => {
  res.json({ ok: true, debate: "ready" });
});

/** Create session; enforces free-tier cap */
debateRouter.post("/sessions", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { topic, difficulty, customTopic } = (req.body ?? {}) as {
    topic?: string;
    difficulty?: string;
    customTopic?: boolean;
  };
  if (!topic || typeof topic !== "string" || topic.trim().length < 2) {
    return res.status(400).json({ error: "Topic required" });
  }
  const d = (difficulty ?? "NEUTRAL").toUpperCase() as Difficulty;
  if (!["FRIENDLY", "NEUTRAL", "AGGRESSIVE", "EXPERT"].includes(d)) {
    return res.status(400).json({ error: "Invalid difficulty" });
  }
  const cu = await clerkClient.users.getUser(userId);
  const u = await syncClerkUser(cu);
  if (!canDebate(u.subscriptionTier, u.debatesUsed)) {
    return res.status(402).json({ error: "paywall", message: "Upgrade for unlimited debates." });
  }
  const s = await prisma.debateSession.create({
    data: {
      userId: u.id,
      topic: topic.trim().slice(0, 500),
      customTopic: Boolean(customTopic),
      difficulty: d,
      status: "PENDING",
    },
  });
  return res.json({ session: s });
});

/** One-time STT WebSocket token */
debateRouter.post("/sessions/:id/stt-token", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const dbU = await getUserByClerkId(userId);
  if (!dbU) return res.status(404).json({ error: "User not found" });
  const session = await prisma.debateSession.findFirst({
    where: { id: req.params.id, userId: dbU.id, status: "IN_PROGRESS" },
  });
  if (!session) return res.status(404).json({ error: "Session not in progress" });
  const t = createSttToken(dbU.id, session.id);
  return res.json(t);
});

debateRouter.post("/sessions/:id/start", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const dbU = await getUserByClerkId(userId);
  if (!dbU) return res.status(401).json({ error: "User not found" });
  const session = await prisma.debateSession.findFirst({
    where: { id: req.params.id, userId: dbU.id },
  });
  if (!session) return res.status(404).json({ error: "Not found" });
  if (session.status === "IN_PROGRESS" || session.status === "COMPLETED") {
    return res.json({ session });
  }
  if (!canDebate(dbU.subscriptionTier, dbU.debatesUsed)) {
    return res.status(402).json({ error: "paywall" });
  }
  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const next = await tx.debateSession.update({
      where: { id: session.id },
      data: {
        status: "IN_PROGRESS",
        startedAt: new Date(),
        transcript: [],
      },
    });
    if (dbU.subscriptionTier === "FREE") {
      await tx.user.update({
        where: { id: dbU.id },
        data: { debatesUsed: { increment: 1 } },
      });
    }
    return next;
  });
  return res.json({ session: updated });
});

debateRouter.post("/sessions/:id/turn", async (req, res) => {
  const t0 = Date.now();
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const dbU = await getUserByClerkId(userId);
  if (!dbU) return res.status(401).json({ error: "User not found" });
  const session = await prisma.debateSession.findFirst({
    where: { id: req.params.id, userId: dbU.id },
  });
  if (!session) return res.status(404).json({ error: "Not found" });
  if (session.status !== "IN_PROGRESS") {
    return res.status(400).json({ error: "Debate is not live" });
  }
  const { userText, history: clientHistory } = (req.body ?? {}) as {
    userText?: string;
    history?: TranscriptLine[];
  };
  if (!userText || typeof userText !== "string") {
    return res.status(400).json({ error: "userText required" });
  }
  const mod = await moderateUserText(userText);
  if (!mod.safe) {
    return res.status(400).json({ error: "moderation", message: mod.reason });
  }
  const prev = (session.transcript as TranscriptLine[] | null) ?? clientHistory ?? [];
  const withUser: TranscriptLine[] = [
    ...prev,
    { role: "user" as const, text: userText, t: Date.now() },
  ];
  const ai = await generateDebateResponse({
    topic: session.topic,
    difficulty: session.difficulty,
    history: withUser,
  });
  if (ai.error || !ai.text) {
    return res.status(502).json({ error: ai.error ?? "AI error" });
  }
  const withBot: TranscriptLine[] = [
    ...withUser,
    { role: "assistant" as const, text: ai.text, t: Date.now() },
  ];
  await prisma.debateSession.update({
    where: { id: session.id },
    data: { transcript: withBot as Prisma.InputJsonValue },
  });
  const tts = await textToSpeechBase64(ai.text);
  const elapsed = Date.now() - t0;
  return res.json({
    text: ai.text,
    tts: tts.base64 ? { base64: tts.base64, mime: tts.mime } : null,
    ttsError: tts.error,
    latencyMs: elapsed,
  });
});

debateRouter.post("/sessions/:id/end", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const dbU = await getUserByClerkId(userId);
  if (!dbU) return res.status(401).json({ error: "User not found" });
  const session = await prisma.debateSession.findFirst({
    where: { id: req.params.id, userId: dbU.id },
  });
  if (!session) return res.status(404).json({ error: "Not found" });
  const tr = (session.transcript as TranscriptLine[] | null) ?? [];
  const card = await generateScorecard({
    topic: session.topic,
    difficulty: session.difficulty,
    transcript: tr,
  });
  const updated = await prisma.debateSession.update({
    where: { id: session.id },
    data: {
      status: "COMPLETED",
      endedAt: new Date(),
      scorecard: card as Prisma.InputJsonValue,
    },
  });
  return res.json({ session: updated, scorecard: card });
});

debateRouter.get("/sessions/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const dbU = await getUserByClerkId(userId);
  if (!dbU) return res.status(401).json({ error: "User not found" });
  const session = await prisma.debateSession.findFirst({
    where: { id: req.params.id, userId: dbU.id },
  });
  if (!session) return res.status(404).json({ error: "Not found" });
  return res.json({ session });
});

debateRouter.get("/me/usage", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const u = await getUserByClerkId(userId);
  if (!u) return res.status(404).json({ error: "User not found" });
  return res.json({
    subscriptionTier: u.subscriptionTier,
    debatesUsed: u.debatesUsed,
    freeLimit: FREE_LIMIT,
    isPro: u.subscriptionTier === "PRO",
  });
});
