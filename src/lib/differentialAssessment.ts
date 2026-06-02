import { isSupabaseConfigured, supabase } from "./supabase";

export type DifferentialHypothesis = {
  name: string;
  match_score: number;
  rationale: string;
  evidence_for: string[];
  evidence_against_or_missing: string[];
  next_checks: string[];
  urgency: "Low" | "Medium" | "High" | "Urgent";
};

export type DifferentialAssessment = {
  disclaimer: string;
  summary: string;
  hypotheses: DifferentialHypothesis[];
  red_flags: string[];
  missing_data: string[];
  ai_warning: string | null;
};

export async function requestDifferentialAssessment(patientId: string, clinicalQuestion: string): Promise<DifferentialAssessment> {
  if (!supabase || !isSupabaseConfigured) throw new Error("Supabase is not configured.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has expired.");
  supabase.functions.setAuth(session.access_token);
  const { data, error } = await supabase.functions.invoke("differential-assessment", {
    body: { patientId, clinicalQuestion },
  });
  if (error) {
    const context = "context" in error ? error.context : null;
    if (context instanceof Response) {
      const body = await context.json().catch(() => null);
      throw new Error(body?.error || "Differential assessment is currently unavailable.");
    }
    throw new Error(error.message || "Differential assessment is currently unavailable.");
  }
  if (data?.error) throw new Error(data.error);
  return data as DifferentialAssessment;
}
