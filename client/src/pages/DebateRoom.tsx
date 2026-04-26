import { useUser } from "@clerk/clerk-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  createSession,
  endSession,
  getDebateConfig,
  getMeUsage,
  getSttToken,
  postTurn,
  startSession,
  startCheckout,
} from "../api";
import { createMicPcm16Stream } from "../audio/sttPcm16";

const PRESET_TOPICS = [
  "The United States should move to a four-day work week.",
  "Social media has done more harm than good to democracy.",
  "Nuclear power is essential for rapid decarbonization.",
  "Colleges should not consider standardized test scores in admissions.",
  "Remote work should be the default for knowledge workers.",
  "Universal basic income should be tested at national scale.",
];

type Diff = "FRIENDLY" | "NEUTRAL" | "AGGRESSIVE" | "EXPERT";
type TLine = { role: "user" | "assistant"; text: string; t?: number };
type Tab = "setup" | "countdown" | "live" | "ended";

const COUNTDOWN_SEC = 3;
const DEFAULT_LIMIT = 300;

export function DebateRoom() {
  const { user, isLoaded } = useUser();
  const [search] = useSearchParams();
  const [tab, setTab] = useState<Tab>("setup");
  const [usage, setUsage] = useState<{
    debatesUsed: number;
    freeLimit: number;
    isPro: boolean;
  } | null>(null);
  const [topic, setTopic] = useState(PRESET_TOPICS[0]!);
  const [custom, setCustom] = useState(false);
  const [diff, setDiff] = useState<Diff>("NEUTRAL");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TLine[]>([]);
  const [interim, setInterim] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_LIMIT);
  const [count, setCount] = useState(COUNTDOWN_SEC);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [score, setScore] = useState<{
    argumentStrength: number;
    fallacies: { name: string; example?: string; explanation: string }[];
    missedCounterarguments: string[];
    persuasion: number;
    overallGrade: string;
    overallFeedback: string;
  } | null>(null);
  const [thinking, setThinking] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sttRef = useRef<ReturnType<typeof createMicPcm16Stream> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const speakDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineBuffer = useRef("");
  const liveStarted = useRef(false);
  const timeExpiredHandled = useRef(false);
  const sidRef = useRef<string | null>(null);
  const upgraded = search.get("upgraded");
  const checkout = search.get("checkout");

  useEffect(() => {
    void (async () => {
      const cfg = await getDebateConfig().catch(() => null);
      if (cfg?.avatarImageUrl) setAvatarUrl(cfg.avatarImageUrl);
    })();
  }, []);

  const refreshUsage = useCallback(() => {
    return getMeUsage()
      .then((u) =>
        setUsage({ debatesUsed: u.debatesUsed, freeLimit: u.freeLimit, isPro: u.isPro })
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isLoaded && user) void refreshUsage();
  }, [isLoaded, user, refreshUsage]);

  sidRef.current = sessionId;

  const attachLocalVideo = (stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {});
    }
  };

  const stopStt = useCallback(() => {
    sttRef.current?.stop();
    sttRef.current = null;
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (speakDebounce.current) {
      clearTimeout(speakDebounce.current);
      speakDebounce.current = null;
    }
  }, []);

  const playTts = (base64: string, mime: string) => {
    setAiSpeaking(true);
    const a = new Audio(`data:${mime};base64,${base64}`);
    a.onended = () => setAiSpeaking(false);
    a.onerror = () => setAiSpeaking(false);
    void a.play().catch(() => setAiSpeaking(false));
  };

  const turnLock = useRef(false);
  const sendUserLine = useCallback(async (userText: string) => {
    const text = userText.trim();
    if (text.length < 2) return;
    if (turnLock.current) return;
    const sid = sidRef.current;
    if (!sid) return;
    turnLock.current = true;
    setErr(null);
    setThinking(true);
    try {
      const r = await postTurn(sid, text, []);
      setLastLatency(r.latencyMs);
      setTranscript((prev) => [
        ...prev,
        { role: "user", text, t: Date.now() },
        { role: "assistant", text: r.text, t: Date.now() },
      ]);
      lineBuffer.current = "";
      if (r.tts) {
        playTts(r.tts.base64, r.tts.mime);
      } else if (r.ttsError) {
        setErr("TTS: " + r.ttsError);
      }
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("moderation:")) {
        setErr("That line was blocked by content moderation. Try rephrasing.");
      } else {
        setErr(msg);
      }
    } finally {
      setThinking(false);
      turnLock.current = false;
    }
  }, []);
  const sendUserLineRef = useRef(sendUserLine);
  sendUserLineRef.current = sendUserLine;

  // Countdown: 3,2,1 then start mic + STT
  useEffect(() => {
    if (tab !== "countdown") {
      liveStarted.current = false;
      return;
    }
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), 1_000);
      return () => clearTimeout(t);
    }
    if (count === 0 && !liveStarted.current) {
      liveStarted.current = true;
      const sid = sidRef.current;
      if (!sid) return;
      void (async () => {
        setErr(null);
        try {
          await startSession(sid);
          const tok = await getSttToken(sid);
          const proto = location.protocol === "https:" ? "wss" : "ws";
          const ws = new WebSocket(
            `${proto}://${location.host}/ws/stt?token=${encodeURIComponent(tok.token)}`
          );
          wsRef.current = ws;
          ws.onopen = () => {
            const stream = streamRef.current;
            if (!stream) return;
            ws.send(JSON.stringify({ type: "start", sampleRate: 16_000 }));
            sttRef.current = createMicPcm16Stream(stream, (chunk) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({ type: "audio", data: chunk.data, encoding: "linear16" })
                );
              }
            });
          };
          ws.onmessage = (ev) => {
            try {
              const m = JSON.parse(String(ev.data)) as {
                type: string;
                text?: string;
                isFinal?: boolean;
                speechFinal?: boolean;
                error?: string;
              };
              if (m.type === "stt_error") {
                setErr(m.error ?? "STT error");
                return;
              }
              if (m.type === "stt" && m.text) {
                if (m.isFinal) {
                  setInterim("");
                  lineBuffer.current = m.text;
                  if (speakDebounce.current) clearTimeout(speakDebounce.current);
                  speakDebounce.current = setTimeout(() => {
                    const line = lineBuffer.current;
                    if (line.trim().length >= 4) {
                      void sendUserLineRef.current(line);
                    }
                  }, m.speechFinal ? 200 : 700);
                } else {
                  setInterim(m.text);
                }
              }
            } catch {
              // ignore
            }
          };
          setTab("live");
          setTimeLeft(DEFAULT_LIMIT);
        } catch (e) {
          setErr(String(e));
        }
      })();
    }
  }, [tab, count]);

  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(
      () => setTimeLeft((t) => (t <= 0 ? 0 : t - 1)),
      1_000
    );
    return () => clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (tab !== "live" || timeLeft > 0) {
      if (tab !== "live") timeExpiredHandled.current = false;
      return;
    }
    if (timeExpiredHandled.current) return;
    timeExpiredHandled.current = true;
    const sid = sessionId;
    if (!sid) return;
    void (async () => {
      try {
        stopStt();
        if (streamRef.current) {
          for (const t of streamRef.current.getTracks()) t.stop();
          streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        const e = await endSession(sid);
        setScore(e.scorecard);
        setTab("ended");
        void refreshUsage();
      } catch (e) {
        setErr(String(e));
        timeExpiredHandled.current = false;
      }
    })();
  }, [tab, timeLeft, sessionId, stopStt, refreshUsage]);

  const onStart = async () => {
    setErr(null);
    setPaywall(false);
    const top = custom ? topic.trim() : topic;
    if (top.length < 2) {
      setErr("Pick a topic");
      return;
    }
    try {
      const { session } = await createSession({
        topic: top,
        difficulty: diff,
        customTopic: custom,
      });
      setTranscript([]);
      setScore(null);
      setLastLatency(null);
      setInterim("");
      setCount(COUNTDOWN_SEC);
      setSessionId(session.id);
      liveStarted.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      attachLocalVideo(stream);
      setTab("countdown");
    } catch (e) {
      const s = String(e);
      if (s.includes("paywall")) {
        setPaywall(true);
      } else {
        setErr(s);
      }
    }
  };

  const onEnd = async () => {
    if (!sessionId) return;
    setErr(null);
    try {
      stopStt();
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      const e = await endSession(sessionId);
      setScore(e.scorecard);
      setTab("ended");
      void refreshUsage();
    } catch (e) {
      setErr(String(e));
    }
  };

  const onUpgrade = async () => {
    setErr(null);
    try {
      const { url } = await startCheckout();
      if (url) location.href = url;
    } catch (e) {
      setErr(String(e));
    }
  };

  if (!isLoaded) {
    return <div className="p-8 text-center text-slate-500">Loading account…</div>;
  }
  if (!user) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4">
        <p>Sign in to use DebateAI.</p>
        <Link to="/sign-in" className="text-emerald-400 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {upgraded && (
        <p className="text-emerald-400 text-sm text-center">You&apos;re on Pro. Enjoy unlimited debates.</p>
      )}
      {checkout === "cancelled" && (
        <p className="text-amber-400 text-sm text-center">Checkout cancelled.</p>
      )}

      {usage && !usage.isPro && (
        <div className="glass p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-300">
          <span>
            Free plan: {usage.debatesUsed} / {usage.freeLimit} debates used.
          </span>
          <button
            type="button"
            onClick={() => void onUpgrade()}
            className="text-emerald-400 hover:text-emerald-300 font-medium"
          >
            Upgrade to Pro — $15/mo
          </button>
        </div>
      )}

      {paywall && (
        <div className="glass p-4 border-amber-700/50 text-amber-200 text-sm text-center">
          You have used your free debates.{" "}
          <button type="button" onClick={() => void onUpgrade()} className="underline text-emerald-300">
            Upgrade
          </button>
        </div>
      )}

      {err && <div className="text-red-400 text-sm break-words">{err}</div>}

      {tab === "setup" && (
        <div className="glass p-6 space-y-4">
          <h2 className="font-display text-xl text-slate-100">Set up your debate</h2>
          <label className="block text-sm text-slate-400">Topic</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              Custom topic
            </label>
            {custom ? (
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full min-h-[88px] rounded-xl bg-slate-950/80 border border-slate-700 p-3 text-slate-200"
                placeholder="Type your resolution…"
                maxLength={500}
              />
            ) : (
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full rounded-xl bg-slate-950/80 border border-slate-700 p-3 text-slate-200"
              >
                {PRESET_TOPICS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <span className="text-sm text-slate-400">Opponent style</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["FRIENDLY", "NEUTRAL", "AGGRESSIVE", "EXPERT"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiff(d)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${
                    diff === d
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-slate-800/50 text-slate-400 border border-slate-700"
                  }`}
                >
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onStart()}
            className="w-full sm:w-auto rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-6 py-3"
          >
            Start debate
          </button>
        </div>
      )}

      {tab === "countdown" && (
        <div className="glass p-12 text-center">
          <p className="text-slate-500 text-sm mb-2">Get ready</p>
          <p className="text-6xl font-display text-emerald-400">{count}</p>
        </div>
      )}

      {tab === "live" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Time: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}
            </span>
            {lastLatency != null && <span>Last turn: {lastLatency} ms</span>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">You</p>
              <video
                ref={videoRef}
                className="w-full rounded-xl border border-slate-800 aspect-video object-cover bg-black"
                playsInline
                muted
                autoPlay
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">AI</p>
              <div
                className={`relative w-full rounded-xl border border-slate-800 aspect-video flex items-center justify-center bg-slate-900 overflow-hidden ${
                  aiSpeaking ? "ring-2 ring-emerald-500/50" : ""
                }`}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover opacity-80" />
                ) : (
                  <div className="text-4xl" aria-hidden>
                    🤖
                  </div>
                )}
                {aiSpeaking && (
                  <div className="absolute bottom-2 left-0 right-0 text-center text-xs text-emerald-400">
                    Speaking…
                  </div>
                )}
                {thinking && !aiSpeaking && (
                  <div className="absolute top-2 right-2 text-xs text-amber-400">Thinking…</div>
                )}
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-400 min-h-[1.5rem]">
            {interim || (thinking ? "…" : "Speak clearly — the AI will respond when you finish a phrase.")}
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto text-sm text-slate-300 font-mono">
            {transcript.map((l, i) => (
              <div key={i} className="border-b border-slate-800/50 pb-1">
                <span className="text-slate-500">{l.role === "user" ? "You" : "AI"}:</span> {l.text}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void sendUserLine(lineBuffer.current || interim)}
              className="rounded-xl border border-slate-600 text-slate-200 px-4 py-2 text-sm"
            >
              Send now
            </button>
            <button
              type="button"
              onClick={() => void onEnd()}
              className="rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/40 px-4 py-2 text-sm"
            >
              End debate
            </button>
          </div>
        </div>
      )}

      {tab === "ended" && score && (
        <div className="glass p-6 space-y-4">
          <h2 className="font-display text-xl text-slate-100">Your scorecard</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Argument strength (1–10)</p>
              <p className="text-2xl font-display text-emerald-400">{score.argumentStrength}</p>
            </div>
            <div>
              <p className="text-slate-500">Persuasion (1–10)</p>
              <p className="text-2xl font-display text-emerald-400">{score.persuasion}</p>
            </div>
            <div>
              <p className="text-slate-500">Overall grade</p>
              <p className="text-2xl font-display text-slate-100">{score.overallGrade}</p>
            </div>
          </div>
          <p className="text-slate-300">{score.overallFeedback}</p>
          {score.fallacies.length > 0 && (
            <div>
              <h3 className="text-slate-200 font-medium mb-2">Logical issues</h3>
              <ul className="space-y-2 text-sm text-slate-400">
                {score.fallacies.map((f, i) => (
                  <li key={i} className="border-l-2 border-amber-500/40 pl-2">
                    <span className="text-amber-200/80">{f.name}</span> — {f.explanation}
                    {f.example && <em className="text-slate-500"> (“{f.example}”)</em>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score.missedCounterarguments.length > 0 && (
            <div>
              <h3 className="text-slate-200 font-medium mb-2">Counterarguments to explore</h3>
              <ul className="list-disc list-inside text-sm text-slate-400">
                {score.missedCounterarguments.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setTab("setup");
              setSessionId(null);
            }}
            className="rounded-xl bg-slate-800 border border-slate-600 text-slate-200 px-4 py-2"
          >
            New debate
          </button>
        </div>
      )}
    </div>
  );
}
