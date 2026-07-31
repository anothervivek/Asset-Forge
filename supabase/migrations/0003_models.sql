-- Snap3D-generated models get their own table + a public Storage bucket, separate from
-- the `grabs` (image) pipeline. Models are fetched server-side from Snap's artifact URL
-- (see upload-model Edge Function) and re-hosted here so they don't depend on Snap's
-- own URL staying valid, mirroring the "keep forever" library behavior already used
-- for grabs (see migration 0002_library_mode.sql).
create table if not exists public.models (
  code text primary key,
  prompt text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- RLS enabled with no policies: only the service-role key (used exclusively by the
-- upload-model/list-models Edge Functions) can read or write this table.
alter table public.models enable row level security;

create index if not exists models_created_at_idx on public.models (created_at desc);

-- Public bucket: the web companion loads .glb files directly from Storage's public URL
-- via three.js GLTFLoader, no Edge Function round-trip needed for the binary itself.
insert into storage.buckets (id, name, public)
values ('models', 'models', true)
on conflict (id) do nothing;
