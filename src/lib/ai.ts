import type { AiHealthSummary } from "../types";
import type { ClinicVisit } from "../types";
import type { Diagnosis } from "../types";
import type { MedicalDocument } from "../types";
import type { Medication } from "../types";
import { isSupabaseConfigured, supabase } from "./supabase";

const CACHE_KEY = "hope_ai_summary";
const CACHE_TTL_MS = 60 * 60 * 1000;

export function buildPatientDataPayload(
  diagnoses: Diagnosis[],
  medications: Medication[],
  visits: ClinicVisit[],
  documents: MedicalDocument[],
) {
  return {
    diagnoses: diagnoses.map((d) => ({
      title: d.title,
      status: d.status,
      date: d.diagnosedAt,
      doctor: d.diagnosedBy,
    })),
    medications: medications.filter((m) => m.active).map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
    })),
    visits: visits.slice(0, 8).map((v) => ({
      clinic: v.clinicName,
      date: v.visitDate,
      reason: v.reason,
    })),
    documents: documents.slice(0, 12).map((doc) => ({
      title: doc.title,
      category: doc.category,
      date: doc.date,
      note: doc.note,
    })),
  };
}

function mockSummary(): AiHealthSummary {
  return {
    summary: "Zdravstveni dosije pokazuje stabilno pracenje hipertenzije uz aktivnu terapiju. Laboratorijski nalazi su arhivirani i dostupni za pregled.",
    alerts: ["Preporucena je redovna kontrola krvnog pritiska svakih 4-6 sedmica."],
    trends: ["Terapija Ramiprilom je kontinuirana od januara 2026."],
    suggestions: ["Zakazite godisnji laboratorijski pregled ako nije uradjen u zadnjih 12 mjeseci."],
  };
}

export async function fetchAiHealthSummary(patientData: unknown): Promise<AiHealthSummary> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { at: number; data: AiHealthSummary };
      if (Date.now() - parsed.at < CACHE_TTL_MS) return parsed.data;
    } catch { /* ignore */ }
  }

  if (!isSupabaseConfigured || !supabase) {
    const data = mockSummary();
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    return data;
  }

  try {
    const { data, error } = await supabase.functions.invoke("ai-health-summary", {
      body: { patientData },
    });
    if (error) throw error;
    const payload = data as AiHealthSummary & { error?: string };
    if (payload.error) throw new Error(payload.error);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: payload }));
    return payload;
  } catch {
    const data = mockSummary();
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    return data;
  }
}

export function clearAiSummaryCache() {
  sessionStorage.removeItem(CACHE_KEY);
}
