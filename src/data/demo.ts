import type { ClinicalEvent, MissingEvidence, TreatmentMemory } from "../types";

export const demoEvents: ClinicalEvent[] = [
  { date:"04 Mar 2026",type:"Follow-up visit",title:"Morning dizziness after medication adjustment",detail:"Patient reported dizziness on standing and fatigue before breakfast. Home blood pressure averaged 108/68 mmHg.",tags:["dizziness","fatigue","morning","blood pressure","medication"] },
  { date:"18 Feb 2026",type:"Medication change",title:"Antihypertensive dose increased",detail:"Ramipril increased from 5 mg to 10 mg daily after elevated home blood pressure readings.",tags:["ramipril","medication","blood pressure","hypertension"] },
  { date:"11 Nov 2025",type:"Primary care visit",title:"Fatigue associated with elevated glucose levels",detail:"Patient described afternoon fatigue and increased thirst. HbA1c measured at 8.1%. Diabetes management plan reviewed.",tags:["fatigue","glucose","diabetes","thirst"] },
  { date:"29 Aug 2025",type:"Urgent consultation",title:"Bilateral ankle swelling and exertional breathlessness",detail:"New bilateral ankle edema with shortness of breath while climbing stairs. Cardiology review requested.",tags:["swollen ankles","edema","shortness of breath","breathlessness","cardiology"] },
  { date:"14 Jun 2025",type:"Medication review",title:"Persistent dry cough discussed",detail:"Patient reported dry cough lasting three weeks after starting ACE inhibitor therapy. No fever or chest pain.",tags:["dry cough","cough","ace inhibitor","ramipril","medication"] },
  { date:"08 Dec 2023",type:"Treatment follow-up",title:"Fatigue improved after iron supplementation",detail:"After three months of oral iron therapy, hemoglobin improved and the patient reported less fatigue during daily activities.",tags:["fatigue","iron","hemoglobin","anemia","treatment response"] },
];

export const demoEvidence: MissingEvidence[] = [
  { title:"HbA1c measurement",detail:"Not found in the last 6 months",status:"Overdue" },
  { title:"Retinal eye exam",detail:"Not found in the last 12 months",status:"Overdue" },
  { title:"Urine microalbumin",detail:"Not found in the last 12 months",status:"Overdue" },
  { title:"Foot examination",detail:"Last documented 10 months ago",status:"Review" },
];

export const treatmentMemories: TreatmentMemory[] = [
  { keywords:["dizziness","morning"],date:"04 Mar 2026",symptom:"Morning dizziness and fatigue",treatment:"Ramipril dose reviewed and home BP monitoring added",outcome:"Dizziness reduced after dose adjustment" },
  { keywords:["cough","coughing","dry cough"],date:"14 Jun 2025",symptom:"Persistent dry cough",treatment:"ACE inhibitor intolerance reviewed",outcome:"Cough resolved after medication change" },
  { keywords:["fatigue","tired","glucose","thirst"],date:"11 Nov 2025",symptom:"Fatigue with elevated glucose",treatment:"Diabetes management plan reinforced",outcome:"HbA1c improved from 8.1% to 7.0%" },
  { keywords:["fatigue","tired","exhaustion","weakness"],date:"08 Dec 2023",symptom:"Persistent fatigue with low hemoglobin",treatment:"Oral iron supplementation for 3 months",outcome:"Hemoglobin improved and fatigue decreased" },
];
