-- Patient-only profiles and password reset codes for email OTP flow.

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_codes_email_created_idx
  on public.password_reset_codes (email, created_at desc);

alter table public.password_reset_codes enable row level security;

-- Only service role (Edge Functions) may read/write reset codes.
revoke all on public.password_reset_codes from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, inbox_alias)
  values (
    new.id,
    'patient',
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'CareTrace korisnik'), '@', 1)),
    new.id::text || '@inbox.caretrace.app'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
