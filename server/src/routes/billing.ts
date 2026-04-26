import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { getAuth, clerkClient } from "@clerk/express";
import { prisma } from "../lib/prisma.js";
import { getUserByClerkId, syncClerkUser } from "../users/syncUser.js";
import { config } from "../config.js";

const stripe = config.stripeSecret ? new Stripe(config.stripeSecret) : null;

export const billingRouter = Router();

billingRouter.get("/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const u = await getUserByClerkId(userId);
  if (!u) return res.status(404).json({ error: "User not found" });
  return res.json({
    tier: u.subscriptionTier,
    customerId: u.stripeCustomerId,
  });
});

/** Redirect user to Stripe Checkout for Pro */
billingRouter.post("/checkout", async (req, res) => {
  if (!stripe || !config.stripePricePro) {
    return res.status(503).json({ error: "Stripe is not configured" });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const cu = await clerkClient.users.getUser(userId);
  const u = await syncClerkUser(cu);
  const email = cu.emailAddresses[0]?.emailAddress;

  let customerId = u.stripeCustomerId;
  if (!customerId) {
    const c = await stripe.customers.create({
      email: email ?? undefined,
      metadata: { clerkId: userId, internalUserId: u.id },
    });
    customerId = c.id;
    await prisma.user.update({
      where: { id: u.id },
      data: { stripeCustomerId: customerId },
    });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: config.stripePricePro, quantity: 1 }],
    success_url: `${config.publicUrl}/app?upgraded=1`,
    cancel_url: `${config.publicUrl}/app?checkout=cancelled`,
  });
  return res.json({ url: session.url });
});

export async function handleStripeWebhook(req: Request, res: Response) {
  if (!stripe) return res.status(503).end();
  const sig = req.headers["stripe-signature"];
  if (!config.stripeWebhookSecret || !sig) {
    return res.status(400).send("Missing webhook");
  }
  const buf = (req as Request & { body: Buffer }).body;
  if (!Buffer.isBuffer(buf)) {
    return res.status(400).send("Expected raw body");
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      Array.isArray(sig) ? sig[0]! : sig,
      config.stripeWebhookSecret
    );
  } catch (e) {
    console.error("Stripe verify", e);
    return res.status(400).send("Bad signature");
  }
  const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (existing) {
    return res.json({ received: true, duplicate: true });
  }
  await prisma.stripeEvent.create({ data: { id: event.id } });
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.customer) {
      const u = await prisma.user.findFirst({
        where: { stripeCustomerId: s.customer as string },
      });
      if (u) {
        await prisma.user.update({
          where: { id: u.id },
          data: { subscriptionTier: "PRO" },
        });
      }
    }
  }
  if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const cId = sub.customer as string;
    const u = await prisma.user.findFirst({ where: { stripeCustomerId: cId } });
    if (u) {
      const active = sub.status === "active" || sub.status === "trialing";
      await prisma.user.update({
        where: { id: u.id },
        data: { subscriptionTier: active ? "PRO" : "FREE" },
      });
    }
  }
  return res.json({ received: true });
}
