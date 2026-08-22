import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createServerClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";

// Stripe Customer Portal: self-service subscription management (cancel,
// update card, view invoices) on a Stripe-hosted page. Keeps us out of the
// business of building billing UI and out of users' payment details.
export async function POST(_req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
    const supabaseAuth = await createServerClient();
    const { data: auth } = await supabaseAuth.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const supabase = createAdminClient();
    const { data: profile } = await supabase
      .from("profiles").select("stripe_customer_id").eq("id", auth.user.id).single();
    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No subscription found." }, { status: 404 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.getreel.org"}/`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe portal error:", err);
    return NextResponse.json({ error: "Couldn't open billing portal." }, { status: 500 });
  }
}
