-- Run this file in the Supabase SQL Editor if an existing Auth user cannot
-- open the app because their public.profiles row is missing.

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
