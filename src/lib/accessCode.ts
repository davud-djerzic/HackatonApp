import type { AccessCodeRecord } from "../types";
import { displayNameFromEmail } from "./demoSession";
import { demoStore, safeId, seedDemoHealthData } from "./demoStore";
import { isSupabaseConfigured, supabase } from "./supabase";

const SESSION_KEY = "hope_doctor_visit";

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function mapCode(row: Record<string, unknown>): AccessCodeRecord {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    code: String(row.code),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    usedAt: row.used_at ? String(row.used_at) : null,
    usedByDoctorName: row.used_by_doctor_name ? String(row.used_by_doctor_name) : null,
    createdAt: String(row.created_at),
  };
}

async function resolvePatientId(demoPatientId?: string) {
  if (demoPatientId) return demoPatientId;
  if (!supabase) throw new Error("Nije povezan nalog.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Prijavite se.");
  return user.id;
}

function saveCodeDemo(pid: string, record: AccessCodeRecord) {
  seedDemoHealthData(pid);
  const existing = demoStore.listCodes(pid);
  const active = existing.filter((item) => !item.revokedAt && new Date(item.expiresAt) > new Date());
  if (active.length >= 5) {
    throw new Error("Maksimalno 5 aktivnih kodova. Poništite stari kod.");
  }
  demoStore.saveCodes(pid, [record, ...existing]);
  return record;
}

export async function generateAccessCode(demoPatientId?: string): Promise<AccessCodeRecord> {
  const pid = await resolvePatientId(demoPatientId);
  const code = generateSixDigitCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const record: AccessCodeRecord = {
    id: safeId(),
    patientId: pid,
    code,
    expiresAt,
    revokedAt: null,
    usedAt: null,
    usedByDoctorName: null,
    createdAt: new Date().toISOString(),
  };

  if (demoPatientId || !isSupabaseConfigured || !supabase) {
    return saveCodeDemo(pid, record);
  }

  try {
    const { data, error } = await supabase.from("access_codes").insert({
      patient_id: pid,
      code,
      expires_at: expiresAt,
    }).select("*").single();
    if (error) throw error;
    return mapCode(data as Record<string, unknown>);
  } catch {
    return saveCodeDemo(pid, record);
  }
}

export async function listMyCodes(demoPatientId?: string): Promise<AccessCodeRecord[]> {
  const pid = await resolvePatientId(demoPatientId);
  if (demoPatientId || !isSupabaseConfigured || !supabase) {
    seedDemoHealthData(pid);
    return demoStore.listCodes(pid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  try {
    const { data, error } = await supabase.from("access_codes").select("*").eq("patient_id", pid).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapCode(row as Record<string, unknown>));
  } catch {
    seedDemoHealthData(pid);
    return demoStore.listCodes(pid);
  }
}

export async function revokeAccessCode(codeId: string, demoPatientId?: string) {
  const pid = await resolvePatientId(demoPatientId);
  if (demoPatientId || !isSupabaseConfigured || !supabase) {
    const list = demoStore.listCodes(pid).map((item) =>
      item.id === codeId ? { ...item, revokedAt: new Date().toISOString() } : item,
    );
    demoStore.saveCodes(pid, list);
    return;
  }
  try {
    const { error } = await supabase.from("access_codes").update({ revoked_at: new Date().toISOString() }).eq("id", codeId).eq("patient_id", pid);
    if (error) throw error;
  } catch {
    const list = demoStore.listCodes(pid).map((item) =>
      item.id === codeId ? { ...item, revokedAt: new Date().toISOString() } : item,
    );
    demoStore.saveCodes(pid, list);
  }
}

export type VerifyCodeResult = {
  visitToken: string;
  patientId: string;
  patientName: string;
  codeId: string;
  expiresAt: string;
  accessCode: string;
};

export async function verifyAccessCode(code: string, doctorName: string): Promise<VerifyCodeResult> {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== 6) throw new Error("Kod mora imati 6 cifara.");

  if (!isSupabaseConfigured || !supabase) {
    const found = demoStore.findCode(normalized);
    if (!found) throw new Error("Kod nije pronadjen ili je istekao.");
    const { record, patientId: pid } = found;
    if (record.revokedAt) throw new Error("Kod je ponisten.");
    if (new Date(record.expiresAt) < new Date()) throw new Error("Kod je istekao.");

    const visitToken = safeId();
    const session: VerifyCodeResult = {
      visitToken,
      patientId: pid,
      patientName: displayNameFromEmail(pid),
      codeId: record.id,
      expiresAt: record.expiresAt,
      accessCode: normalized,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, doctorName }));
    return session;
  }

  try {
    const { data, error } = await supabase.functions.invoke("verify-access-code", {
      body: { code: normalized, doctorName },
    });
    if (error) throw new Error(error.message);
    const payload = data as VerifyCodeResult & { error?: string };
    if (payload.error) throw new Error(payload.error);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...payload, doctorName }));
    return payload;
  } catch {
    const found = demoStore.findCode(normalized);
    if (!found) throw new Error("Kod nije pronadjen ili je istekao.");
    const { record, patientId: pid } = found;
    if (record.revokedAt || new Date(record.expiresAt) < new Date()) {
      throw new Error("Kod nije validan.");
    }
    const session: VerifyCodeResult = {
      visitToken: safeId(),
      patientId: pid,
      patientName: displayNameFromEmail(pid),
      codeId: record.id,
      expiresAt: record.expiresAt,
      accessCode: normalized,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, doctorName }));
    return session;
  }
}

export function loadDoctorSession(): (VerifyCodeResult & { doctorName: string }) | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifyCodeResult & { doctorName: string };
    if (new Date(parsed.expiresAt) < new Date()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDoctorSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function formatCodeDisplay(code: string) {
  const digits = code.replace(/\D/g, "").slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}
