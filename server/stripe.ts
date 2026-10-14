import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { marketplaceOffers, marketplacePurchases } from "../drizzle/schema";
import { getDb } from "./db";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
export const stripe = stripeKey ? new Stripe(stripeKey) : null;

export const catalog = {
  marketplaceLead: { name: "Fluxora Marktplatz-Lead", description: "Ein freigegebener Kontakt im Fluxora Marktplatz" },
} as const;

export function requireStripe() {
  if (!stripe) throw new Error("Stripe ist für diesen Mandanten noch nicht konfiguriert.");
  return stripe;
}

export function registerStripeWebhook(app: Express) {
  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    if (!stripe || !webhookSecret) return res.status(503).json({ error: "Stripe webhook is not configured" });
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") return res.status(400).json({ error: "Missing Stripe signature" });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
      return res.status(400).json({ error: "Invalid Stripe signature" });
    }
    if (event.id.startsWith("evt_test_")) {
      console.log("[Webhook] Test event detected, returning verification response");
      return res.json({ verified: true });
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = Number(session.metadata?.tenant_id); const offerId = Number(session.metadata?.marketplace_offer_id);
      const checkoutSessionId = session.id; const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      const db = await getDb();
      if (db && Number.isInteger(tenantId) && tenantId > 0 && Number.isInteger(offerId) && offerId > 0) {
        const existing = (await db.select({ id: marketplacePurchases.id }).from(marketplacePurchases).where(eq(marketplacePurchases.stripeCheckoutSessionId, checkoutSessionId)).limit(1))[0];
        const offer = (await db.select().from(marketplaceOffers).where(and(eq(marketplaceOffers.id, offerId), eq(marketplaceOffers.tenantId, tenantId))).limit(1))[0];
        if (!existing && offer) {
          const buyerName = session.customer_details?.name ?? session.metadata?.customer_name ?? "Unbekannter Käufer";
          const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
          await db.transaction(async (tx) => { await tx.insert(marketplacePurchases).values({ tenantId, offerId, buyerName, purchasePrice: amount, stripeCheckoutSessionId: checkoutSessionId, stripePaymentIntentId: paymentIntentId, status: "bezahlt" }); await tx.update(marketplaceOffers).set({ status: "verkauft" }).where(eq(marketplaceOffers.id, offer.id)); });
        }
      }
    }
    console.log("[Stripe] Verified webhook", { type: event.type, id: event.id, created: event.created });
    return res.json({ received: true });
  });
}
