import { isSupabaseConfigured, supabase } from "./supabase";

export type PatientSymptom = {
  id: string;
  symptomName: string;
  severity: number;
  startedAt: string | null;
  notes: string;
  active: boolean;
};

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function loadMySymptoms(): Promise<PatientSymptom[]> {
  const { data, error } = await requireSupabase().from("patient_symptoms")
    .select("id, symptom_name, severity, started_at, notes, active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((symptom) => ({
    id: symptom.id,
    symptomName: symptom.symptom_name,
    severity: symptom.severity,
    startedAt: symptom.started_at,
    notes: symptom.notes ?? "",
    active: symptom.active,
  }));
}

export async function addMySymptom(input: { symptomName: string; severity: number; startedAt: string; notes: string }) {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Your session has expired.");
  const { error } = await client.from("patient_symptoms").insert({
    patient_id: user.id,
    symptom_name: input.symptomName.trim(),
    severity: input.severity,
    started_at: input.startedAt || null,
    notes: input.notes.trim() || null,
  });
  if (error) throw error;
}
