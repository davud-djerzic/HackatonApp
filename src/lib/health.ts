import type { ClinicVisit, Diagnosis, DiagnosisStatus, DoctorNote, Medication } from "../types";
import { demoStore, safeId, seedDemoHealthData } from "./demoStore";
import { isSupabaseConfigured, supabase } from "./supabase";

function requireClient() {
  if (!supabase || !isSupabaseConfigured) return null;
  return supabase;
}

async function patientId(explicit?: string) {
  if (explicit) return explicit;
  const client = requireClient();
  if (!client) throw new Error("Nije definisan pacijent.");
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Prijavite se.");
  return user.id;
}

function mapDiagnosis(row: Record<string, unknown>): Diagnosis {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    title: String(row.title),
    icd10Code: row.icd10_code ? String(row.icd10_code) : null,
    description: row.description ? String(row.description) : null,
    diagnosedAt: String(row.diagnosed_at),
    diagnosedBy: row.diagnosed_by ? String(row.diagnosed_by) : null,
    status: row.status as DiagnosisStatus,
    doctorAuthored: Boolean(row.doctor_authored),
  };
}

function mapMedication(row: Record<string, unknown>): Medication {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    name: String(row.name),
    dosage: row.dosage ? String(row.dosage) : null,
    frequency: row.frequency ? String(row.frequency) : null,
    prescribedBy: row.prescribed_by ? String(row.prescribed_by) : null,
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    active: Boolean(row.active),
    notes: row.notes ? String(row.notes) : null,
    doctorAuthored: Boolean(row.doctor_authored),
  };
}

function mapVisit(row: Record<string, unknown>): ClinicVisit {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    clinicName: String(row.clinic_name),
    doctorName: row.doctor_name ? String(row.doctor_name) : null,
    visitDate: String(row.visit_date),
    reason: row.reason ? String(row.reason) : null,
    notes: row.notes ? String(row.notes) : null,
    doctorAuthored: Boolean(row.doctor_authored),
  };
}

