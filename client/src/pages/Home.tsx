import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";

export function Home() {
  const { isSignedIn, isLoaded } = useUser();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl sm:text-5xl font-display font-bold text-slate-50 tracking-tight">
          DebateAI
        </h1>
        <p className="text-slate-400 text-lg max-w-lg mx-auto">
          Practice live debates against an AI that listens, counters your arguments, fact-checks you, and
          calls out fallacies. Under three seconds from your last word to the avatar&apos;s first word.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {!isLoaded ? (
            <span className="text-slate-500">Loading…</span>
          ) : isSignedIn ? (
            <Link
              to="/app"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-8 py-3 transition"
            >
              Open debate room
            </Link>
          ) : (
            <>
              <Link
                to="/sign-in"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-8 py-3 transition"
              >
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className="inline-flex items-center justify-center rounded-xl border border-slate-600 text-slate-200 hover:border-slate-500 px-8 py-3 transition"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
