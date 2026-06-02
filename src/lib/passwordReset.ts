import { isSupabaseConfigured, supabase } from "./supabase";

type ResetResponse = { ok?: boolean; message?: string; error?: string };

async function parseFunctionError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const body = await context.json().catch(() => ({})) as { error?: string };
      if (body.error) return body.error;
    }
  }
  if (error instanceof Error && error.message !== "Failed to fetch") return error.message;
  return fallback;
}

export async function requestPasswordResetCode(email: string) {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Supabase nije konfigurisan.");
  }

  const { data, error } = await supabase.functions.invoke("send-password-reset-code", {
    body: { email: email.trim().toLowerCase() },
  });

  if (error) {
    throw new Error(await parseFunctionError(error, "Slanje sigurnosnog koda nije uspjelo."));
  }

  const payload = data as ResetResponse;
  if (payload?.error) throw new Error(payload.error);
  return payload?.message ?? "Sigurnosni kod je poslan na vas email.";
}

export async function confirmPasswordReset(email: string, code: string, password: string) {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Supabase nije konfigurisan.");
  }

  const { data, error } = await supabase.functions.invoke("confirm-password-reset", {
    body: {
      email: email.trim().toLowerCase(),
      code: code.trim(),
      password,
    },
  });

  if (error) {
    throw new Error(await parseFunctionError(error, "Reset lozinke nije uspio."));
  }

  const payload = data as ResetResponse;
  if (payload?.error) throw new Error(payload.error);
  return payload?.message ?? "Lozinka je promijenjena.";
}

/** Fallback when Edge Functions are not deployed — uses Supabase Auth OTP recovery. */
export async function requestPasswordResetCodeSupabase(email: string) {
  if (!supabase) throw new Error("Supabase nije konfigurisan.");
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${import.meta.env.VITE_APP_URL || window.location.origin}/`,
  });
  if (error) throw new Error(error.message);
  return "Provjerite email — poslan je sigurnosni kod za reset lozinke.";
}

export async function confirmPasswordResetSupabase(email: string, code: string, password: string) {
  if (!supabase) throw new Error("Supabase nije konfigurisan.");
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: "recovery",
  });
  if (verifyError) throw new Error("Kod nije ispravan ili je istekao.");
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) throw new Error(updateError.message);
  await supabase.auth.signOut();
  return "Lozinka je promijenjena. Prijavite se novom lozinkom.";
}
