-- CareTrace extension: health profile, access codes, doctor audit

create table if not exists public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  icd10_code text,
  description text,
  diagnosed_at date not null,
  diagnosed_by text,
  status text not null default 'aktivan' check (status in ('aktivan', 'rijesen', 'u pracenju')),
  doctor_authored boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  clinic_name text not null,
  doctor_name text,
  visit_date date not null,
  reason text,
  notes text,
  doctor_authored boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dosage text,
  frequency text,
  prescribed_by text,
  start_date date,
  end_date date,
  active boolean not null default true,
  notes text,
  doctor_authored boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  code char(6) not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  revoked_at timestamptz,
  used_at timestamptz,
  used_by_doctor_name text,
  created_at timestamptz not null default now(),
  unique (code)
);

create table if not exists public.doctor_access_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  access_code_id uuid references public.access_codes(id) on delete set null,
  doctor_name text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.doctor_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  doctor_name text not null,
  body text not null,
  doctor_authored boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists diagnoses_patient_idx on public.diagnoses (patient_id, diagnosed_at desc);
create index if not exists medications_patient_idx on public.medications (patient_id, active desc);
create index if not exists clinic_visits_patient_idx on public.clinic_visits (patient_id, visit_date desc);
create index if not exists access_codes_patient_idx on public.access_codes (patient_id, created_at desc);
create index if not exists access_codes_code_idx on public.access_codes (code) where revoked_at is null;

alter table public.diagnoses enable row level security;
alter table public.clinic_visits enable row level security;
alter table public.medications enable row level security;
alter table public.access_codes enable row level security;
alter table public.doctor_access_logs enable row level security;
alter table public.doctor_notes enable row level security;

create policy "patient_own_diagnoses" on public.diagnoses
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "patient_own_visits" on public.clinic_visits
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "patient_own_medications" on public.medications
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "patient_own_access_codes" on public.access_codes
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "patient_own_doctor_notes" on public.doctor_notes
  for select to authenticated
  using (auth.uid() = patient_id);

create policy "patient_own_access_logs" on public.doctor_access_logs
  for select to authenticated
  using (auth.uid() = patient_id);
