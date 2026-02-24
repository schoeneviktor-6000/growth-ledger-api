import { z } from "zod";
import Stripe from "stripe";
import type { AppRouteHandler } from "../types";

export const FounderConnectStripeSchema = {
tags: ["founder"],
summary: "Create Stripe Connect onboarding link for founder",
request: {
body: {
content: {
"application/json": {
schema: z.object({
founder_id: z.string().uuid()
})
}
}
}
},
responses: {
200: {
description: "Onboarding URL",
content: {
"application/json": {
schema: z.object({
url: z.string().url()
})
}
}
},
404: {
description: "Founder not found"
},
500: {
description: "Server error"
}
}
} as const;

export const founderConnectStripe: AppRouteHandler<typeof FounderConnectStripeSchema> = async (c) => {
try {
const { founder_id } = c.req.valid("json");

const supabaseUrl = c.env.SUPABASE_URL;
const serviceKey = c.env.SUPABASE_SERVICE_ROLE_KEY;

const foundersRes = await fetch(`${supabaseUrl}/rest/v1/founders?id=eq.${founder_id}&select=id,stripe_account_id`, {
headers: {
apikey: serviceKey,
Authorization: `Bearer ${serviceKey}`
}
});

const founders = await foundersRes.json();
if (!Array.isArray(founders) || founders.length === 0) {
return c.text("Founder not found", 404);
}

let stripeAccountId: string | null = founders[0].stripe_account_id ?? null;

const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
apiVersion: "2023-10-16",
httpClient: Stripe.createFetchHttpClient()
});

if (!stripeAccountId) {
const account = await stripe.accounts.create({
type: "standard"
});
stripeAccountId = account.id;

await fetch(`${supabaseUrl}/rest/v1/founders?id=eq.${founder_id}`, {
method: "PATCH",
headers: {
"Content-Type": "application/json",
apikey: serviceKey,
Authorization: `Bearer ${serviceKey}`
},
body: JSON.stringify({
stripe_account_id: stripeAccountId,
stripe_connect_status: "pending"
})
});
}

const accountLink = await stripe.accountLinks.create({
account: stripeAccountId,
refresh_url: `${c.env.APP_BASE_URL}/connect/refresh`,
return_url: `${c.env.APP_BASE_URL}/connect/success`,
type: "account_onboarding"
});

return c.json({ url: accountLink.url }, 200);
} catch (err: any) {
return c.text(`Error: ${err?.message ?? "unknown"}`, 500);
}
};
