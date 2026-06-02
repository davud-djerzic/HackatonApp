-- Run this file in the Supabase SQL Editor.
-- Each authenticated demo clinician can access only their own patient records.

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  birth_date date,
  sex text,
  conditions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.clinical_events (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  event_date date not null,
  event_type text not null,
  title text not null,
  detail text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.treatment_responses (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  symptom text not null,
  intervention text not null,
  outcome text not null,
  documented_at date not null,
  created_at timestamptz not null default now()
);

-- One profile per authenticated account. Patients receive a private inbox
-- address used by the server-side email ingest function.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('patient', 'doctor')),
  full_name text not null,
  inbox_alias text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.medical_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  title text not null,
  category text not null,
  specialty text not null default 'Unclassified',
  storage_path text not null,
  source text not null check (source in ('email', 'patient_upload', 'doctor_upload')),
  sender_email text,
  notes text,
  created_at timestamptz not null default now()
);

-- Written only by a server-side function after webhook signature validation.
-- Store the provider event id so retrying a webhook cannot duplicate a report.
create table if not exists public.email_ingest_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  patient_id uuid references public.profiles(id) on delete set null,
  sender_email text not null,
  recipient_alias text not null,
  status text not null check (status in ('received', 'archived', 'rejected')),
  document_id uuid references public.medical_documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.doctor_patient_access (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (doctor_id, patient_id)
);

create table if not exists public.patient_record_shares (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  doctor_id uuid references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked', 'expired')),
  code_expires_at timestamptz not null,
  access_expires_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.document_access_log (
  id uuid primary key default gen_random_uuid(),
  share_id uuid references public.patient_record_shares(id) on delete set null,
  document_id uuid references public.medical_documents(id) on delete set null,
  viewed_by uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('list', 'preview')),
  created_at timestamptz not null default now()
);

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

create index if not exists lab_results_patient_parameter_date_idx
on public.lab_results (patient_id, parameter_name, result_date desc);

alter table public.medical_documents
  add column if not exists specialty text not null default 'Unclassified',
  add column if not exists lab_extraction_status text not null default 'not_requested'
    check (lab_extraction_status in ('not_requested', 'pending', 'completed', 'no_results', 'failed', 'not_configured')),
  add column if not exists lab_extraction_count integer not null default 0,
  add column if not exists lab_extraction_error text,
  add column if not exists extracted_document_text text,
  add column if not exists extracted_document_json jsonb;

create index if not exists medical_documents_patient_specialty_created_idx
on public.medical_documents (patient_id, specialty, created_at desc);

create or replace function public.generate_patient_share_code()
returns table (share_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_code text;
  expiration timestamptz := now() + interval '10 minutes';
begin
  if not exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'patient'
  ) then
    raise exception 'Only patients can generate share codes';
  end if;

  update public.patient_record_shares
  set status = 'revoked'
  where patient_id = (select auth.uid()) and status = 'pending';

  generated_code := upper(substr(md5(gen_random_uuid()::text), 1, 4) || '-' || substr(md5(gen_random_uuid()::text), 1, 4) || '-' || substr(md5(gen_random_uuid()::text), 1, 4));

  insert into public.patient_record_shares (patient_id, code_hash, code_expires_at)
  values (
    (select auth.uid()),
    encode(sha256(convert_to(generated_code, 'UTF8')), 'hex'),
    expiration
  );

  return query select generated_code, expiration;
end;
$$;

create or replace function public.redeem_patient_share_code(share_code text)
returns table (share_id uuid, patient_id uuid, patient_name text, access_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_share public.patient_record_shares;
  access_expiration timestamptz := now() + interval '60 minutes';
begin
  if not exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'doctor'
  ) then
    raise exception 'Only doctors can redeem share codes';
  end if;

  select * into selected_share
  from public.patient_record_shares
  where code_hash = encode(sha256(convert_to(upper(trim(share_code)), 'UTF8')), 'hex')
    and status = 'pending'
    and code_expires_at > now()
  for update;

  if selected_share.id is null then
    raise exception 'Share code is invalid or expired';
  end if;

  update public.patient_record_shares
  set doctor_id = (select auth.uid()),
      status = 'active',
      claimed_at = now(),
      access_expires_at = access_expiration
  where id = selected_share.id;

  return query
  select selected_share.id, profile.id, profile.full_name, access_expiration
  from public.profiles profile
  where profile.id = selected_share.patient_id;
end;
$$;

create or replace function public.log_document_preview(preview_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_share_id uuid;
begin
  select share.id into active_share_id
  from public.patient_record_shares share
  join public.medical_documents document on document.patient_id = share.patient_id
  where document.id = preview_document_id
    and share.doctor_id = (select auth.uid())
    and share.status = 'active'
    and share.access_expires_at > now()
  limit 1;

  if active_share_id is null then
    raise exception 'Temporary access is not active';
  end if;

  insert into public.document_access_log (share_id, document_id, viewed_by, action)
  values (active_share_id, preview_document_id, (select auth.uid()), 'preview');
end;
$$;

alter table public.medical_documents
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists email_sent_at timestamptz;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.medical_documents(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.medical_documents(id) on delete cascade,
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  provider text not null default 'sendgrid',
  provider_message_id text,
  status text not null check (status in ('requested', 'accepted', 'delivered', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.email_deliveries
  drop constraint if exists email_deliveries_status_check;
alter table public.email_deliveries
  add constraint email_deliveries_status_check
  check (status in ('requested', 'accepted', 'delivered', 'failed'));

create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.email_deliveries(id) on delete cascade,
  provider_event_id text not null unique,
  event_type text not null,
  reason text,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('medical-documents', 'medical-documents', false)
on conflict (id) do update set public = false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, inbox_alias)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'doctor' then 'doctor' else 'patient' end,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'CareTrace korisnik'), '@', 1)),
    case
      when new.raw_user_meta_data ->> 'role' = 'doctor' then null
      else new.id::text || '@inbox.caretrace.app'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create profiles for users registered before this schema was installed.
