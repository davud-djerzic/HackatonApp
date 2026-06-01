export type ClinicalEvent = {
  date: string;
  type: string;
  title: string;
  detail: string;
  tags: string[];
};

export type ScoredEvent = ClinicalEvent & {
  hits: number;
  score: number;
};

export type TreatmentMemory = {
  keywords: string[];
  date: string;
  symptom: string;
  treatment: string;
  outcome: string;
};

export type MissingEvidence = {
  title: string;
  detail: string;
  status: "Overdue" | "Review";
};
