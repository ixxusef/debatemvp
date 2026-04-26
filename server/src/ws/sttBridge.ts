import type { WebSocket } from "ws";
import { createClient, LiveTranscriptionEvents, type LiveClient } from "@deepgram/sdk";
import { config } from "../config.js";

type ClientMsg =
  | { type: "start"; encoding?: "linear16"; sampleRate?: number }
  | { type: "audio"; data: string; encoding?: "linear16" }
  | { type: "stop" };

/**
 * Wire a browser WebSocket to a Deepgram live stream.
 * Client sends base64 linear16 16kHz mono chunks; server forwards and echoes transcripts as JSON.
 */
export function attachSttToSocket(
  clientWs: WebSocket,
  onTranscript: (t: { text: string; isFinal: boolean; speechFinal?: boolean }) => void
): void {
  if (!config.deepgramKey) {
    clientWs.send(
      JSON.stringify({ type: "stt_error", error: "Deepgram is not configured. Add DEEPGRAM_API_KEY." })
    );
    return;
  }

  const deepgram = createClient(config.deepgramKey);
  let dg: LiveClient | null = null;
  const queue: string[] = [];
  let open = false;

  const flushQueue = () => {
    if (!dg || !open) return;
    for (const b of queue) {
      const buf = Buffer.from(b, "base64");
      dg.send(buf as never);
    }
    queue.length = 0;
  };

  const startDg = (sampleRate: number) => {
    if (dg) return;
    dg = deepgram.listen.live({
      model: "nova-2",
      language: "en",
      smart_format: true,
      encoding: "linear16",
      sample_rate: sampleRate,
      channels: 1,
      interim_results: true,
    });

    dg.on(LiveTranscriptionEvents.Open, () => {
      open = true;
      flushQueue();
    });

    dg.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = (data as { channel?: { alternatives?: { transcript?: string }[] } }).channel
        ?.alternatives?.[0];
      const text = (alt?.transcript ?? "").trim();
      if (!text) return;
      const isFinal = Boolean((data as { is_final?: boolean }).is_final);
      onTranscript({
        text,
        isFinal,
        speechFinal: (data as { speech_final?: boolean }).speech_final,
      });
    });

    dg.on(LiveTranscriptionEvents.Error, (e) => {
      try {
        clientWs.send(
          JSON.stringify({ type: "stt_error", error: (e as Error).message || String(e) })
        );
      } catch {
        // ignore
      }
    });
  };

  clientWs.on("message", (raw) => {
    const text = String(raw);
    if (text.startsWith("{")) {
      try {
        const msg: ClientMsg = JSON.parse(text) as ClientMsg;
        if (msg.type === "start") {
          const sr = msg.sampleRate ?? 16_000;
          startDg(sr);
        } else if (msg.type === "audio" && msg.data) {
          if (dg && open) {
            const buf = Buffer.from(msg.data, "base64");
            dg.send(buf as never);
          } else {
            queue.push(msg.data);
          }
        } else if (msg.type === "stop") {
          dg?.requestClose();
        }
      } catch {
        // ignore
      }
    }
  });

  clientWs.on("close", () => {
    dg?.requestClose();
  });
}
