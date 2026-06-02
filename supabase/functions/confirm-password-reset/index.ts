import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

async function hashCode(email: string, code: string) {
  const pepper = Deno.env.get("PASSWORD_RESET_PEPPER") ?? "caretrace-reset";
  const data = new TextEncoder().encode(`${email.toLowerCase()}:${code}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { email: rawEmail, code: rawCode, password: rawPassword } = await request.json() as {
      email?: string;
      code?: string;
      password?: string;
    };

    const email = String(rawEmail ?? "").trim().toLowerCase();
    const code = String(rawCode ?? "").trim();
    const password = String(rawPassword ?? "");

    if (!email || !email.includes("@")) return json({ error: "Email nije validan." }, 400);
    if (!/^\d{6}$/.test(code)) return json({ error: "Sigurnosni kod mora imati 6 cifara." }, 400);
    if (password.length < 8) return json({ error: "Nova lozinka mora imati najmanje 8 znakova." }, 400);

    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const codeHash = await hashCode(email, code);
    const now = new Date().toISOString();

    const { data: resetRow, error: resetError } = await admin
      .from("password_reset_codes")
      .select("id")
      .eq("email", email)
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resetError) throw resetError;
    if (!resetRow) return json({ error: "Kod nije ispravan ili je istekao." }, 400);

    const { data: authData, error: authError } = await admin.auth.admin.getUserByEmail(email);
    if (authError) throw authError;
    if (!authData.user) return json({ error: "Nalog nije pronadjen." }, 404);

    const { error: updateError } = await admin.auth.admin.updateUserById(authData.user.id, {
      password,
    });
    if (updateError) throw updateError;

    await admin
      .from("password_reset_codes")
      .update({ used_at: now })
      .eq("id", resetRow.id);

    return json({ ok: true, message: "Lozinka je uspjesno promijenjena. Mozete se prijaviti." });
  } catch (error) {
    console.error(error);
    return json({ error: "Serverska greska pri resetu lozinke." }, 500);
  }
});
