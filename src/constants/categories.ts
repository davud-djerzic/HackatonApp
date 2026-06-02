export const DOCUMENT_CATEGORIES = [
  "Laboratorija",
  "Specijalisticki nalaz",
  "Terapija",
  "Snimanje",
  "Ostalo",
] as const;

export const SPECIALIZATIONS = [
  "Ginekologija",
  "Radiologija",
  "Kardiologija",
  "Neurologija",
  "Interna medicina",
  "Ortopedija",
  "Dermatologija",
  "Urologija",
  "Oftalmologija",
  "ORL",
  "Endokrinologija",
  "Gastroenterologija",
  "Pulmologija",
  "Psihijatrija",
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];
