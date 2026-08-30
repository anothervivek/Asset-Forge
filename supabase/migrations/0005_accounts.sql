-- Lets a Spectacles device be linked to a Supabase Auth user (created via the website's
-- magic-link login), so uploads from a linked device can be scoped to their owner.
-- Backward compatible: an unlinked device behaves exactly as before this migration —
-- grabs.user_id/models.user_id just stay null, same as every row that already exists.

create table if not exists public.pairing_codes (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

-- RLS enabled with no policies: only the service-role key (used exclusively by the
-- create-pairing-code/redeem-pairing-code Edge Functions) can read or write this table.
alter table public.pairing_codes enable row level security;

create table if not exists public.device_links (
  device_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  linked_at timestamptz not null default now()
);

-- RLS enabled with no policies: only the service-role key (used by redeem-pairing-code,
-- and by upload/upload-model to resolve a device's owner) can read or write this table.
alter table public.device_links enable row level security;

alter table public.grabs
  add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.models
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists grabs_user_id_idx on public.grabs (user_id);
create index if not exists models_user_id_idx on public.models (user_id);
