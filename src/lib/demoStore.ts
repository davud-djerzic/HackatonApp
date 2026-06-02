import type { AccessCodeRecord, ClinicVisit, Diagnosis, DoctorNote, Medication } from "../types";

const PREFIX = "hope_demo_";

function key(suffix: string, patientId: string) {
  return `${PREFIX}${suffix}_${patientId}`;
}

export function safeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function read<T>(storageKey: string, fallback: T): T {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as T;
    } catch { /* try next */ }
  }
  return fallback;
}

function write(storageKey: string, value: unknown) {
  const payload = JSON.stringify(value);
  try {
    localStorage.setItem(storageKey, payload);
    return;
  } catch {
    sessionStorage.setItem(storageKey, payload);
  }
}

function listAllKeys(): string[] {
  const keys: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k) keys.push(k);
      }
    } catch { /* ignore */ }
  }
  return keys;
}

export function seedDemoHealthData(patientId: string) {
  const dxKey = key("diagnoses", patientId);
  if (read<Diagnosis[]>(dxKey, []).length > 0) return;

  const diagnoses: Diagnosis[] = [
    {
      id: safeId(),
      patientId,
      title: "Hipertenzija stadij I",
      icd10Code: "I10",
      description: "Kontrola krvnog pritiska jednom mjesecno.",
      diagnosedAt: "2025-11-12",
      diagnosedBy: "Dr. Amila M.",
      status: "aktivan",
      doctorAuthored: false,
    },
    {
      id: safeId(),
      patientId,
      title: "Blaga anemija",
      icd10Code: "D50.9",
      description: null,
      diagnosedAt: "2026-01-08",
      diagnosedBy: "Dr. Dino K.",
      status: "u pracenju",
      doctorAuthored: true,
    },
  ];

  const medications: Medication[] = [
    {
      id: safeId(),
      patientId,
      name: "Ramipril 5 mg",
      dosage: "1 tableta",
      frequency: "jednom dnevno",
      prescribedBy: "Dr. Amila M.",
      startDate: "2026-01-11",
      endDate: null,
      active: true,
      notes: "Uzimati ujutro.",
      doctorAuthored: false,
    },
  ];

  const visits: ClinicVisit[] = [
    {
      id: safeId(),
      patientId,
      clinicName: "Poliklinika Medis",
      doctorName: "Dr. Amila M.",
      visitDate: "2026-05-28",
      reason: "Kontrolni pregled",
      notes: "Pritisak stabilan.",
      doctorAuthored: false,
    },
  ];

  write(dxKey, diagnoses);
  write(key("medications", patientId), medications);
  write(key("visits", patientId), visits);
  write(key("notes", patientId), [] as DoctorNote[]);
  write(key("codes", patientId), [] as AccessCodeRecord[]);
}

export const demoStore = {
  listDiagnoses(patientId: string) {
    return read<Diagnosis[]>(key("diagnoses", patientId), []);
  },
  saveDiagnoses(patientId: string, items: Diagnosis[]) {
    write(key("diagnoses", patientId), items);
  },
  listMedications(patientId: string) {
    return read<Medication[]>(key("medications", patientId), []);
  },
  saveMedications(patientId: string, items: Medication[]) {
    write(key("medications", patientId), items);
  },
  listVisits(patientId: string) {
    return read<ClinicVisit[]>(key("visits", patientId), []);
  },
  saveVisits(patientId: string, items: ClinicVisit[]) {
    write(key("visits", patientId), items);
  },
  listNotes(patientId: string) {
    return read<DoctorNote[]>(key("notes", patientId), []);
  },
  saveNotes(patientId: string, items: DoctorNote[]) {
    write(key("notes", patientId), items);
  },
  listCodes(patientId: string) {
    return read<AccessCodeRecord[]>(key("codes", patientId), []);
  },
  saveCodes(patientId: string, items: AccessCodeRecord[]) {
    write(key("codes", patientId), items);
  },
  findCode(code: string): { patientId: string; record: AccessCodeRecord } | null {
    const storageKeySuffix = `${PREFIX}codes_`;
    for (const storageKey of listAllKeys()) {
      if (!storageKey.startsWith(storageKeySuffix)) continue;
      const patientId = storageKey.replace(storageKeySuffix, "");
      const records = read<AccessCodeRecord[]>(storageKey, []);
      const record = records.find((item) => item.code === code);
      if (record) return { patientId, record };
    }
    return null;
  },
};
