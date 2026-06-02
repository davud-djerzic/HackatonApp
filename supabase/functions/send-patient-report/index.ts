import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

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
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "report.pdf";
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
    if (!authorization) return json({ error: "Authentication is required." }, 401);
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    if (!accessToken || accessToken === authorization) return json({ error: "Authentication is invalid." }, 401);

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
    if (userError || !user) return json({ error: "Your session has expired." }, 401);

    const form = await request.formData();
    const patientEmail = String(form.get("patientEmail") ?? "").trim().toLowerCase();
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const specialty = String(form.get("specialty") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const file = form.get("file");

    if (!patientEmail || !patientEmail.includes("@")) return json({ error: "Enter a valid patient email address." }, 400);
    if (!title || title.length > 160) return json({ error: "The report title is invalid." }, 400);
    if (!category || category.length > 80) return json({ error: "The document type is invalid." }, 400);
    if (!specialty || specialty.length > 80) return json({ error: "The medical specialty is invalid." }, 400);
    if (!(file instanceof File)) return json({ error: "A PDF report is required." }, 400);
    if (file.type !== "application/pdf") return json({ error: "Only PDF documents are allowed." }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ error: "The PDF document must not exceed 10 MB." }, 400);

    const { data: doctor } = await admin
      .from("profiles").select("id, full_name, role").eq("id", user.id).single();
    if (!doctor || doctor.role !== "doctor") return json({ error: "Only a doctor can send a report." }, 403);

    const { data: authUsers, error: authUsersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authUsersError) throw authUsersError;
    const authUser = authUsers.users.find((candidate) => candidate.email?.toLowerCase() === patientEmail);
    if (!authUser) return json({ error: "A patient with this email address does not have a HOPE account." }, 404);
    const patientId = authUser.id;

    const { data: patient } = await admin
      .from("profiles").select("id, full_name, role").eq("id", patientId).single();
    if (!patient || patient.role !== "patient") return json({ error: "This email address does not belong to a HOPE patient." }, 400);

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
        specialty,
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

    await admin.from("medical_documents").update({
      lab_extraction_status: "pending",
      lab_extraction_count: 0,
      lab_extraction_error: null,
    }).eq("id", documentId);

    await admin.from("notifications").insert({
      user_id: patientId,
      document_id: documentId,
      title: "New medical document",
      body: "A doctor added a new document to your health record.",
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
        from: { email: sendgridFromEmail, name: "HOPE" },
        subject: "A new document is available in your HOPE record",
        content: [{
          type: "text/html",
          value: `<p>Dear ${escapeHtml(patient.full_name)},</p><p>A new document has been added to your HOPE health record.</p><p><a href="${escapeHtml(appUrl)}">Sign in to HOPE</a> to review it securely.</p><p>To protect your privacy, the medical document was not included as an email attachment.</p>`,
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
      return json({ error: "The report was archived, but the email notification could not be sent.", documentId }, 502);
    }

    await Promise.all([
      admin.from("email_deliveries").update({
        status: "accepted",
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
      }).eq("id", delivery.id),
      admin.from("medical_documents").update({ email_sent_at: new Date().toISOString() }).eq("id", documentId),
    ]);

    EdgeRuntime.waitUntil(fetch(`${supabaseUrl}/functions/v1/extract-medical-document`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documentId }),
    }).catch((error) => console.error("Extraction trigger failed", error)));

    return json({
      documentId,
      emailSent: true,
      extractedLabResults: 0,
      extractionWarning: "The PDF has been saved. Content analysis is running in the background.",
    });
  } catch (error) {
    console.error(error);
    if (documentPath && !documentId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceRoleKey) {
        await createClient(supabaseUrl, serviceRoleKey).storage.from("medical-documents").remove([documentPath]);
      }
    }
    return json({ error: "A server error occurred while sending the report." }, 500);
  }
});
