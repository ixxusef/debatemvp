import "dotenv/config";
import * as http from "node:http";
import express, { json, raw, type Request } from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { clerkMiddleware } from "@clerk/express";
import { config, isConfigured } from "./config.js";
import { debateRouter } from "./routes/debate.js";
import { billingRouter, handleStripeWebhook } from "./routes/billing.js";
import { attachSttToSocket } from "./ws/sttBridge.js";
import { validateSttToken, revokeSttToken } from "./ws/sttToken.js";
import { prisma } from "./lib/prisma.js";

const app = express();
app.set("trust proxy", 1);
app.post(
  "/api/webhooks/stripe",
  raw({ type: "application/json" }) as (req: Request, res: express.Response, next: express.NextFunction) => void,
  (req, res) => {
    return handleStripeWebhook(req, res);
  }
);
app.use(
  cors({
    origin: [config.publicUrl, "http://127.0.0.1:5173", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(json({ limit: "2mb" }));
app.use(clerkMiddleware());
app.use("/api/billing", billingRouter);
app.use("/api/debate", debateRouter);
app.get("/api/ready", (_req, res) => {
  const cfg = isConfigured();
  res.json({ ok: cfg.ready, missing: cfg.missing });
});
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url ?? "/ws", "http://local.test");
  if (u.pathname !== "/ws/stt") {
    socket.destroy();
    return;
  }
  const token = u.searchParams.get("token");
  const v = validateSttToken(token);
  if (!v) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  void (async () => {
    const session = await prisma.debateSession.findFirst({
      where: { id: v.sessionId, userId: v.userId, status: "IN_PROGRESS" },
    });
    if (!session) {
      if (token) revokeSttToken(token);
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      if (token) revokeSttToken(token);
      attachSttToSocket(clientWs, (t) => {
        try {
          clientWs.send(
            JSON.stringify({
              type: "stt",
              text: t.text,
              isFinal: t.isFinal,
              speechFinal: t.speechFinal,
            })
          );
        } catch {
          // closed
        }
      });
    });
  })();
});

server.listen(config.port, () => {
  const cfg = isConfigured();
  console.log(`DebateAI API http://127.0.0.1:${config.port}`);
  if (!cfg.ready) {
    console.warn("Missing config:", cfg.missing.join(", "));
  }
});
