-- Replaces the email/Supabase-Auth account system (migration 0005_accounts.sql) with a
-- much simpler device-code model: no login, no SMTP. Each Lens gets one permanent short
-- code tied to its own device_id; typing that code into the companion shows that device's
-- library. Whoever holds the code can see that device's items — same security model the
-- existing per-item grab codes already have, just scoped to a whole library instead of
-- one photo.
drop table if exists public.pairing_codes;
drop table if exists public.device_links;

create table if not exists public.device_codes (
  device_id text primary key,
  code text unique not null,
  created_at timestamptz not null default now()
);

-- RLS enabled with no policies: only the service-role key (used exclusively by the
-- device-code Edge Function, and by list/list-models to resolve a code to a device) can
-- read or write this table.
alter table public.device_codes enable row level security;

alter table public.grabs drop column if exists user_id;
alter table public.models drop column if exists user_id;

alter table public.grabs
  add column if not exists device_id text;
alter table public.models
  add column if not exists device_id text;

create index if not exists grabs_device_id_idx on public.grabs (device_id);
create index if not exists models_device_id_idx on public.models (device_id);