export async function loadDiagnoses(forPatientId?: string, demoPatientId?: string): Promise<Diagnosis[]> {
  const pid = demoPatientId ?? await patientId(forPatientId).catch(() => null);
  if (!pid || demoPatientId) {
    if (!pid) return [];
    seedDemoHealthData(pid);
    return demoStore.listDiagnoses(pid);
  }
  const client = requireClient();
  if (!client) {
    seedDemoHealthData(pid);
    return demoStore.listDiagnoses(pid);
  }
  const { data, error } = await client.from("diagnoses").select("*").eq("patient_id", pid).order("diagnosed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapDiagnosis(row as Record<string, unknown>));
}

export async function addDiagnosis(
  input: Omit<Diagnosis, "id" | "patientId" | "doctorAuthored"> & { doctorAuthored?: boolean },
  forPatientId?: string,
  demoPatientId?: string,
) {
  const pid = demoPatientId ?? await patientId(forPatientId);
  const item: Diagnosis = {
    id: safeId(),
    patientId: pid,
    doctorAuthored: input.doctorAuthored ?? false,
    ...input,
  };

  const client = requireClient();
  if (!client || demoPatientId) {
    seedDemoHealthData(pid);
    const list = demoStore.listDiagnoses(pid);
    demoStore.saveDiagnoses(pid, [item, ...list]);
    return item;
  }

  const { data, error } = await client.from("diagnoses").insert({
    patient_id: pid,
    title: item.title,
    icd10_code: item.icd10Code,
    description: item.description,
    diagnosed_at: item.diagnosedAt,
    diagnosed_by: item.diagnosedBy,
    status: item.status,
    doctor_authored: item.doctorAuthored,
  }).select("*").single();
  if (error) throw error;
  return mapDiagnosis(data as Record<string, unknown>);
}

export async function loadMedications(forPatientId?: string, demoPatientId?: string): Promise<Medication[]> {
  const pid = demoPatientId ?? await patientId(forPatientId).catch(() => null);
  if (!pid || demoPatientId) {
    if (!pid) return [];
    seedDemoHealthData(pid);
    return demoStore.listMedications(pid);
  }
  const client = requireClient();
  if (!client) {
    seedDemoHealthData(pid);
    return demoStore.listMedications(pid);
  }
  const { data, error } = await client.from("medications").select("*").eq("patient_id", pid).order("active", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapMedication(row as Record<string, unknown>));
}

export async function addMedication(
  input: Omit<Medication, "id" | "patientId" | "doctorAuthored"> & { doctorAuthored?: boolean },
  forPatientId?: string,
  demoPatientId?: string,
) {
  const pid = demoPatientId ?? await patientId(forPatientId);
  const item: Medication = { id: safeId(), patientId: pid, doctorAuthored: input.doctorAuthored ?? false, ...input };

  const client = requireClient();
  if (!client || demoPatientId) {
    seedDemoHealthData(pid);
    demoStore.saveMedications(pid, [item, ...demoStore.listMedications(pid)]);
    return item;
  }

  const { data, error } = await client.from("medications").insert({
    patient_id: pid,
    name: item.name,
    dosage: item.dosage,
    frequency: item.frequency,
    prescribed_by: item.prescribedBy,
    start_date: item.startDate,
    end_date: item.endDate,
    active: item.active,
    notes: item.notes,
    doctor_authored: item.doctorAuthored,
  }).select("*").single();
  if (error) throw error;
  return mapMedication(data as Record<string, unknown>);
}

export async function loadClinicVisits(forPatientId?: string, demoPatientId?: string): Promise<ClinicVisit[]> {
  const pid = demoPatientId ?? await patientId(forPatientId).catch(() => null);
  if (!pid || demoPatientId) {
    if (!pid) return [];
    seedDemoHealthData(pid);
    return demoStore.listVisits(pid);
  }
  const client = requireClient();
  if (!client) {
    seedDemoHealthData(pid);
    return demoStore.listVisits(pid);
  }
  const { data, error } = await client.from("clinic_visits").select("*").eq("patient_id", pid).order("visit_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapVisit(row as Record<string, unknown>));
}

export async function addClinicVisit(
  input: Omit<ClinicVisit, "id" | "patientId" | "doctorAuthored"> & { doctorAuthored?: boolean },
  forPatientId?: string,
  demoPatientId?: string,
) {
  const pid = demoPatientId ?? await patientId(forPatientId);
  const item: ClinicVisit = { id: safeId(), patientId: pid, doctorAuthored: input.doctorAuthored ?? false, ...input };

  const client = requireClient();
  if (!client || demoPatientId) {
    seedDemoHealthData(pid);
    demoStore.saveVisits(pid, [item, ...demoStore.listVisits(pid)]);
    return item;
  }

  const { data, error } = await client.from("clinic_visits").insert({
    patient_id: pid,
    clinic_name: item.clinicName,
    doctor_name: item.doctorName,
    visit_date: item.visitDate,
    reason: item.reason,
    notes: item.notes,
    doctor_authored: item.doctorAuthored,
  }).select("*").single();
  if (error) throw error;
  return mapVisit(data as Record<string, unknown>);
}

export async function loadDoctorNotes(forPatientId?: string, demoPatientId?: string): Promise<DoctorNote[]> {
  const pid = demoPatientId ?? await patientId(forPatientId).catch(() => null);
  if (!pid) return [];
  if (demoPatientId || !requireClient()) {
    seedDemoHealthData(pid);
    return demoStore.listNotes(pid);
  }
  const { data, error } = await requireClient()!.from("doctor_notes").select("*").eq("patient_id", pid).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    patientId: String(row.patient_id),
    doctorName: String(row.doctor_name),
    body: String(row.body),
    createdAt: String(row.created_at),
  }));
}

export async function addDoctorNote(
  body: string,
  doctorName: string,
  forPatientId?: string,
  demoPatientId?: string,
) {
  const pid = demoPatientId ?? await patientId(forPatientId);
  const note: DoctorNote = {
    id: safeId(),
    patientId: pid,
    doctorName,
    body,
    createdAt: new Date().toISOString(),
  };

  const client = requireClient();
  if (!client || demoPatientId) {
    seedDemoHealthData(pid);
    demoStore.saveNotes(pid, [note, ...demoStore.listNotes(pid)]);
    return note;
  }

  const { data, error } = await client.from("doctor_notes").insert({
    patient_id: pid,
    doctor_name: doctorName,
    body,
  }).select("*").single();
  if (error) throw error;
  return {
    id: String(data.id),
    patientId: String(data.patient_id),
    doctorName: String(data.doctor_name),
    body: String(data.body),
    createdAt: String(data.created_at),
  };
}
