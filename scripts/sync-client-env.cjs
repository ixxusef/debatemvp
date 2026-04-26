/**
 * Creates client/.env with VITE_CLERK_PUBLISHABLE_KEY from server/.env (Clerk public key is safe in frontend).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serverEnv = path.join(root, "server", ".env");
const clientEnv = path.join(root, "client", ".env");

if (!fs.existsSync(serverEnv)) {
  console.error("Missing server/.env — copy from server/.env.example and fill in values.");
  process.exit(1);
}

const text = fs.readFileSync(serverEnv, "utf8");
let pub = "";
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*CLERK_PUBLISHABLE_KEY\s*=\s*(.*)$/);
  if (m) {
    pub = m[1].trim().replace(/^["']|["']$/g, "");
    break;
  }
}

if (!pub) {
  console.error("No CLERK_PUBLISHABLE_KEY in server/.env — add it from Clerk dashboard.");
  process.exit(1);
}

const out = `VITE_CLERK_PUBLISHABLE_KEY=${pub}\n`;
fs.writeFileSync(clientEnv, out, "utf8");
console.log("OK: wrote client/.env (VITE_CLERK_PUBLISHABLE_KEY from server).");
