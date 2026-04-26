import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5173",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  deepgramKey: process.env.DEEPGRAM_API_KEY ?? "",
  didApiKey: process.env.DID_API_KEY ?? "",
  didAvatarSourceUrl: process.env.DID_AVATAR_SOURCE_URL ?? "",
  stripeSecret: process.env.STRIPE_SECRET_KEY ?? "",
  stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
} as const;

export function isConfigured(): { ready: boolean; missing: string[] } {
  const need = {
    OPENAI_API_KEY: config.openaiKey,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "",
    DATABASE_URL: process.env.DATABASE_URL ?? "",
  };
  const missing = Object.entries(need)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return { ready: missing.length === 0, missing };
}
