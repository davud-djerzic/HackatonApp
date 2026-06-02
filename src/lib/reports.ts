import { isSupabaseConfigured, supabase } from "./supabase";

export type SendPatientReportInput = {
  patientEmail: string;
  title: string;
  category: string;
  specialty: string;
  notes: string;
  file: File;
};

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  return supabase;
}

export async function sendPatientReport(input: SendPatientReportInput) {
  const client = requireSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("Your session has expired. Sign in again.");

  const form = new FormData();
  form.set("patientEmail", input.patientEmail);
  form.set("title", input.title);
  form.set("category", input.category);
  form.set("specialty", input.specialty);
  form.set("notes", input.notes);
  form.set("file", input.file);

  try {
    client.functions.setAuth(session.access_token);
    const { data, error } = await client.functions.invoke("send-patient-report", { body: form });
    if (error) {
      const context = "context" in error ? error.context : undefined;
      let serverMessage = "";
      if (context instanceof Response) {
        const body = await context.json().catch(() => ({})) as { error?: string };
        serverMessage = body.error || "";
      } else if (context instanceof Error) {
        serverMessage = context.message;
      } else if (context && typeof context === "object" && "error" in context && typeof context.error === "string") {
        serverMessage = context.error;
      } else if (context && typeof context === "object" && "message" in context && typeof context.message === "string") {
        serverMessage = context.message;
      } else if (typeof context === "string") {
        serverMessage = context;
      }
      throw new Error(serverMessage ? `${error.message}: ${serverMessage}` : error.message);
    }
    return data as { documentId?: string; emailSent?: boolean; extractedLabResults?: number; extractionWarning?: string | null };
  } catch (error) {
    if (error instanceof Error && error.message !== "Failed to fetch") throw error;
    throw new Error("Unable to connect to the server. Restart the application and check your internet connection.", { cause: error });
  }
}
