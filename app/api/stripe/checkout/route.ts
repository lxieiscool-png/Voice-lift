import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createServerClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.getreel.org";

export async function POST(_req: NextRequest) {
  try {
    // Identity comes from the session cookie only — checkout grants a paid
    // entitlement to this user, so a body-supplied userId is not acceptable.
    const supabaseAuth = await createServerClient();
    const { data: auth } = await supabaseAuth.auth.getUser();
    const user = auth.user;
    if (!user?.email) return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });

    const stripe = getStripe();
    const supabase = createAdminClient();

    // Get or create the Stripe customer for this user
    const { data: profile } = await supabase
      .from("profiles").select("stripe_customer_id").eq("id", user.id).single();

    let customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    // No payment_method_types: Stripe picks eligible methods dynamically from
    // Dashboard settings, which converts better than hardcoding cards.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: `${APP_URL}/?upgraded=1`,
      cancel_url: `${APP_URL}/`,
      subscription_data: { metadata: { supabase_user_id: user.id } },
      integration_identifier: "reel-pro-checkout-mkvqzrtw",
    } as Stripe.Checkout.SessionCreateParams);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
