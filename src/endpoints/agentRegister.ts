import type { Context } from "hono";
import { supabaseRest } from "../lib/supabaseRest";
import { sha256Hex } from "../lib/agentAuth";

function randomKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function agentRegister(c: Context) {
  const body = await c.req.json().catch(() => ({}));
  const full_name = body?.full_name ?? null;
  const email = body?.email ?? null;

  const sb = supabaseRest(c.env);

  const agent_id = crypto.randomUUID();
  const api_key = `gl_agent_${randomKey()}`;
  const api_key_hash = await sha256Hex(api_key);

  await sb.post("/profiles", {
    id: agent_id,
    role: "agent",
    full_name,
    email,
  });

  await sb.post("/growth_partners", {
    id: agent_id,
    partner_type: "agent",
  });

  await sb.post("/ai_agents", {
    id: agent_id,
    api_key_hash,
    status: "active",
  });

  return c.json(
    {
      agent_id,
      api_key,
      note: "Store this api_key now. It will not be shown again.",
    },
    201
  );
}
