# Contributing

Thanks for improving Asset Forge.

## Development Setup

Install Lens Studio 5.15.4+ and a Supabase project (a Snap Cloud-provisioned one, or your own). See the [README Quick Start](README.md#quick-start) for the full setup.

## Checks

Before sharing changes:

- Open the Lens in Lens Studio and confirm the Logger panel shows no script errors on load.
- If you touched a Supabase function, keep its self-contained `supabase/functions/*/index.ts` version and the `supabase/functions/_shared/*` version in sync, and run its accompanying `*.test.ts` if one exists.

## Scope

Keep changes symmetric across the stack:

- a new upload/list/delete field needs matching changes in the Edge Function, the migration, the Lens script, and the web companion's rendering of that field
- every mode added to `LensModeSelect` needs its own root `SceneObject` and a documented `@input` wiring
- prefer extending an existing mode's capture/generate/preview/confirm pattern over introducing a new state-management approach

## Documentation

Update docs when changing setup, the upload/list/delete contract, radial menu modes, or web companion behavior. Main entry points:

```txt
README.md
CHANGELOG.md
```

Add a new `CHANGELOG.md` entry for any user-visible change, following the existing `[Phase N]` format.
