export const documentSpecialties = [
  "General medicine",
  "Laboratory medicine",
  "Cardiology",
  "Gynecology",
  "Urology",
  "Neurology",
  "Gastroenterology",
  "Endocrinology",
  "Pulmonology",
  "Orthopedics",
  "Dermatology",
  "Ophthalmology",
  "ENT",
  "Pediatrics",
  "Psychiatry",
  "Oncology",
  "Radiology",
  "Other",
] as const;

export type DocumentSpecialty = typeof documentSpecialties[number];

export function displaySpecialty(specialty: string | null | undefined) {
  return specialty?.trim() || "Unclassified";
}
