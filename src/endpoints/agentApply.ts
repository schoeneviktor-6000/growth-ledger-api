import type { Context } from "hono";
import { supabaseRest } from "../lib/supabaseRest";
import { parseBearer, sha256Hex } from "../lib/agentAuth";

export async function agentApply(c: Context) {
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

  await sb.post("/applications", {
    product_id,
    growth_partner_id: agent_id,
    status: "pending",
  });

  return c.json({ success: true, status: "pending" }, 201);
}
