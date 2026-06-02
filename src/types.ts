export type DiagnosisStatus = "aktivan" | "rijesen" | "u pracenju";

export type ClinicalEvent = {
  date: string;
  type: string;
  title: string;
  detail: string;
  tags: string[];
};

export type MissingEvidence = {
  title: string;
  detail: string;
  status: "Overdue" | "Review" | "Complete";
};

export type TreatmentMemory = {
  keywords: string[];
  date: string;
  symptom: string;
  treatment: string;
  outcome: string;
};

export type Diagnosis = {
  id: string;
  patientId: string;
  title: string;
  icd10Code: string | null;
  description: string | null;
  diagnosedAt: string;
  diagnosedBy: string | null;
  status: DiagnosisStatus;
  doctorAuthored: boolean;
};

export type Medication = {
  id: string;
  patientId: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  prescribedBy: string | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  notes: string | null;
  doctorAuthored: boolean;
};

export type ClinicVisit = {
  id: string;
  patientId: string;
  clinicName: string;
  doctorName: string | null;
  visitDate: string;
  reason: string | null;
  notes: string | null;
  doctorAuthored: boolean;
};

export type AccessCodeRecord = {
  id: string;
  patientId: string;
  code: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  usedByDoctorName: string | null;
  createdAt: string;
};

export type DoctorNote = {
  id: string;
  patientId: string;
  doctorName: string;
  body: string;
  createdAt: string;
};

export type DoctorVisitSession = {
  visitToken: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  codeId: string;
  expiresAt: string;
};

export type AiHealthSummary = {
  summary: string;
  alerts: string[];
  trends: string[];
  suggestions: string[];
};

export type AppView = "dosije" | "dijagnoze" | "terapija" | "statistike" | "pristup";

export type DocumentCategory =
  | "Laboratorija"
  | "Specijalisticki nalaz"
  | "Terapija"
  | "Snimanje"
  | "Ostalo";

export type MedicalDocument = {
  id: number | string;
  title: string;
  category: DocumentCategory;
  specialization?: string;
  doctor: string;
  date: string;
  source: "Doktor" | "Licni upload";
  status: "Novi nalaz" | "Arhivirano";
  note: string;
  storagePath?: string;
};

export type PatientProfile = {
  fullName: string;
  inboxAlias: string | null;
  patientId: string;
};
