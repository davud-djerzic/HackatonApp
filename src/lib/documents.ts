import { isSupabaseConfigured, supabase } from "./supabase";
import { displaySpecialty } from "./specialties";

export type StoredDocument = {
  id: string;
  title: string;
  category: string;
  specialty: string;
  date: string;
  storagePath: string;
  source: "Doctor" | "Personal upload";
  status: "New record" | "Archived";
  note: string;
};

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) throw new Error("Supabase is not configured.");
  return supabase;
}

function isMissingSpecialtyColumn(error: { message?: string; code?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || Boolean(error.message?.includes("specialty"));
}

export function displayCategory(category: string) {
  return ({
    Laboratorija: "Laboratory",
    "Specijalisticki nalaz": "Specialist report",
    Terapija: "Therapy",
    Snimanje: "Imaging",
    Ostalo: "Other",
  } as Record<string, string>)[category] ?? category;
}

export async function loadMyDocuments(): Promise<StoredDocument[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("medical_documents")
    .select("id, title, category, specialty, source, notes, storage_path, created_at")
    .order("created_at", { ascending: false });
  if (error && !isMissingSpecialtyColumn(error)) throw error;
  const fallback = data ? null : await client
    .from("medical_documents")
    .select("id, title, category, source, notes, storage_path, created_at")
    .order("created_at", { ascending: false });
  if (fallback?.error) throw fallback.error;
  const documents = data ?? fallback?.data ?? [];

  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    category: displayCategory(document.category),
    specialty: displaySpecialty("specialty" in document && typeof document.specialty === "string" ? document.specialty : null),
    date: new Intl.DateTimeFormat("en-GB").format(new Date(document.created_at)),
    storagePath: document.storage_path,
    source: document.source === "patient_upload" ? "Personal upload" : "Doctor",
    status: "Archived",
    note: document.notes || "",
  }));
}

export async function createDocumentPreviewUrl(storagePath: string) {
  const { data, error } = await requireSupabase().storage
    .from("medical-documents")
    .createSignedUrl(storagePath, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadOwnDocument(file: File, category: string, specialty: string) {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to add a document.");

  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const storagePath = `${user.id}/${crypto.randomUUID()}/${cleanName}`;
  const { error: uploadError } = await client.storage
    .from("medical-documents")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error: insertError } = await client.from("medical_documents").insert({
    patient_id: user.id,
    uploaded_by: user.id,
    title: file.name.replace(/\.[^/.]+$/, ""),
    category,
    specialty,
    storage_path: storagePath,
    source: "patient_upload",
    notes: "Document added by the patient to their personal health record.",
    file_name: cleanName,
    mime_type: file.type,
    file_size: file.size,
  });
  if (insertError) {
    await client.storage.from("medical-documents").remove([storagePath]);
    if (isMissingSpecialtyColumn(insertError)) {
      throw new Error("Medical specialty classification is not installed yet. Run supabase/document-specialty-flow.sql in the Supabase SQL Editor.");
    }
    throw insertError;
  }
}
