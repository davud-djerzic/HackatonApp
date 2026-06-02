-- Run this file once in the Supabase SQL Editor.
-- It adds a medical specialty classification used for document filtering.

alter table public.medical_documents
  add column if not exists specialty text not null default 'Unclassified';

create index if not exists medical_documents_patient_specialty_created_idx
on public.medical_documents (patient_id, specialty, created_at desc);
