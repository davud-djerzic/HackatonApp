-- Run this file once in the Supabase SQL Editor.
-- It adds temporary patient-to-doctor record sharing for the localhost app.

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

alter table public.patient_record_shares enable row level security;
alter table public.document_access_log enable row level security;

drop policy if exists "Patients and doctors view relevant record shares" on public.patient_record_shares;
create policy "Patients and doctors view relevant record shares"
on public.patient_record_shares for select
to authenticated
using (
  (select auth.uid()) = patient_id
  or (select auth.uid()) = doctor_id
);

drop policy if exists "Patients view own document access log" on public.document_access_log;
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

drop policy if exists "Doctors view temporarily shared patient profiles" on public.profiles;
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

drop policy if exists "Doctors view temporarily shared patient documents" on public.medical_documents;
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

drop policy if exists "Doctors preview temporarily shared medical documents" on storage.objects;
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
