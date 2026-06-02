-- Run this file once in the Supabase SQL Editor after share-code-flow.sql.
-- It adds structured laboratory data used by the doctor AI search assistant.

create table if not exists public.lab_results (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.medical_documents(id) on delete set null,
  result_date date not null,
  parameter_name text not null,
  measured_value numeric not null,
  unit text not null,
  reference_low numeric,
  reference_high numeric,
  created_at timestamptz not null default now()
);

alter table public.medical_documents
  add column if not exists lab_extraction_status text not null default 'not_requested'
    check (lab_extraction_status in ('not_requested', 'pending', 'completed', 'no_results', 'failed', 'not_configured')),
  add column if not exists lab_extraction_count integer not null default 0,
  add column if not exists lab_extraction_error text,
  add column if not exists extracted_document_text text,
  add column if not exists extracted_document_json jsonb;

create index if not exists lab_results_patient_parameter_date_idx
on public.lab_results (patient_id, parameter_name, result_date desc);

alter table public.lab_results enable row level security;

drop policy if exists "Patients view own lab results" on public.lab_results;
create policy "Patients view own lab results"
on public.lab_results for select
to authenticated
using ((select auth.uid()) = patient_id);

drop policy if exists "Doctors view temporarily shared lab results" on public.lab_results;
create policy "Doctors view temporarily shared lab results"
on public.lab_results for select
to authenticated
using (
  exists (
    select 1 from public.patient_record_shares share
    where share.doctor_id = (select auth.uid())
      and share.patient_id = lab_results.patient_id
      and share.status = 'active'
      and share.access_expires_at > now()
  )
);

insert into public.lab_results
  (patient_id, result_date, parameter_name, measured_value, unit, reference_low, reference_high)
values
  ('5abb7458-0a7d-4396-a8db-94ecca719090', '2026-03-01', 'Gvozdje', 15.2, 'umol/L', 10.7, 28.6),
  ('5abb7458-0a7d-4396-a8db-94ecca719090', '2026-04-01', 'Gvozdje', 11.4, 'umol/L', 10.7, 28.6),
  ('5abb7458-0a7d-4396-a8db-94ecca719090', '2026-05-01', 'Gvozdje', 8.9, 'umol/L', 10.7, 28.6),
  ('5abb7458-0a7d-4396-a8db-94ecca719090', '2026-05-01', 'Hemoglobin', 118, 'g/L', 120, 160),
  ('5abb7458-0a7d-4396-a8db-94ecca719090', '2026-05-01', 'Leukociti', 7.1, '10^9/L', 4, 10);
