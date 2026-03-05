import type { Context } from "hono";
import { supabaseRest } from "../lib/supabaseRest";
import { parseBearer, sha256Hex } from "../lib/agentAuth";

function makeReferralCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function referralCreate(c: Context) {
  const body = await c.req.json();
  const product_id = body?.product_id;
  if (!product_id) return c.json({ error: "product_id is required" }, 400);

  const token = parseBearer(c.req.header("Authorization"));
  if (!token) return c.json({ error: "Missing Bearer token" }, 401);

  const sb = supabaseRest(c.env);
  const tokenHash = await sha256Hex(token);

  const rows = await sb.get(`/ai_agents?api_key_hash=eq.${tokenHash}&select=id,status`);
  if (!Array.isArray(rows) || rows.length === 0) return c.json({ error: "Invalid api key" }, 401);
  if (rows[0].status !== "active") return c.json({ error: "Agent revoked" }, 403);

  const agent_id = rows[0].id;

  const referral_code = `ref_${makeReferralCode()}`;

  const created = await sb.post("/referrals", {
    product_id,
    growth_partner_id: agent_id,
    referral_code,
  });

  return c.json({ success: true, referral_code, created }, 201);
}
