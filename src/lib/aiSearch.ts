import { isSupabaseConfigured, supabase } from "./supabase";

export type AiMetric = {
  source_document_id: string | null;
  parameter: string;
  date: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  status: "CRITICAL_LOW" | "CRITICAL_HIGH" | "NORMAL";
};

export type AiSourceReference = {
  document_id: string | null;
  title: string;
  category: string;
  date: string;
  excerpt: string;
  evidence_type: "pdf_excerpt" | "structured_lab_result" | "database_record";
};

export type AiSearchAnswer = {
  text_summary: string;
  extracted_metrics: AiMetric[];
  ai_recommendation: string;
  ai_warning: string | null;
  sources: AiSourceReference[];
};

export async function askPatientAi(patientId: string, question: string): Promise<AiSearchAnswer> {
  if (!supabase || !isSupabaseConfigured) throw new Error("Supabase is not configured.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has expired.");

  supabase.functions.setAuth(session.access_token);
  const { data, error } = await supabase.functions.invoke("patient-ai-search", {
    body: { patientId, question },
  });
  if (error) {
    const context = "context" in error ? error.context : null;
    if (context instanceof Response) {
      const body = await context.json().catch(() => null);
      if (context.status === 403) {
        throw new Error(body?.error || "Temporary record access is not active. The patient needs to generate a new code.");
      }
      throw new Error(body?.error || "The connection to the database or AI service was interrupted.");
    }
    throw new Error(error.message || "The connection to the database or AI service was interrupted.");
  }
  if (data?.error) throw new Error(data.error);
  return data as AiSearchAnswer;
}
