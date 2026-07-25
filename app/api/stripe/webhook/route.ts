import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, syncSubscriptionToWorkspace } from "@/lib/billing";
import { billingEnabled } from "@/lib/plan";
import { track } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe webhook. Auth = signature verification against the raw body (no
// session). syncSubscriptionToWorkspace is idempotent, so replays and
// out-of-order delivery are safe; unhandled event types return 200.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!billingEnabled || !secret) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text(); // raw body required for verification
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe().subscriptions.retrieve(
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id,
          );
          await syncSubscriptionToWorkspace(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscriptionToWorkspace(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await track("subscription_updated", {
          meta: { status: "payment_failed", customer: String(invoice.customer) },
        });
        break;
      }
      default:
        break; // acknowledged, ignored
    }
  } catch (err) {
    console.error(`[billing] webhook handling failed for ${event.type}`, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
