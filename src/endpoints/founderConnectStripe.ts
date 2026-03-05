import Stripe from "stripe";
import type { Context } from "hono";

export async function founderConnectStripe(c: Context) {
  const body = await c.req.json();
  const founder_id = body?.founder_id;

  if (!founder_id) {
    return c.json({ error: "founder_id is required" }, 400);
  }

  const supabaseUrl = c.env.SUPABASE_URL;
  const serviceKey = c.env.SUPABASE_SERVICE_ROLE_KEY;

  const founderRes = await fetch(
    `${supabaseUrl}/rest/v1/founders?id=eq.${founder_id}&select=id,stripe_account_id`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );

  const founders = await founderRes.json();
  if (!Array.isArray(founders) || founders.length === 0) {
    return c.json({ error: "Founder not found" }, 404);
  }

  let stripeAccountId: string | null = founders[0].stripe_account_id ?? null;

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  if (!stripeAccountId) {
    const account = await stripe.accounts.create({ type: "standard" });
    stripeAccountId = account.id;

    await fetch(`${supabaseUrl}/rest/v1/founders?id=eq.${founder_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        stripe_account_id: stripeAccountId,
        stripe_connect_status: "pending",
      }),
    });
  }

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${c.env.APP_BASE_URL}/connect/refresh`,
    return_url: `${c.env.APP_BASE_URL}/connect/success`,
    type: "account_onboarding",
  });

  return c.json({ url: link.url }, 200);
}
