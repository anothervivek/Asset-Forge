create table if not exists public.grabs (
  code text primary key,
  image text not null,
  expires_at timestamptz not null
);

-- RLS is enabled with no policies: only the service-role key (used exclusively by the
-- upload/grab Edge Functions) can read or write this table, since service-role bypasses
-- RLS entirely. The anon/public key can never reach it directly.
alter table public.grabs enable row level security;
