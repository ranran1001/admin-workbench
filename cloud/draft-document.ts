// Supabase Edge Function named draft-document. Set DEEPSEEK_API_KEY and
// ALLOWED_EMAIL under Edge Functions > Secrets. Never paste secrets into GitHub.
const origin = "https://ranran1001.github.io";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (request.headers.get("Origin") !== origin) return reply({ error: "origin_denied" }, 403);
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "login_required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const allowedEmail = Deno.env.get("ALLOWED_EMAIL");
  if (!url || !publicKey || !apiKey || !allowedEmail)
    return reply({ error: "server_not_configured" }, 503);
  const profile = await fetch(url + "/auth/v1/user", {
    headers: { apikey: publicKey, Authorization: auth },
  });
  if (!profile.ok) return reply({ error: "login_expired" }, 401);
  const user = await profile.json();
  if (String(user.email || "").toLowerCase() !== allowedEmail.toLowerCase())
    return reply({ error: "account_not_allowed" }, 403);

  let prompt: unknown;
  try {
    prompt = (await request.json()).prompt;
  } catch {
    return reply({ error: "invalid_json" }, 400);
  }
  if (typeof prompt !== "string" || prompt.length < 10 || prompt.length > 12000)
    return reply({ error: "prompt_length_invalid" }, 400);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        max_tokens: 2200,
        messages: [
          {
            role: "system",
            content: "你是中文行政公文起草助手。只根据用户提供的事实起草，不虚构人员、日期、政策依据或审批结论。缺失信息用【待核实】标记。只输出可编辑草稿。",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) return reply({ error: "deepseek_request_failed_" + response.status }, 502);
    const result = await response.json();
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      return reply({ error: "deepseek_empty_response" }, 502);
    return reply({ text });
  } catch {
    return reply({ error: "deepseek_network_error" }, 502);
  }
});
