import { isSupabaseConfigured, supabase } from "./supabase";

export type StoredDocument = {
  id: string;
  title: string;
  category: string;
  date: string;
  storagePath: string;
  source: "Doktor" | "Licni upload";
  status: "Novi nalaz" | "Arhivirano";
  note: string;
};

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) throw new Error("Supabase nije konfigurisan.");
  return supabase;
}

export async function loadMyDocuments(): Promise<StoredDocument[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("medical_documents")
    .select("id, title, category, source, notes, storage_path, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return data.map((document) => ({
    id: document.id,
    title: document.title,
    category: document.category,
    date: new Intl.DateTimeFormat("bs-BA").format(new Date(document.created_at)),
    storagePath: document.storage_path,
    source: document.source === "patient_upload" ? "Licni upload" : "Doktor",
    status: "Arhivirano",
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

export async function uploadOwnDocument(file: File) {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Prijavite se da biste dodali dokument.");

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
    category: "Ostalo",
    storage_path: storagePath,
    source: "patient_upload",
    notes: "Dokument koji ste samostalno dodali u svoj zdravstveni dosije.",
    file_name: cleanName,
    mime_type: file.type,
    file_size: file.size,
  });
  if (insertError) {
    await client.storage.from("medical-documents").remove([storagePath]);
    throw insertError;
  }
}
