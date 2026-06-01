import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
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

function cleanFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "nalaz.pdf";
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let documentPath: string | null = null;
  let documentId: string | null = null;

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Prijava je obavezna." }, 401);
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    if (!accessToken || accessToken === authorization) return json({ error: "Prijava nije validna." }, 401);

    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const supabaseAnonKey = requiredSecret("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const sendgridApiKey = requiredSecret("SENDGRID_API_KEY");
    const sendgridFromEmail = requiredSecret("SENDGRID_FROM_EMAIL");
    const appUrl = requiredSecret("APP_URL");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !user) return json({ error: "Prijava je istekla." }, 401);

    const form = await request.formData();
    const patientEmail = String(form.get("patientEmail") ?? "").trim().toLowerCase();
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const file = form.get("file");

    if (!patientEmail || !patientEmail.includes("@")) return json({ error: "Unesite validan email pacijenta." }, 400);
    if (!title || title.length > 160) return json({ error: "Naziv nalaza nije validan." }, 400);
    if (!category || category.length > 80) return json({ error: "Vrsta dokumenta nije validna." }, 400);
    if (!(file instanceof File)) return json({ error: "PDF nalaz je obavezan." }, 400);
    if (file.type !== "application/pdf") return json({ error: "Dozvoljen je samo PDF dokument." }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ error: "PDF dokument moze imati najvise 10 MB." }, 400);

    const { data: doctor } = await admin
      .from("profiles").select("id, full_name, role").eq("id", user.id).single();
    if (!doctor || doctor.role !== "doctor") return json({ error: "Samo doktor moze poslati nalaz." }, 403);

    const { data: authUsers, error: authUsersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authUsersError) throw authUsersError;
    const authUser = authUsers.users.find((candidate) => candidate.email?.toLowerCase() === patientEmail);
    if (!authUser) return json({ error: "Pacijent sa ovom email adresom nema CareTrace nalog." }, 404);
    const patientId = authUser.id;

    const { data: patient } = await admin
      .from("profiles").select("id, full_name, role").eq("id", patientId).single();
    if (!patient || patient.role !== "patient") return json({ error: "Email ne pripada CareTrace pacijentu." }, 400);

    const fileName = cleanFileName(file.name);
    documentPath = `${patientId}/${crypto.randomUUID()}/${fileName}`;
    const { error: uploadError } = await admin.storage
      .from("medical-documents").upload(documentPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data: medicalDocument, error: documentError } = await admin
      .from("medical_documents")
      .insert({
        patient_id: patientId,
        uploaded_by: user.id,
        title,
        category,
        storage_path: documentPath,
        source: "doctor_upload",
        sender_email: user.email,
        notes,
        file_name: fileName,
        mime_type: file.type,
        file_size: file.size,
      })
      .select("id").single();
    if (documentError) throw documentError;
    documentId = medicalDocument.id;

    await admin.from("notifications").insert({
      user_id: patientId,
      document_id: documentId,
      title: "Novi medicinski dokument",
      body: "Doktor je dodao novi dokument u vas zdravstveni dosije.",
    });

    const { data: delivery, error: deliveryError } = await admin
      .from("email_deliveries")
      .insert({
        document_id: documentId,
        doctor_id: user.id,
        patient_id: patientId,
        recipient_email: patientEmail,
        status: "requested",
      })
      .select("id").single();
    if (deliveryError) throw deliveryError;

    const sendgridResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: patientEmail, name: patient.full_name }],
          custom_args: { delivery_id: delivery.id },
        }],
        from: { email: sendgridFromEmail, name: "CareTrace" },
        subject: "Novi dokument je dostupan u vasem CareTrace dosijeu",
        content: [{
          type: "text/html",
          value: `<p>Postovani/a ${escapeHtml(patient.full_name)},</p><p>U vas CareTrace zdravstveni dosije je dodan novi dokument.</p><p><a href="${escapeHtml(appUrl)}">Prijavite se u CareTrace</a> da biste ga sigurno pregledali.</p><p>Radi zastite privatnosti, medicinski dokument nije poslan kao email attachment.</p>`,
        }],
      }),
    });

    const providerMessageId = sendgridResponse.headers.get("x-message-id");
    if (!sendgridResponse.ok) {
      const sendgridError = await sendgridResponse.text();
      await admin.from("email_deliveries").update({
        status: "failed",
        error_message: sendgridError.slice(0, 1000),
      }).eq("id", delivery.id);
      return json({ error: "Nalaz je arhiviran, ali email obavijest nije poslana.", documentId }, 502);
    }

    await Promise.all([
      admin.from("email_deliveries").update({
        status: "accepted",
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
      }).eq("id", delivery.id),
      admin.from("medical_documents").update({ email_sent_at: new Date().toISOString() }).eq("id", documentId),
    ]);

    return json({ documentId, emailSent: true });
  } catch (error) {
    console.error(error);
    if (documentPath && !documentId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceRoleKey) {
        await createClient(supabaseUrl, serviceRoleKey).storage.from("medical-documents").remove([documentPath]);
      }
    }
    return json({ error: "Serverska greska pri slanju nalaza." }, 500);
  }
});
