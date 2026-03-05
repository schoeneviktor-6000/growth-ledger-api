import type { Context } from "hono";
import { supabaseRest } from "../lib/supabaseRest";

type StripeCheckoutSession = {
  id: string;
  url: string | null;
};

async function stripePost(
  secretKey: string,
  path: string,
  params: Record<string, string>,
  stripeAccount?: string | null
) {
  const body = new URLSearchParams(params);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (stripeAccount) {
    headers["Stripe-Account"] = stripeAccount;
  }

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers,
    body,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`Stripe error ${res.status}: ${text}`);
  }

  return json;
}

export async function checkoutCreate(c: Context) {
  const body = await c.req.json();

  const referral_code = body?.referral_code;
  const product_id = body?.product_id;
  const customer_email = body?.customer_email ?? undefined;

  if (!referral_code) {
    return c.json({ error: "referral_code is required" }, 400);
  }

  if (!product_id) {
    return c.json({ error: "product_id is required" }, 400);
  }

  const sb = supabaseRest(c.env);

  // 1️⃣ Find referral
  const refRows = await sb.get(
    `/referrals?referral_code=eq.${encodeURIComponent(
      referral_code
    )}&product_id=eq.${product_id}&select=id,growth_partner_id,product_id`
  );

  if (!Array.isArray(refRows) || refRows.length === 0) {
    return c.json({ error: "Referral not found for this product" }, 404);
  }

  const referral = refRows[0];

  // 2️⃣ Load product
  const prodRows = await sb.get(
    `/products?id=eq.${product_id}&select=id,founder_id,stripe_price_id,pricing_type,currency`
  );

  if (!Array.isArray(prodRows) || prodRows.length === 0) {
    return c.json({ error: "Product not found" }, 404);
  }

  const product = prodRows[0];

  if (!product.stripe_price_id) {
    return c.json({ error: "Product missing stripe_price_id" }, 400);
  }

  // 3️⃣ Load founder
  const founderRows = await sb.get(
    `/founders?id=eq.${product.founder_id}&select=id,stripe_account_id`
  );

  if (!Array.isArray(founderRows) || founderRows.length === 0) {
    return c.json({ error: "Founder not found" }, 404);
  }

  const founder = founderRows[0];

  const successUrl = `${c.env.APP_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${c.env.APP_BASE_URL}/checkout/cancel`;

  const mode = product.pricing_type === "one_off" ? "payment" : "subscription";

  const params: Record<string, string> = {
    mode,
    "line_items[0][price]": product.stripe_price_id,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: referral.id,
  };

  if (customer_email) {
    params["customer_email"] = customer_email;
  }

  const stripeAccount = founder.stripe_account_id ?? null;

  const session = (await stripePost(
    c.env.STRIPE_SECRET_KEY,
    "/checkout/sessions",
    params,
    stripeAccount
  )) as StripeCheckoutSession;

  if (!session.url) {
    return c.json({ error: "Stripe did not return checkout URL" }, 500);
  }

  // 4️⃣ Store checkout session
  const stripeAccountIdToStore = founder.stripe_account_id ?? "platform";

  await sb.post("/checkout_sessions", {
    product_id,
    growth_partner_id: referral.growth_partner_id,
    referral_id: referral.id,
    stripe_checkout_session_id: session.id,
    stripe_account_id: stripeAccountIdToStore,
    status: "created",
  });

  return c.json(
    {
      checkout_url: session.url,
      stripe_checkout_session_id: session.id,
    },
    201
  );
}
