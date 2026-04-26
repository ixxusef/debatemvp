import { SignIn } from "@clerk/clerk-react";
import { Link } from "react-router-dom";

export function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="mb-4">
        <Link to="/" className="text-slate-500 hover:text-slate-300 text-sm">
          ← Home
        </Link>
      </div>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" afterSignInUrl="/app" />
    </div>
  );
}
