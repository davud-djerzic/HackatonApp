-- Run this file once in the Supabase SQL Editor after share-code-flow.sql.
-- It adds patient-entered symptoms for doctor-reviewed differential assessment.

create table if not exists public.patient_symptoms (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  symptom_name text not null,
  severity integer not null check (severity between 1 and 10),
  started_at date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists patient_symptoms_patient_created_idx
on public.patient_symptoms (patient_id, created_at desc);

alter table public.patient_symptoms enable row level security;

drop policy if exists "Patients manage own symptoms" on public.patient_symptoms;
create policy "Patients manage own symptoms"
on public.patient_symptoms for all
to authenticated
using ((select auth.uid()) = patient_id)
with check ((select auth.uid()) = patient_id);

drop policy if exists "Doctors view temporarily shared patient symptoms" on public.patient_symptoms;
create policy "Doctors view temporarily shared patient symptoms"
on public.patient_symptoms for select
to authenticated
using (
  exists (
    select 1 from public.patient_record_shares share
    where share.doctor_id = (select auth.uid())
      and share.patient_id = patient_symptoms.patient_id
      and share.status = 'active'
      and share.access_expires_at > now()
  )
);
