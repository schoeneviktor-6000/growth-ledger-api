export type SupabaseRestClient = {
  get: (path: string) => Promise<any>;
  post: (path: string, body: unknown) => Promise<any>;
  patch: (path: string, body: unknown) => Promise<any>;
};

export function supabaseRest(env: Env): SupabaseRestClient {
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  async function request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      throw new Error(`Supabase REST error ${res.status}: ${text}`);
    }
    return json;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
  };
}
