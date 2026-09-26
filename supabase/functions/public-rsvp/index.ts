// Public RSVP and private first-access activation. No guest table is exposed anonymously.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_KEY = "sb_publishable_hvkc3yS6vxmZFbNvJUU_8w_kMovzv-_";
const allowedOrigins = new Set(["https://vinicius-calegari.github.io", "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]);
const encoder = new TextEncoder();
async function hash(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
type RequestTimings = { databaseMs: number };
async function rpc(name: string, body: Record<string, unknown>, timings?: RequestTimings) {
  const started = performance.now();
  try {
    const result = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST", headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body), ...(timings ? { signal: AbortSignal.timeout(8000) } : {}),
    });
    if (!result.ok) throw new Error("Falha no banco de dados.");
    return await result.json();
  } finally {
    if (timings) timings.databaseMs += performance.now() - started;
  }
}
async function authAdmin(path: string, body?: Record<string, unknown>, method = "POST") {
  const response = await fetch(SUPABASE_URL + "/auth/v1/admin/" + path, {
    method, headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  return { ok: response.ok, data };
}
Deno.serve(async (req: Request) => {
  const started = performance.now();
  const requestId = crypto.randomUUID();
  const timings: RequestTimings = { databaseMs: 0 };
  let operation = "invalid";
  const origin = req.headers.get("origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://vinicius-calegari.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "Server-Timing, X-Request-Id",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json"
  };
  const json = (data: unknown, status = 200) => {
    const durationMs = performance.now() - started;
    // Correlate server and database transport time without logging guest data,
    // IP addresses, invitation phrases, session tokens, or database credentials.
    if (operation === "lookup" || operation === "answer") {
      console.info(JSON.stringify({ requestId, operation, status,
        durationMs: +durationMs.toFixed(1), databaseMs: +timings.databaseMs.toFixed(1) }));
    }
    return new Response(JSON.stringify(data), { status, headers: { ...cors,
      "X-Request-Id": requestId,
      "Server-Timing": `app;dur=${durationMs.toFixed(1)}, db;dur=${timings.databaseMs.toFixed(1)}`,
    } });
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origem não permitida." }, 403);
  try {
    if (Number(req.headers.get("content-length") || 0) > 8192) return json({ error: "Solicitação muito grande." }, 413);
    const raw = await req.text();
    if (raw.length > 8192) return json({ error: "Solicitação muito grande." }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "Solicitação inválida." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Solicitação inválida." }, 400);
    // Body transport avoids a browser preflight. Older clients can keep their apikey header.
    if ((req.headers.get("apikey") || body.appKey) !== PUBLIC_KEY) return json({ error: "Chave de aplicação inválida." }, 401);
    const action = body.action;
    if (!["lookup", "answer", "activate"].includes(String(action))) return json({ error: "Ação inválida." }, 400);
    operation = String(action);
    const forwarded = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    const ip = req.headers.get("cf-connecting-ip") || forwarded || req.headers.get("x-real-ip") || "unknown";
    const fingerprint = await hash(ip + "|" + SERVICE_KEY);
    const keywordHash = typeof body.keyword === "string" && body.keyword.trim()
      ? body.keyword.length <= 100 ? await hash(body.keyword.trim().toLowerCase()) : "invalid"
      : "";
    if (action === "lookup") {
      if (typeof body.name !== "string" || body.name.trim().length < 3 || body.name.length > 180) return json({ error: "Informe seu nome completo." }, 400);
      const last4 = typeof body.last4 === "string" ? body.last4 : "";
      if (last4 && !/^\d{4}$/.test(last4)) return json({ error: "Informe somente os quatro últimos números do telefone." }, 400);
      const sessionToken = token();
      const result = await rpc("rsvp_request", { p_action: action, p_fingerprint: fingerprint, p_keyword_hash: keywordHash,
        p_payload: { name: body.name, last4, token_hash: await hash(sessionToken) } }, timings);
      const { http_status = 200, ...payload } = result;
      return json(payload.guest ? { ...payload, token: sessionToken } : payload, http_status);
    }
    if (action === "answer") {
      if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return json({ error: "Sua sessão expirou. Busque seu nome novamente." }, 400);
      if (!["confirmed", "declined"].includes(String(body.status))) return json({ error: "Escolha uma resposta válida." }, 400);
      if (body.message !== null && (typeof body.message !== "string" || body.message.length > 500)) return json({ error: "O recado deve ter no máximo 500 caracteres." }, 400);
      const result = await rpc("rsvp_request", { p_action: action, p_fingerprint: fingerprint, p_keyword_hash: keywordHash,
        p_payload: { token_hash: await hash(body.token), status: body.status, message: body.message ?? null } }, timings);
      const { http_status = 200, ...payload } = result;
      return json(payload, http_status);
    }
    const allowed = await rpc("rsvp_rate_limit", { p_fingerprint: fingerprint, p_action: action });
    if (!allowed) return json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429);
    if (typeof body.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.code) ||
        typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
        typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
      return json({ error: "Informe o código de acesso, um e-mail válido e uma senha com pelo menos 12 caracteres." }, 400);
    }
    const codeHash = await hash(body.code);
    const reserved = await rpc("reserve_admin_invite", { p_token_hash: codeHash });
    if (!reserved?.side) return json({ error: "Código inválido, expirado ou já utilizado." }, 400);
    const created = await authAdmin("users", { email: body.email.trim().toLowerCase(), password: body.password, email_confirm: true });
    if (!created.ok || !created.data?.id) {
      await rpc("release_admin_invite", { p_token_hash: codeHash });
      return json({ error: "Não foi possível ativar este e-mail. Use um e-mail ainda não cadastrado ou faça login." }, 400);
    }
    try {
      await rpc("finish_admin_invite", { p_token_hash: codeHash, p_user_id: created.data.id });
    } catch {
      await authAdmin("users/" + created.data.id, undefined, "DELETE");
      await rpc("release_admin_invite", { p_token_hash: codeHash });
      return json({ error: "Não foi possível concluir a ativação. Tente novamente." }, 500);
    }
    return json({ ok: true });
  } catch {
    return json({ error: operation === "answer"
      ? "Não foi possível confirmar a resposta do servidor. Busque seu nome novamente para conferir se a resposta foi registrada."
      : "Não foi possível concluir agora. Tente novamente em instantes." }, 503);
  }
});
