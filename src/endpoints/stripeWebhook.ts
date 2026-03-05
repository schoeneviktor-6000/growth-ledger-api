import type { Context } from "hono";
import { supabaseRest } from "../lib/supabaseRest";

type CheckoutSessionRow = {
  stripe_checkout_session_id: string;
  stripe_account_id: string;
  product_id: string;
  growth_partner_id: string;
  referral_id: string | null;
  status: string;
};

type ProductRow = {
  id: string;
  founder_id: string;
  commission_percent: number;
  commission_months: number;
  pending_days: number;
};

type LedgerPaymentRow = {
  id: string;
  product_id: string;
  growth_partner_id: string;
  stripe_account_id: string;
};

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string) {
  const parts = sigHeader.split(",").reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts["t"];
  const v1 = parts["v1"];

  if (!timestamp || !v1) {
    throw new Error("Invalid Stripe-Signature header");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (expected.length !== v1.length) {
    throw new Error("Invalid signature");
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  }

  if (diff !== 0) {
    throw new Error("Invalid signature");
  }
}

function isoFromStripeCreated(createdSeconds: number) {
  return new Date(createdSeconds * 1000).toISOString();
}

async function insertStripeEvent(sb: ReturnType<typeof supabaseRest>, event: any) {
  const stripe_account_id = event.account ?? "platform";

  try {
    await sb.post("/stripe_events", {
      id: event.id,
      type: event.type,
      stripe_account_id,
      received_at: new Date().toISOString(),
      payload: event,
    });
    return { inserted: true, stripe_account_id };
  } catch (_e) {
    // likely duplicate event id
    return { inserted: false, stripe_account_id };
  }
}

async function getProduct(
  sb: ReturnType<typeof supabaseRest>,
  product_id: string
): Promise<ProductRow | null> {
  const rows = await sb.get(
    `/products?id=eq.${encodeURIComponent(
      product_id
    )}&select=id,founder_id,commission_percent,commission_months,pending_days`
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] as ProductRow;
}

async function createCommissionForLedgerPayment(
  sb: ReturnType<typeof supabaseRest>,
  ledger_payment_id: string,
  product: ProductRow,
  growth_partner_id: string,
  product_id: string,
  amount_gross: number | null,
  currency: string | null,
  paid_at: string
) {
  const commission_amount =
    amount_gross === null || amount_gross === undefined
      ? null
      : Math.floor(Number(amount_gross) * Number(product.commission_percent));

  const eligible = new Date(paid_at);
  eligible.setUTCDate(eligible.getUTCDate() + Number(product.pending_days ?? 0));
  const eligible_payout_at = eligible.toISOString();

  await sb.post("/commissions", {
    ledger_payment_id,
    founder_id: product.founder_id,
    growth_partner_id,
    product_id,
    commission_amount,
    currency,
    status: "pending",
    eligible_payout_at,
    paid_at: null,
  });
}

async function fetchLedgerPaymentIdByInvoice(
  sb: ReturnType<typeof supabaseRest>,
  stripe_invoice_id: string
): Promise<string | null> {
  const rows = await sb.get(
    `/ledger_payments?stripe_invoice_id=eq.${encodeURIComponent(
      stripe_invoice_id
    )}&select=id&limit=1`
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0].id;
}

async function countPriorLedgerPaymentsBySubscription(
  sb: ReturnType<typeof supabaseRest>,
  stripe_subscription_id: string
): Promise<number> {
  const rows = await sb.get(
    `/ledger_payments?stripe_subscription_id=eq.${encodeURIComponent(
      stripe_subscription_id
    )}&select=id`
  );

  return Array.isArray(rows) ? rows.length : 0;
}

export async function stripeWebhook(c: Context) {
  const sig = c.req.header("Stripe-Signature");
  if (!sig) {
    return c.json({ error: "Missing Stripe-Signature header" }, 400);
  }

  const whsec = c.env.STRIPE_WEBHOOK_SECRET;
  if (!whsec) {
    return c.json({ error: "Missing STRIPE_WEBHOOK_SECRET in env" }, 500);
  }

  const payload = await c.req.text();
  await verifyStripeSignature(payload, sig, whsec);

  const event = JSON.parse(payload);
  const sb = supabaseRest(c.env);

  const stripeEvent = await insertStripeEvent(sb, event);
  if (!stripeEvent.inserted) {
    return c.json({ received: true, deduped: true }, 200);
  }

  const event_type: string = event.type;

  // 1) CHECKOUT SESSION COMPLETED
  // - mark checkout_session as paid
  // - create FIRST ledger_payment + commission if invoice exists
  if (event_type === "checkout.session.completed") {
    const session = event.data?.object;
    const stripe_checkout_session_id: string | undefined = session?.id;

    if (!stripe_checkout_session_id) {
      return c.json({ received: true, warning: "Missing checkout session id" }, 200);
    }

    const csRows = await sb.get(
      `/checkout_sessions?stripe_checkout_session_id=eq.${encodeURIComponent(
        stripe_checkout_session_id
      )}&select=stripe_checkout_session_id,stripe_account_id,product_id,growth_partner_id,referral_id,status`
    );

    if (!Array.isArray(csRows) || csRows.length === 0) {
      return c.json({ received: true, warning: "checkout_sessions row not found" }, 200);
    }

    const cs = csRows[0] as CheckoutSessionRow;

    await sb.patch(
      `/checkout_sessions?stripe_checkout_session_id=eq.${encodeURIComponent(
        stripe_checkout_session_id
      )}`,
      { status: "paid" }
    );

    const stripe_invoice_id: string | null = session?.invoice ?? null;
    const stripe_subscription_id: string | null = session?.subscription ?? null;
    const stripe_customer_id: string | null = session?.customer ?? null;
    const stripe_payment_intent_id: string | null = session?.payment_intent ?? null;
    const amount_gross: number | null = session?.amount_total ?? null;
    const currency: string | null = session?.currency ?? null;
    const paid_at = isoFromStripeCreated(event.created);

    // If Stripe has not attached an invoice yet, we just mark session as paid and stop here.
    if (!stripe_invoice_id) {
      return c.json({ received: true, info: "No invoice on checkout.session.completed" }, 200);
    }

    // Deduplicate first-payment ledger insert
    const existingLedgerId = await fetchLedgerPaymentIdByInvoice(sb, stripe_invoice_id);
    if (existingLedgerId) {
      return c.json({ received: true, deduped: true }, 200);
    }

    await sb.post("/ledger_payments", {
      stripe_account_id: cs.stripe_account_id,
      stripe_event_id: event.id,
      product_id: cs.product_id,
      growth_partner_id: cs.growth_partner_id,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_invoice_id,
      stripe_payment_intent_id,
      amount_gross,
      currency,
      paid_at,
      refund_status: "none",
      refund_at: null,
    });

    const ledger_payment_id = await fetchLedgerPaymentIdByInvoice(sb, stripe_invoice_id);
    if (!ledger_payment_id) {
      return c.json({ received: true, warning: "ledger_payment created but id not found" }, 200);
    }

    const product = await getProduct(sb, cs.product_id);
    if (!product) {
      return c.json({ received: true, warning: "Product not found for commission calc" }, 200);
    }

    await createCommissionForLedgerPayment(
      sb,
      ledger_payment_id,
      product,
      cs.growth_partner_id,
      cs.product_id,
      amount_gross,
      currency,
      paid_at
    );

    return c.json({ received: true }, 200);
  }

  // 2) RECURRING INVOICE PAID
  // - create recurring ledger_payment + commission
  if (event_type === "invoice.paid") {
    const invoice = event.data?.object;

    const stripe_invoice_id: string | null = invoice?.id ?? null;
    const stripe_customer_id: string | null = invoice?.customer ?? null;
    const stripe_subscription_id: string | null = invoice?.subscription ?? null;
    const stripe_payment_intent_id: string | null = invoice?.payment_intent ?? null;
    const amount_gross: number | null = invoice?.amount_paid ?? null;
    const currency: string | null = invoice?.currency ?? null;
    const paid_at = isoFromStripeCreated(event.created);

    if (!stripe_invoice_id) {
      return c.json({ received: true, warning: "invoice.paid missing invoice id" }, 200);
    }

    // Deduplicate by invoice id
    const existingLedgerId = await fetchLedgerPaymentIdByInvoice(sb, stripe_invoice_id);
    if (existingLedgerId) {
      return c.json({ received: true, deduped: true }, 200);
    }

    if (!stripe_subscription_id) {
      return c.json({ received: true, warning: "invoice.paid missing subscription id" }, 200);
    }

    // Attribute recurring invoices via previous ledger_payment on same subscription
    const priorRows = await sb.get(
      `/ledger_payments?stripe_subscription_id=eq.${encodeURIComponent(
        stripe_subscription_id
      )}&select=id,product_id,growth_partner_id,stripe_account_id&order=created_at.asc`
    );

    if (!Array.isArray(priorRows) || priorRows.length === 0) {
      return c.json(
        { received: true, warning: "No prior ledger_payment found for subscription attribution" },
        200
      );
    }

    const prior = priorRows[0] as LedgerPaymentRow;

    await sb.post("/ledger_payments", {
      stripe_account_id: prior.stripe_account_id,
      stripe_event_id: event.id,
      product_id: prior.product_id,
      growth_partner_id: prior.growth_partner_id,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_invoice_id,
      stripe_payment_intent_id,
      amount_gross,
      currency,
      paid_at,
      refund_status: "none",
      refund_at: null,
    });

    const ledger_payment_id = await fetchLedgerPaymentIdByInvoice(sb, stripe_invoice_id);
    if (!ledger_payment_id) {
      return c.json({ received: true, warning: "Recurring ledger_payment id not found" }, 200);
    }

    const product = await getProduct(sb, prior.product_id);
    if (!product) {
      return c.json({ received: true, warning: "Product not found for recurring commission calc" }, 200);
    }

    const priorCount = await countPriorLedgerPaymentsBySubscription(sb, stripe_subscription_id);

    // priorCount includes the current row because we already inserted it.
    // Pay commissions only for first N invoices.
    if (priorCount <= Number(product.commission_months)) {
      await createCommissionForLedgerPayment(
        sb,
        ledger_payment_id,
        product,
        prior.growth_partner_id,
        prior.product_id,
        amount_gross,
        currency,
        paid_at
      );
    }

    return c.json({ received: true }, 200);
  }

  // Ignore all other events
  return c.json({ received: true }, 200);
}
