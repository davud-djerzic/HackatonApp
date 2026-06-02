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
    const body = await request.json() as {
      code?: string;
      doctorName?: string;
      type?: "diagnosis" | "note";
      payload?: Record<string, unknown>;
    };

    const code = String(body.code ?? "").replace(/\D/g, "");
    const doctorName = String(body.doctorName ?? "Doktor");
    const type = body.type;
    const payload = body.payload ?? {};

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: accessCode } = await admin
      .from("access_codes")
      .select("id, patient_id, expires_at, revoked_at")
      .eq("code", code)
      .maybeSingle();

    if (!accessCode || accessCode.revoked_at) return json({ error: "Kod nije validan." }, 403);
    if (new Date(accessCode.expires_at) < new Date()) return json({ error: "Kod je istekao." }, 403);

    const patientId = accessCode.patient_id;

    if (type === "diagnosis") {
      const { error } = await admin.from("diagnoses").insert({
        patient_id: patientId,
        title: payload.title,
        icd10_code: payload.icd10Code ?? null,
        description: payload.description ?? null,
        diagnosed_at: payload.diagnosedAt ?? new Date().toISOString().slice(0, 10),
        diagnosed_by: doctorName,
        status: payload.status ?? "aktivan",
        doctor_authored: true,
      });
      if (error) throw error;
    } else if (type === "note") {
      const { error } = await admin.from("doctor_notes").insert({
        patient_id: patientId,
        doctor_name: doctorName,
        body: payload.body,
      });
      if (error) throw error;
      await admin.from("notifications").insert({
        user_id: patientId,
        title: "Nova biljeska doktora",
        body: `${doctorName} je dodao biljesku u vas dosije.`,
      });
    } else {
      return json({ error: "Nepoznat tip unosa." }, 400);
    }

    await admin.from("doctor_access_logs").insert({
      patient_id: patientId,
      access_code_id: accessCode.id,
      doctor_name: doctorName,
      action: `write_${type}`,
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Serverska greska." }, 500);
  }
});
