import { isSupabaseConfigured, supabase } from "./supabase";
import { displayCategory } from "./documents";
import { displaySpecialty } from "./specialties";

export type GeneratedShareCode = {
  shareCode: string;
  expiresAt: string;
};

export type SharedPatient = {
  shareId: string;
  patientId: string;
  patientName: string;
  accessExpiresAt: string;
};

export type SharedDocument = {
  id: string;
  title: string;
  category: string;
  specialty: string;
  date: string;
  storagePath: string;
};

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) throw new Error("Supabase is not configured.");
  return supabase;
}

function isMissingSpecialtyColumn(error: { message?: string; code?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || Boolean(error.message?.includes("specialty"));
}

export async function generatePatientShareCode(): Promise<GeneratedShareCode> {
  const { data, error } = await requireSupabase().rpc("generate_patient_share_code");
  if (error) {
    if (error.code === "PGRST202" || error.message.includes("generate_patient_share_code")) {
      throw new Error("The share code function is not installed in the Supabase database. Run supabase/share-code-flow.sql in the SQL Editor.");
    }
    throw error;
  }
  const result = data?.[0];
  if (!result) throw new Error("The share code was not generated.");
  return { shareCode: result.share_code, expiresAt: result.expires_at };
}

export async function redeemPatientShareCode(shareCode: string): Promise<SharedPatient> {
  const { data, error } = await requireSupabase().rpc("redeem_patient_share_code", { share_code: shareCode });
  if (error) {
    if (error.code === "PGRST202" || error.message.includes("redeem_patient_share_code")) {
      throw new Error("The record access function is not installed in the Supabase database. Run supabase/share-code-flow.sql in the SQL Editor.");
    }
    if (error.message.includes("invalid or expired")) throw new Error("The code is invalid or has expired.");
    throw error;
  }
  const result = data?.[0];
  if (!result) throw new Error("Access was not activated.");
  return {
    shareId: result.share_id,
    patientId: result.patient_id,
    patientName: result.patient_name,
    accessExpiresAt: result.access_expires_at,
  };
}

export async function loadActiveSharedPatients(): Promise<SharedPatient[]> {
  const client = requireSupabase();
  const { data: shares, error: sharesError } = await client
    .from("patient_record_shares")
    .select("id, patient_id, access_expires_at")
    .eq("status", "active")
    .gt("access_expires_at", new Date().toISOString())
    .order("claimed_at", { ascending: false });
  if (sharesError) throw sharesError;
  if (!shares.length) return [];

  const patientIds = [...new Set(shares.map((share) => share.patient_id))];
  const { data: profiles, error: profilesError } = await client
    .from("profiles")
    .select("id, full_name")
    .in("id", patientIds);
  if (profilesError) throw profilesError;

  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  return shares.map((share) => ({
    shareId: share.id,
    patientId: share.patient_id,
    patientName: names.get(share.patient_id) ?? "Patient",
    accessExpiresAt: share.access_expires_at,
  }));
}

export async function loadSharedPatientDocuments(patientId: string): Promise<SharedDocument[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("medical_documents")
    .select("id, title, category, specialty, storage_path, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error && !isMissingSpecialtyColumn(error)) throw error;
  const fallback = data ? null : await client
    .from("medical_documents")
    .select("id, title, category, storage_path, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (fallback?.error) throw fallback.error;
  const documents = data ?? fallback?.data ?? [];
  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    category: displayCategory(document.category),
    specialty: displaySpecialty("specialty" in document && typeof document.specialty === "string" ? document.specialty : null),
    storagePath: document.storage_path,
    date: new Intl.DateTimeFormat("en-GB").format(new Date(document.created_at)),
  }));
}

export async function logSharedDocumentPreview(documentId: string) {
  const { error } = await requireSupabase().rpc("log_document_preview", { preview_document_id: documentId });
  if (error) throw error;
}
