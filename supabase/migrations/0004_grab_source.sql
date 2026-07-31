-- AI Gen mode (GeminiTextureGenerate.ts) uploads through the same `grabs` pipeline as
-- pinch-captured photos (see the `upload` Edge Function), but the web companion needs to
-- tell them apart: AI-generated images skip PBR-map derivation and show as a flat,
-- ready-to-download image instead of going through the material pipeline. `source`
-- distinguishes the two; `prompt` mirrors the `models` table's own column (migration
-- 0003_models.sql) so an AI Gen item can show what was typed, same as a 3D Gen one.
alter table public.grabs
  add column if not exists source text not null default 'capture';

alter table public.grabs
  add column if not exists prompt text;

create index if not exists grabs_source_idx on public.grabs (source);
