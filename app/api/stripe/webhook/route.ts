import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get("stripe-signature")!;

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Webhook signature error:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Flip is_pro for the profile that owns this Stripe customer. Primary match
  // is stripe_customer_id; if that was never saved (e.g. the profile update
  // failed during checkout), fall back to the supabase_user_id we stamp into
  // the subscription metadata — a paying customer must ALWAYS get Pro.
  async function setPro(customerId: string, isPro: boolean, fallbackUserId?: string) {
    const { data } = await supabase.from("profiles")
      .update({ is_pro: isPro }).eq("stripe_customer_id", customerId).select("id");
    if ((data?.length ?? 0) === 0 && fallbackUserId) {
      console.warn(`Webhook: no profile matched customer ${customerId}; falling back to metadata user id`);
      await supabase.from("profiles")
        .update({ is_pro: isPro, stripe_customer_id: customerId }).eq("id", fallbackUserId);
    }
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const active = sub.status === "active" || sub.status === "trialing";
      await setPro(sub.customer as string, active, sub.metadata?.supabase_user_id);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await setPro(sub.customer as string, false, sub.metadata?.supabase_user_id);
      break;
    }
    case "invoice.payment_failed": {
      // Grace period — don't revoke immediately, Stripe retries
      break;
    }
  }

  return NextResponse.json({ received: true });
}

