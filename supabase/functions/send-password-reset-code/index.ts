import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

const CODE_TTL_MINUTES = 15;
const MAX_CODES_PER_HOUR = 5;

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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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
    const { email: rawEmail } = await request.json() as { email?: string };
    const email = String(rawEmail ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json({ error: "Unesite ispravnu email adresu." }, 400);

    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const sendgridApiKey = requiredSecret("SENDGRID_API_KEY");
    const sendgridFromEmail = requiredSecret("SENDGRID_FROM_EMAIL");

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await admin
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", since);

    if ((recentCount ?? 0) >= MAX_CODES_PER_HOUR) {
      return json({ error: "Previse zahtjeva. Pokusajte ponovo za sat vremena." }, 429);
    }

    const { data: authData, error: authError } = await admin.auth.admin.getUserByEmail(email);
    if (authError) throw authError;

    // Do not reveal whether the account exists.
    if (!authData.user) {
      return json({ ok: true, message: "Ako nalog postoji, sigurnosni kod je poslan na email." });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profile?.role && profile.role !== "patient") {
      return json({ ok: true, message: "Ako nalog postoji, sigurnosni kod je poslan na email." });
    }

    const code = generateCode();
    const codeHash = await hashCode(email, code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insertError } = await admin.from("password_reset_codes").insert({
      email,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (insertError) throw insertError;

    const sendgridResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: sendgridFromEmail, name: "CareTrace" },
        subject: "CareTrace sigurnosni kod za reset lozinke",
        content: [{
          type: "text/html",
          value: `<p>Postovani/a,</p><p>Vas sigurnosni kod za reset lozinke je:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${escapeHtml(code)}</p><p>Kod vrijedi ${CODE_TTL_MINUTES} minuta. Ako niste trazili reset lozinke, ignorisite ovu poruku.</p>`,
        }],
      }),
    });

    if (!sendgridResponse.ok) {
      const sendgridError = await sendgridResponse.text();
      console.error("SendGrid error:", sendgridError);
      return json({ error: "Email sa kodom nije poslan. Provjerite SendGrid postavke." }, 502);
    }

    return json({ ok: true, message: "Sigurnosni kod je poslan na vas email." });
  } catch (error) {
    console.error(error);
    return json({ error: "Serverska greska pri slanju koda." }, 500);
  }
});
