DebateAI — local run (after first-time npm install)
===================================================

1) Start Docker Desktop, wait until it says "Running".

2) In this folder, PowerShell:
   npm run db:up
   npm run db:push

3) If you have not yet, copy server\.env.example to server\.env and fill in keys.
   Create client from Clerk publishable key:
   npm run setup:client
   (or: duplicate CLERK_PUBLISHABLE_KEY into client\.env as VITE_CLERK_PUBLISHABLE_KEY=)

4) Check everything (names only, no secrets printed):
   npm run check:env

5) Start app:
   npm run dev
   Open http://localhost:5173

6) If db:up fails with "pipe dockerDesktop", Docker is not running — start Docker Desktop or use
   a cloud Postgres URL in DATABASE_URL (e.g. Neon) instead of localhost.

One-shot after keys + Docker:
   npm run setup
   npm run dev
