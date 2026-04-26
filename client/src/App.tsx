import { Route, Routes, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Home } from "./pages/Home";
import { DebateRoom } from "./pages/DebateRoom";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { TokenBridge } from "./components/TokenBridge";

const hasClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {hasClerk && <TokenBridge />}
      <header className="border-b border-slate-800/60 backdrop-blur">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="font-display font-bold text-slate-100">
            DebateAI
          </Link>
          <div className="text-sm text-slate-500">
            {hasClerk ? <HeaderAuth /> : "Add VITE_CLERK_PUBLISHABLE_KEY"}
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function HeaderAuth() {
  const { isSignedIn, isLoaded, signOut } = useAuth();
  if (!isLoaded) return <span>…</span>;
  if (!isSignedIn) {
    return (
      <div className="space-x-3">
        <Link to="/sign-in" className="text-slate-300 hover:text-white">
          Sign in
        </Link>
        <Link to="/sign-up" className="text-emerald-400 hover:text-emerald-300">
          Sign up
        </Link>
      </div>
    );
  }
  return (
    <div className="space-x-3 flex items-center">
      <Link to="/app" className="text-slate-300 hover:text-white">
        Debate
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        className="text-slate-500 hover:text-slate-300"
      >
        Sign out
      </button>
    </div>
  );
}

function AppNoClerk() {
  return (
    <AppLayout>
      <div className="p-6 max-w-md mx-auto text-slate-400 text-center space-y-2">
        <p>
          Create <code className="text-slate-200">client/.env</code> with{" "}
          <code className="text-slate-200">VITE_CLERK_PUBLISHABLE_KEY</code> and{" "}
          <code className="text-slate-200">server/.env</code> for Clerk, database, and API keys. See
          the README in the project root.
        </p>
        <p className="text-sm">The UI shell still loads; auth is required for the debate room.</p>
      </div>
    </AppLayout>
  );
}

export default function App() {
  if (!hasClerk) {
    return <AppNoClerk />;
  }
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/app" element={<DebateRoom />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
      </Routes>
    </AppLayout>
  );
}