insert into public.profiles (id, role, full_name, inbox_alias)
select
  users.id,
  case when users.raw_user_meta_data ->> 'role' = 'doctor' then 'doctor' else 'patient' end,
  coalesce(users.raw_user_meta_data ->> 'full_name', split_part(coalesce(users.email, 'CareTrace korisnik'), '@', 1)),
  case
    when users.raw_user_meta_data ->> 'role' = 'doctor' then null
    else users.id::text || '@inbox.caretrace.app'
  end
from auth.users users
on conflict (id) do nothing;

alter table public.patients enable row level security;
alter table public.clinical_events enable row level security;
alter table public.treatment_responses enable row level security;
alter table public.profiles enable row level security;
alter table public.medical_documents enable row level security;
alter table public.email_ingest_events enable row level security;
alter table public.doctor_patient_access enable row level security;
alter table public.patient_record_shares enable row level security;
alter table public.document_access_log enable row level security;
alter table public.lab_results enable row level security;
alter table public.patient_symptoms enable row level security;
alter table public.notifications enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.email_delivery_events enable row level security;

create policy "Clinicians manage own patients"
on public.patients for all
to authenticated
using ((select auth.uid()) = clinician_id)
with check ((select auth.uid()) = clinician_id);

create policy "Clinicians manage own clinical events"
on public.clinical_events for all
to authenticated
using ((select auth.uid()) = clinician_id)
with check ((select auth.uid()) = clinician_id);

create policy "Clinicians manage own treatment responses"
on public.treatment_responses for all
to authenticated
using ((select auth.uid()) = clinician_id)
with check ((select auth.uid()) = clinician_id);

create policy "Users view own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "Patients view own documents"
on public.medical_documents for select
to authenticated
using ((select auth.uid()) = patient_id);

create policy "Patients upload own documents"
on public.medical_documents for insert
to authenticated
with check (
  (select auth.uid()) = patient_id
  and (select auth.uid()) = uploaded_by
  and source = 'patient_upload'
);

create policy "Doctors view linked patient profiles"
on public.profiles for select
to authenticated
using (
  exists (
    select 1 from public.doctor_patient_access access
    where access.doctor_id = (select auth.uid())
      and access.patient_id = profiles.id
      and access.active
  )
);

create policy "Users view own doctor patient links"
on public.doctor_patient_access for select
to authenticated
using (
  (select auth.uid()) = doctor_id
  or (select auth.uid()) = patient_id
);

create policy "Patients and doctors view relevant record shares"
on public.patient_record_shares for select
to authenticated
using (
  (select auth.uid()) = patient_id
  or (select auth.uid()) = doctor_id
);

create policy "Patients view own document access log"
on public.document_access_log for select
to authenticated
using (
  exists (
    select 1 from public.medical_documents document
    where document.id = document_access_log.document_id
      and document.patient_id = (select auth.uid())
  )
);

create policy "Patients view own lab results"
on public.lab_results for select
to authenticated
using ((select auth.uid()) = patient_id);

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

create policy "Patients manage own symptoms"
on public.patient_symptoms for all
to authenticated
using ((select auth.uid()) = patient_id)
with check ((select auth.uid()) = patient_id);

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

create policy "Doctors view temporarily shared patient profiles"
on public.profiles for select
to authenticated
using (
  exists (
    select 1 from public.patient_record_shares share
    where share.doctor_id = (select auth.uid())
      and share.patient_id = profiles.id
      and share.status = 'active'
      and share.access_expires_at > now()
  )
);

create policy "Doctors view temporarily shared patient documents"
on public.medical_documents for select
to authenticated
using (
  exists (
    select 1 from public.patient_record_shares share
    where share.doctor_id = (select auth.uid())
      and share.patient_id = medical_documents.patient_id
      and share.status = 'active'
      and share.access_expires_at > now()
  )
);

create policy "Doctors view linked patient documents"
on public.medical_documents for select
to authenticated
using (
  exists (
    select 1 from public.doctor_patient_access access
    where access.doctor_id = (select auth.uid())
      and access.patient_id = medical_documents.patient_id
      and access.active
  )
);

create policy "Users view own notifications"
on public.notifications for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users update own notifications"
on public.notifications for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users view relevant email deliveries"
on public.email_deliveries for select
to authenticated
using (
  (select auth.uid()) = doctor_id
  or (select auth.uid()) = patient_id
);

create policy "Users view relevant email delivery events"
on public.email_delivery_events for select
to authenticated
using (
  exists (
    select 1 from public.email_deliveries delivery
    where delivery.id = email_delivery_events.delivery_id
      and (
        delivery.doctor_id = (select auth.uid())
        or delivery.patient_id = (select auth.uid())
      )
  )
);

create policy "Patients download own medical documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'medical-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Patients upload own medical documents storage"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'medical-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Doctors preview temporarily shared medical documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'medical-documents'
  and exists (
    select 1 from public.patient_record_shares share
    where share.doctor_id = (select auth.uid())
      and share.patient_id::text = (storage.foldername(name))[1]
      and share.status = 'active'
      and share.access_expires_at > now()
  )
);

revoke all on function public.generate_patient_share_code() from public;
revoke all on function public.redeem_patient_share_code(text) from public;
revoke all on function public.log_document_preview(uuid) from public;
grant execute on function public.generate_patient_share_code() to authenticated;
grant execute on function public.redeem_patient_share_code(text) to authenticated;
grant execute on function public.log_document_preview(uuid) to authenticated;
