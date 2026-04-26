import { SignUp } from "@clerk/clerk-react";
import { Link } from "react-router-dom";

export function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="mb-4">
        <Link to="/" className="text-slate-500 hover:text-slate-300 text-sm">
          ← Home
        </Link>
      </div>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" afterSignUpUrl="/app" />
    </div>
  );
}
