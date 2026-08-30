-- Lets the web companion subscribe to live inserts instead of only polling
-- refreshLibrary() every 8 seconds (see web/index.html). Additive only — the existing
-- polling still works fine on its own; this just enables the faster Realtime path
-- alongside it.
alter publication supabase_realtime add table public.grabs;
alter publication supabase_realtime add table public.models;
