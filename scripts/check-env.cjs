/**
 * Reports which *names* of required vars are empty in server/.env (does not print values).
 */
const fs = require("fs");
const path = require("path");

const serverEnv = path.join(__dirname, "..", "server", ".env");
if (!fs.existsSync(serverEnv)) {
  console.log("server/.env: MISSING (create it)");
  process.exit(1);
}

const text = fs.readFileSync(serverEnv, "utf8");
const get = (key) => {
  const m = text.match(
    new RegExp("^\\s*" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*(.*)$", "m")
  );
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, "");
  return v || null;
};

const required = [
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "DEEPGRAM_API_KEY",
];
const missing = required.filter((k) => !get(k));

if (missing.length) {
  console.log("server/.env: still empty — " + missing.join(", "));
} else {
  console.log("server/.env: required keys are set (not validating format).");
}

const clientPath = path.join(__dirname, "..", "client", ".env");
if (fs.existsSync(clientPath)) {
  if (get("CLERK_PUBLISHABLE_KEY")) {
    const c = fs.readFileSync(clientPath, "utf8");
    if (!/VITE_CLERK_PUBLISHABLE_KEY\s*=\s*\S+/.test(c)) {
      console.log("client/.env: VITE_CLERK_PUBLISHABLE_KEY looks empty — run npm run setup:client");
    } else {
      console.log("client/.env: present");
    }
  }
} else {
  console.log("client/.env: MISSING — run npm run setup:client");
}
