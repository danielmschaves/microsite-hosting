import Stripe from "stripe";
import { query, type WorkspaceRow } from "./db";
import { billingEnabled, MIN_TEAM_SEATS } from "./plan";
import { track } from "./events";

// Stripe integration. Lazy singleton so the app boots without keys; every
// entry point checks `billingEnabled` first. syncSubscriptionToWorkspace is
// the SOLE writer of plan/seats/status — always from a freshly retrieved
// subscription object, which makes webhook replays and out-of-order delivery
// harmless.

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
    });
  }
  return _stripe;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Get or create the Stripe customer for a workspace. */
export async function ensureCustomer(ws: WorkspaceRow): Promise<string> {
  if (ws.stripe_customer_id) return ws.stripe_customer_id;
  const customer = await stripe().customers.create({
    name: ws.name,
    metadata: { workspace_id: ws.id },
  });
  await query("UPDATE workspaces SET stripe_customer_id = $1 WHERE id = $2", [
    customer.id,
    ws.id,
  ]);
  return customer.id;
}

export async function createCheckoutSession(
  ws: WorkspaceRow,
  memberCount: number,
  returnUrl: string,
): Promise<string> {
  const customerId = await ensureCustomer(ws);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: ws.id,
    line_items: [
      {
        price: process.env.STRIPE_TEAM_PRICE_ID!,
        quantity: Math.max(MIN_TEAM_SEATS, memberCount),
      },
    ],
    subscription_data: { metadata: { workspace_id: ws.id } },
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=cancelled`,
  });
  return session.url!;
}

export async function createPortalSession(
  ws: WorkspaceRow,
  returnUrl: string,
): Promise<string> {
  const customerId = await ensureCustomer(ws);
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/**
 * Map a Stripe subscription onto the workspace row. Resolves the workspace
 * from subscription metadata, falling back to the customer id.
 */
export async function syncSubscriptionToWorkspace(
  subscription: Stripe.Subscription,
): Promise<void> {
  const wsId = subscription.metadata?.workspace_id;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const rows = wsId
    ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [wsId])
    : await query<WorkspaceRow>(
        "SELECT * FROM workspaces WHERE stripe_customer_id = $1",
        [customerId],
      );
  const ws = rows[0];
  if (!ws) {
    console.error(`[billing] no workspace for subscription ${subscription.id}`);
    return;
  }

  const status = subscription.status;
  const plan = ACTIVE_STATUSES.has(status) ? "team" : "free";
  const seats = subscription.items.data[0]?.quantity ?? 0;

  await query(
    `UPDATE workspaces
        SET plan = $1, subscription_status = $2, seats = $3,
            stripe_subscription_id = $4, stripe_customer_id = $5
      WHERE id = $6`,
    [plan, status, seats, subscription.id, customerId, ws.id],
  );
  await track("subscription_updated", {
    workspaceId: ws.id,
    meta: { status, plan, seats },
  });
}

/**
 * Align the subscription quantity with the member count (min seats floor).
 * Called on member join/remove; failures never block the membership change —
 * the next webhook or portal visit reconciles.
 */
export async function updateSeatQuantity(
  ws: WorkspaceRow,
  memberCount: number,
): Promise<void> {
  if (!billingEnabled || ws.plan !== "team" || !ws.stripe_subscription_id) return;
  try {
    const sub = await stripe().subscriptions.retrieve(ws.stripe_subscription_id);
    const item = sub.items.data[0];
    const quantity = Math.max(MIN_TEAM_SEATS, memberCount);
    if (item && item.quantity !== quantity) {
      await stripe().subscriptions.update(sub.id, {
        items: [{ id: item.id, quantity }],
        proration_behavior: "create_prorations",
      });
    }
  } catch (err) {
    console.error("[billing] seat sync failed (webhook will reconcile)", err);
  }
}
