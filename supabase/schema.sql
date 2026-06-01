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
