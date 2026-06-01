import { isSupabaseConfigured, supabase } from "./supabase";

export type LinkedPatient = {
  id: string;
  fullName: string;
  inboxAlias: string | null;
};

export type SendPatientReportInput = {
  patientId: string;
  title: string;
  category: string;
  notes: string;
  file: File;
};

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Supabase nije konfigurisan. Dodajte VITE_SUPABASE_URL i VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  return supabase;
}

export async function loadLinkedPatients(): Promise<LinkedPatient[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Prijavite se kao doktor da biste poslali nalaz.");

  const { data: accessRows, error: accessError } = await client
    .from("doctor_patient_access")
    .select("patient_id")
    .eq("doctor_id", user.id)
    .eq("active", true);
  if (accessError) throw accessError;
  if (!accessRows.length) return [];

  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, full_name, inbox_alias")
    .in("id", accessRows.map((row) => row.patient_id))
    .eq("role", "patient");
  if (profileError) throw profileError;

  return profiles.map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    inboxAlias: profile.inbox_alias,
  }));
}

export async function sendPatientReport(input: SendPatientReportInput) {
  const client = requireSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("Prijava je istekla. Prijavite se ponovo.");

  const form = new FormData();
  form.set("patientId", input.patientId);
  form.set("title", input.title);
  form.set("category", input.category);
  form.set("notes", input.notes);
  form.set("file", input.file);

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-patient-report`, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: form,
  });
  const body = await response.json() as { error?: string; documentId?: string; emailSent?: boolean };
  if (!response.ok) throw new Error(body.error || "Slanje nalaza nije uspjelo.");
  return body;
}
