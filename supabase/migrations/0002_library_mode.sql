-- Library mode: grabs are no longer a short-lived pairing code, they persist so the
-- web companion can browse them as a gallery. Add created_at for display/sorting and
-- stop requiring expires_at (still present, unused, in case TTL semantics ever return).
alter table public.grabs
  add column if not exists created_at timestamptz not null default now();

alter table public.grabs
  alter column expires_at drop not null;

create index if not exists grabs_created_at_idx on public.grabs (created_at desc);
