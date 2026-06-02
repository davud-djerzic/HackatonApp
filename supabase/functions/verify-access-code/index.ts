import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { code, doctorName } = await request.json() as { code?: string; doctorName?: string };
    const normalized = String(code ?? "").replace(/\D/g, "");
    if (normalized.length !== 6) return json({ error: "Kod mora imati 6 cifara." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: accessCode, error } = await admin
      .from("access_codes")
      .select("id, patient_id, expires_at, revoked_at, used_at")
      .eq("code", normalized)
      .maybeSingle();

    if (error) throw error;
    if (!accessCode) return json({ error: "Kod nije pronadjen." }, 404);
    if (accessCode.revoked_at) return json({ error: "Kod je ponisten." }, 400);
    if (accessCode.used_at) return json({ error: "Kod je vec iskoristen." }, 400);
    if (new Date(accessCode.expires_at) < new Date()) return json({ error: "Kod je istekao." }, 400);

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", accessCode.patient_id)
      .single();

    const visitToken = crypto.randomUUID();
    const expiresAt = accessCode.expires_at;

    await admin.from("access_codes").update({
      used_at: new Date().toISOString(),
      used_by_doctor_name: doctorName || "Doktor",
    }).eq("id", accessCode.id);

    await admin.from("doctor_access_logs").insert({
      patient_id: accessCode.patient_id,
      access_code_id: accessCode.id,
      doctor_name: doctorName || "Doktor",
      action: "code_verified",
    });

    return json({
      visitToken,
      patientId: accessCode.patient_id,
      patientName: profile?.full_name || "Pacijent",
      codeId: accessCode.id,
      expiresAt,
      accessCode: normalized,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Serverska greska." }, 500);
  }
});
